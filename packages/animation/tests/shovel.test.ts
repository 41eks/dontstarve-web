import { AnimState } from '../src/animState';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { configureShovelEntity, shovelVisual } from '../../prefab/src/shovel';
import { declaredSymbol, overrideArchives } from './animStateFixture';
import * as CANNON from 'cannon-es';
import { PlayerController } from '../../stategraphs/src/playercontroller';
import { Locomotor } from '../../prefab/src/locomotor';
import { WORLD_SCALE } from '../../prefab/src/tile';
import { workTargets } from './workTargets';
import { FarmPlowPlacement } from '../../prefab/src/farm_plow';
import { TurfMap } from '../../prefab/src/turfMap';
import { wilsonPlayerInstance, createWilsonPlayer, type WilsonAnimationController } from './playerVisual';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from '../../prefab/src/groundItems';
import { createGroundItemVisual } from './groundItemVisual';
import type { WorldContext } from '../../prefab/src/worldContext';
import { inventoryItemEquipmentKind, inventoryItemMaxStack } from '../../inventory/src/slots';
import { PlaySound } from '../../prefab/src/sound';
import { createEquipmentExistenceState } from '../../signals/src';
import { ItemEntity } from '../../inventory/src/entity';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop() {} })) }));
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

function setup(player = new THREE.Group(), random = () => 0.9) {
  const world = { scene: new THREE.Scene(), player, camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(),
    renderer: { domElement: new EventTarget() } } as unknown as WorldContext;
  const turf = new TurfMap(96);
  const farm = new FarmPlowPlacement(world, turf, () => {}, undefined, random);
  return { farm, turf, world };
}
function advance(animation: WilsonAnimationController, frames: number) {
  for (let i = 0; i < frames; i++) animation.update(1 / 30);
}

it('loads original ground and separate equipped art, visible skins and hidden equipped symbols', async () => {
  const assets = new GroundItemAssets();
  try {
    const regular = await createGroundItemVisual(assets, 'shovel', 'shovel_feathered');
    const gold = await createGroundItemVisual(assets, 'goldenshovel');
    for (const sprite of [regular, gold]) {
      expect((sprite.model.children[0].children[0].children[0] as THREE.Mesh).geometry.drawRange.count).toBeGreaterThan(0);
      sprite.dispose();
    }
    expect(GROUND_ITEM_DEFINITIONS.shovel).toMatchObject({ bank: 'shovel', animation: 'idle', atlas: 'images/inventoryimages.xml' });
    expect(GROUND_ITEM_DEFINITIONS.goldenshovel).toMatchObject({ bank: 'goldenshovel', animation: 'idle', atlas: 'images/inventoryimages.xml' });
    expect(inventoryItemEquipmentKind('shovel')).toBe('hand');
    expect(inventoryItemMaxStack('goldenshovel')).toBe(1);
    const anim = new AnimState(() => {});
    const owner = { AnimState: anim, PushEvent() {} };
    const equip = (prefab: string, skinId?: string) => shovelVisual({ id: prefab, prefab, skinId }).onequip(owner);
    equip('shovel');
    expect(overrideArchives(anim, 'swap_object')).toEqual(['swap_shovel.zip']);
    equip('goldenshovel');
    expect(overrideArchives(anim, 'swap_object')).toEqual(['swap_goldenshovel.zip']);
    equip('shovel', 'shovel_feathered');
    const frames = (await declaredSymbol(anim, assets, 'swap_object'))!;
    expect(frames).toHaveLength(1);
    expect(frames[0].materials[0].name).toBe('ground:shovel_feathered');
    equip('goldenshovel', 'goldenshovel_invisible');
    expect(await declaredSymbol(anim, assets, 'swap_object')).toHaveLength(0);
  } finally { assets.dispose(); }
});

it('removes one debris with source loot while preserving soil, terrain, other debris and restored state', async () => {
  const random = vi.fn(() => 0.9);
  const { farm, turf } = setup(undefined, random);
  const point = new THREE.Vector3(3, 0, 3), loot = vi.fn(async () => {});
  farm.setDebrisLootHandler(loot);
  try {
    turf.plow(point);
    farm.spawnDecor('farm_soil_debris', point, { animation: 'f2' }, 'garbage');
    // farm_soil_debris.lua: workable DIG with one work.
    const [target] = workTargets('DIG');
    expect(target.id).toBe('garbage');
    farm.spawnDecor('farm_soil', new THREE.Vector3(8, 0, 3), { broken: false }, 'hole');
    farm.spawnDecor('farm_soil_debris', new THREE.Vector3(8, 0, 8), { animation: 'f4' }, 'other');
    random.mockReturnValueOnce(0.1).mockReturnValueOnce(0.99);
    const tiles = turf.exportTiles(), preserved = farm.exportDecorRecords().filter(({ record }) => record.id !== target.id);
    expect(target.work()).toBe(true);
    expect(target.work()).toBe(false);
    expect(loot).toHaveBeenCalledExactlyOnceWith('goldnugget', point);
    expect(turf.exportTiles()).toEqual(tiles);
    expect(farm.exportDecorRecords()).toEqual(preserved);
    farm.dispose();
    const restored = setup();
    try {
      restored.turf.plow(point);
      for (const { prefabId, record } of preserved) restored.farm.spawnDecor(prefabId, new THREE.Vector3(...record.transform.position),
        record.components.farmSoil ?? record.components.farmDebris, record.id);
      expect(restored.farm.exportDecorRecords()).toEqual(preserved);
      expect(workTargets('DIG').map(({ id }) => id)).toEqual(['other']);
    } finally { restored.farm.dispose(); }
  } finally { farm.dispose(); }
});

it('walks into reach, commits DIG at shovel_loop frame 15, and preserves cancelled or unequipped targets', async () => {
  const player = await createWilsonPlayer('/dst/data/anim');
  player.position.set(0, 0, 15);
  const animation = wilsonPlayerInstance(player).animationController as WilsonAnimationController;
  await animation.setCarryItem('goldenshovel');
  expect(PlaySound).toHaveBeenCalledWith('dontstarve/wilson/equip_item_gold');
  const { world, farm, turf } = setup(player);
  const point = new THREE.Vector3(3, 0, 3);
  turf.plow(point);
  farm.spawnDecor('farm_soil_debris', point, { animation: 'f1' }, 'target');
  const equipped = createEquipmentExistenceState('HANDS');
  const tool = new ItemEntity({ itemId: 'goldenshovel', count: 1 });
  configureShovelEntity(tool);
  equipped.set({ itemId: 'goldenshovel', EQUIPSLOTS: 'HANDS', entity: tool });
  const locomotor = new Locomotor({ position: player.position, velocity: new THREE.Vector3() } as unknown as CANNON.Body,
    { physicsRadius: .5 * WORLD_SCALE });
  const controller = new PlayerController(world, animation, locomotor, equipped);
  const dig = () => controller.DoAction(controller.createAction({ action: 'DIG', target: workTargets('DIG')[0].entity, invobject: tool })!);
  try {
    expect(dig()).toBe(true);
    expect(locomotor.destination).toBeDefined();
    player.position.set(3, 0, 4.5); locomotor.update(16, 1 / 30);
    while (animation.stategraph.stateName === 'dig_start') animation.update(1 / 30);
    advance(animation, 14);
    expect(farm.exportDecorRecords()).toHaveLength(1);
    expect(tool.components.finiteuses.remaining).toBeUndefined();
    animation.setFacing('side', true); animation.update(1 / 30);
    expect(farm.exportDecorRecords()).toEqual([]);
    expect(tool.components.finiteuses.remaining).toBe(24.75);
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/wilson/dig');
    advance(animation, 60);
    farm.spawnDecor('farm_soil_debris', point, { animation: 'f3' }, 'preserved');
    const preserved = farm.exportDecorRecords();
    expect(dig()).toBe(true);
    controller.cancel(); advance(animation, 60);
    expect(farm.exportDecorRecords()).toEqual(preserved);
    expect(tool.components.finiteuses.remaining).toBe(24.75);
    expect(dig()).toBe(true);
    equipped.set(null); await animation.setCarryItem(null); advance(animation, 60);
    expect(farm.exportDecorRecords()).toEqual(preserved);
    expect(tool.components.finiteuses.remaining).toBe(24.75);
  } finally { controller.dispose(); farm.dispose(); tool.remove(); }
});

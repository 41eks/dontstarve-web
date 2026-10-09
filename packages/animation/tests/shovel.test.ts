import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadShovelEquipment, resolveShovelPlayerSprite } from '../../prefab/src/shovel';
import { ShovelActionController } from '../../stategraphs/src/shovel';
import { FarmPlowPlacement } from '../../prefab/src/farm_plow';
import { TurfMap } from '../../prefab/src/turfMap';
import { createWilsonPlayer, type WilsonAnimationController } from '../../prefab/src/player';
import { GroundItemAssets, createGroundItemSprite, GROUND_ITEM_DEFINITIONS } from '../../prefab/src/groundItems';
import type { WorldContext } from '../../prefab/src/worldContext';
import { inventoryItemEquipmentKind, inventoryItemMaxStack } from '../../inventory/src/slots';
import { PlaySound } from '../../prefab/src/sound';
import type { AnimElement } from '../src/animationAssets';
import { createHandEquipmentExistenceState } from '../../signals/src';

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
  const farm = new FarmPlowPlacement(world, turf, '/dst/data', async () => {}, () => [], random);
  return { farm, turf, world };
}
function advance(animation: WilsonAnimationController, frames: number) {
  for (let i = 0; i < frames; i++) animation.update(1 / 30);
}

it('loads original ground and separate equipped art, visible skins and hidden equipped symbols', async () => {
  const assets = new GroundItemAssets('/dst/data/anim');
  try {
    const regular = await createGroundItemSprite(assets, 'shovel', 'shovel_feathered');
    const gold = await createGroundItemSprite(assets, 'goldenshovel');
    for (const sprite of [regular, gold]) {
      expect((sprite.model.children[0].children[0] as THREE.Mesh).geometry.drawRange.count).toBeGreaterThan(0);
      sprite.dispose();
    }
    expect(GROUND_ITEM_DEFINITIONS.shovel).toMatchObject({ bank: 'shovel', animation: 'idle', atlas: 'images/inventoryimages.xml' });
    expect(GROUND_ITEM_DEFINITIONS.goldenshovel).toMatchObject({ bank: 'goldenshovel', animation: 'idle', atlas: 'images/inventoryimages.xml' });
    expect(inventoryItemEquipmentKind('shovel')).toBe('hand');
    expect(inventoryItemMaxStack('goldenshovel')).toBe(1);
    expect((await loadShovelEquipment(assets, 'shovel')).builds[0].build.name).toBe('swap_shovel');
    expect((await loadShovelEquipment(assets, 'goldenshovel')).builds[0].build.name).toBe('swap_goldenshovel');
    const skin = await loadShovelEquipment(assets, 'shovel', 'shovel_feathered');
    const frames = resolveShovelPlayerSprite(skin, { imageIndex: 0 } as AnimElement);
    expect(frames).toHaveLength(1);
    expect(frames[0].materials[0].name).toBe('ground:shovel_feathered');
    expect(resolveShovelPlayerSprite(await loadShovelEquipment(assets, 'goldenshovel', 'goldenshovel_invisible'),
      { imageIndex: 0 } as AnimElement)).toHaveLength(0);
  } finally { assets.dispose(); }
});

it('removes one debris with source loot while preserving soil, terrain, other debris and restored state', async () => {
  const random = vi.fn(() => 0.9);
  const { farm, turf } = setup(undefined, random);
  const point = new THREE.Vector3(3, 0, 3), loot = vi.fn(async () => {});
  farm.setDebrisLootHandler(loot);
  try {
    await farm.spawnDecor('farm_soil_debris', point, { animation: 'f2' }, undefined, 'garbage');
    const target = farm.digTargets[0];
    expect(target.isValid()).toBe(false);
    expect(target.dig()).toBe(false);
    turf.plow(point);
    await farm.spawnDecor('farm_soil', new THREE.Vector3(8, 0, 3), { broken: false }, undefined, 'hole');
    await farm.spawnDecor('farm_soil_debris', new THREE.Vector3(8, 0, 8), { animation: 'f4' }, undefined, 'other');
    random.mockReturnValueOnce(0.1).mockReturnValueOnce(0.99);
    const tiles = turf.exportTiles(), preserved = farm.exportDecorRecords().filter(({ record }) => record.id !== target.id);
    expect(target.dig()).toBe(true);
    expect(target.dig()).toBe(false);
    expect(loot).toHaveBeenCalledExactlyOnceWith('goldnugget', point);
    expect(turf.exportTiles()).toEqual(tiles);
    expect(farm.exportDecorRecords()).toEqual(preserved);
    const restored = setup();
    try {
      restored.turf.plow(point);
      for (const { prefabId, record } of preserved) await restored.farm.spawnDecor(prefabId, new THREE.Vector3(...record.transform.position),
        record.components.farmSoil ?? record.components.farmDebris, undefined, record.id);
      expect(restored.farm.exportDecorRecords()).toEqual(preserved);
      expect(restored.farm.digTargets.map(({ id }) => id)).toEqual(['other']);
    } finally { restored.farm.dispose(); }
  } finally { farm.dispose(); }
});

it('walks into reach, commits at shovel_loop frame 15, and preserves cancelled or unequipped targets', async () => {
  const player = await createWilsonPlayer('/dst/data/anim');
  player.position.set(0, 0, 15);
  const animation = player.userData.animationController as WilsonAnimationController;
  await animation.setCarryItem('goldenshovel');
  expect(PlaySound).toHaveBeenCalledWith('dontstarve/wilson/equip_item_gold');
  const { world, farm, turf } = setup(player);
  const point = new THREE.Vector3(3, 0, 3);
  turf.plow(point);
  await farm.spawnDecor('farm_soil_debris', point, { animation: 'f1' }, undefined, 'target');
  const equipped = createHandEquipmentExistenceState();
  equipped.set({ itemId: 'goldenshovel', EQUIPSLOTS: 'HANDS' });
  const locomotor = { goToPoint: vi.fn(() => true), stop: vi.fn(), destination: undefined };
  const controller = new ShovelActionController(world, animation, locomotor, equipped, () => farm.digTargets);
  try {
    expect(controller.request(farm.digTargets[0])).toBe(true); controller.update(0);
    expect(locomotor.goToPoint).toHaveBeenCalled();
    player.position.set(3, 0, 6); controller.update(0);
    while (animation.stategraph.stateName === 'dig_start') animation.update(1 / 30);
    advance(animation, 14);
    expect(farm.exportDecorRecords()).toHaveLength(1);
    animation.setFacing('side', true); animation.update(1 / 30);
    expect(farm.exportDecorRecords()).toEqual([]);
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/wilson/dig');
    advance(animation, 60);
    await farm.spawnDecor('farm_soil_debris', point, { animation: 'f3' }, undefined, 'preserved');
    const preserved = farm.exportDecorRecords();
    expect(controller.request(farm.digTargets[0])).toBe(true); controller.update(0);
    controller.cancel(); advance(animation, 60);
    expect(farm.exportDecorRecords()).toEqual(preserved);
    expect(controller.request(farm.digTargets[0])).toBe(true); controller.update(0);
    equipped.set(null); await animation.setCarryItem(null); controller.update(0); advance(animation, 60);
    expect(farm.exportDecorRecords()).toEqual(preserved);
  } finally { controller.dispose(); farm.dispose(); }
});

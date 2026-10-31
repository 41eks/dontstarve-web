import { SpatialIndex } from '../../prefab/src/spatialIndex';
import { AnimState } from '../src/animState';
import { smallHash } from '../src/animationAssets';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { farmHoeVisual } from '../../prefab/src/farm_hoe';
import { declaredSymbol, overrideArchives } from './animStateFixture';
import { FarmHoeActionController } from '../../stategraphs/src/till';
import { createEquipmentExistenceState } from '../../signals/src';
import { FarmPlowPlacement } from '../../prefab/src/farm_plow';
import { TurfMap } from '../../prefab/src/turfMap';
import { wilsonPlayerInstance, createWilsonPlayer, type WilsonAnimationController } from './playerVisual';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from '../../prefab/src/groundItems';
import { createGroundItemVisual } from './groundItemVisual';
import type { WorldContext } from '../../prefab/src/worldContext';
import { inventoryItemEquipmentKind, inventoryItemMaxStack } from '../../inventory/src/slots';
import { PlaySound } from '../../prefab/src/sound';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop() {} })) }));
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

function setup(player = new THREE.Group()) {
  const world = { scene: new THREE.Scene(), player, camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(),
    renderer: { domElement: new EventTarget() } } as unknown as WorldContext;
  const turf = new TurfMap(96);
  const blockers = new SpatialIndex<{ position: THREE.Vector3; tags?: string[] }>(blocker => blocker.position);
  const farm = new FarmPlowPlacement(world, turf, () => {}, blockers);
  return { farm, turf, world, blockers };
}
function advance(animation: WilsonAnimationController, frames: number) {
  for (let i = 0; i < frames; i++) animation.update(1 / 30);
}

it('resolves both source ground builds, the separate golden held build and invisible equipment', async () => {
  const assets = new GroundItemAssets();
  try {
    const ordinary = await createGroundItemVisual(assets, 'farm_hoe');
    const gold = await createGroundItemVisual(assets, 'golden_farm_hoe', 'golden_farmhoe_garden');
    for (const sprite of [ordinary, gold]) {
      expect((sprite.model.children[0].children[0].children[0] as THREE.Mesh).geometry.drawRange.count).toBeGreaterThan(0);
      sprite.dispose();
    }
    expect(GROUND_ITEM_DEFINITIONS.farm_hoe).toMatchObject({ bank: 'quagmire_hoe', animation: 'idle', atlas: 'images/inventoryimages2.xml' });
    expect(GROUND_ITEM_DEFINITIONS.golden_farm_hoe).toMatchObject({ bank: 'goldenhoe', animation: 'idle', atlas: 'images/inventoryimages2.xml' });
    expect(inventoryItemEquipmentKind('farm_hoe')).toBe('hand');
    expect(inventoryItemMaxStack('golden_farm_hoe')).toBe(1);
    const anim = new AnimState(() => {});
    const owner = { AnimState: anim, PushEvent() {} };
    const equip = (prefab: string, skinId?: string) => farmHoeVisual({ id: prefab, prefab, skinId }).onequip(owner);
    equip('farm_hoe');
    expect(anim.json.peek().overrides.get(smallHash('swap_object'))?.sources[0].symbol).toBe(smallHash('swap_quagmire_hoe'));
    equip('golden_farm_hoe');
    expect(overrideArchives(anim, 'swap_object')).toEqual(['swap_goldenhoe.zip']);
    equip('golden_farm_hoe', 'golden_farmhoe_garden');
    const heldSkin = (await declaredSymbol(anim, assets, 'swap_object'))!;
    expect(heldSkin).toHaveLength(1);
    expect(heldSkin[0].materials[0].name).toBe('ground:golden_farmhoe_garden');
    equip('golden_farm_hoe', 'golden_farmhoe_invisible');
    expect(await declaredSymbol(anim, assets, 'swap_object')).toHaveLength(0);
  } finally { assets.dispose(); }
});

it('retills broken soil at the exact point, preserves blockers and crops, and restores saved holes', async () => {
  const { farm, turf, blockers, world } = setup();
  const point = new THREE.Vector3(3, 0, 3);
  try {
    expect(farm.canTill(point)).toBe(false);
    turf.plow(point);
    farm.spawnDecor('farm_soil', point, { broken: true }, 'broken');
    farm.spawnDecor('farm_soil', new THREE.Vector3(6, 0, 3), { broken: false }, 'neighbour');
    const blocker = { position: point, tags: [] as string[] };
    blockers.add(blocker);
    expect(farm.canTill(point)).toBe(false);
    blocker.tags = ['FX'];
    expect(farm.canTill(point)).toBe(true);
    expect(farm.exportDecorRecords().map(({ record }) => record.id)).toEqual(['broken', 'neighbour']);
    expect(farm.till(point)).toBe(true);
    const records = farm.exportDecorRecords();
    expect(records.some(({ record }) => record.id === 'broken')).toBe(false);
    expect(records.find(({ record }) => record.id === 'neighbour')?.record.components.farmSoil?.broken).toBe(true);
    const hole = records.find(({ record }) => record.id !== 'neighbour')!;
    expect(hole.record.transform.position).toEqual([3, 0, 3]);
    expect(hole.record.components.farmSoil).toEqual({ broken: false });
    const restored = setup();
    try {
      restored.turf.plow(point);
      restored.farm.spawnDecor('farm_soil', point, hole.record.components.farmSoil, hole.record.id);
      expect(restored.farm.exportDecorRecords()).toEqual([hole]);
      expect(restored.farm.soilTargets[0].id).toBe(hole.record.id);
    } finally { restored.farm.dispose(); }
    farm.spawnPlantedSeed(point, 'crop');
    const crops = farm.exportPlantedSeedRecords();
    expect(farm.canTill(point)).toBe(false);
    expect(farm.till(point)).toBe(false);
    expect(farm.exportPlantedSeedRecords()).toEqual(crops);
    farm.spawnDecor('farm_soil_debris', new THREE.Vector3(9, 0, 9), { animation: 'f1' });
    expect(farm.canTill(new THREE.Vector3(9, 0, 9))).toBe(false);
  } finally { farm.dispose(); }
  expect(world.scene.children).toHaveLength(0);
});

it('approaches the target, creates one hole at till_loop frame 11, and cancels before an unequipped or interrupted hit', async () => {
  const player = await createWilsonPlayer('/dst/data/anim');
  player.position.set(0, 0, 15);
  const animation = wilsonPlayerInstance(player).animationController as WilsonAnimationController;
  await animation.setCarryItem('golden_farm_hoe');
  const { world, farm, turf } = setup(player);
  const locomotor = { goToPoint: vi.fn(() => true), stop: vi.fn(), destination: undefined };
  const tool = createEquipmentExistenceState('HANDS');
  tool.set({ itemId: 'golden_farm_hoe', EQUIPSLOTS: 'HANDS' });
  const controller = new FarmHoeActionController(world, animation, locomotor, tool, farm);
  const point = new THREE.Vector3(3, 0, 3);
  turf.plow(point);
  try {
    tool.set({ itemId: 'torch', EQUIPSLOTS: 'HANDS' });
    expect(controller.request(point)).toBe(false);
    tool.set({ itemId: 'golden_farm_hoe', EQUIPSLOTS: 'HANDS' });
    expect(controller.request(point)).toBe(true); controller.update();
    expect(locomotor.goToPoint).toHaveBeenCalled();
    expect(farm.exportDecorRecords()).toEqual([]);
    player.position.set(3, 0, 6);
    await vi.waitFor(() => { controller.update(); expect(animation.stategraph.stateName).toBe('till_start'); });
    while (animation.stategraph.stateName === 'till_start') animation.update(1 / 30);
    advance(animation, 10);
    expect(farm.exportDecorRecords()).toEqual([]);
    animation.setFacing('side', true); animation.update(1 / 30);
    expect(farm.exportDecorRecords()).toHaveLength(1);
    animation.update(1 / 30);
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/wilson/dig');
    expect(PlaySound).toHaveBeenCalledWith('dontstarve_DLC001/creatures/mole/emerge');
    advance(animation, 60);
    expect(farm.exportDecorRecords()).toHaveLength(1);
    const preserved = farm.exportDecorRecords();
    expect(controller.request(point)).toBe(true);
    await vi.waitFor(() => { controller.update(); expect(animation.isTilling).toBe(true); });
    controller.cancel(); advance(animation, 60);
    expect(farm.exportDecorRecords()).toEqual(preserved);
    expect(controller.request(point)).toBe(true);
    await vi.waitFor(() => { controller.update(); expect(animation.isTilling).toBe(true); });
    tool.set(null); await animation.setCarryItem(null); controller.update(); advance(animation, 60);
    expect(farm.exportDecorRecords()).toEqual(preserved);
  } finally { controller.dispose(); farm.dispose(); }
});

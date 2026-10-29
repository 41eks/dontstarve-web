import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FarmPlowPlacement } from '../../prefab/src/farm_plow';
import { FOOD_EFFECTS, PERISHABLE_FOODS } from '../../prefab/src/food';
import { SEEDS_HUNGER } from '../../prefab/src/seeds';
import { FoodActionController } from '../../stategraphs/src/food';
import { wilsonPlayerInstance, createWilsonPlayer, type WilsonAnimationController } from './playerVisual';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from '../../prefab/src/groundItems';
import { createGroundItemVisual } from './groundItemVisual';
import { TurfMap } from '../../prefab/src/turfMap';
import type { WorldContext } from '../../prefab/src/worldContext';
import { PlaySound } from '../../prefab/src/sound';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop() {} })) }));
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

function farmSetup(player = new THREE.Group()) {
  const world = { scene: new THREE.Scene(), player, camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(),
    renderer: { domElement: new EventTarget() } } as unknown as WorldContext;
  const turf = new TurfMap(96);
  const farm = new FarmPlowPlacement(world, turf, async () => {});
  return { farm, turf, world };
}

it('renders the original ground seed pose and commits quick eating once at frame 12, preserving other stats', async () => {
  const assets = new GroundItemAssets();
  const sprite = await createGroundItemVisual(assets, 'seeds');
  expect(GROUND_ITEM_DEFINITIONS.seeds).toMatchObject({ atlas: 'images/inventoryimages.xml', bank: 'seeds',
    animationArchive: 'seeds.zip', animation: 'idle', skinArchives: {} });
  const mesh = sprite.model.children[0].children[0].children[0] as THREE.Mesh;
  expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
  sprite.dispose(); assets.dispose();
  const player = await createWilsonPlayer('/dst/data/anim');
  const animation = wilsonPlayerInstance(player).animationController as WilsonAnimationController;
  const { farm, world } = farmSetup(player);
  const seeds = new FoodActionController(world, animation, { stop() {}, goToPoint: () => true, destination: undefined }, farm);
  let count = 2;
  const stats = { hunger: 105, health: 150, sanity: 35 };
  const source = { isValid: () => count > 0, take: () => { count--; return true; } };
  try {
    expect(await seeds.eat(source, () => { stats.hunger += SEEDS_HUNGER; })).toBe(true);
    for (let frame = 0; frame < 11; frame++) animation.update(1 / 30);
    expect(count).toBe(2);
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/wilson/eat');
    animation.update(1 / 30);
    expect(count).toBe(1);
    expect(stats).toEqual({ hunger: 109.6875, health: 150, sanity: 35 });
    for (let frame = 0; frame < 40; frame++) animation.update(1 / 30);
    expect(count).toBe(1);
    expect(animation.stategraph.stateName).toBe('idle');
    await seeds.eat(source, () => { stats.hunger += SEEDS_HUNGER; });
    animation.update(0.1); seeds.cancel(); animation.update(1);
    expect(count).toBe(1);
    expect(stats.hunger).toBe(109.6875);
    expect(seeds.eat(source, () => { stats.hunger += SEEDS_HUNGER; })).toBe(true);
    seeds.cancel(); animation.update(1);
    expect(count).toBe(1);
  } finally { seeds.dispose(); farm.dispose(); }
});

it('plants only an intact finished hole, replaces it atomically and restores the planted entity without spending seeds', async () => {
  const { farm, turf, world } = farmSetup();
  const position = new THREE.Vector3(3, 0, 3);
  const take = vi.fn(() => true);
  try {
    await farm.spawnDecor('farm_soil', position, { broken: false }, undefined, 'soil');
    expect(farm.soilTargets).toEqual([]);
    turf.plow(position);
    await farm.spawnDecor('farm_soil', new THREE.Vector3(8, 0, 8), { broken: true }, undefined, 'broken');
    await farm.spawnDecor('farm_soil', new THREE.Vector3(9, 0, 3), { broken: false, plowId: 'working' }, undefined, 'working');
    expect(farm.soilTargets.map(({ id }) => id)).toEqual(['soil']);
    const prepared = (await farm.prepareSeedPlant('soil'))!;
    expect(prepared.apply(() => false)).toBe(false);
    expect(farm.soilTargets).toHaveLength(1);
    expect(prepared.apply(take)).toBe(true);
    expect(prepared.apply(take)).toBe(false);
    prepared.dispose();
    expect(take).toHaveBeenCalledOnce();
    expect(farm.soilTargets).toEqual([]);
    expect(farm.exportDecorRecords().some(({ record }) => record.id === 'soil')).toBe(false);
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/common/plant', position);
    const saved = farm.exportPlantedSeedRecords()[0];
    expect(saved).toMatchObject({ prefabId: 'farm_plant_randomseed', record: { transform: { position: [3, 0, 3] }, components: {} } });
    const restore = farmSetup();
    try {
      const model = await restore.farm.spawnPlantedSeed(new THREE.Vector3(...saved.record.transform.position), saved.record.id);
      expect(model.userData.animationController.currentAnimation).toBe('sow_idle');
      expect(restore.farm.exportPlantedSeedRecords()).toEqual([saved]);
    } finally { restore.farm.dispose(); }
    await farm.spawnDecor('farm_soil', position, { broken: false }, undefined, 'cancelled');
    const cancelled = (await farm.prepareSeedPlant('cancelled'))!;
    cancelled.dispose(); expect(cancelled.apply(take)).toBe(false);
    const stale = (await farm.prepareSeedPlant('cancelled'))!;
    turf.dig(position);
    expect(stale.apply(take)).toBe(false); stale.dispose();
    expect(take).toHaveBeenCalledOnce();
    expect(farm.exportPlantedSeedRecords()).toEqual([saved]);
  } finally { farm.dispose(); }
  expect(world.scene.children).toHaveLength(0);
});

it('renders veggie ground art and plants split bank/build veggie seeds, preserving them through save restore', async () => {
  const assets = new GroundItemAssets();
  expect(GROUND_ITEM_DEFINITIONS.carrot_seeds).toMatchObject({ icon: 'carrot_seeds.tex', atlas: 'images/inventoryimages.xml',
    bank: 'farm_plant_seeds', animationArchive: 'farm_plant_seeds.zip', animation: 'carrot' });
  expect(GROUND_ITEM_DEFINITIONS.tomato.icon).toBe('quagmire_tomato.tex');
  expect(GROUND_ITEM_DEFINITIONS.kelp_dried).toMatchObject({ bank: 'meat_rack_food_tot', animation: 'dried_kelp' });
  for (const id of ['carrot_seeds', 'kelp_dried', 'tomato_cooked']) {
    const sprite = await createGroundItemVisual(assets, id);
    expect((sprite.model.children[0].children[0].children[0] as THREE.Mesh).geometry.drawRange.count).toBeGreaterThan(0);
    sprite.dispose();
  }
  assets.dispose();
  expect(FOOD_EFFECTS.carrot_seeds).toEqual({ health: 0.5, hunger: 9.375, sanity: 0 });
  expect(FOOD_EFFECTS.pepper).toEqual({ health: -20, hunger: 9.375, sanity: -15 });
  expect(FOOD_EFFECTS.watermelon_cooked.sanity).toBe(7.5);
  expect(PERISHABLE_FOODS.carrot).toEqual({ perishTime: 4800, replacement: 'spoiled_food' });
  const { farm, turf } = farmSetup();
  const take = vi.fn(() => true);
  try {
    for (const [index, [seed, plant]] of [['carrot_seeds', 'farm_plant_carrot'], ['corn_seeds', 'farm_plant_corn']].entries()) {
      const position = new THREE.Vector3(3 + index * 8, 0, 3);
      await farm.spawnDecor('farm_soil', position, { broken: false }, undefined, `soil${index}`);
      turf.plow(position);
      expect(await farm.prepareSeedPlant(`soil${index}`, 'unknown_seeds')).toBeUndefined();
      const prepared = (await farm.prepareSeedPlant(`soil${index}`, seed))!;
      expect(prepared.apply(take)).toBe(true);
      prepared.dispose();
      expect(farm.exportPlantedSeedRecords()[index]).toMatchObject({ prefabId: plant,
        record: { transform: { position: position.toArray() }, components: {} } });
    }
    expect(take).toHaveBeenCalledTimes(2);
    expect(farm.soilTargets).toEqual([]);
    const saved = farm.exportPlantedSeedRecords();
    const restore = farmSetup();
    try {
      for (const { prefabId, record } of saved) {
        const model = await restore.farm.spawnPlantedSeed(new THREE.Vector3(...record.transform.position), record.id, prefabId);
        expect(model.userData.animationController.currentAnimation).toBe('crop_seed');
      }
      expect(restore.farm.exportPlantedSeedRecords()).toEqual(saved);
    } finally { restore.farm.dispose(); }
  } finally { farm.dispose(); }
});

it('commits PLANT on frame 6 and cancels an uncommitted short action', async () => {
  const player = await createWilsonPlayer('/dst/data/anim');
  const animation = wilsonPlayerInstance(player).animationController as WilsonAnimationController;
  const plant = vi.fn(() => true);
  expect(animation.playPlant(plant)).toBe(true);
  for (let frame = 0; frame < 5; frame++) animation.update(1 / 30);
  expect(plant).not.toHaveBeenCalled();
  animation.update(1 / 30);
  expect(plant).toHaveBeenCalledOnce();
  for (let frame = 0; frame < 40; frame++) animation.update(1 / 30);
  expect(animation.playPlant(plant)).toBe(true);
  animation.cancelFoodAction();
  for (let frame = 0; frame < 40; frame++) animation.update(1 / 30);
  expect(plant).toHaveBeenCalledOnce();
});

import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FarmPlowPlacement } from '../../prefab/src/farm_plow';
import { SEEDS_HUNGER } from '../../prefab/src/seeds';
import { FoodActionController } from '../../stategraphs/src/food';
import { createWilsonPlayer, type WilsonAnimationController } from '../../prefab/src/player';
import { GroundItemAssets, createGroundItemSprite, GROUND_ITEM_DEFINITIONS } from '../../prefab/src/groundItems';
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
  const farm = new FarmPlowPlacement(world, turf, '/dst/data', async () => {});
  return { farm, turf, world };
}

it('renders the original ground seed pose and commits quick eating once at frame 12, preserving other stats', async () => {
  const assets = new GroundItemAssets('/dst/data/anim');
  const sprite = await createGroundItemSprite(assets, 'seeds');
  expect(GROUND_ITEM_DEFINITIONS.seeds).toMatchObject({ atlas: 'images/inventoryimages.xml', bank: 'seeds',
    animationArchive: 'seeds.zip', animation: 'idle', skinArchives: {} });
  const mesh = sprite.model.children[0].children[0] as THREE.Mesh;
  expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
  sprite.dispose(); assets.dispose();
  const player = await createWilsonPlayer('/dst/data/anim');
  const animation = player.userData.animationController as WilsonAnimationController;
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
    const pending = seeds.eat(source, () => { stats.hunger += SEEDS_HUNGER; });
    seeds.cancel(); expect(await pending).toBe(false);
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

it('commits PLANT on frame 6 and cancels an uncommitted short action', async () => {
  const player = await createWilsonPlayer('/dst/data/anim');
  const animation = player.userData.animationController as WilsonAnimationController;
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

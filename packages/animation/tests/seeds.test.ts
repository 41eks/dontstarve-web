import { advancePlayer } from './playerVisual';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FarmPlowPlacement } from '../../prefab/src/farm_plow';
import { FOOD_EFFECTS, PERISHABLE_FOODS } from '../../prefab/src/food';
import { inventoryUse } from './inventoryUseFixture';
import { wilsonPlayerInstance, createWilsonPlayer, type WilsonAnimationController } from './playerVisual';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from '../../prefab/src/groundItems';
import { createGroundItemVisual } from './groundItemVisual';
import { TurfMap } from '../../prefab/src/turfMap';
import type { WorldContext } from '../../prefab/src/worldContext';
import { createPickupInventory } from './pickupFixture';
import { inventorySlotAddress } from '@dontstarve-web/inventory';
import { PlaySound } from '../../prefab/src/sound';
import { createBufferedAction } from '../../stategraphs/src/actionfns';
import { createPickupDoer } from '../../stategraphs/src/pickup';
import { collectUseItemActions } from '../../stategraphs/src/componentactions';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop() {}, isPlaying: () => true })) }));
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

function farmSetup(player = new THREE.Group()) {
  const world = { scene: new THREE.Scene(), player, camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(),
    renderer: { domElement: new EventTarget() } } as unknown as WorldContext;
  const turf = new TurfMap(96);
  const farm = new FarmPlowPlacement(world, turf, () => {});
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
  const instance = wilsonPlayerInstance(player), store = createPickupInventory();
  instance.components.inventory = store;
  const seeds = inventoryUse(world, animation.stategraph, instance);
  store.add('seeds', 2);
  const slot = inventorySlotAddress(0), source = store.getEntity(slot)!;
  const stats = () => ({ hunger: instance.stats.hunger.current, health: instance.stats.health.currenthealth, sanity: instance.stats.sanity.current });
  try {
    expect(await seeds.use(source)).toBe(true);
    for (let frame = 0; frame < 11; frame++) advancePlayer(animation, 1 / 30);
    expect(store.get(slot)?.count).toBe(2);
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/wilson/eat', undefined);
    advancePlayer(animation, 1 / 30);
    expect(store.get(slot)?.count).toBe(1);
    expect(stats()).toEqual({ hunger: 109.6875, health: 150, sanity: 35 });
    for (let frame = 0; frame < 40; frame++) advancePlayer(animation, 1 / 30);
    expect(store.get(slot)?.count).toBe(1);
    expect(animation.stategraph.stateName).toBe('idle');
    await seeds.use(source);
    advancePlayer(animation, 0.1); seeds.cancel(); advancePlayer(animation, 1);
    expect(store.get(slot)?.count).toBe(1);
    expect(stats().hunger).toBe(109.6875);
    expect(seeds.use(source)).toBe(true);
    seeds.cancel(); advancePlayer(animation, 1);
    expect(store.get(slot)?.count).toBe(1);
  } finally { seeds.dispose(); store.dispose(); farm.dispose(); }
});

it('excludes broken soil and soil still being plowed from USEITEM actions', () => {
  const { farm, turf } = farmSetup(), inventory = createPickupInventory();
  const seeds = inventory.entities.create({ itemId: 'seeds', count: 1 }); inventory.configureItem(seeds);
  const doer = { hasTag: () => false };
  try {
    const position = new THREE.Vector3(3, 0, 3); turf.plow(position);
    for (const [id, state] of [['broken', { broken: true }], ['working', { broken: false, plowId: 'plow' }]] as const) {
      const soil = prefabInstance(farm.spawnDecor('farm_soil', position, state, id))!;
      expect(soil.hasTag('NOCLICK')).toBe(true);
      expect(collectUseItemActions(seeds, doer, soil, false)).toEqual([]);
    }
  } finally { farm.dispose(); inventory.dispose(); }
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
  const { farm, turf, world } = farmSetup();
  const inventory = createPickupInventory(), doer = createPickupDoer(world.player, inventory);
  try {
    for (const [index, [seed, plant]] of [['carrot_seeds', 'farm_plant_carrot'], ['corn_seeds', 'farm_plant_corn']].entries()) {
      const position = new THREE.Vector3(3 + index * 8, 0, 3);
      const soil = prefabInstance(farm.spawnDecor('farm_soil', position, { broken: false }, `soil${index}`))!;
      turf.plow(position);
      inventory.add(seed, 1);
      expect(createBufferedAction('PLANTSOIL', { doer, target: soil, invobject: inventory.getEntity(inventorySlotAddress(0))! }).do()).toBe(true);
      expect(farm.exportPlantedSeedRecords()[index]).toMatchObject({ prefabId: plant,
        record: { transform: { position: position.toArray() }, components: {} } });
    }
    expect(farm.exportDecorRecords()).toEqual([]);
    const saved = farm.exportPlantedSeedRecords();
    const restore = farmSetup();
    try {
      for (const { prefabId, record } of saved) {
        const model = restore.farm.spawnPlantedSeed(new THREE.Vector3(...record.transform.position), record.id, prefabId);
        expect(prefabInstance(model)!.sprite.currentAnimation).toBe('crop_seed');
      }
      expect(restore.farm.exportPlantedSeedRecords()).toEqual(saved);
    } finally { restore.farm.dispose(); }
  } finally { farm.dispose(); inventory.dispose(); }
});

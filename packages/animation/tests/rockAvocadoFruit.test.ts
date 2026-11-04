import { prefabDisplays, prefabManager } from './prefabManagerFixture';
import { plantManager } from './plantManagerFixture';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { rockAvocadoSaplingPrefabs, ROCK_AVOCADO_SAPLING_ID, type RockAvocadoSaplingInstance } from '../../prefab/src/rock_avocado_fruit_sprout_sapling';
import { PrefabDisplayGroup } from '@dontstarve-web/display';
import { FireFxHost } from '../../prefab/src/treeFire';
import { rockAvocadoProduct } from '../../prefab/src/rock_avocado_fruit';
import { rockAvocadoBushPrefabs } from '../../prefab/src/rock_avocado_bush';
import { GroundItemManager } from '../../prefab/src/groundItemManager';
import { createInventoryStore } from '../../../src/inventory';
import { inventorySlotAddress } from '../../inventory/src';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { PlaySound } from '../../prefab/src/sound';
import { inventoryStateFromSave } from '../../../src/save/inventoryState';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { bindTestWorld } from './worldContentFixture';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { workTargets } from './workTargets';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const settleEffects = () => new Promise(resolve => setTimeout(resolve, 0));

function setup() {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const inventory = createInventoryStore([]), scene = new THREE.Scene(), player = new THREE.Group(), physics = new CANNON.World();
  const scheduler = new GameTimeScheduler();
  const ground = new GroundItemManager(scene, new THREE.PerspectiveCamera(), { domElement: new EventTarget() } as THREE.WebGLRenderer,
    '/dst/data/databundles/images.zip', inventory, '/dst/data/anim', player);
  const { season, snowLevel } = bindTestWorld(scheduler);
  const bushes = plantManager(rockAvocadoBushPrefabs, scene, { physics,
    spawnGroundItem: (definition, position, options) => ground.spawnGroundItem(definition, position, options) });
  const sproutDisplays = new PrefabDisplayGroup(scene), fire = FireFxHost.create('/dst/data/anim');
  const sprouts = prefabManager(sproutDisplays, '/dst/data/anim', { scheduler, fire, spawnPrefab: (id: 'rock_avocado_bush', position: Parameters<typeof bushes.spawn>[1]) => bushes.spawn(id, position),
    spawnGroundItem: (definition: Parameters<typeof ground.spawnGroundItem>[0], position: Parameters<typeof ground.spawnGroundItem>[1], options?: Parameters<typeof ground.spawnGroundItem>[2]) => ground.spawnGroundItem(definition, position, options) }, rockAvocadoSaplingPrefabs);
  const registry = new EntityRegistry();
  registry.register(PREFAB_DEFINITIONS.rockAvocadoBushes, {
    restore: (_, record) => bushes.spawn('rock_avocado_bush', new THREE.Vector3(...record.transform.position), record).transform.model,
    debugSpawn: () => bushes.spawn('rock_avocado_bush', player.position).transform.model,
    exportRecords: () => bushes.exportRecords(), dispose: () => bushes.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.rockAvocadoSaplings, {
    restore: (_, record) => sprouts.spawn(ROCK_AVOCADO_SAPLING_ID, new THREE.Vector3(...record.transform.position), record).transform.model,
    debugSpawn: () => sprouts.spawn(ROCK_AVOCADO_SAPLING_ID, player.position).transform.model,
    exportRecords: () => sprouts.exportRecords(),
    dispose: () => sprouts.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.groundItems, {
    restore: (_, record) => ground.spawnFromSave(record.id,
      { ...SAVE_CATALOG.items[record.components.stack!.itemId], ...record.components.stack! }, new THREE.Vector3(...record.transform.position)),
    debugSpawn: id => ground.spawnFromSave(`command:${id}`, { ...SAVE_CATALOG.items[id], itemId: id, count: 1 }, player.position),
    exportRecords: () => ground.exportRecords().map(record => ({ prefabId: 'ground_item', record })), dispose: () => ground.dispose(),
  });
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  const save = () => serializeSave(template, { entities: { rock_avocado_bush: bushes.exportRecords().map(({ record }) => record), ground_item: ground.exportRecords(), rock_avocado_fruit_sprout_sapling: sprouts.exportRecords().map(({ record }) => record) },
    inventory: inventory.exportState(), elapsedSeconds: scheduler.now, playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
  const advance = (seconds: number) => { scheduler.advance(seconds); prefabDisplays(bushes).update(seconds, new THREE.Quaternion()); sproutDisplays.update(seconds, new THREE.Quaternion()); };
  return { inventory, player, scene, physics, scheduler, season, snowLevel, ground, bushes, sprouts, registry, save, advance,
    picker: { giveItem: (id: string, count: number) => inventory.add(id, count) },
    dispose: () => { registry.dispose(); sproutDisplays.dispose(); fire.dispose(); inventory.dispose(); scheduler.dispose(); } };
}

it('mines a stack through the common tool action, rolls each consumed fruit, groups loot, and reloads the remaining stack', async () => {
  const random = vi.spyOn(Math, 'random').mockReturnValue(.5);
  const s = setup(), restored = setup();
  try {
    expect([0, .649999, .65, .659999, .66, .999].map(rockAvocadoProduct)).toEqual([
      'rock_avocado_fruit_ripe', 'rock_avocado_fruit_ripe', 'rock_avocado_fruit_sprout', 'rock_avocado_fruit_sprout', 'rocks', 'rocks']);
    const point = new THREE.Vector3(24, 0, 36);
    const model = await s.ground.spawnFromSave('hard-fruit:stack', { ...SAVE_CATALOG.items.rock_avocado_fruit, itemId: 'rock_avocado_fruit', count: 5 }, point);
    const target = workTargets('MINE', s.scene)[0], entity = s.ground.entities.get('hard-fruit:stack')!;
    const pickaxe = s.inventory.entities.create({ itemId: 'pickaxe', count: 1 }); s.inventory.GiveItem(pickaxe);
    const uses = pickaxe.components.finiteuses.remaining ?? s.inventory.getItemSpec('pickaxe').maxUses!;
    expect(performToolWork('MINE', target.entity, { getPosition: () => new THREE.Vector3(21, 0, 36) }, pickaxe)).toBe(true);
    expect(pickaxe.components.finiteuses.remaining).toBe(uses! - 1);
    expect(entity.components.stackable.count).toBe(4); expect(entity.components.workable!.GetWorkLeft()).toBe(4);
    random.mockReturnValueOnce(.655).mockReturnValueOnce(.9).mockReturnValueOnce(.1);
    expect(entity.components.workable!.WorkedBy({ getPosition: () => point }, 3)).toBe(true);
    expect(entity.components.stackable.count).toBe(1); expect(entity.components.workable!.GetWorkLeft()).toBe(1);
    const products = s.ground.exportRecords().filter(record => record.id !== entity.id);
    expect(products.map(record => [record.components.stack?.itemId, record.components.stack?.count])).toEqual([
      ['rock_avocado_fruit_ripe', 1], ['rock_avocado_fruit_ripe', 1], ['rock_avocado_fruit_sprout', 1], ['rocks', 1]]);
    expect(products[0].components.stack?.freshnessPercent).toBe(1);
    expect(model.parent).toBe(s.scene);
    for (let frame = 0; frame < 90; frame++) s.ground.update(1 / 30, new THREE.Quaternion());
    expect(s.ground.exportRecords().find(record => record.id === products[0].id)!.transform.position[0]).toBeGreaterThan(point.x);
    const before = s.ground.exportRecords();
    const saved = deserializeSave(s.save(), SAVE_CATALOG);
    for (const record of saved.world.entities.ground_item) await restored.ground.spawnFromSave(record.id,
      { ...SAVE_CATALOG.items[record.components.stack!.itemId], ...record.components.stack! }, new THREE.Vector3(...record.transform.position));
    expect(restored.ground.exportRecords()).toEqual(before);
    expect(workTargets('MINE', restored.scene)[0].id).toBe(entity.id);
    random.mockReturnValueOnce(.8);
    expect(performToolWork('MINE', target.entity, {}, pickaxe)).toBe(true);
    expect(entity.isRemoved).toBe(true); expect(workTargets('MINE', s.scene)).toEqual([]);
    expect(performToolWork('MINE', target.entity, {}, pickaxe)).toBe(false);
    expect(pickaxe.components.finiteuses.remaining).toBe(uses! - 2);
  } finally { s.dispose(); restored.dispose(); }
}, 15000);

it('plants one sprout, preserves its named deadline through save/load, and becomes a natural bush after seed_growth without rendering', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(.5);
  const s = setup(), restored = setup();
  try {
    expect((await executeDebugCommand('c_give("rock_avocado_fruit_sprout",2);c_give("rock_avocado_fruit_ripe",2);c_give("rock_avocado_fruit_ripe_cooked");c_spawn("rock_avocado_fruit_sprout");c_spawn("rock_avocado_fruit_ripe_cooked")',
      s.inventory, id => s.registry.spawn(id))).ok).toBe(true);
    const point = new THREE.Vector3(12, 0, 24), item = s.inventory.getEntity(inventorySlotAddress(0))!;
    expect(item.components.deployable!.Deploy(point, { position: point, PushEvent: vi.fn() }, {
      canPlaceTurf: () => false, setTile: vi.fn(), itemPlanted: vi.fn(), canDeployDock: () => false, createDock: vi.fn(), canDeployPlow: () => false, deployPlow: () => false, 
      isPassableAtPoint: () => true, isOceanTileAtPoint: () => false,
      canDeployPlant: () => false, SpawnPrefab: () => s.sprouts.spawn(ROCK_AVOCADO_SAPLING_ID, point) as never,
    })).toBe(false);
    expect(s.inventory.count('rock_avocado_fruit_sprout')).toBe(2);
    const root = s.inventory.extract(inventorySlotAddress(0), 1, item)!;
    expect(root.components.deployable!.Deploy(point, { position: point, PushEvent: vi.fn() }, {
      canPlaceTurf: () => false, setTile: vi.fn(), itemPlanted: vi.fn(), canDeployDock: () => false, createDock: vi.fn(), canDeployPlow: () => false, deployPlow: () => false, 
      isPassableAtPoint: () => true, isOceanTileAtPoint: () => false,
      canDeployPlant: () => true, SpawnPrefab: () => s.sprouts.spawn(ROCK_AVOCADO_SAPLING_ID, point) as never,
    })).toBe(true);
    expect(root.isRemoved).toBe(true); expect(s.inventory.count('rock_avocado_fruit_sprout')).toBe(1);
    const model = workTargets('DIG', s.scene)[0].model, { timer } = prefabInstance<RockAvocadoSaplingInstance>(model)!.components;
    const snapshot = timer.snapshot('grow').peek();
    s.advance(600); expect(timer.snapshot('grow').peek()).toBe(snapshot);
    s.season.set({ season: 'winter', progress: .5 }); await settleEffects();
    let json = '';
    expect((await executeDebugCommand('c_save()', s.inventory, undefined, () => { json = s.save(); })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG), record = saved.world.entities.rock_avocado_fruit_sprout_sapling[0];
    expect(record.components.saplingTimer?.timers.grow.timeleft).toBe(900);
    restored.sprouts.spawn(ROCK_AVOCADO_SAPLING_ID, new THREE.Vector3(...record.transform.position), record);
    restored.inventory.replaceState(inventoryStateFromSave(saved), SAVE_CATALOG.recipes);
    for (const ground of saved.world.entities.ground_item) await restored.ground.spawnFromSave(ground.id,
      { ...SAVE_CATALOG.items[ground.components.stack!.itemId], ...ground.components.stack! }, new THREE.Vector3(...ground.transform.position));
    expect(restored.sprouts.exportRecords().map(({ record }) => record)).toEqual([record]);
    expect(restored.inventory.exportState()).toEqual(s.inventory.exportState());
    expect(restored.ground.exportRecords()).toEqual(s.ground.exportRecords());
    // The scheduler, rather than a presentation update, owns the replacement.
    s.scheduler.advance(900);
    expect(s.bushes.exportRecords().map(({ record }) => record)).toEqual([]);
    const { seedGrowth } = prefabInstance<RockAvocadoSaplingInstance>(model)!;
    expect(seedGrowth.snapshot.peek().status).toBe('scheduled');
    const completion = seedGrowth.snapshot.peek() as { endTime: number };
    s.scheduler.advanceTo(completion.endTime);
    expect(s.sprouts.exportRecords()).toEqual([]);
    const bush = s.bushes.exportRecords().map(({ record }) => record)[0];
    expect(bush.transform.position).toEqual(point.toArray()); expect(bush.id).not.toBe(record.id);
    // Pickable:OnSave omits unused cycles.
    expect(bush.components.pickable?.cyclesLeft).toBeUndefined();
    expect(bush.components.pickable?.transplanted).toBeUndefined();
    expect(bush.components.growable?.stage).toBe(3);
    expect(seedGrowth.snapshot.peek().status).toBe('stopped');
    // Sample the animated path too: seed_growth contains an unresolved engine snow placeholder.
    restored.scheduler.advance(900);
    const loaded = workTargets('DIG', restored.scene)[0].model;
    for (let frame = 0; frame < 180 && loaded.parent; frame++) restored.advance(1 / 30);
    expect(loaded.parent).toBeNull();
  } finally { s.dispose(); restored.dispose(); }
}, 15000);

it('cancels and restarts growth on ignition/extinguishing, reloads a stopped source timer, and cancels replacement when dug', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(.5);
  const s = setup(), restored = setup();
  try {
    s.player.position.y = .3;
    expect((await executeDebugCommand('c_spawn("rock_avocado_fruit_sprout_sapling")', s.inventory, id => s.registry.spawn(id))).ok).toBe(true);
    const model = workTargets('DIG', s.scene)[0].model, { timer } = prefabInstance<RockAvocadoSaplingInstance>(model)!.components, burnable = prefabInstance(model)!.components.burnable!;
    s.advance(400); burnable.Ignite(); expect(timer.snapshot('grow').peek().status).toBe('stopped');
    const { sprite } = prefabInstance<RockAvocadoSaplingInstance>(model)!;
    expect(sprite.fx.peek().size).toBe(1);
    s.advance(5); vi.mocked(PlaySound).mockClear(); burnable.Extinguish(); expect(timer.GetTimeLeft('grow')).toBe(1500);
    // firefx plays this for the sprout's fire; the sprout's own callback only restarts its timer.
    expect(vi.mocked(PlaySound).mock.calls.filter(([path]) => path === 'dontstarve/common/fireOut')).toHaveLength(1);
    expect(sprite.fx.peek().size).toBe(0);
    burnable.Ignite();
    const saved = deserializeSave(s.save(), SAVE_CATALOG), record = saved.world.entities.rock_avocado_fruit_sprout_sapling[0];
    expect(record.components.saplingTimer).toEqual({ timers: {} });
    restored.sprouts.spawn(ROCK_AVOCADO_SAPLING_ID, new THREE.Vector3(...record.transform.position), record);
    const loaded = workTargets('DIG', restored.scene)[0].model;
    expect(prefabInstance<RockAvocadoSaplingInstance>(loaded)!.components.timer.GetTimeLeft('grow')).toBe(1500);
    restored.scheduler.advance(1500);
    const completion = prefabInstance<RockAvocadoSaplingInstance>(loaded)!.seedGrowth.snapshot;
    expect(completion.peek().status).toBe('scheduled');
    expect(workTargets('DIG', restored.scene)[0].work()).toBe(true);
    expect(completion.peek().status).toBe('stopped');
    restored.scheduler.advance(5000); expect(restored.bushes.exportRecords().map(({ record }) => record)).toEqual([]);
    expect(restored.ground.exportRecords().at(-1)?.components.stack?.itemId).toBe('rock_avocado_fruit_sprout');
    s.advance(7.5); expect(s.sprouts.exportRecords()).toEqual([]);
    expect(s.ground.exportRecords().at(-1)?.components.stack?.itemId).toBe('ash');
  } finally { s.dispose(); restored.dispose(); }
}, 15000);


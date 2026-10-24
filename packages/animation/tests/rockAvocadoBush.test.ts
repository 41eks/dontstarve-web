import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { RockAvocadoBushManager } from '../../prefab/src/rock_avocado_bush';
import { GroundItemManager } from '../../../src/groundItems';
import { createInventoryStore } from '../../../src/inventory';
import { inventorySlotAddress } from '../../inventory/src';
import { createSignal, type SeasonState } from '../../signals/src';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { inventoryStateFromSave } from '../../../src/save/inventoryState';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { bindTestWorld } from './worldContentFixture';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };

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
  const bushes = new RockAvocadoBushManager(scene, '/dst/data/anim', { physics,
    prepareSpawn: (definition, fling) => ground.prepareSpawn(definition, fling) });
  const registry = new EntityRegistry();
  registry.register(PREFAB_DEFINITIONS.rockAvocadoBushes, {
    restore: (_, record) => bushes.spawn(new THREE.Vector3(...record.transform.position), record),
    debugSpawn: () => bushes.spawn(player.position),
    exportRecords: () => bushes.exportRecords().map(record => ({ prefabId: 'rock_avocado_bush', record })), dispose: () => bushes.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.groundItems, {
    restore: (_, record) => ground.spawnFromSave(record.id,
      { ...SAVE_CATALOG.items[record.components.stack!.itemId], ...record.components.stack! }, new THREE.Vector3(...record.transform.position)),
    debugSpawn: id => ground.spawnFromSave(`command:${id}`, { ...SAVE_CATALOG.items[id], itemId: id, count: 1 }, player.position),
    exportRecords: () => ground.exportRecords().map(record => ({ prefabId: 'ground_item', record })), dispose: () => ground.dispose(),
  });
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  const save = () => serializeSave(template, { entities: { rock_avocado_bush: bushes.exportRecords(), ground_item: ground.exportRecords() },
    inventory: inventory.exportState(), elapsedSeconds: scheduler.now, playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
  const advance = (seconds: number) => { scheduler.advance(seconds); bushes.update(seconds, new THREE.Quaternion()); };
  return { inventory, scene, physics, scheduler, season, snowLevel, ground, bushes, registry, save, advance,
    picker: { giveItem: (id: string, count: number) => inventory.add(id, count) },
    dispose: () => { registry.dispose(); inventory.dispose(); scheduler.dispose(); } };
}

it('cycles all four stages through winter, picks three fruits or clears nil product, and retains the existing deadline', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(.5);
  const s = setup();
  try {
    const model = await s.bushes.spawn(new THREE.Vector3(12, 0, 24));
    const { pickable, growable } = model.userData.components;
    expect(growable.GetStage()).toBe(3);
    const timer = growable.state.timer.peek();
    s.advance(100); expect(growable.state.timer.peek()).toBe(timer);
    expect(pickable.pick(s.picker)).toBe(true);
    expect(s.inventory.count('rock_avocado_fruit')).toBe(3);
    expect(growable.GetStage()).toBe(1);
    expect(growable.state.timer.peek()).toBe(timer);
    expect(pickable.state.timer.peek().status).toBe('stopped');
    s.season.set({ season: 'winter', progress: 0 }); await settleEffects();
    s.advance(800); expect(growable.GetStage()).toBe(2);
    expect(pickable.canBePicked).toBe(false);
    s.advance(180); expect(growable.GetStage()).toBe(3);
    s.advance(900); expect(growable.GetStage()).toBe(4);
    expect(pickable.product).toBeUndefined(); expect(pickable.canBePicked).toBe(true);
    const giveItem = vi.fn(() => false);
    expect(pickable.pick({ giveItem })).toBe(true); expect(giveItem).not.toHaveBeenCalled();
    expect(growable.GetStage()).toBe(1); expect(pickable.cyclesLeft).toBe(3);
    s.season.set({ season: 'spring', progress: 0 }); await settleEffects();
    s.advance(300); expect(growable.GetStage()).toBe(2);
    expect(growable.OnSave().time).toBe(135);
    s.advance(135); expect(growable.GetStage()).toBe(3);
    expect(growable.OnSave().time).toBe(675);
    expect(model.userData.animationController.currentAnimation).toBe('grow2');
    pickable.MakeEmpty();
    model.userData.components.simplemagicgrower.StartGrowing();
    expect(growable.GetStage()).toBe(2);
    s.advance(.5); expect(growable.GetStage()).toBe(3);
    s.advance(.5); expect(growable.GetStage()).toBe(3);
    expect(growable.OnSave().time).toBe(675);
    expect(model.userData.tags).not.toContain('magicgrowth');
  } finally { s.dispose(); }
});

it('digs three separate fruits and a root, transplants, fertilizes and stops after three transplanted picks', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(.5);
  const s = setup(), restored = setup();
  try {
    const position = new THREE.Vector3(24, 0, 36);
    await s.bushes.spawn(position);
    expect(performToolWork('DIG', s.bushes.digTargets[0].entity!, {})).toBe(true);
    const loot = s.ground.exportRecords();
    expect(loot.map(record => record.components.stack?.itemId)).toEqual([
      'rock_avocado_fruit', 'rock_avocado_fruit', 'rock_avocado_fruit', 'dug_rock_avocado_bush']);
    expect(loot.map(record => record.components.stack?.count)).toEqual([1, 1, 1, 1]);
    expect(s.physics.bodies).toHaveLength(0);
    const item = s.inventory.entities.create({ itemId: 'dug_rock_avocado_bush', count: 2 }); s.inventory.GiveItem(item);
    const root = s.inventory.extract(inventorySlotAddress(0), 1, item)!;
    const prepared = await s.bushes.prepareTransplant();
    expect(root.components.deployable!.Deploy(position, { position, PushEvent: vi.fn() }, {
      canDeployPlant: () => true, deployPlant: (point: THREE.Vector3) => prepared.spawn(point),
    })).toBe(true); prepared.dispose();
    expect(s.inventory.count('dug_rock_avocado_bush')).toBe(1);
    const model = s.bushes.digTargets[0].model, { pickable, growable, witherable } = model.userData.components;
    expect(pickable.IsBarren()).toBe(true); expect(growable.IsGrowing()).toBe(false);
    expect(model.userData.animationController.currentAnimation).toBe('dead1');
    const fertilizer = s.inventory.entities.create({ itemId: 'poop', count: 1 }); s.inventory.configureItem(fertilizer);
    expect(pickable.Fertilize(fertilizer)).toBe(true);
    expect(model.userData.animationController.currentAnimation).toBe('dead1_to_idle1');
    expect(growable.OnSave()).toEqual({ stage: 1, time: 600 });
    for (let cycle = 3; cycle > 0; cycle--) {
      growable.DoGrowth(); growable.DoGrowth();
      expect(pickable.pick(s.picker)).toBe(true); expect(pickable.cyclesLeft).toBe(cycle - 1);
      if (cycle === 3) {
        const saved = deserializeSave(s.save(), SAVE_CATALOG), record = saved.world.entities.rock_avocado_bush[0];
        await restored.bushes.spawn(new THREE.Vector3(...record.transform.position), record);
        expect(restored.bushes.exportRecords()).toEqual([record]);
      }
    }
    expect(s.inventory.count('rock_avocado_fruit')).toBe(9);
    expect(growable.state.timer.peek().status).toBe('stopped'); expect(growable.magicgrowable).toBe(false);
    expect(model.userData.animationController.currentAnimation).toBe('picked');
    for (let frame = 0; frame < 150; frame++) s.advance(1 / 30);
    expect(model.userData.animationController.currentAnimation).toBe('dead1');
    expect(pickable.Fertilize(fertilizer)).toBe(true);
    witherable.ForceWither(); expect(growable.IsGrowing()).toBe(false);
    expect(pickable.Fertilize(fertilizer)).toBe(true); expect(growable.IsGrowing()).toBe(true);
    expect(witherable.IsWithered()).toBe(false);
    witherable.ForceWither();
    expect(performToolWork('DIG', s.bushes.digTargets[0].entity!, {})).toBe(true);
    expect(s.ground.exportRecords().slice(-2).map(record => record.components.stack?.itemId)).toEqual(['twigs', 'twigs']);
    s.advance(10000); expect(s.bushes.exportRecords()).toEqual([]); expect(s.physics.bodies).toHaveLength(0);
  } finally { s.dispose(); restored.dispose(); }
});

it('exports and reloads debug commands, roots and fruit; a saved burning mature bush leaves three fruits and ash', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(.5);
  const s = setup(), restored = setup();
  try {
    expect((await executeDebugCommand('c_spawn("rock_avocado_bush");c_spawn("dug_rock_avocado_bush");c_spawn("rock_avocado_fruit");c_give("dug_rock_avocado_bush",2);c_give("rock_avocado_fruit",3)',
      s.inventory, id => s.registry.spawn(id))).ok).toBe(true);
    expect(s.inventory.getItemSpec('dug_rock_avocado_bush').maxStack).toBe(10);
    expect(s.inventory.getItemSpec('rock_avocado_fruit').maxStack).toBe(40);
    const model = s.bushes.digTargets[0].model;
    const beforeBurn = s.bushes.exportRecords()[0];
    model.userData.components.burnable.Ignite();
    let json = '';
    expect((await executeDebugCommand('c_save()', s.inventory, undefined, () => { json = s.save(); })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG), record = saved.world.entities.rock_avocado_bush[0];
    expect(record.id).toBe(beforeBurn.id); expect(record.transform).toEqual(beforeBurn.transform);
    expect(record.components.burning).toBe(true);
    restored.inventory.replaceState(inventoryStateFromSave(saved), SAVE_CATALOG.recipes);
    for (const item of saved.world.entities.ground_item) await restored.ground.spawnFromSave(item.id,
      { ...SAVE_CATALOG.items[item.components.stack!.itemId], ...item.components.stack! }, new THREE.Vector3(...item.transform.position));
    expect(restored.ground.exportRecords()).toEqual(s.ground.exportRecords());
    expect(restored.inventory.exportState()).toEqual(s.inventory.exportState());
    await restored.bushes.spawn(new THREE.Vector3(...record.transform.position), record);
    expect(restored.bushes.exportRecords()).toEqual([]);
    expect(restored.ground.exportRecords().slice(-4).map(item => item.components.stack?.itemId)).toEqual([
      'rock_avocado_fruit', 'rock_avocado_fruit', 'rock_avocado_fruit', 'ash']);
    s.advance(20); expect(s.bushes.exportRecords()).toEqual([]);
    expect(s.ground.exportRecords().slice(-4).map(item => item.components.stack?.itemId)).toEqual([
      'rock_avocado_fruit', 'rock_avocado_fruit', 'rock_avocado_fruit', 'ash']);
  } finally { s.dispose(); restored.dispose(); }
});


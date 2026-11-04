import type { Timer } from '../../componets/src/timer';
import { prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import * as THREE from 'three';
import { createTestArea, useTestTileMap } from './tileMapFixture';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { moonTreePrefabs } from '../../prefab/src/moontree';
import { treeWorld } from './treeManagerFixture';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { createDeployMap } from '../../prefab/src/deployMap';
import { placementEntities } from '../../prefab/src/placementEntities';
import { deployActor, landTurf } from './deployActor';
import { createInventoryStore } from '../../../src/inventory';
import { cursorSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { inventoryStateFromSave } from '../../../src/save/inventoryState';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import type { WorldContext } from '../../prefab/src/worldContext';
import { PlaySound } from '../../prefab/src/sound';
import { bindTestWorld, drawn } from './worldContentFixture';
import { prefabInstance, type PrefabInstance } from '../../prefab/src/prefabInstance';
import { workTargets } from './workTargets';

useTestTileMap();
let area: ReturnType<typeof createTestArea>;
beforeEach(async () => { area = createTestArea(); await area.ready; });
afterEach(() => area.dispose());

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop() {} })) }));
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function setup() {
  const scheduler = new GameTimeScheduler();
  const { snowLevel, unbind, getWatchWorldContent } = bindTestWorld(scheduler);
  let spring = false;
  const world = treeWorld(area.query, world => moonTreePrefabs(world, () => .5), { getWatchWorldContent,
    growthDuration: (seconds: number) => seconds * (spring ? .75 : 1) }, { scheduler });
  await area.visit(new THREE.Vector3());
  const saplings = () => world.prefabs.exportRecords().filter(({ prefabId }) => prefabId === 'moonbutterfly_sapling').map(({ record }) => record);
  return { ...world, saplings, snowLevel, setSpring: () => { spring = true; },
    dispose: () => { world.dispose(); unbind(); scheduler.dispose(); } };
}

it('plants one moonbutterfly with original baby-tree art and cycles short/normal/tall work and growth, accelerating new spring tasks', async () => {
  const s = await setup(), canvas = new EventTarget(), scene = s.scene;
  const inventory = createInventoryStore([]);
  const world = { scene, player: new THREE.Group(), camera: s.camera, ground: new THREE.Group(), renderer: { domElement: canvas } } as unknown as WorldContext;
  const canPlant = vi.fn(() => true);
  const spawnPrefab = vi.fn((_prefab: string, position: THREE.Vector3) => s.prefabs.spawn('moonbutterfly_sapling', position) as never);
  const planting = deployActor(world, inventory, createDeployMap({ turf: landTurf({ canDeployPlantAtPoint: canPlant }),
    blockers: placementEntities(scene), spawnPrefab }));
  const { graph, locomotor } = planting;
  const point = new THREE.Vector3(6, 0, 0);
  let restored: Awaited<ReturnType<typeof setup>> | undefined;
  const restoredInventory = createInventoryStore([]);
  try {
    expect((await executeDebugCommand('c_give("moonbutterfly",2)', inventory)).ok).toBe(true);
    const original = inventory.getEntity(inventorySlotAddress(0))!;
    expect(original.components.perishable.localMultiplier?.()).toBe(.25);
    original.setFreshnessPercent(.6);
    expect(inventory.transfer(inventorySlotAddress(0), cursorSlotAddress(), 2)).toBe(true);
    canPlant.mockReturnValue(false);
    expect(planting.canDeploy(point)).toBe(false);
    canPlant.mockReturnValue(true);
    expect(s.saplings()).toEqual([]);
    world.player.position.set(4, 0, 0);
    expect(planting.deploy(point)).toBe(true);
    expect(locomotor.PushAction).toHaveBeenCalled();
    graph.update(5 / 30); planting.controller.cancel(); graph.update(1);
    expect(inventory.get(cursorSlotAddress())?.count).toBe(2);
    expect(s.saplings()).toEqual([]);
    expect(planting.deploy(point)).toBe(true);
    graph.update(5 / 30);
    expect(inventory.get(cursorSlotAddress())?.count).toBe(2);
    graph.update(1 / 30);
    expect(inventory.get(cursorSlotAddress())).toMatchObject({ count: 1, freshnessPercent: .6 });
    expect(inventory.getEntity(cursorSlotAddress())?.id).toBe(original.id);
    expect(s.saplings()[0].transform.position).toEqual(point.toArray());
    expect(s.saplings()[0].components.saplingTimer!.timers.grow.timeleft).toBe(225);
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/wilson/plant_tree', point);
    expect(planting.canDeploy(point.clone().add(new THREE.Vector3(9.5, 0, 0)))).toBe(false);
    expect(planting.canDeploy(point.clone().add(new THREE.Vector3(9.7, 0, 0)))).toBe(true);
    const unloaded = s.prefabs.spawn('moon_tree_normal', new THREE.Vector3(300, 0, 0));
    expect(prefabInstance(unloaded.transform.model)!.sprite.loaded).toBe(false);
    expect(planting.canDeploy(new THREE.Vector3(309.5, 0, 0))).toBe(false);
    expect(planting.canDeploy(new THREE.Vector3(309.7, 0, 0))).toBe(true);
    let json = '';
    expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
      json = serializeSave(deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG), {
        entities: { moonbutterfly_sapling: s.saplings() }, inventory: inventory.exportState(),
        elapsedSeconds: s.scheduler.now, playerTransform: { position: [0, 0, 0], rotationY: 0 },
      }, SAVE_CATALOG);
    })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG);
    restored = await setup();
    const record = saved.world.entities.moonbutterfly_sapling[0];
    restored.prefabs.spawn('moonbutterfly_sapling', new THREE.Vector3(...record.transform.position), record);
    restoredInventory.replaceState(inventoryStateFromSave(saved), SAVE_CATALOG.recipes);
    expect(restored.saplings()).toEqual(s.saplings());
    expect(restoredInventory.exportState()).toEqual(inventory.exportState());
    s.scheduler.advance(225);
    expect(s.saplings()).toEqual([]);
    const tree = prefabInstance(workTargets('CHOP').find(target => target.position.equals(point))!.model) as unknown as PrefabInstance;
    expect(tree.GetPersistData()).toEqual({ moonTree: { size: 'short' }, growable: { stage: 1, time: 450 } });
    // The new entity has no drawn sprite yet; its transition settles under the display residency contract.
    expect(lookupPrefabInstance(tree.transform.model)!.sprite.sprite.peek().clip.name).toBe('sway1_loop_short');
    expect(workTargets('CHOP', tree.transform.model)[0].entity.components.workable!.GetWorkLeft()).toBe(8);
    expect(performToolWork('CHOP', workTargets('CHOP', tree.transform.model)[0].entity, {})).toBe(true);
    s.setSpring(); s.scheduler.advance(450);
    expect(tree.GetPersistData()).toEqual({ moonTree: { size: 'normal' }, growable: { stage: 2, time: 1125 } });
    expect(workTargets('CHOP', tree.transform.model)[0].entity.components.workable!.GetWorkLeft()).toBe(12);
    s.scheduler.advance(1125);
    expect(tree.GetPersistData().moonTree!.size).toBe('tall');
    expect(workTargets('CHOP', tree.transform.model)[0].entity.components.workable!.GetWorkLeft()).toBe(16);
    s.scheduler.advance(1125);
    expect(tree.GetPersistData()).toEqual({ moonTree: { size: 'short' }, growable: { stage: 1, time: 337 } });
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/forest/treeGrowFromWilt', tree.position);
  } finally { planting.controller.dispose(); graph.cancelAction(); inventory.dispose(); restoredInventory.dispose(); restored?.dispose(); s.dispose(); }
});

it('keeps logical growth while unloaded and stops growth when chopping or digging plants', async () => {
  const s = await setup();
  try {
    const tree = s.prefabs.spawn('moon_tree_normal', new THREE.Vector3(3, 0, 0));
    await area.visit(new THREE.Vector3(500, 0, 0));
    s.scheduler.advance(1600);
    expect(tree.GetPersistData().growable).toEqual({ stage: 2, time: 0, sleeptime: 1600 });
    await area.visit(new THREE.Vector3());
    expect(tree.GetPersistData()).toEqual({ moonTree: { size: 'short' }, growable: { stage: 1, time: 250 } });
    expect(prefabInstance(tree.transform.model)!.sprite.currentAnimation).not.toMatch(/^grow_/);
    const target = workTargets('CHOP', tree.transform.model)[0];
    expect(target.entity.components.workable!.WorkedBy({}, 8)).toBe(true);
    expect(tree.GetPersistData()).toEqual({ moonTree: { size: 'short', stump: true }, growable: { stage: 1 },
      moonTreeTimer: { timers: { decay: { timeleft: 14400, initial_time: 14400, paused: false } } } });
    expect(prefabInstance(tree.transform.model)!.minimap.icon).toBe('moon_tree_stump.png');
    s.scheduler.advance(5000);
    expect(workTargets('DIG', tree.transform.model)[0].work()).toBe(true);
    const sapling = s.prefabs.spawn('moonbutterfly_sapling', new THREE.Vector3(5, 0, 0));
    expect(workTargets('DIG', sapling.transform.model)[0].work()).toBe(true);
    expect(sapling.isRemoved).toBe(true);
    expect(s.dropLoot).toHaveBeenLastCalledWith([{ itemId: 'twigs', count: 1 }], sapling.position);
    s.scheduler.advance(300);
    expect(s.records()).toEqual([]);
  } finally { s.dispose(); }
});

it('shows source snow art at the cover threshold, restores it on reload and releases unloaded tree effects', async () => {
  const s = await setup();
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  const drawnIndices = (model: THREE.Group) => {
    let count = 0;
    model.traverse(object => { if (object instanceof THREE.Mesh) count += object.geometry.drawRange.count; });
    return count;
  };
  try {
    const tree = s.prefabs.spawn('moon_tree_tall', new THREE.Vector3(3, 0, 0));
    await drawn(tree.transform.model);
    const model = tree.transform.model, bareIndices = drawnIndices(model);
    expect(prefabInstance(model)!.listTags()).toContain('SnowCovered');
    const mesh = () => model.children[0].children[0].children.find(child => child instanceof THREE.Mesh) as THREE.Mesh;
    expect(mesh().visible).toBe(false); // Swaying is drawn by the shared instance batch.
    s.snowLevel.set(.014); await settle();
    expect(drawnIndices(model)).toBe(bareIndices);
    s.snowLevel.set(.015); await settle();
    expect(drawnIndices(model)).toBeGreaterThan(bareIndices);
    const oldAnimation = prefabInstance(model)!.sprite;
    const hide = vi.spyOn(oldAnimation, 'setSymbolHidden');
    await area.visit(new THREE.Vector3(500, 0, 0));
    s.snowLevel.set(0);
    await settle();
    expect(hide).not.toHaveBeenCalled();
    s.snowLevel.set(.5);
    await area.visit(new THREE.Vector3());
    expect(tree.transform.model).toBe(model);
    expect(prefabInstance(tree.transform.model)!.sprite).toBe(oldAnimation);
    expect(drawnIndices(tree.transform.model)).toBeGreaterThan(bareIndices);
    s.snowLevel.set(0); await settle();
    expect(drawnIndices(tree.transform.model)).toBe(bareIndices);
    expect(hide).toHaveBeenCalledWith('snow', true);
  } finally { s.dispose(); }
});

it('restores a paused moon-tree decay timer while unloaded, then removes its logical map icon at expiration', async () => {
  const s = await setup();
  try {
    const timer = { timers: { decay: { timeleft: 10, initial_time: 200, paused: true } } };
    const tree = s.prefabs.spawn('moon_tree_short', new THREE.Vector3(300, 0, 0), { id: 'moon-stump',
      transform: { position: [300, 0, 0], rotationY: 0 }, components: { moonTree: { size: 'short', stump: true }, growable: { stage: 1 }, moonTreeTimer: timer } });
    const icon = prefabInstance(tree.transform.model)!.minimap;
    expect(prefabInstance(tree.transform.model)!.sprite.loaded).toBe(false);
    expect(icon).toMatchObject({ icon: 'moon_tree_stump.png', priority: -1 });
    s.scheduler.advance(20);
    const state = tree.GetPersistData();
    expect(state.moonTreeTimer).toEqual(timer);
    const save = deserializeSave(serializeSave(deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG), {
      inventory: { slots: [], bufferedBuilds: [] },
      entities: { moon_tree: [{ id: 'moon-stump', transform: { position: tree.position.toArray(), rotationY: 0 }, components: state }] },
      elapsedSeconds: s.scheduler.now, playerTransform: { position: [0, 0, 0], rotationY: 0 },
    }, SAVE_CATALOG), SAVE_CATALOG);
    expect(save.world.entities.moon_tree[0].components).toEqual(state);
    (prefabInstance(tree.transform.model)!.components as { timer: Timer }).timer.ResumeTimer('decay');
    s.scheduler.advance(10);
    expect(s.records()).toEqual([]);
    expect(prefabInstance(tree.transform.model)!.isRemoved).toBe(true);
    expect(icon.enabled).toBe(false);
  } finally { s.dispose(); }
});

import { EventEmitter } from '@dontstarve-web/signals';
import type { WorldEvents } from '../../prefab/src/worldContext';
import * as THREE from 'three';
import { createTestArea, useTestTileMap } from './tileMapFixture';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMoonTreeForest } from '../../prefab/src/moontree';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { PlantDeployment } from '../../prefab/src/plantDeployment';
import { WilsonStateGraph } from '../../stategraphs/src/SGwilson';
import type { ActionAnimationController } from '../../stategraphs/src/actionContext';
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
import { bindTestWorld } from './worldContentFixture';

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
  const scheduler = new GameTimeScheduler(), camera = new THREE.PerspectiveCamera(), dropLoot = vi.fn();
  const { snowLevel, unbind } = bindTestWorld(scheduler);
  const forest = await createMoonTreeForest('/dst/data/anim', { positions: [], random: () => .5 });
  let spring = false;
  forest.bindWorld({ camera, scene: new THREE.Scene(), worldEvents: new EventEmitter<WorldEvents>(), tickingarea: area.query, scheduler, dropLoot, growthDuration: seconds => seconds * (spring ? .75 : 1) });
  await area.visit(new THREE.Vector3(), forest);
  return { forest, scheduler, camera, dropLoot, snowLevel, setSpring: () => { spring = true; },
    dispose: () => { forest.dispose(); unbind(); scheduler.dispose(); } };
}

it('plants one moonbutterfly with original baby-tree art and cycles short/normal/tall work and growth, accelerating new spring tasks', async () => {
  const s = await setup(), canvas = new EventTarget(), scene = new THREE.Scene();
  scene.add(s.forest.group);
  const inventory = createInventoryStore([]);
  const graph = new WilsonStateGraph({ playAnimation: () => 1, playSound() {}, stopSound() {}, setCasting() {}, onStateChanged() {} });
  const animation = { stategraph: graph, cancelEmote: vi.fn(), setFacing: vi.fn() } as unknown as ActionAnimationController;
  const locomotor = { destination: undefined, goToPoint: vi.fn(() => true), stop: vi.fn() };
  const world = { scene, player: new THREE.Group(), camera: s.camera, ground: new THREE.Group(), renderer: { domElement: canvas } } as unknown as WorldContext;
  const canPlant = vi.fn(() => true);
  const source = () => {
    const address = cursorSlotAddress(), entity = inventory.getEntity(address);
    if (!entity) return undefined;
    const isValid = () => !entity.isRemoved && inventory.getEntity(address) === entity;
    return { entity, isValid, take: () => isValid() ? inventory.extract(address, 1, entity) ?? undefined : undefined,
      putBack: (item: typeof entity) => { inventory.receiveAt(address, item); } };
  };
  const prepare = vi.fn(() => s.forest.prepareTransplant());
  const planting = new PlantDeployment(world, animation, locomotor, source,
    { plants: { moonbutterfly_sapling: { prepareTransplant: prepare } }, canPlant });
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
    expect(planting.request(point)).toBe(false);
    canPlant.mockReturnValue(true);
    expect(planting.request(point)).toBe(true);
    await prepare.mock.results.at(-1)!.value; await new Promise(resolve => setTimeout(resolve, 0));
    planting.update();
    expect(locomotor.goToPoint).toHaveBeenCalled();
    expect(s.forest.exportSaplings()).toEqual([]);
    world.player.position.set(4, 0, 0);
    planting.update(); graph.update(5 / 30); planting.cancel(); graph.update(1);
    expect(inventory.get(cursorSlotAddress())?.count).toBe(2);
    expect(s.forest.exportSaplings()).toEqual([]);
    expect(planting.request(point)).toBe(true);
    await prepare.mock.results.at(-1)!.value; await new Promise(resolve => setTimeout(resolve, 0));
    planting.update(); graph.update(5 / 30);
    expect(inventory.get(cursorSlotAddress())?.count).toBe(2);
    graph.update(1 / 30);
    expect(inventory.get(cursorSlotAddress())).toMatchObject({ count: 1, freshnessPercent: .6 });
    expect(inventory.getEntity(cursorSlotAddress())?.id).toBe(original.id);
    expect(s.forest.exportSaplings()[0].transform.position).toEqual(point.toArray());
    expect(s.forest.exportSaplings()[0].components.saplingTimer.timers.grow.timeleft).toBe(225);
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/wilson/plant_tree', point);
    expect(planting.canDeploy(point.clone().add(new THREE.Vector3(9.5, 0, 0)), source()!.entity)).toBe(false);
    expect(planting.canDeploy(point.clone().add(new THREE.Vector3(9.7, 0, 0)), source()!.entity)).toBe(true);
    const unloaded = s.forest.spawnTree('moon_tree_normal', new THREE.Vector3(300, 0, 0));
    expect(unloaded.model).toBeUndefined();
    expect(planting.canDeploy(new THREE.Vector3(309.5, 0, 0), source()!.entity)).toBe(false);
    expect(planting.canDeploy(new THREE.Vector3(309.7, 0, 0), source()!.entity)).toBe(true);
    let json = '';
    expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
      json = serializeSave(deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG), {
        entities: { moonbutterfly_sapling: s.forest.exportSaplings() }, inventory: inventory.exportState(),
        elapsedSeconds: s.scheduler.now, playerTransform: { position: [0, 0, 0], rotationY: 0 },
      }, SAVE_CATALOG);
    })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG);
    restored = await setup();
    const record = saved.world.entities.moonbutterfly_sapling[0];
    restored.forest.spawnSapling(new THREE.Vector3(...record.transform.position), {
      ...record, components: { saplingTimer: record.components.saplingTimer! },
    });
    restoredInventory.replaceState(inventoryStateFromSave(saved), SAVE_CATALOG.recipes);
    expect(restored.forest.exportSaplings()).toEqual(s.forest.exportSaplings());
    expect(restoredInventory.exportState()).toEqual(inventory.exportState());
    s.scheduler.advance(225);
    expect(s.forest.exportSaplings()).toEqual([]);
    const tree = s.forest.entities.find(tree => tree.position.equals(point))!;
    expect(s.forest.exportState(tree)).toEqual({ moonTree: { size: 'short' }, growable: { stage: 1, time: 450 } });
    expect(tree.model!.userData.animationController.currentAnimation).toBe('grow_seed_to_short');
    expect(s.forest.chopTargets[0].entity.components.workable!.GetWorkLeft()).toBe(8);
    expect(performToolWork('CHOP', s.forest.chopTargets[0].entity, {})).toBe(true);
    s.setSpring(); s.scheduler.advance(450);
    expect(s.forest.exportState(tree)).toEqual({ moonTree: { size: 'normal' }, growable: { stage: 2, time: 1125 } });
    expect(s.forest.chopTargets[0].entity.components.workable!.GetWorkLeft()).toBe(12);
    s.scheduler.advance(1125);
    expect(s.forest.exportState(tree).moonTree!.size).toBe('tall');
    expect(s.forest.chopTargets[0].entity.components.workable!.GetWorkLeft()).toBe(16);
    s.scheduler.advance(1125);
    expect(s.forest.exportState(tree)).toEqual({ moonTree: { size: 'short' }, growable: { stage: 1, time: 337 } });
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/forest/treeGrowFromWilt', tree.position);
  } finally { planting.dispose(); graph.cancelAction(); inventory.dispose(); restoredInventory.dispose(); restored?.dispose(); s.dispose(); }
});

it('keeps logical growth while unloaded and stops growth when chopping or digging plants', async () => {
  const s = await setup();
  try {
    const tree = s.forest.spawnTree('moon_tree_normal', new THREE.Vector3(3, 0, 0));
    await area.visit(new THREE.Vector3(500, 0, 0), s.forest);
    s.scheduler.advance(1600);
    expect(s.forest.exportState(tree).growable).toEqual({ stage: 2, time: 0, sleeptime: 1600 });
    await area.visit(new THREE.Vector3(), s.forest);
    expect(s.forest.exportState(tree)).toEqual({ moonTree: { size: 'short' }, growable: { stage: 1, time: 250 } });
    expect(tree.model!.userData.animationController.currentAnimation).not.toMatch(/^grow_/);
    const target = s.forest.chopTargets[0];
    expect(target.entity.components.workable!.WorkedBy({}, 8)).toBe(true);
    expect(s.forest.exportState(tree)).toEqual({ moonTree: { size: 'short', stump: true }, growable: { stage: 1 },
      moonTreeTimer: { timers: { decay: { timeleft: 14400, initial_time: 14400, paused: false } } } });
    expect(s.forest.miniMapEntities[0].icon).toBe('moon_tree_stump.png');
    s.scheduler.advance(5000);
    expect(s.forest.digTargets[0].dig()).toBe(true);
    const sapling = s.forest.spawnSapling(new THREE.Vector3(5, 0, 0));
    expect(s.forest.digTargets[0].dig()).toBe(true);
    expect(sapling.userData.removed).toBe(true);
    expect(s.dropLoot).toHaveBeenLastCalledWith([{ itemId: 'twigs', count: 1 }], sapling.position);
    s.scheduler.advance(300);
    expect(s.forest.entities).toEqual([]);
    expect(s.forest.exportSaplings()).toEqual([]);
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
    const tree = s.forest.spawnTree('moon_tree_tall', new THREE.Vector3(3, 0, 0));
    const model = tree.model!, bareIndices = drawnIndices(model);
    expect(model.userData.tags).toContain('SnowCovered');
    const mesh = () => model.children[0].children.find(child => child instanceof THREE.Mesh) as THREE.Mesh;
    expect(mesh().visible).toBe(false); // Swaying is drawn by the shared instance batch.
    s.snowLevel.set(.014); await settle();
    expect(drawnIndices(model)).toBe(bareIndices);
    s.snowLevel.set(.015); await settle();
    expect(drawnIndices(model)).toBeGreaterThan(bareIndices);
    const oldAnimation = model.userData.animationController;
    const hide = vi.spyOn(oldAnimation, 'setSymbolHidden');
    await area.visit(new THREE.Vector3(500, 0, 0), s.forest);
    s.snowLevel.set(0);
    await settle();
    expect(hide).not.toHaveBeenCalled();
    s.snowLevel.set(.5);
    await area.visit(new THREE.Vector3(), s.forest);
    expect(tree.model).not.toBe(model);
    expect(drawnIndices(tree.model!)).toBeGreaterThan(bareIndices);
    s.snowLevel.set(0); await settle();
    expect(drawnIndices(tree.model!)).toBe(bareIndices);
    expect(hide).not.toHaveBeenCalled();
  } finally { s.dispose(); }
});

it('restores a paused moon-tree decay timer while unloaded, then removes its logical map icon at expiration', async () => {
  const s = await setup();
  try {
    const tree = s.forest.spawnTree('moon_tree_short', new THREE.Vector3(300, 0, 0), 'moon-stump');
    const timer = { timers: { decay: { timeleft: 10, initial_time: 200, paused: true } } };
    s.forest.restoreState('moon-stump', { size: 'short', stump: true }, { stage: 1 }, timer);
    const icon = s.forest.miniMapEntities[0];
    expect(tree.model).toBeUndefined();
    expect(icon).toMatchObject({ icon: 'moon_tree_stump.png', priority: -1, position: tree.position });
    s.scheduler.advance(20);
    const state = s.forest.exportState(tree);
    expect(state.moonTreeTimer).toEqual(timer);
    const save = deserializeSave(serializeSave(deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG), {
      inventory: { slots: [], bufferedBuilds: [] },
      entities: { moon_tree: [{ id: 'moon-stump', transform: { position: tree.position.toArray(), rotationY: 0 }, components: state }] },
      elapsedSeconds: s.scheduler.now, playerTransform: { position: [0, 0, 0], rotationY: 0 },
    }, SAVE_CATALOG), SAVE_CATALOG);
    expect(save.world.entities.moon_tree[0].components).toEqual(state);
    s.forest.restoreState('moon-stump', state.moonTree, state.growable,
      { timers: { decay: { ...timer.timers.decay, paused: false } } });
    s.scheduler.advance(10);
    expect(s.forest.entities).toEqual([]);
    expect(s.forest.miniMapEntities).toEqual([]);
    expect(icon.enabled).toBe(false);
  } finally { s.dispose(); }
});

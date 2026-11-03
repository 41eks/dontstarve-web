import { prefabDisplays } from './prefabManagerFixture';
import { plantManager } from './plantManagerFixture';
import { prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import type { PrefabDisplay } from '@dontstarve-web/display';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { monkeytailPrefabs, MONKEYTAIL_REGROW_TIME } from '../../prefab/src/monkeytail';
import { createDeployMap } from '../../prefab/src/deployMap';
import { placementEntities } from '../../prefab/src/placementEntities';
import { deployActor, landTurf } from './deployActor';
import { GroundItemManager } from '../../prefab/src/groundItemManager';
import { createInventoryStore } from '../../../src/inventory';
import { inventorySlotAddress, cursorSlotAddress } from '../../inventory/src';
import { createSignal } from '../../signals/src';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { WilsonStateGraph } from '../../stategraphs/src/SGwilson';
import { ItemUseActionController, getItemUseActions } from '../../stategraphs/src/itemuse';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { inventoryStateFromSave } from '../../../src/save/inventoryState';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { bindTestWorld, drawn, plantInstance } from './worldContentFixture';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { workTargets } from './workTargets';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const inventory = createInventoryStore([]), scene = new THREE.Scene(), player = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(), renderer = { domElement: new EventTarget() } as THREE.WebGLRenderer;
  const scheduler = new GameTimeScheduler();
  const ground = new GroundItemManager(scene, camera, renderer, '/dst/data/databundles/images.zip', inventory, '/dst/data/anim', player);
  const { season } = bindTestWorld(scheduler);
  const rain = createSignal<'none' | 'rain' | 'snow'>('none');
  let temperature = 20;
  const monkeytails = plantManager(monkeytailPrefabs, scene, {
    rain, getLocalTemperature: () => temperature,
    spawnGroundItem: (definition, position, options) => ground.spawnGroundItem(definition, position, options),
  });
  const registry = new EntityRegistry();
  registry.register(PREFAB_DEFINITIONS.monkeytails, {
    restore: (_, record) => drawn(monkeytails.spawn('monkeytail', new THREE.Vector3(...record.transform.position), record).transform.model),
    debugSpawn: () => drawn(monkeytails.spawn('monkeytail', player.position.clone()).transform.model),
    exportRecords: () => monkeytails.exportRecords(),
    dispose: () => monkeytails.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.groundItems, {
    restore: (_, record) => ground.spawnFromSave(record.id, {
      ...SAVE_CATALOG.items[record.components.stack!.itemId], ...record.components.stack!,
    }, new THREE.Vector3(...record.transform.position)),
    debugSpawn: id => ground.spawnFromSave('dug:command', { ...SAVE_CATALOG.items[id], itemId: id, count: 1 }, player.position),
    exportRecords: () => ground.exportRecords().map(record => ({ prefabId: 'ground_item', record })),
    dispose: () => ground.dispose(),
  });
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  const save = () => serializeSave(template, {
    entities: { monkeytail: monkeytails.exportRecords().map(({ record }) => record), ground_item: ground.exportRecords() }, inventory: inventory.exportState(),
    elapsedSeconds: scheduler.now, playerTransform: { position: player.position.toArray() as [number, number, number], rotationY: 0 },
  }, SAVE_CATALOG);
  const advance = (seconds: number) => { scheduler.advance(seconds); prefabDisplays(monkeytails).update(seconds, new THREE.Quaternion()); };
  return { inventory, scene, player, ground, monkeytails, registry, season, rain, scheduler, save, advance,
    setTemperature: (value: number) => { temperature = value; },
    world: { scene, player, camera, renderer, ground: new THREE.Group(), cameraFacing: createSignal(8), cameraHeading: createSignal(45) },
    dispose: () => { registry.dispose(); inventory.dispose(); scheduler.dispose(); } };
}

function actor() {
  const graph = new WilsonStateGraph({ playAnimation: () => 1, playSound: () => {}, stopSound: () => {}, onStateChanged: () => {} });
  const animation = { stategraph: graph };
  const locomotor = { destination: undefined, goToPoint: vi.fn(() => true), stop: vi.fn() };
  return { graph, animation, locomotor };
}

it('spawns wild monkeytail, picks reeds, pauses in winter and reloads its discrete regrowth task', async () => {
  const s = setup(), restored = setup();
  try {
    s.player.position.set(3, 0, 6);
    expect((await executeDebugCommand('c_spawn("monkeytail")', s.inventory, id => s.registry.spawn(id))).ok).toBe(true);
    const model = workTargets('DIG', s.scene)[0].model, pickable = plantInstance(model).components.pickable;
    expect(plantInstance(model).sprite.currentAnimation).toBe('idle');
    expect(prefabInstance(model)!.listTags()).toContain('silviculture');
    expect(prefabInstance(model)!.listTags()).not.toContain('renewable');
    expect(plantInstance(model).deploySmartRadius).toBe(1.5);
    const cycles = pickable.cyclesLeft;
    expect(cycles).toBeGreaterThanOrEqual(5); expect(cycles).toBeLessThanOrEqual(7);
    const doer = { giveItem: (item: string, count: number) => s.inventory.add(item, count) };
    expect(pickable.pick(doer)).toBe(true);
    expect(s.inventory.count('cutreeds')).toBe(1);
    expect(pickable.cyclesLeft).toBe(cycles);
    expect(plantInstance(model).sprite.currentAnimation).toBe('picking');
    const waiting = pickable.state.timer.peek();
    s.advance(400);
    expect(pickable.state.timer.peek()).toBe(waiting);
    s.season.set({ season: 'winter', progress: 0 });
    expect(pickable.state.timer.peek()).toEqual({ status: 'paused', remainingSeconds: 1040 });
    let json = '';
    expect((await executeDebugCommand('c_save()', s.inventory, undefined, () => { json = s.save(); })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG), record = saved.world.entities.monkeytail[0];
    restored.season.set({ season: 'winter', progress: 0 });
    await drawn(restored.monkeytails.spawn('monkeytail', new THREE.Vector3(...record.transform.position), record).transform.model);
    restored.inventory.replaceState(inventoryStateFromSave(saved), SAVE_CATALOG.recipes);
    expect(restored.monkeytails.exportRecords().map(({ record }) => record)).toEqual([record]);
    expect(restored.inventory.exportState()).toEqual(s.inventory.exportState());
    s.advance(1000); expect(pickable.canBePicked).toBe(false);
    s.season.set({ season: 'spring', progress: 0 });
    expect(pickable.remainingSeconds).toBe(780);
    s.advance(780); expect(pickable.canBePicked).toBe(true);
    expect(plantInstance(model).sprite.currentAnimation).toBe('grow');
    for (let frame = 0; frame < 90; frame++) s.advance(1 / 30);
    expect(plantInstance(model).sprite.currentAnimation).toBe('idle');
    // A native mature plant has no transplanted-cycle limit.
    for (let i = 0; i < cycles + 1; i++) { expect(pickable.pick(doer)).toBe(true); s.advance(1080); }
    expect(pickable.cyclesLeft).toBe(cycles);
  } finally { s.dispose(); restored.dispose(); }
});

it('plants cursor-held roots and fertilizes at frame six, preserves cancellation and saves exhausted transplanted plants', async () => {
  const s = setup(), restored = setup(), a = actor();
  let deployment: ReturnType<typeof deployActor> | undefined, fertilizing: ItemUseActionController | undefined;
  try {
    // The ground-art fixture must not obstruct the cursor-held plant's deployment point.
    s.player.position.set(30, 0, 30);
    expect((await executeDebugCommand('c_give("dug_monkeytail",2);c_give("poop",2);c_spawn("dug_monkeytail")', s.inventory,
      id => s.registry.spawn(id))).ok).toBe(true);
    expect(s.inventory.getItemSpec('dug_monkeytail').maxStack).toBe(10);
    expect(s.inventory.getItemSpec('dug_monkeytail').atlas).toBe('images/inventoryimages2.xml');
    let groundMesh!: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
    await (prefabDisplay(s.ground.reskinTargets[0].model) as PrefabDisplay).artLoaded();
    s.ground.reskinTargets[0].model.traverse(object => { if (object instanceof THREE.Mesh) groundMesh ??= object as typeof groundMesh; });
    expect(groundMesh.material.some(material => material.name === 'ground:reeds_monkeytails')).toBe(true);
    expect(groundMesh.geometry.drawRange.count).toBeGreaterThan(0);
    s.player.position.set(0, 0, 0);
    expect(s.inventory.transfer(inventorySlotAddress(0), cursorSlotAddress(), 2)).toBe(true);
    const spawnPrefab = vi.fn((_prefab: string, position: THREE.Vector3) => prefabInstance(s.monkeytails.spawn('monkeytail', position).transform.model) as never);
    deployment = deployActor(s.world as never, s.inventory, createDeployMap({ turf: landTurf({ canDeployPlantAtPoint: (point: THREE.Vector3) => point.x >= 0 }),
      blockers: placementEntities(s.scene), spawnPrefab }), a.graph);
    expect(deployment.canDeploy(new THREE.Vector3(-1, 0, 0))).toBe(false);
    expect(deployment.deploy(new THREE.Vector3(2, 0, 0))).toBe(true);
    a.graph.update(5 / 30); deployment.controller.cancel();
    a.graph.update(1);
    expect(spawnPrefab).not.toHaveBeenCalled();
    expect(s.inventory.get(cursorSlotAddress())?.count).toBe(2);
    expect(s.monkeytails.exportRecords().map(({ record }) => record)).toEqual([]);
    expect(deployment.deploy(new THREE.Vector3(2, 0, 0))).toBe(true);
    a.graph.update(5 / 30);
    expect(s.inventory.get(cursorSlotAddress())?.count).toBe(2);
    a.graph.update(1 / 30);
    expect(s.inventory.get(cursorSlotAddress())?.count).toBe(1);
    const target = workTargets('DIG', s.scene)[0], pickable = plantInstance(target.model).components.pickable;
    expect(pickable.exportState()).toMatchObject({ picked: true, transplanted: true, cyclesLeft: 0 });
    expect(pickable.state.timer.peek()).toEqual({ status: 'stopped' });
    expect(plantInstance(target.model).sprite.currentAnimation).toBe('idle_dead');
    expect(deployment.canDeploy(new THREE.Vector3(4, 0, 0))).toBe(false);
    expect(deployment.canDeploy(new THREE.Vector3(5, 0, 0))).toBe(true);
    a.graph.update(1);
    expect(s.inventory.transfer(cursorSlotAddress(), inventorySlotAddress(0), 1)).toBe(true);
    expect(s.inventory.transfer(inventorySlotAddress(1), cursorSlotAddress(), 2)).toBe(true);
    const fertilizerSource = () => {
      const entity = s.inventory.getEntity(cursorSlotAddress())!;
      return { entity, isValid: () => s.inventory.getEntity(cursorSlotAddress()) === entity && !entity.isRemoved,
        take: () => { const item = s.inventory.extract(cursorSlotAddress(), 1, entity); if (!item) return false; item.remove(); return true; } };
    };
    fertilizing = new ItemUseActionController(s.world, a.animation.stategraph, a.locomotor, fertilizerSource);
    expect(getItemUseActions(target.model, fertilizerSource()).some(candidate => candidate.action.action === 'FERTILIZE')).toBe(true);
    expect(fertilizing.request('FERTILIZE', target.entity! as never)).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    fertilizing.update(); a.graph.update(5 / 30); fertilizing.cancel(); a.graph.update(1);
    expect(pickable.IsBarren()).toBe(true); expect(s.inventory.count('poop')).toBe(2);
    expect(fertilizing.request('FERTILIZE', target.entity! as never)).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    fertilizing.update(); a.graph.update(6 / 30);
    expect(s.inventory.count('poop')).toBe(1);
    expect(pickable.IsBarren()).toBe(false); expect(pickable.remainingSeconds).toBe(MONKEYTAIL_REGROW_TIME);
    s.advance(MONKEYTAIL_REGROW_TIME);
    const cycles = pickable.cyclesLeft;
    for (let i = 0; i < cycles; i++) {
      expect(pickable.pick({ giveItem: (id: string, count: number) => s.inventory.add(id, count) })).toBe(true);
      if (i < cycles - 1) s.advance(MONKEYTAIL_REGROW_TIME);
    }
    expect(pickable.IsBarren()).toBe(true); expect(pickable.remainingSeconds).toBeUndefined();
    let json = '';
    expect((await executeDebugCommand('c_save()', s.inventory, undefined, () => { json = s.save(); })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG);
    restored.inventory.replaceState(inventoryStateFromSave(saved), SAVE_CATALOG.recipes);
    for (const record of saved.world.entities.monkeytail) await drawn(restored.monkeytails.spawn('monkeytail', new THREE.Vector3(...record.transform.position), record).transform.model);
    for (const record of saved.world.entities.ground_item) {
      const item = record.components.stack!;
      await restored.ground.spawnFromSave(record.id, { ...SAVE_CATALOG.items[item.itemId], ...item }, new THREE.Vector3(...record.transform.position));
    }
    expect(restored.monkeytails.exportRecords().map(({ record }) => record)).toEqual(s.monkeytails.exportRecords().map(({ record }) => record));
    expect(restored.ground.exportRecords()).toEqual(s.ground.exportRecords());
    expect(restored.inventory.exportState()).toEqual(s.inventory.exportState());
    expect(restored.inventory.get(cursorSlotAddress())?.itemId).toBe('poop');
    expect(plantInstance(workTargets('DIG', restored.scene)[0].model).sprite.currentAnimation).toBe('idle_dead');
  } finally { deployment?.controller.dispose(); fertilizing?.dispose(); a.graph.cancelAction(); s.dispose(); restored.dispose(); }
});

it('withers in heat, reloads its recovery delay, regrows after rain and digs the Lua-specific loot', async () => {
  const s = setup(), restored = setup();
  try {
    const model = await drawn(s.monkeytails.spawn('monkeytail', new THREE.Vector3(3, 0, 6)).transform.model);
    const pickable = plantInstance(model).components.pickable, witherable = plantInstance(model).components.witherable;
    s.setTemperature(100); s.advance(60);
    expect(witherable.IsWithered()).toBe(true); expect(pickable.IsBarren()).toBe(true);
    expect(plantInstance(model).sprite.currentAnimation).toBe('full_to_dead');
    const saved = deserializeSave(s.save(), SAVE_CATALOG), record = saved.world.entities.monkeytail[0];
    await drawn(restored.monkeytails.spawn('monkeytail', new THREE.Vector3(...record.transform.position), record).transform.model);
    expect(restored.monkeytails.exportRecords().map(({ record }) => record)).toEqual([record]);
    s.rain.set('rain');
    await new Promise(resolve => setTimeout(resolve, 0));
    s.advance(60);
    expect(witherable.IsWithered()).toBe(false); expect(pickable.IsBarren()).toBe(false);
    expect(pickable.remainingSeconds).toBeGreaterThan(0);
    s.advance(MONKEYTAIL_REGROW_TIME);
    expect(pickable.canBePicked).toBe(true);
    const mature = workTargets('DIG', s.scene)[0];
    expect(performToolWork('DIG', mature.entity!, {})).toBe(true);
    expect(s.ground.exportRecords().map(record => record.components.stack?.itemId)).toEqual(['cutreeds', 'dug_monkeytail']);
    const dead = await drawn(s.monkeytails.spawn('monkeytail', new THREE.Vector3(80, 0, 6)).transform.model);
    plantInstance(dead).components.witherable.ForceWither();
    expect(performToolWork('DIG', workTargets('DIG', s.scene)[0].entity!, {})).toBe(true);
    expect(s.ground.exportRecords().map(record => record.components.stack?.itemId)).toEqual(['cutreeds', 'dug_monkeytail', 'cutreeds']);
    s.advance(2000); expect(s.monkeytails.exportRecords().map(({ record }) => record)).toEqual([]);
    expect(witherable.state.timer.peek()).toEqual({ status: 'stopped' });
  } finally { s.dispose(); restored.dispose(); }
});

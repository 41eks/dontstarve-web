import { findActionEntity } from '../../prefab/src/actionEntity';
import { useTestTileMap, testMap } from './tileMapFixture';
import * as THREE from 'three';
import { PhysicsWorld } from '../../componets/src/physicsWorld';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import { hotspringPrefabs, HOTSPRING_ID, HOTSPRING_LIGHT, type HotspringInstance } from '../../prefab/src/hotspring.ts';
import { worldFxPrefabs, worldFxSpawner } from '../../prefab/src/world_fx';
import { PrefabEntityManager, prefabInstance, type PrefabInstance } from '../../prefab/src/prefabInstance';
import { FindEntities } from '../../prefab/src/actionEntity';
import { GroundItemManager } from '../../prefab/src/groundItemManager';
import { createInventoryStore } from '../../../src/inventory';
import { cursorSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { WilsonStateGraph } from '../../stategraphs/src/SGwilson';
import { ItemUseActionController, getItemUseActions } from '../../stategraphs/src/itemuse';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { createWorldState } from '../../../src/worldState';
import type { TileStateQuery } from '../../signals/src';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { bindTestWorld } from './worldContentFixture';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';

/** The inst.Light an entity's model declares. */
const declaredLight = (inst: PrefabInstance) => inst.light.peek();
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

useTestTileMap();

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(tickingarea?: TileStateQuery, random?: () => number) {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const inventory = createInventoryStore([]), scene = new THREE.Scene(), player = new THREE.Group(), scheduler = new GameTimeScheduler();
  const camera = new THREE.PerspectiveCamera(), renderer = { domElement: new EventTarget() } as THREE.WebGLRenderer;
  const ground = new GroundItemManager(scene, camera, renderer, '/dst/data/databundles/images.zip', inventory, '/dst/data/anim', player);
  const physics = new PhysicsWorld({}, tickingarea);
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { tickingarea, physics });
  prefabs.register(worldFxPrefabs({ scheduler }) as never);
  prefabs.register(hotspringPrefabs({ scheduler, fx: worldFxSpawner(prefabs), random }) as never);
  const registry = new EntityRegistry([], prefabs, () => player.position);
  registry.registerPrefabs(PREFAB_DEFINITIONS.hotsprings);
  registry.register(PREFAB_DEFINITIONS.groundItems, {
    restore: (_, record) => ground.spawnFromSave(record.id, {
      ...SAVE_CATALOG.items[record.components.stack!.itemId], ...record.components.stack! }, new THREE.Vector3(...record.transform.position)),
    debugSpawn: id => ground.spawnFromSave('dug:command', { ...SAVE_CATALOG.items[id], itemId: id, count: 1 }, player.position),
    exportRecords: () => ground.exportRecords().map(record => ({ prefabId: 'ground_item', record })),
    dispose: () => ground.dispose(),
  });
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  const save = () => serializeSave(template, {
    entities: registry.exportRecords(), inventory: inventory.exportState(),
    elapsedSeconds: 0, playerTransform: { position: player.position.toArray() as [number, number, number], rotationY: 0 },
  }, SAVE_CATALOG);
  const springs = () => prefabs.exportRecords().filter(({ prefabId }) => prefabId === HOTSPRING_ID);
  /** Game time and the displays, one 0.1 s frame at a time. */
  const tick = async (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 10); i++) { scheduler.advance(.1); displays.update(.1); await settle(); }
  };
  return { inventory, scene, player, prefabs, displays, physics, registry, scheduler, save, springs, tick,
    spawn: (position: THREE.Vector3, saved?: Parameters<typeof prefabs.spawn>[2]) => prefabs.spawn(HOTSPRING_ID, position, saved) as HotspringInstance,
    world: { scene, player, camera, renderer, ground: new THREE.Group() },
    dispose: () => { registry.dispose(); prefabs.dispose(); displays.dispose(); physics.dispose(); inventory.dispose(); scheduler.dispose(); } };
}

it('lights and heats a spring only after a cursor-held bath bomb is tossed in, then saves and reloads the state', async () => {
  const s = setup(), restored = setup();
  const graph = new WilsonStateGraph({ playAnimation: () => 1, playSound: () => {}, stopSound: () => {}, onStateChanged: () => {} });
  const locomotor = { destination: undefined, goToPoint: vi.fn(() => true), stop: vi.fn() };
  const source = () => {
    const entity = s.inventory.getEntity(cursorSlotAddress());
    if (!entity) return undefined;
    return { entity, isValid: () => s.inventory.getEntity(cursorSlotAddress()) === entity && !entity.isRemoved,
      take: () => { const item = s.inventory.extract(cursorSlotAddress(), 1, entity); if (!item) return false; item.remove(); return true; } };
  };
  let toss: ItemUseActionController | undefined;
  try {
    expect((await executeDebugCommand('c_give("bathbomb",2);c_spawn("hotspring")', s.inventory, id => s.registry.spawn(id))).ok).toBe(true);
    expect(s.inventory.getItemSpec('bathbomb').maxStack).toBe(20);
    expect(s.springs()).toHaveLength(1);
    const spring = s.scene.children.map(child => prefabInstance<HotspringInstance>(child)!).find(inst => inst?.prefab === HOTSPRING_ID)!;
    const model = spring.transform.model, inst = findActionEntity(model)!, heater = spring.components.heater;
    expect(spring.listTags().filter(tag => tag !== 'tickingarea')).toEqual(['watersource', 'antlion_sinkhole_blocker', 'birdblocker', 'inspectable', 'HASHEATER', 'bathbombable', 'blocker']);
    expect(spring.minimap.icon).toBe('hotspring.png');
    expect(heater.GetHeat()).toBe(45);
    expect(declaredLight(spring)).toBeUndefined();
    await prefabDisplay(model)!.artLoaded();
    expect(spring.sprite.currentAnimation).toBe('idle');

    expect(s.inventory.transfer(inventorySlotAddress(0), cursorSlotAddress(), 2)).toBe(true);
    toss = new ItemUseActionController(s.world, graph, locomotor, source);
    expect(getItemUseActions(model, source()).some(candidate => candidate.action.action === 'BATHBOMB')).toBe(true);
    expect(toss.request('BATHBOMB', inst)).toBe(true);
    toss.update(); graph.update(5 / 30);
    expect(s.inventory.get(cursorSlotAddress())?.count).toBe(2);
    toss.cancel(); graph.update(1);
    expect(heater.GetHeat()).toBe(45); expect(spring.hasTag('bathbombable')).toBe(true);

    expect(toss.request('BATHBOMB', inst)).toBe(true);
    toss.update(); graph.update(6 / 30);
    expect(s.inventory.get(cursorSlotAddress())?.count).toBe(1);
    expect(heater.GetHeat()).toBe(90);
    expect(spring.hasTag('bathbombable')).toBe(false);
    expect(declaredLight(spring)).toEqual(HOTSPRING_LIGHT);
    expect(spring.sprite.currentAnimation).toBe('bath_bomb');
    // PlayAnimation("bath_bomb"), PushAnimation("glow_pre"), PushAnimation("glow_loop", true).
    await s.tick(18);
    expect(spring.sprite.currentAnimation).toBe('glow_loop');
    // A bombed spring refuses a second bomb.
    expect(getItemUseActions(model, source()).some(candidate => candidate.action.action === 'BATHBOMB')).toBe(false);

    let json = '';
    expect(await executeDebugCommand('c_save()', s.inventory, undefined, () => { json = s.save(); })).toMatchObject({ ok: true });
    const record = deserializeSave(json, SAVE_CATALOG).world.entities.hotspring[0];
    expect(record.components.hotspring).toEqual({ isbathbombed: true });
    const reloaded = restored.spawn(new THREE.Vector3(...record.transform.position), record);
    expect(restored.springs().map(entry => entry.record)).toEqual([record]);
    expect(reloaded.components.heater.GetHeat()).toBe(90);
    expect(declaredLight(reloaded)).toEqual(HOTSPRING_LIGHT);
    // OnBathBombed while POPULATING goes straight to the glow loop.
    expect(reloaded.sprite.sprite.peek().clip).toMatchObject({ name: 'glow_loop', loop: true });

    spring.remove();
    expect(FindEntities(model.position, 1, ['HASHEATER']).map(entity => entity === findActionEntity(reloaded.transform.model))).toEqual([true]);
    expect(declaredLight(spring)).toBeUndefined();
  } finally { toss?.dispose(); s.dispose(); restored.dispose(); }
});

it('faces the camera on LAYER_BACKGROUND while keeping the saved foot point and physics fixed', async () => {
  // The spring's display turns itself to the world's camera rotation.
  const content = bindTestWorld(new GameTimeScheduler());
  const s = setup();
  try {
    const position = new THREE.Vector3(12, 0, -24);
    const spring = s.spawn(position), model = spring.transform.model;
    await prefabDisplay(model)!.artLoaded();
    // SetLayer(LAYER_BACKGROUND): a fixed order below the world entities, not laid flat.
    expect(spring.sprite.sprite.peek()).toMatchObject({ billboard: true, ground: { flat: false } });
    expect(s.registry.renderEntities.map(entry => entry.object)).not.toContain(model);
    const visual = model.children[0];
    const records = s.springs();
    const physicsPosition = spring.physicsBody!.position.toArray();
    for (const heading of [0, Math.PI / 2]) {
      s.world.camera.rotation.set(-.65, heading, 0, 'YXZ');
      const quaternion = s.world.camera.quaternion;
      content.camerarotation.set(quaternion.clone());
      await settle();
      s.registry.update(0, quaternion);
      model.updateMatrixWorld(true);
      const normal = new THREE.Vector3(0, 0, 1).transformDirection(visual.matrixWorld);
      const cameraNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
      expect(normal.dot(cameraNormal)).toBeCloseTo(1);
      expect(spring.position.toArray()).toEqual(position.toArray());
      expect(spring.physicsBody!.position.toArray()).toEqual(physicsPosition);
      expect(s.springs()).toEqual(records);
    }
  } finally { s.dispose(); content.unbind(); }
});

it('toggles tile visibility, physics and the steam task while preserving inactive saves and cleaning up each spring independently', async () => {
  const state = createWorldState({ map: testMap(), elapsedSeconds: 0, systems: {} });
  state.playerpositions.set([new THREE.Vector3()]);
  const s = setup(state.tickingarea), restored = setup(state.tickingarea);
  try {
    const first = s.spawn(new THREE.Vector3(), { id: 'tile-spring', components: { hotspring: { isbathbombed: true } } });
    const second = s.spawn(new THREE.Vector3(1, 0, 1));
    await settle();
    const firstBody = first.physicsBody, secondBody = second.physicsBody;
    const records = s.springs();
    expect(first.transform.model.parent).toBe(s.scene); expect(second.transform.model.parent).toBe(s.scene);
    expect(s.physics.bodies).toEqual([firstBody, secondBody]);
    expect(first.fxTask.snapshot.peek().status).toBe('scheduled');

    state.playerpositions.set([new THREE.Vector3(300, 0, 0)]);
    await settle();
    expect([first.status.peek(), second.status.peek()]).toEqual(['asleep', 'asleep']);
    expect(first.transform.model.parent).toBeNull(); expect(second.transform.model.parent).toBeNull();
    expect(s.physics.bodies).toEqual([]);
    expect([...s.physics.registeredBodies]).toEqual([firstBody, secondBody]);
    // OnEntitySleep: StopFx.
    expect(first.fxTask.snapshot.peek().status).toBe('stopped');
    expect(s.springs()).toEqual(records);
    expect(first.components.heater.GetHeat()).toBe(90);
    let json = '';
    expect(await executeDebugCommand('c_save()', s.inventory, undefined, () => { json = s.save(); })).toMatchObject({ ok: true });
    const saved = deserializeSave(json, SAVE_CATALOG);
    expect(saved.world.entities.hotspring).toEqual(records.map(entry => entry.record));
    const loaded = restored.spawn(new THREE.Vector3(...saved.world.entities.hotspring[0].transform.position), saved.world.entities.hotspring[0]);
    await settle();
    expect(loaded.transform.model.parent).toBeNull(); expect(restored.physics.bodies).toEqual([]);
    expect(restored.springs()[0]).toEqual(records[0]);
    expect(loaded.sprite.sprite.peek().clip).toMatchObject({ name: 'glow_loop' });

    // Removing one sleeping spring neither stops the others on its tile nor comes back with the tile.
    first.remove();
    state.playerpositions.set([new THREE.Vector3()]);
    await settle();
    expect(first.transform.model.parent).toBeNull();
    expect(second.transform.model.parent).toBe(s.scene); expect(loaded.transform.model.parent).toBe(restored.scene);
    expect(s.physics.bodies).toEqual([secondBody]);
    expect([...s.physics.registeredBodies]).toEqual([secondBody]);
    expect(restored.physics.bodies).toEqual([loaded.physicsBody]);
    expect(declaredLight(loaded)).toEqual(HOTSPRING_LIGHT);
    // OnEntityWake restarts the task of a spring that can still steam.
    expect(second.fxTask.snapshot.peek().status).toBe('scheduled');
  } finally { s.dispose(); restored.dispose(); state.dispose(); }
});

it('emits slow steam, switches to crater steam once bombed, stops while asleep and restarts on wake', async () => {
  const state = createWorldState({ map: testMap(), elapsedSeconds: 0, systems: {} });
  state.playerpositions.set([new THREE.Vector3()]);
  // random() = .5: first delay 2s (then every 3s), steam3 for both families.
  const s = setup(state.tickingarea, () => .5);
  const steam = () => s.scene.children.map(child => prefabInstance(child)!).filter(inst => /steam_fx/.test(inst?.prefab ?? ''));
  try {
    const spring = s.spawn(new THREE.Vector3(2, 0, 3));
    await s.tick(1.8); expect(steam()).toHaveLength(0);
    await s.tick(.5);
    expect(steam().map(fx => fx.prefab)).toEqual(['slow_steam_fx3']);
    const [fx] = steam();
    expect(fx.position.toArray()).toEqual([2, 0, 3]); expect(fx.persists).toBe(false);
    // fx.lua FinalOffset1: drawn in front of the world entity at the same foot.
    expect(fx.sprite.sprite.peek().depthOffset).toBe(true);

    // The family is chosen when the task fires, from the bath bomb state; the one-shot FX removes itself.
    spring.components.bathbombable.OnBathBombed();
    await s.tick(3);
    expect(fx.isRemoved).toBe(true);
    expect(steam().map(other => other.prefab)).toEqual(['crater_steam_fx3']);

    // OnEntitySleep stops the task; OnEntityWake starts it again with a fresh random delay.
    state.playerpositions.set([new THREE.Vector3(300, 0, 0)]); await settle();
    expect(spring.fxTask.snapshot.peek().status).toBe('stopped');
    await s.tick(10); expect(steam()).toHaveLength(0);
    state.playerpositions.set([new THREE.Vector3()]); await settle();
    expect(spring.fxTask.snapshot.peek().status).toBe('scheduled');
    await s.tick(2.3); expect(steam().map(other => other.prefab)).toEqual(['crater_steam_fx3']);

    spring.remove();
    expect(spring.fxTask.snapshot.peek().status).toBe('stopped');
  } finally { s.dispose(); state.dispose(); }
});

import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { HotspringManager, HOTSPRING_LIGHT } from '../../prefab/src/hotspring.ts';
import { getPrefabLocalLight } from '../../prefab/src/localLight';
import { FindEntities } from '../../prefab/src/actionEntity';
import { GroundItemManager } from '../../../src/groundItems';
import { createInventoryStore } from '../../../src/inventory';
import { cursorSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { WilsonStateGraph } from '../../stategraphs/src/SGwilson';
import type { ActionAnimationController } from '../../stategraphs/src/actionContext';
import { ItemUseActionController, getItemUseActions } from '../../stategraphs/src/itemuse';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { createWorldState } from '../../../src/worldState';
import type { TileStateQuery } from '../../signals/src';
import { GetTileKeyAtPoint } from '../../componets/src/tileManager';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(tickingarea?: TileStateQuery, random?: () => number) {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const inventory = createInventoryStore([]), scene = new THREE.Scene(), player = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(), renderer = { domElement: new EventTarget() } as THREE.WebGLRenderer;
  const ground = new GroundItemManager(scene, camera, renderer, '/dst/data/databundles/images.zip', inventory, '/dst/data/anim', player);
  const physics = new CANNON.World();
  const springs = new HotspringManager(scene, physics, '/dst/data/anim', tickingarea, { random });
  const registry = new EntityRegistry();
  registry.register(PREFAB_DEFINITIONS.hotsprings, {
    restore: (_, record) => springs.spawn(new THREE.Vector3(...record.transform.position), {
      id: record.id, transform: record.transform, components: { hotspring: record.components.hotspring } }),
    debugSpawn: () => springs.spawn(player.position.clone().setY(0)),
    exportRecords: () => springs.exportRecords(),
    update: (dt, quaternion) => springs.update(dt, quaternion),
    renderEntities: () => springs.renderEntities,
    dispose: () => springs.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.groundItems, {
    restore: (_, record) => ground.spawnFromSave(record.id, {
      ...SAVE_CATALOG.items[record.components.stack!.itemId], ...record.components.stack! }, new THREE.Vector3(...record.transform.position)),
    debugSpawn: id => ground.spawnFromSave('dug:command', { ...SAVE_CATALOG.items[id], itemId: id, count: 1 }, player.position),
    exportRecords: () => ground.exportRecords().map(record => ({ prefabId: 'ground_item', record })),
    dispose: () => ground.dispose(),
  });
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  const save = () => serializeSave(template, {
    entities: { hotspring: springs.exportRecords().map(entry => entry.record), ground_item: ground.exportRecords() }, inventory: inventory.exportState(),
    elapsedSeconds: 0, playerTransform: { position: player.position.toArray() as [number, number, number], rotationY: 0 },
  }, SAVE_CATALOG);
  return { inventory, scene, player, springs, physics, registry, save,
    world: { scene, player, camera, renderer, ground: new THREE.Group() },
    dispose: () => { registry.dispose(); inventory.dispose(); } };
}

it('lights and heats a spring only after a cursor-held bath bomb is tossed in, then saves and reloads the state', async () => {
  const s = setup(), restored = setup();
  const graph = new WilsonStateGraph({ playAnimation: () => 1, playSound: () => {}, stopSound: () => {}, setCasting: () => {}, onStateChanged: () => {} });
  const animation = { stategraph: graph, cancelEmote: vi.fn(), setFacing: vi.fn() } as unknown as ActionAnimationController;
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
    const model = s.springs.exportRecords().length === 1 ? s.scene.children.find(child => child.userData.prefab === 'hotspring')! as THREE.Group : undefined;
    const inst = model!.userData.actionEntity, heater = inst.components.heater;
    expect(inst.hasTag('HASHEATER')).toBe(true); expect(inst.hasTag('bathbombable')).toBe(true);
    expect(heater.GetHeat()).toBe(45);
    expect(getPrefabLocalLight(model!)).toBeUndefined();
    expect(model!.userData.animationController.currentAnimation).toBe('idle');

    expect(s.inventory.transfer(inventorySlotAddress(0), cursorSlotAddress(), 2)).toBe(true);
    toss = new ItemUseActionController(s.world, animation, locomotor, source);
    expect(getItemUseActions(model, source()).some(candidate => candidate.action.action === 'BATHBOMB')).toBe(true);
    expect(toss.request('BATHBOMB', inst)).toBe(true);
    toss.update(); graph.update(5 / 30);
    expect(s.inventory.get(cursorSlotAddress())?.count).toBe(2);
    toss.cancel(); graph.update(1);
    expect(heater.GetHeat()).toBe(45); expect(inst.hasTag('bathbombable')).toBe(true);

    expect(toss.request('BATHBOMB', inst)).toBe(true);
    toss.update(); graph.update(6 / 30);
    expect(s.inventory.get(cursorSlotAddress())?.count).toBe(1);
    expect(heater.GetHeat()).toBe(90);
    expect(inst.hasTag('bathbombable')).toBe(false);
    expect(getPrefabLocalLight(model!)).toEqual(HOTSPRING_LIGHT);
    expect(model!.userData.animationController.currentAnimation).toBe('bath_bomb');
    for (let frame = 0; frame < 180; frame++) s.springs.update(1 / 30, s.world.camera.quaternion);
    expect(model!.userData.animationController.currentAnimation).toBe('glow_loop');
    // A bombed spring refuses a second bomb.
    expect(getItemUseActions(model, source()).some(candidate => candidate.action.action === 'BATHBOMB')).toBe(false);

    let json = '';
    const saveResult = await executeDebugCommand('c_save()', s.inventory, undefined, () => { json = s.save(); });
    expect(saveResult).toMatchObject({ ok: true });
    const saved = deserializeSave(json, SAVE_CATALOG), record = saved.world.entities.hotspring[0];
    expect(record.components.hotspring).toEqual({ isbathbombed: true });
    const reloaded = await restored.springs.spawn(new THREE.Vector3(...record.transform.position), record);
    expect(restored.springs.exportRecords().map(entry => entry.record)).toEqual([record]);
    expect(reloaded.userData.actionEntity.components.heater.GetHeat()).toBe(90);
    expect(getPrefabLocalLight(reloaded)).toEqual(HOTSPRING_LIGHT);
    expect(reloaded.userData.animationController.currentAnimation).toBe('glow_loop');

    s.springs.remove(model!);
    expect(FindEntities(s.scene, model!.position, 1, ['HASHEATER'])).toEqual([]);
    expect(getPrefabLocalLight(model!)).toBeUndefined();
  } finally { toss?.dispose(); s.dispose(); restored.dispose(); }
});

it('faces the camera as a background billboard while keeping the saved foot point and physics fixed', async () => {
  const s = setup();
  try {
    const position = new THREE.Vector3(12, 0, -24);
    const model = await s.springs.spawn(position);
    const visual = model.children[0];
    const records = s.springs.exportRecords();
    const physicsPosition = model.userData.physicsBody.position.toArray();
    expect(model.userData.billboard).toBe(true);
    expect(visual.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
    expect(visual.position.toArray()).toEqual([0, 0, 0]);
    for (const heading of [0, Math.PI / 2]) {
      s.world.camera.rotation.set(-.65, heading, 0, 'YXZ');
      const quaternion = s.world.camera.quaternion;
      s.registry.update(0, quaternion);
      model.updateMatrixWorld(true);
      const normal = new THREE.Vector3(0, 0, 1).transformDirection(visual.matrixWorld);
      const cameraNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
      expect(normal.dot(cameraNormal)).toBeCloseTo(1);
      expect(model.position).toEqual(position);
      expect(model.userData.physicsBody.position.toArray()).toEqual(physicsPosition);
      expect(s.springs.exportRecords()).toEqual(records);
    }
    const [entry] = s.registry.renderEntities;
    expect(entry.object).toBe(model);
    expect(entry.footPosition).toBe(model.position);
    expect(entry.renderLayer).toBe(-1);
  } finally { s.dispose(); }
});

it('keeps a spring active when the injected tile query returns undefined', async () => {
  const query = vi.fn<TileStateQuery>(() => undefined);
  const s = setup(query);
  try {
    const position = new THREE.Vector3(5, 0, 6);
    const model = await s.springs.spawn(position);
    const update = vi.spyOn(model.userData.animationController, 'update');
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][0].peek()).toBe(GetTileKeyAtPoint(model.position));
    expect(model.position).toEqual(position);
    expect(model.parent).toBe(s.scene);
    expect(s.physics.bodies).toEqual([model.userData.physicsBody]);
    s.springs.update(.1, s.world.camera.quaternion);
    expect(update).toHaveBeenCalledExactlyOnceWith(.1);
    s.springs.remove(model);
    expect(model.parent).toBeNull();
    expect(s.physics.bodies).toEqual([]);
  } finally { s.dispose(); }
});

it('toggles tile visibility, physics and animation while preserving inactive saves and cleaning up each spring independently', async () => {
  const state = createWorldState({ elapsedSeconds: 0, systems: {} });
  state.playerpositions.set([new THREE.Vector3()]);
  const s = setup(state.tickingarea), restored = setup(state.tickingarea);
  try {
    const first = await s.springs.spawn(new THREE.Vector3(), {
      id: 'tile-spring', transform: { position: [0, 0, 0], rotationY: 0 }, components: { hotspring: { isbathbombed: true } },
    });
    const second = await s.springs.spawn(new THREE.Vector3(1, 0, 1));
    const firstBody = first.userData.physicsBody, secondBody = second.userData.physicsBody;
    const firstAnimation = vi.spyOn(first.userData.animationController, 'update');
    const secondAnimation = vi.spyOn(second.userData.animationController, 'update');
    const addBody = vi.spyOn(s.physics, 'addBody');
    const records = s.springs.exportRecords();
    expect(first.parent).toBe(s.scene); expect(second.parent).toBe(s.scene);
    expect(s.registry.renderEntities.map(entry => entry.object)).toEqual([first, second]);
    expect(s.physics.bodies).toEqual([firstBody, secondBody]);
    s.springs.update(.1, s.world.camera.quaternion);
    expect(firstAnimation).toHaveBeenCalledOnce(); expect(secondAnimation).toHaveBeenCalledOnce();

    state.playerpositions.set([new THREE.Vector3(300, 0, 0)]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(first.parent).toBeNull(); expect(second.parent).toBeNull();
    expect(s.registry.renderEntities).toEqual([]);
    expect(s.physics.bodies).toEqual([]);
    s.springs.update(5, s.world.camera.quaternion);
    expect(firstAnimation).toHaveBeenCalledOnce(); expect(secondAnimation).toHaveBeenCalledOnce();
    expect(s.springs.exportRecords()).toEqual(records);
    expect(first.userData.actionEntity.components.heater.GetHeat()).toBe(90);
    let json = '';
    expect(await executeDebugCommand('c_save()', s.inventory, undefined, () => { json = s.save(); })).toMatchObject({ ok: true });
    const saved = deserializeSave(json, SAVE_CATALOG);
    expect(saved.world.entities.hotspring).toEqual(records.map(entry => entry.record));
    const loaded = await restored.springs.spawn(new THREE.Vector3(...saved.world.entities.hotspring[0].transform.position), saved.world.entities.hotspring[0]);
    expect(loaded.parent).toBeNull(); expect(restored.physics.bodies).toEqual([]);
    expect(restored.springs.exportRecords()[0]).toEqual(records[0]);
    expect(loaded.userData.animationController.currentAnimation).toBe('glow_loop');

    // 移除一个休眠实例，不能停止同 tile 的其他实例，也不能在回到范围时复活。
    s.springs.remove(first);
    state.playerpositions.set([new THREE.Vector3()]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(first.parent).toBeNull(); expect(first.userData.removed).toBe(true);
    expect(second.parent).toBe(s.scene); expect(loaded.parent).toBe(restored.scene);
    expect(s.registry.renderEntities.map(entry => entry.object)).toEqual([second]);
    expect(s.physics.bodies).toEqual([secondBody]);
    expect(addBody).toHaveBeenCalledExactlyOnceWith(secondBody);
    expect(restored.physics.bodies).toEqual([loaded.userData.physicsBody]);
    expect(getPrefabLocalLight(loaded)).toEqual(HOTSPRING_LIGHT);
    s.springs.update(.1, s.world.camera.quaternion);
    expect(secondAnimation).toHaveBeenCalledTimes(2);
    state.playerpositions.set([new THREE.Vector3(1, 0, 1)]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(addBody).toHaveBeenCalledOnce();

    state.playerpositions.set([new THREE.Vector3(300, 0, 0)]);
    s.springs.dispose(); restored.springs.dispose();
    await new Promise(resolve => setTimeout(resolve, 0));
    state.playerpositions.set([new THREE.Vector3()]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(s.physics.bodies).toEqual([]); expect(restored.physics.bodies).toEqual([]);
    expect(second.parent).toBeNull(); expect(loaded.parent).toBeNull();
  } finally { s.dispose(); restored.dispose(); state.dispose(); }
});

it('emits slow steam, switches to crater steam once bombed, stops while asleep and restarts on wake', async () => {
  const state = createWorldState({ elapsedSeconds: 0, systems: {} });
  state.playerpositions.set([new THREE.Vector3()]);
  // random() = .5: first delay 2s (then every 3s), steam3 for both families.
  const s = setup(state.tickingarea, () => .5);
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  // SpriteController clamps each update to 0.1s, so advance in 0.1s frames.
  const tick = async (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 10); i++) { s.springs.update(.1, s.world.camera.quaternion); await settle(); }
  };
  const steam = () => s.scene.children.filter(child => /steam_fx/.test(child.userData.prefab ?? ''));
  try {
    const model = await s.springs.spawn(new THREE.Vector3(2, 0, 3));
    await tick(1.8); expect(steam()).toHaveLength(0);
    await tick(.5);
    expect(steam().map(child => child.userData.prefab)).toEqual(['slow_steam_fx3']);
    const fx = steam()[0];
    expect(fx.position.toArray()).toEqual([2, 0, 3]); expect(fx.userData.persists).toBe(false);
    expect(s.registry.renderEntities.find(entry => entry.object === fx)).toMatchObject({ sortLayer: 2 });
    expect(s.registry.renderEntities.find(entry => entry.object === model)).toMatchObject({ renderLayer: -1 });

    // The family is chosen when the task fires, from the bath bomb state; the one-shot FX removes itself.
    model.userData.hotspring.bathbombable.OnBathBombed();
    await tick(3);
    expect(fx.parent).toBeNull();
    expect(steam().map(child => child.userData.prefab)).toEqual(['crater_steam_fx3']);

    // OnEntitySleep stops the task; OnEntityWake starts it again with a fresh random delay.
    state.playerpositions.set([new THREE.Vector3(300, 0, 0)]); await settle();
    expect(model.userData.hotspring.fx.peek().status).toBe('stopped');
    await tick(10); expect(steam()).toHaveLength(0);
    state.playerpositions.set([new THREE.Vector3()]); await settle();
    expect(model.userData.hotspring.fx.peek().status).toBe('scheduled');
    await tick(2.3); expect(steam().map(child => child.userData.prefab)).toEqual(['crater_steam_fx3']);

    s.springs.remove(model);
    expect(model.userData.hotspring.fx.peek().status).toBe('stopped');
  } finally { s.dispose(); }
});

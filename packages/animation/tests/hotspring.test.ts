import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { HotspringManager, HOTSPRING_LIGHT } from '../../prefab/src/hotspring';
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
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const inventory = createInventoryStore([]), scene = new THREE.Scene(), player = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(), renderer = { domElement: new EventTarget() } as THREE.WebGLRenderer;
  const ground = new GroundItemManager(scene, camera, renderer, '/dst/data/databundles/images.zip', inventory, '/dst/data/anim', player);
  const physics = new CANNON.World();
  const springs = new HotspringManager(scene, physics, '/dst/data/anim');
  const registry = new EntityRegistry();
  registry.register(PREFAB_DEFINITIONS.hotsprings, {
    restore: (_, record) => springs.spawn(new THREE.Vector3(...record.transform.position), {
      id: record.id, transform: record.transform, components: { hotspring: record.components.hotspring } }),
    debugSpawn: () => springs.spawn(player.position.clone().setY(0)),
    exportRecords: () => springs.exportRecords(),
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
    expect(getItemUseActions(s.scene, source()).some(candidate => candidate.action.action === 'BATHBOMB')).toBe(true);
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
    for (let frame = 0; frame < 180; frame++) s.springs.update(1 / 30);
    expect(model!.userData.animationController.currentAnimation).toBe('glow_loop');
    // A bombed spring refuses a second bomb.
    expect(getItemUseActions(s.scene, source()).some(candidate => candidate.action.action === 'BATHBOMB')).toBe(false);

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

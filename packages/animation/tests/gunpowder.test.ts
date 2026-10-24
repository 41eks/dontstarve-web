import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { GroundItemManager } from '../../../src/groundItems';
import { createInventoryStore } from '../../../src/inventory';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { WorldFx } from '../../prefab/src/world_fx';
import { configureTorchEntity } from '../../prefab/src/torch';
import { Explosive, EXPLOSIVE_MAX_WORKABLE_INVENTORYITEMS, type ExplosiveInst, type ExplosiveTarget } from '../../componets/src/explosive';
import { Workable } from '../../componets/src/workable';
import { collectEquippedActions, performLightAction } from '../../stategraphs/src/componentactions';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const inventory = createInventoryStore([]), scene = new THREE.Scene(), player = new THREE.Group();
  const fx = new WorldFx(scene);
  const ground = new GroundItemManager(scene, new THREE.PerspectiveCamera(), { domElement: new EventTarget() } as THREE.WebGLRenderer,
    '/dst/data/databundles/images.zip', inventory, '/dst/data/anim', player,
    undefined, undefined, undefined, undefined, undefined, fx);
  const registry = new EntityRegistry();
  registry.register(PREFAB_DEFINITIONS.groundItems, {
    restore: (_, record) => ground.spawnFromSave(record.id,
      { ...SAVE_CATALOG.items[record.components.stack!.itemId], ...record.components.stack! }, new THREE.Vector3(...record.transform.position)),
    debugSpawn: id => ground.spawnFromSave(`command:${id}`, { ...SAVE_CATALOG.items[id], itemId: id, count: 1 }, player.position),
    exportRecords: () => ground.exportRecords().map(record => ({ prefabId: 'ground_item', record })), dispose: () => ground.dispose(),
  });
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  const save = () => serializeSave(template, { entities: { ground_item: ground.exportRecords() },
    inventory: inventory.exportState(), elapsedSeconds: 0, playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
  const spawn = (id: string, count: number, x: number) => ground.spawnFromSave(`test:${id}:${x}`,
    { ...SAVE_CATALOG.items[id], itemId: id, count }, new THREE.Vector3(x, 0, 0));
  const advance = (seconds: number) => { for (let t = 0; t < seconds; t += 1 / 30) { ground.update(1 / 30, new THREE.Quaternion()); fx.update(1 / 30, new THREE.Quaternion()); } };
  return { inventory, scene, fx, ground, registry, save, spawn, advance, dispose: () => { registry.dispose(); fx.dispose(); inventory.dispose(); } };
}

it('lights gunpowder with a torch, explodes its stack, works nearby stone fruit and ignites burnables', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(.5);
  const s = setup();
  try {
    await s.spawn('gunpowder', 2, 0); await s.spawn('rock_avocado_fruit', 3, 6); await s.spawn('rock_avocado_fruit', 2, 30);
    await s.spawn('log', 1, -4);
    const powder = s.ground.entities.get('test:gunpowder:0')!, near = s.ground.entities.get('test:rock_avocado_fruit:6')!;
    const far = s.ground.entities.get('test:rock_avocado_fruit:30')!, log = s.ground.entities.get('test:log:-4')!;
    const torch = s.inventory.entities.create({ itemId: 'torch', count: 1 }); configureTorchEntity(torch);
    const target = (id: string) => s.scene.children.find(model => model.userData.actionEntity?.components === s.ground.entities.get(id)!.components)!.userData.actionEntity;
    // Only inst with a burnable are LIGHT targets; hard stone fruit is not.
    expect(collectEquippedActions(torch, target(powder.id), true)).toContain('LIGHT');
    expect(collectEquippedActions(torch, target(near.id), true)).not.toContain('LIGHT');
    expect(powder.hasTag('explosive')).toBe(true); expect(powder.hasTag('molebait')).toBe(true);
    expect(performLightAction(torch, target(powder.id), { prefab: 'wilson' } as never)).toBe(true);
    // DefaultBurnFn: a lit fuse is not saved.
    expect(powder.components.burnable!.IsBurning()).toBe(true); expect(powder.persists).toBe(false);
    expect(s.ground.exportRecords().some(record => record.id === powder.id)).toBe(false);
    s.advance(3); expect(powder.isRemoved).toBe(false);
    s.advance(2);
    expect(powder.isRemoved).toBe(true);
    expect(near.isRemoved).toBe(true); expect(far.isRemoved).toBe(false);
    // explosive.lua lightonexplode reached the log inside the range; stone fruit loot is a ripe fruit with the mocked roll.
    expect(log.components.burnable!.IsBurning()).toBe(true);
    const records = s.ground.exportRecords();
    expect(records.filter(record => record.components.stack?.itemId === 'rock_avocado_fruit_ripe')
      .reduce((sum, record) => sum + record.components.stack!.count, 0)).toBe(3);
    expect(records.some(record => record.id === far.id)).toBe(true);
    expect(s.fx.renderEntities).toHaveLength(1);
    s.advance(1.5); expect(s.fx.renderEntities).toHaveLength(0);
  } finally { s.dispose(); }
}, 20000);

it('works at most 20 inventory items, pushes explosion to survivors and throws a surviving stone fruit', async () => {
  const s = setup();
  try {
    const events: [number, string, unknown][] = [];
    let removed = false;
    const burst: ExplosiveInst = { get isRemoved() { return removed; }, hasTag: () => false, addTag() {}, removeTag() {}, getPosition: () => new THREE.Vector3(),
      PushEvent() {}, remove() { removed = true; return true; }, components: { stackable: { count: 1 } } };
    const targets: ExplosiveTarget[] = Array.from({ length: EXPLOSIVE_MAX_WORKABLE_INVENTORYITEMS + 1 }, (_, i) => {
      const target: ExplosiveTarget = { isRemoved: false, hasTag: () => false, addTag() {}, removeTag() {}, getPosition: () => new THREE.Vector3(),
        PushEvent: (name, data) => events.push([i, name, data]), components: { inventoryitem: {}, stackable: { count: 1 } } };
      const workable = new Workable({ ...target, removal: { get: () => false, peek: () => false, subscribe: () => () => {} } } as never);
      workable.SetWorkLeft(100); (target.components as { workable?: Workable }).workable = workable;
      return target;
    });
    const explosive = new Explosive(burst, () => targets);
    explosive.OnBurnt();
    expect(targets.map(target => target.components.workable!.GetWorkLeft())).toEqual([...Array(20).fill(90), 100]);
    expect(events.filter(([, name]) => name === 'explosion')).toHaveLength(21);
    expect(burst.isRemoved).toBe(true);
    explosive.OnBurnt(); // one explosion per inst

    await s.spawn('rock_avocado_fruit', 1, 0);
    const fruit = s.ground.entities.get('test:rock_avocado_fruit:0')!;
    const launched: unknown[] = []; fruit.ListenForEvent('launch', launch => launched.push(launch));
    fruit.PushEvent('explosion', { explosive: { getPosition: () => new THREE.Vector3(3, 0, 0) } });
    expect(launched).toHaveLength(1);
    expect(launched[0]).toMatchObject({ height: .5, speed: { min: -1.8, range: -3.6 } });
    s.advance(.5); expect(fruit.getPosition().x).not.toBe(0);
  } finally { s.dispose(); }
}, 20000);

it('spawns and gives gunpowder through debug commands and keeps the stack through c_save', async () => {
  const s = setup(), restored = setup();
  try {
    expect((await executeDebugCommand('c_give("gunpowder",5);c_spawn("gunpowder")', s.inventory, id => s.registry.spawn(id))).ok).toBe(true);
    expect(s.inventory.count('gunpowder')).toBe(5);
    let json = '';
    expect((await executeDebugCommand('c_save()', s.inventory, undefined, () => { json = s.save(); })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG);
    expect(saved.world.entities.ground_item.map(record => record.components.stack)).toMatchObject([{ itemId: 'gunpowder', count: 1 }]);
    for (const record of saved.world.entities.ground_item) await restored.ground.spawnFromSave(record.id,
      { ...SAVE_CATALOG.items[record.components.stack!.itemId], ...record.components.stack! }, new THREE.Vector3(...record.transform.position));
    expect(restored.ground.exportRecords()).toEqual(s.ground.exportRecords());
  } finally { s.dispose(); restored.dispose(); }
}, 20000);

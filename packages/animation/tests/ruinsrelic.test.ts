import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { prefabDisplay } from '@dontstarve-web/display';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { RuinsRelicManager, type RuinsRelicInstance, type RuinsRelicRecord } from '../../prefab/src/ruinsrelic';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { actionEntity } from '../../prefab/src/actionEntity';
import { reskinEntity } from '../../prefab/src/reskin_tool';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { createInventoryStore } from '../../../src/inventory';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { inventoryStateFromSave } from '../../../src/save/inventoryState';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const record = (components: RuinsRelicRecord['components']): RuinsRelicRecord => ({ id: 'saved-relic',
  transform: { position: [2, 0, -3], rotationY: .4 }, components });
function setup() {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
  const scene = new THREE.Scene(), awake = createSignal(true), scheduler = new GameTimeScheduler();
  const registry = new EntityRegistry(), inventory = createInventoryStore([]);
  const manager = new RuinsRelicManager(scene, { scheduler, tickingarea: () => createMemo(() => awake.get()),
    trackDisplay: display => registry.trackDisplay(display) });
  registry.registerDisplayManager(PREFAB_DEFINITIONS.ruinsRelics, manager, {
    restore: (id, saved) => manager.spawn(id, new THREE.Vector3(...saved.transform.position), saved),
    debugSpawn: id => manager.spawn(id, new THREE.Vector3(12, 0, -6)),
  });
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  return { scene, awake, registry, inventory, manager,
    save: () => serializeSave(template, { entities: registry.exportRecords(), inventory: inventory.exportState(), elapsedSeconds: 0,
      playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG),
    dispose() { registry.dispose(); inventory.dispose(); scheduler.dispose(); } };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('loads source records through construction, OnPreLoad and health.OnLoad, retaining non-looping poses and tags', async () => {
  const s = setup();
  try {
    // A naturally intact chair saved as rubble, and an originally rubble vase saved after repair.
    const chair = s.manager.spawn('ruins_chair', new THREE.Vector3(2, 0, -3),
      record({ ruinsRelic: { rubble: true }, health: { current: 18, maximum: 90 } }));
    const vase = s.manager.spawn('ruins_rubble_vase', new THREE.Vector3(2, 0, -3),
      { ...record({ health: { current: 95, maximum: 95 } }), id: 'repaired-vase' });
    const inst = prefabInstance(chair)!;
    expect(inst.sprite.sprite.peek().clip).toMatchObject({ name: 'idle', loop: false });
    expect(inst.sprite.sprite.peek().queue).toEqual([{ name: 'idle', loop: false }, { name: 'broken', loop: false }]);
    expect(inst.components.health!.OnSave()).toMatchObject({ health: 18, maxhealth: 90 });
    for (const tag of ['cavedweller', 'smashable', 'object', 'stone', 'noauradamage', 'electricdamageimmune',
      'inspectable', 'repairable_stone', 'healthrepairable']) expect(inst.hasTag(tag)).toBe(true);
    expect(inst.hasTag('cansit')).toBe(false);
    expect(prefabInstance(vase)!.sprite.sprite.peek().clip).toMatchObject({ name: 'broken', loop: false });
    expect(prefabInstance(vase)!.sprite.sprite.peek().queue).toEqual([{ name: 'broken', loop: false }, { name: 'idle', loop: false }]);
    await Promise.all([chair, vase].map(model => prefabDisplay(model)!.artLoaded()));
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/dst/data/anim/ruins_chair.zip'));
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/dst/data/anim/ruins_vase.zip'));
    (inst as RuinsRelicInstance).onHit();
    expect(inst.sprite.sprite.peek().clip).toMatchObject({ name: 'repair', loop: false });
    expect(inst.sprite.sprite.peek().queue).toEqual([{ name: 'broken', loop: false }]);
    // The complete reimported default cave also passes the shared save catalog.
    const cave = JSON.parse(await readFile(new URL('../../../public/saves/Cluster_1/Caves.json', import.meta.url), 'utf8'));
    cave.players = { local: { ...initialWorld.players.local, shardId: cave.world.shardId } };
    expect(deserializeSave(JSON.stringify(cave), SAVE_CATALOG).world.entities.ruins_rubble_chair).toHaveLength(44);
  } finally { s.dispose(); }
});

it('rebuilds a sleeping chair with its declared clip and skin using the shared display resources', async () => {
  const s = setup();
  try {
    const model = s.manager.spawn('ruinsrelic_chair', new THREE.Vector3(2, 0, -3),
      record({ ruinsRelic: { skinId: 'ruinsrelic_chair_tesla' } }));
    const inst = prefabInstance(model)!;
    await prefabDisplay(model)!.artLoaded();
    const saved = s.manager.exportRecords(), clip = inst.sprite.sprite.peek().clip;
    s.awake.set(false); await settle();
    expect(inst.sprite.loaded).toBe(false); expect(model.parent).toBeNull();
    s.awake.set(true); await settle(); await prefabDisplay(model)!.artLoaded();
    expect(model.parent).toBe(s.scene); expect(inst.sprite.loaded).toBe(true);
    expect(inst.sprite.sprite.peek().clip).toEqual(clip);
    expect(inst.skinId).toBe('ruinsrelic_chair_tesla');
    expect(s.manager.exportRecords()).toEqual(saved);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/dst/data/anim/dynamic/ruinsrelic_chair_tesla.zip'));
  } finally { s.dispose(); }
});

it('c_spawn / c_give then c_save exports and reloads identity, transform, health, rubble, item count and chair skin', async () => {
  const first = setup(); let json = '', entities: ReturnType<typeof first.registry.exportRecords>;
  try {
    const command = 'c_spawn("ruins_chair");c_spawn("ruinsrelic_chair");c_spawn("ruinsrelic_bowl");c_give("ruinsrelic_plate",2)';
    expect((await executeDebugCommand(command, first.inventory, id => first.registry.spawn(id))).ok).toBe(true);
    const [natural, replica, bowl] = first.scene.children;
    prefabInstance(natural)!.components.health!.DoDelta(-50);
    expect(reskinEntity(actionEntity(replica, 'ruinsrelic_chair').reskinTarget!)).toBe(true);
    // A source moisture payload survives while the component intentionally has constructor-only support.
    (prefabInstance(bowl) as RuinsRelicInstance).saveRecord = record({ inventoryitemmoisture: { moisture: 37, wet: true } });
    entities = first.registry.exportRecords();
    expect((await executeDebugCommand('c_give("ruins_chair")', first.inventory)).ok).toBe(false);
    expect((await executeDebugCommand('c_save()', first.inventory, undefined, () => { json = first.save(); })).ok).toBe(true);
  } finally { first.dispose(); }
  const saved = deserializeSave(json, SAVE_CATALOG), second = setup();
  try {
    await second.registry.restoreAll(saved.world.entities);
    second.inventory.replaceState(inventoryStateFromSave(saved), SAVE_CATALOG.recipes);
    expect(second.registry.exportRecords()).toEqual(entities!);
    expect(second.inventory.exportState().slots.filter(slot => slot.item)).toEqual(inventoryStateFromSave(saved).slots);
    expect(second.inventory.exportState().slots.filter(slot => slot.item?.itemId === 'ruinsrelic_plate')).toHaveLength(2);
    expect(second.registry.exportRecords().ruins_chair[0].components.ruinsRelic).toEqual({ rubble: true });
    await Promise.all(second.scene.children.map(model => prefabDisplay(model)!.artLoaded()));
    for (let frame = 0; frame < 120; frame++) second.registry.update(1 / 30, new THREE.Quaternion());
    for (const model of second.scene.children) {
      const inst = prefabInstance(model)!;
      expect(inst.position.toArray()).toEqual([12, 0, -6]);
      expect(inst.sprite.sprite.peek().clip.loop).toBe(false);
      expect(inst.sprite.currentAnimation).toBe(inst.prefab === 'ruins_chair' ? 'broken' : 'idle');
    }
  } finally { second.dispose(); }
});

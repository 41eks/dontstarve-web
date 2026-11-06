import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import { createMemo, createSignal } from '../../signals/src';
import { grottoPoolPrefabs, GROTTO_POOL_MIST_ID, type GrottoGlassInstance, type GrottoPoolInstance } from '../../prefab/src/grotto_pool';
import { PrefabEntityManager, prefabInstance, type PrefabInstance } from '../../prefab/src/prefabInstance';
import { GroundItemManager } from '../../prefab/src/groundItemManager';
import { createInventoryStore } from '../../../src/inventory';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { createClusterSaveZip } from '../../../src/save/download';
import { importedSave } from './importedSave';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { workTargets } from './workTargets';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop: vi.fn(), isPlaying: () => true, setVolume: vi.fn() })) }));
beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const turn = () => new Promise(resolve => setTimeout(resolve, 0));

function setup() {
  const inventory = createInventoryStore([]), scene = new THREE.Scene(), player = new THREE.Group(), physics = new CANNON.World();
  player.position.set(12, 0, -6);
  const scheduler = new GameTimeScheduler(), awake = createSignal(true), fx = { spawn: vi.fn() };
  const waterfalls = new Map<THREE.Vector3, { radius: number; large: boolean }>();
  const ground = new GroundItemManager(scene, new THREE.PerspectiveCamera(), { domElement: new EventTarget() } as THREE.WebGLRenderer,
    '/dst/data/databundles/images.zip', inventory, '/dst/data/anim', player);
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { tickingarea: () => createMemo(() => awake.get()), physics });
  prefabs.register(grottoPoolPrefabs({ scheduler, fx,
    registerWaterfallPool: (position, radius, large) => {
      waterfalls.set(position, { radius, large });
      return () => { waterfalls.delete(position); };
    },
    spawnGroundItem: (definition, position, options) => ground.spawnGroundItem(definition, position, options),
    spawnPrefab: (id, position) => prefabs.spawn(id, position),
    getEntity: id => prefabs.get(id) }));
  const registry = new EntityRegistry([], prefabs, () => player.position);
  registry.registerPrefabs(PREFAB_DEFINITIONS.grottoPools);
  registry.register(PREFAB_DEFINITIONS.groundItems, {
    restore: () => { throw new Error('unused'); },
    debugSpawn: id => ground.spawnFromSave(`command:${id}`, { ...SAVE_CATALOG.items[id], itemId: id, count: 1 }, player.position),
    exportRecords: () => ground.exportRecords().map(record => ({ prefabId: 'ground_item', record })), dispose: () => ground.dispose(),
  });
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  const save = () => serializeSave(template, { entities: registry.exportRecords(), inventory: inventory.exportState(), elapsedSeconds: 0,
    playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
  const all = () => scene.children.map(model => prefabInstance<PrefabInstance>(model)!).filter(Boolean);
  return { inventory, scene, physics, ground, prefabs, registry, scheduler, awake, fx, save, waterfalls, all,
    ids: () => prefabs.exportRecords().map(({ prefabId }) => prefabId).sort(),
    find: <T extends PrefabInstance = PrefabInstance>(id: string) => all().find(inst => inst.prefab === id) as T,
    dispose: () => { registry.dispose(); prefabs.dispose(); displays.dispose(); inventory.dispose(); scheduler.dispose(); } };
}

it('a small pool sets up its mist, waterfall and sound on its first frame; mining and removal follow the source', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(.7);
  const s = setup();
  try {
    expect((await executeDebugCommand('c_spawn("grotto_pool_small")', s.inventory, id => s.registry.spawn(id))).ok).toBe(true);
    const pool = s.find<GrottoPoolInstance>('grotto_pool_small');
    expect(pool.listTags().filter(tag => tag !== 'tickingarea')).toEqual(['blocker', 'antlion_sinkhole_blocker', 'birdblocker', 'watersource', 'inspectable']);
    expect(pool.minimap.icon).toBe('grotto_pool_small.png');
    expect(s.ids()).toEqual(['grotto_pool_small']);
    // DoTaskInTime(0, ...): the mist, register_pool and setup_children.
    s.scheduler.advance(.01);
    expect(s.ids()).toEqual(['grotto_pool_small', 'grotto_waterfall_small2']);
    const mist = s.find(GROTTO_POOL_MIST_ID), fall = s.find<GrottoGlassInstance>('grotto_waterfall_small2');
    expect(mist.listTags().filter(tag => tag !== 'tickingarea')).toEqual(['FX', 'NOCLICK']);
    expect(mist.sprite.sprite.peek().clip).toMatchObject({ name: 'steam_small2', loop: true });
    expect([...s.waterfalls.values()]).toEqual([{ radius: 2, large: false }]);
    expect(pool._children).toEqual([fall]);

    // The pool is OnGround art; the props are billboards.
    expect(pool.sprite.sprite.peek()).toMatchObject({ ground: { renderOrder: 0, flat: true }, meshOrder: -.5 });
    expect(fall.sprite.sprite.peek().billboard).toBe(true);
    await prefabDisplay(pool.transform.model)!.artLoaded();

    // on_mined: moonglass_prop loot at the worker, then the mined loop and NOCLICK until a cave full moon.
    const [target] = workTargets('MINE');
    expect(target.entity.prefab).toBe('grotto_waterfall_small2');
    const pickaxe = s.inventory.entities.create({ itemId: 'pickaxe', count: 1 });
    for (let i = 0; i < 6; i++) expect(target.work({}, pickaxe)).toBe(true);
    expect(fall.sprite.sprite.peek().clip).toMatchObject({ name: 'water_small2_mined', loop: true });
    expect(fall.hasTag('NOCLICK')).toBe(true);
    expect(fall.physicsRadiusOverride).toBeUndefined();
    await vi.waitFor(() => expect(s.ground.exportRecords().map(record => record.components.stack?.itemId)).toEqual(['moonglass', 'moonglass']));
    expect(workTargets('MINE')).toHaveLength(0);
    expect(s.prefabs.exportRecords().find(({ prefabId }) => prefabId === 'grotto_waterfall_small2')!.record.components)
      .toEqual({ grottoGlass: { workleft: 0 } });

    // on_removed: the waterfall and mist go with the pool, and so do its sound source and body.
    pool.remove();
    expect([fall.isRemoved, mist.isRemoved]).toEqual([true, true]);
    expect(s.waterfalls.size).toBe(0);
    expect(s.prefabs.exportRecords()).toEqual([]);
    expect(s.physics.bodies).toHaveLength(0);
  } finally { s.dispose(); }
}, 30000);

it('c_save and reload link a big pool to its saved children by ID instead of spawning new ones', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(.25);
  const first = setup(); let zip!: Uint8Array, records!: ReturnType<EntityRegistry['exportRecords']>;
  try {
    expect((await executeDebugCommand('c_spawn("grotto_pool_big")', first.inventory, id => first.registry.spawn(id))).ok).toBe(true);
    first.scheduler.advance(.01);
    const pool = first.find<GrottoPoolInstance>('grotto_pool_big');
    expect(pool._children.map(child => child!.prefab)).toEqual(['grotto_waterfall_big', 'grotto_moonglass_1', 'grotto_moonglass_3', 'grotto_moonglass_4', 'grotto_moonglass_4']);
    const [x, , z] = pool._children[1]!.position.toArray();
    expect([x, z]).toEqual([12 + 1.15 * 3, -6 - 2.77 * 3]);
    expect([...first.waterfalls.values()]).toEqual([{ radius: 5.5, large: true }]);
    const glass = pool._children[1] as GrottoGlassInstance;
    for (let i = 0; i < 6; i++) glass.components.workable!.WorkedBy({});
    // A removed child leaves its slot.
    pool._children[4]!.remove();
    expect(pool._children[4]).toBeUndefined();
    records = first.registry.exportRecords();
    expect(records.grotto_pool_big[0].components.grottoPool!.children.map(({ index }) => index)).toEqual([1, 2, 3, 4]);
    expect(records.grotto_moonglass_1[0].components).toEqual({ grottoGlass: { workleft: 0 } });
    expect(records[GROTTO_POOL_MIST_ID]).toBeUndefined();
    expect((await executeDebugCommand('c_save()', first.inventory, undefined, async () => {
      zip = await createClusterSaveZip(first.save(), 'forest');
    })).ok).toBe(true);
  } finally { first.dispose(); }
  const files = unzipSync(zip), text = strFromU8(files['Cluster_1/Master.json']);
  const exported = JSON.parse(text) as { session: { playerFile: string } };
  const { player } = JSON.parse(strFromU8(files[`Cluster_1/${exported.session.playerFile}`])) as { player: unknown };
  const saved = deserializeSave(text, SAVE_CATALOG, player), second = setup();
  try {
    expect(saved.world.entities.grotto_pool_big).toEqual(records.grotto_pool_big);
    await second.registry.restoreAll(Object.fromEntries(Object.entries(saved.world.entities).filter(([id]) => id.startsWith('grotto_'))));
    second.scheduler.advance(.01);
    const pool = second.find<GrottoPoolInstance>('grotto_pool_big');
    expect(pool._children.slice(0, 4).map(child => child!.entityId)).toEqual(records.grotto_pool_big[0].components.grottoPool!.children.map(({ id }) => id));
    // setup_children fills the empty slot only.
    expect(pool._children[4]!.prefab).toBe('grotto_moonglass_4');
    expect(second.ids().filter(id => id === 'grotto_moonglass_4')).toHaveLength(2);
    const glass = pool._children[1] as GrottoGlassInstance;
    expect(glass.sprite.sprite.peek().clip).toMatchObject({ name: 'moonglass_1_mined', loop: true });
    expect(glass.hasTag('NOCLICK')).toBe(true);
  } finally { second.dispose(); }
}, 30000);

it('accepts the imported Caves save with every grotto prop linked to an imported pool', async () => {
  const { entities } = importedSave('Caves').world;
  const all = new Map(Object.values(entities).flat().map(record => [record.id, record]));
  expect([entities.grotto_pool_big.length, entities.grotto_pool_small.length]).toEqual([5, 21]);
  for (const pool of [...entities.grotto_pool_big, ...entities.grotto_pool_small]) {
    for (const { id } of pool.components.grottoPool!.children) expect(all.has(id)).toBe(true);
  }
});

it('gives and spawns the moonglass that the props drop', async () => {
  const s = setup();
  try {
    expect((await executeDebugCommand('c_give("moonglass", 3)', s.inventory, id => s.registry.spawn(id))).ok).toBe(true);
    expect(JSON.stringify(s.inventory.exportState())).toContain('"itemId":"moonglass","count":3');
    expect((await executeDebugCommand('c_spawn("moonglass")', s.inventory, id => s.registry.spawn(id))).ok).toBe(true);
    await vi.waitFor(() => expect(s.ground.exportRecords().map(record => record.components.stack?.itemId)).toEqual(['moonglass']));
  } finally { s.dispose(); }
}, 30000);

it('a pool outside the tickingarea sleeps while its mist, which cannot sleep, stays awake', async () => {
  const s = setup();
  try {
    const pool = s.prefabs.spawn('grotto_pool_big', new THREE.Vector3(2, 0, 3));
    s.scheduler.advance(.01);
    const mist = s.find(GROTTO_POOL_MIST_ID);
    s.awake.set(false); await turn();
    expect(pool.status.peek()).toBe('asleep');
    expect(mist.status.peek()).toBe('active');
    s.awake.set(true); await turn();
    expect(pool.status.peek()).toBe('active');
  } finally { s.dispose(); }
});

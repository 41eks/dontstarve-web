import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { GrottoPoolManager } from '../../prefab/src/grotto_pool';
import { WorldFx } from '../../prefab/src/world_fx';
import { GroundItemManager } from '../../../src/groundItems';
import { createInventoryStore } from '../../../src/inventory';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };

const sound = vi.hoisted(() => ({ volumes: [] as number[], stops: 0 }));
vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop: () => { sound.stops++; }, isPlaying: () => true, setVolume: (volume: number) => { sound.volumes.push(volume); } })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(playerAt = new THREE.Vector3()) {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const inventory = createInventoryStore([]), scene = new THREE.Scene(), player = new THREE.Group(), physics = new CANNON.World();
  player.position.copy(playerAt);
  const scheduler = new GameTimeScheduler(), fx = new WorldFx(scene);
  const ground = new GroundItemManager(scene, new THREE.PerspectiveCamera(), { domElement: new EventTarget() } as THREE.WebGLRenderer,
    '/dst/data/databundles/images.zip', inventory, '/dst/data/anim', player);
  const pools = new GrottoPoolManager(scene, { physics, scheduler, fx, playerPosition: () => player.position,
    prepareSpawn: (definition, fling) => ground.prepareSpawn(definition, fling) });
  const registry = new EntityRegistry();
  registry.register(PREFAB_DEFINITIONS.grottoPools, {
    restore: (id, record) => pools.spawn(id, new THREE.Vector3(...record.transform.position),
      { id: record.id, transform: record.transform, components: record.components }),
    debugSpawn: id => pools.spawn(id, player.position),
    exportRecords: () => pools.exportRecords(), dispose: () => pools.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.groundItems, {
    restore: () => { throw new Error('unused'); },
    debugSpawn: id => ground.spawnFromSave(`command:${id}`, { ...SAVE_CATALOG.items[id], itemId: id, count: 1 }, player.position),
    exportRecords: () => ground.exportRecords().map(record => ({ prefabId: 'ground_item', record })), dispose: () => { ground.dispose(); fx.dispose(); },
  });
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  const save = () => serializeSave(template, { entities: {
    ...Object.fromEntries(PREFAB_DEFINITIONS.grottoPools.prefabIds.map(id => [id, pools.exportRecords().filter(entry => entry.prefabId === id).map(entry => entry.record)])),
    ground_item: ground.exportRecords() },
  inventory: inventory.exportState(), elapsedSeconds: 0, playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
  return { inventory, scene, physics, ground, pools, registry, scheduler, save, player, template,
    dispose: () => { registry.dispose(); inventory.dispose(); scheduler.dispose(); } };
}
const prefabs = (s: ReturnType<typeof setup>) => s.pools.exportRecords().map(({ prefabId }) => prefabId).sort();

it('shares pool, mist and waterfall frames while mining and removing pools independently', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(.25);
  const s = setup(), disposed = vi.fn();
  const mesh = (model: THREE.Object3D) => model.children[0].children[0] as THREE.Mesh;
  try {
    const first = await s.pools.spawn('grotto_pool_small', new THREE.Vector3());
    const second = await s.pools.spawn('grotto_pool_small', new THREE.Vector3(10, 0, 0));
    const mist = (pool: THREE.Group) => pool.children.find(model => model.name.endsWith('_mist'))!;
    expect(mesh(first).geometry).toBe(mesh(second).geometry);
    expect(mesh(mist(first)).geometry).toBe(mesh(mist(second)).geometry);
    s.scheduler.advance(.01);
    await vi.waitFor(() => expect(s.pools.mineTargets).toHaveLength(2));
    const [firstFall, secondFall] = s.pools.mineTargets;
    expect(mesh(firstFall.model).geometry).toBe(mesh(secondFall.model).geometry);
    s.pools.update(.1, new THREE.Quaternion());
    expect(mesh(first).geometry).toBe(mesh(second).geometry);
    expect(mesh(mist(first)).geometry).toBe(mesh(mist(second)).geometry);
    expect(mesh(firstFall.model).geometry).toBe(mesh(secondFall.model).geometry);

    const whole = mesh(secondFall.model).geometry;
    const positions = [...whole.getAttribute('position').array];
    const pickaxe = s.inventory.entities.create({ itemId: 'pickaxe', count: 1 });
    for (let i = 0; i < 6; i++) expect(performToolWork('MINE', firstFall.entity, {}, pickaxe)).toBe(true);
    expect(mesh(firstFall.model).geometry).not.toBe(whole);
    expect(mesh(secondFall.model).geometry).toBe(whole);
    expect([...whole.getAttribute('position').array]).toEqual(positions);
    for (let i = 0; i < 6; i++) expect(performToolWork('MINE', secondFall.entity, {}, pickaxe)).toBe(true);
    expect(mesh(firstFall.model).geometry).toBe(mesh(secondFall.model).geometry);

    const shared = [mesh(second).geometry, mesh(mist(second)).geometry, mesh(secondFall.model).geometry];
    for (const geometry of shared) geometry.addEventListener('dispose', disposed);
    first.userData.remove();
    expect(disposed).not.toHaveBeenCalled();
    expect(s.pools.exportRecords().map(({ prefabId }) => prefabId).sort())
      .toEqual(['grotto_pool_small', 'grotto_waterfall_small1']);
    s.pools.update(.1, new THREE.Quaternion());
    expect(mesh(second).geometry.drawRange.count).toBeGreaterThan(0);
    expect(mesh(mist(second)).geometry.drawRange.count).toBeGreaterThan(0);
    expect(disposed).not.toHaveBeenCalled();
  } finally { s.dispose(); }
  expect(disposed).toHaveBeenCalledTimes(3);
}, 30000);

it('spawns the big pool with its five children, mines a glass for moonglass and keeps all of it through save/load', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(.5);
  const s = setup(), restored = setup();
  try {
    expect((await executeDebugCommand('c_spawn("grotto_pool_big")', s.inventory, id => s.registry.spawn(id))).ok).toBe(true);
    expect(s.pools.miniMapEntities.map(({ icon }) => icon)).toEqual(['grotto_pool_big.png']);
    expect(s.physics.bodies).toHaveLength(1);
    // setup_children runs at the next scheduler tick, after restored entities exist.
    s.scheduler.advance(0.01);
    await vi.waitFor(() => expect(prefabs(s)).toEqual(['grotto_moonglass_1', 'grotto_moonglass_3', 'grotto_moonglass_4', 'grotto_moonglass_4',
      'grotto_pool_big', 'grotto_waterfall_big']));
    const [pool] = s.pools.exportRecords();
    expect(pool.record.components.grottoPool!.children.map(({ index }) => index)).toEqual([1, 2, 3, 4, 5]);
    // The waterfall is NOCLICK scenery; only the four glasses can be mined.
    expect(s.pools.mineTargets).toHaveLength(4);

    const pickaxe = s.inventory.entities.create({ itemId: 'pickaxe', count: 1 });
    const [mine] = s.pools.mineTargets;
    for (let i = 0; i < 5; i++) expect(performToolWork('MINE', mine.entity, {}, pickaxe)).toBe(true);
    expect(mine.model.userData.physicsRadius).toBeDefined();
    expect(performToolWork('MINE', mine.entity, {}, pickaxe)).toBe(true);
    expect(s.pools.mineTargets).toHaveLength(3);
    expect(mine.entity.hasTag('NOCLICK')).toBe(true);
    expect(mine.model.userData.physicsRadius).toBeUndefined();
    // moonglass_prop: two sure pieces and the 50% one (random = .5 hits).
    await vi.waitFor(() => expect(s.ground.exportRecords().map(record => record.components.stack?.itemId)).toEqual(['moonglass', 'moonglass', 'moonglass']));

    let json = '';
    expect((await executeDebugCommand('c_save()', s.inventory, undefined, () => { json = s.save(); })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG).world.entities;
    for (const [prefabId, records] of Object.entries(saved)) {
      if (!(PREFAB_DEFINITIONS.grottoPools.prefabIds as readonly string[]).includes(prefabId)) continue;
      for (const record of records) await restored.pools.spawn(prefabId as 'grotto_pool_big', new THREE.Vector3(...record.transform.position),
        { id: record.id, transform: record.transform, components: record.components });
    }
    // The saved children are linked, not spawned again.
    restored.scheduler.advance(0.01);
    await new Promise(resolve => setTimeout(resolve, 50));
    const byId = (m: typeof s.pools) => m.exportRecords().sort((a, b) => a.record.id.localeCompare(b.record.id));
    expect(byId(restored.pools)).toEqual(byId(s.pools));
    expect(restored.pools.mineTargets).toHaveLength(3);
    expect(restored.pools.exportRecords().find(({ record }) => record.id === String(mine.id))!.record.components.grottoGlass).toEqual({ workleft: 0 });
  } finally { s.dispose(); restored.dispose(); }
}, 30000);

it('spawns the small pool with one small waterfall and plays the waterfall loop only near a pool', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(.7);
  const s = setup();
  try {
    expect(await s.registry.spawn('grotto_pool_small')).toBe(true);
    s.scheduler.advance(0.01);
    await vi.waitFor(() => expect(prefabs(s)).toEqual(['grotto_pool_small', 'grotto_waterfall_small2']));
    expect(s.pools.mineTargets).toHaveLength(1);
    s.pools.update(0.2, new THREE.Quaternion());
    expect(sound.volumes.at(-1)).toBe(0.8);
    // Walking away stops the emitter once the pool is beyond 40 DST units.
    s.player.position.set(1000, 0, 0);
    const before = sound.stops;
    s.pools.update(0.2, new THREE.Quaternion());
    expect(sound.stops).toBe(before + 1);
    // Removing the pool removes its waterfall.
    const pool = s.scene.children.find(model => model.userData.prefab === 'grotto_pool_small')!;
    pool.userData.remove();
    expect(s.pools.exportRecords()).toEqual([]);
    expect(s.physics.bodies).toHaveLength(0);
  } finally { s.dispose(); }
}, 30000);

it('accepts the imported Caves save with every grotto prop linked to an imported pool', async () => {
  const caves = await readFile(new URL('../../../public/saves/Cluster_1/Caves.json', import.meta.url), 'utf8');
  const { entities } = deserializeSave(caves, SAVE_CATALOG).world;
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

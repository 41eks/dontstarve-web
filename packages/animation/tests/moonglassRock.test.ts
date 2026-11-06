import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { MOONGLASS_ROCK_ID, moonglassRockPrefabs, type MoonglassRockInstance } from '../../prefab/src/rocks';
import { PrefabEntityManager, prefabInstance, type PrefabInstance } from '../../prefab/src/prefabInstance';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { createInventoryStore } from '../../../src/inventory';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { createClusterSaveZip } from '../../../src/save/download';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { CLUSTER_SAVE_ZIP_TIMEOUT } from './importedSave';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));

const turn = () => new Promise(resolve => setTimeout(resolve, 0));
const requested = () => vi.mocked(fetch).mock.calls.map(([url]) => String(url).split('/').pop());

function setup() {
  const scene = new THREE.Scene(), awake = createSignal(true), scheduler = new GameTimeScheduler();
  const tickingarea = () => createMemo(() => awake.get());
  const displays = new PrefabDisplayGroup(scene), spawnGroundItem = vi.fn(() => undefined);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { tickingarea });
  prefabs.register(moonglassRockPrefabs({ scheduler, spawnGroundItem }) as never);
  const registry = new EntityRegistry([], prefabs, () => new THREE.Vector3(12, 0, -6)), inventory = createInventoryStore([]);
  registry.registerPrefabs(PREFAB_DEFINITIONS.moonglassRocks);
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  return { scene, awake, prefabs, registry, inventory, spawnGroundItem,
    spawn: (position: THREE.Vector3, rockType?: number) => prefabs.spawn(MOONGLASS_ROCK_ID, position,
      rockType === undefined ? undefined : { id: 'saved-rock', components: { rock_type: rockType as 1 } }) as MoonglassRockInstance,
    save: () => serializeSave(template, { entities: registry.exportRecords(), inventory: inventory.exportState(), elapsedSeconds: 0,
      playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG),
    dispose() { registry.dispose(); prefabs.dispose(); displays.dispose(); inventory.dispose(); scheduler.dispose(); } };
}

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('restores a saved rock with its Lua clip, tags, type and bank, without rerolling the constructor type', async () => {
  const s = setup();
  // math.random(4) rolls type 4, then OnLoad replaces it before any art is requested.
  vi.spyOn(Math, 'random').mockReturnValue(.99);
  try {
    const rock = s.spawn(new THREE.Vector3(3, 0, 6), 2);
    expect(rock.sprite.sprite.peek().clip).toMatchObject({ name: 'full', loop: false });
    expect(rock.sprite.sprite.peek().queue).toEqual([]);
    expect(rock.rock_type).toBe(2);
    for (const tag of ['boulder', 'moonglass', 'SnowCovered', 'inspectable', 'MINE_workable']) expect(rock.hasTag(tag)).toBe(true);
    await prefabDisplay(rock.transform.model)!.artLoaded();
    expect(requested()).toContain('moonglass_rock2.zip');
    expect(requested()).not.toContain('moonglass_rock4.zip');
    expect(rock.sprite.currentAnimation).toBe('full');
  } finally { s.dispose(); }
});

it('mines through the source poses and drops the moon glass table', async () => {
  const s = setup();
  vi.spyOn(Math, 'random').mockReturnValue(.5);
  try {
    const rock = s.spawn(new THREE.Vector3(3, 0, 6), 1), workable = rock.components.workable!;
    const worker = {}, clip = () => rock.sprite.sprite.peek().clip.name;
    workable.WorkedBy(worker, 2); expect(clip()).toBe('full'); // 4 left is not below ROCKS_MINE * 2 / 3.
    workable.WorkedBy(worker, 1); expect(clip()).toBe('med');
    workable.WorkedBy(worker, 2); expect(clip()).toBe('low');
    workable.WorkedBy(worker, 1);
    expect(rock.isRemoved).toBe(true);
    // Two certain pieces; the .25 third misses at random .5.
    expect((s.spawnGroundItem.mock.calls as unknown as [{ itemId: string }][]).map(([item]) => item.itemId)).toEqual(['moonglass', 'moonglass']);
    expect(s.registry.exportRecords().moonglass_rock ?? []).toEqual([]);
  } finally { s.dispose(); }
});

it('sleeping releases the sprite and waking rebuilds the declared clip in the same bank', async () => {
  const s = setup();
  try {
    const rock = s.spawn(new THREE.Vector3(3, 0, 6), 3), display = prefabDisplay(rock.transform.model)!;
    await display.artLoaded();
    rock.sprite.playOnce('med');
    s.awake.set(false); await turn();
    expect(rock.status.peek()).toBe('asleep');
    expect(rock.sprite.loaded).toBe(false);
    s.awake.set(true); await turn();
    await display.artLoaded();
    expect(rock.sprite.loaded).toBe(true);
    expect(rock.sprite.sprite.peek().clip.name).toBe('med');
    expect(rock.sprite.currentAnimation).toBe('med');
    expect(requested()).toEqual([...new Set(requested())]); // The shared archive cache is reused across the wake.
    expect(rock.rock_type).toBe(3);
  } finally { s.dispose(); }
});

it('c_spawn, c_save and reload keep the id, position, rock_type and restored clip', async () => {
  const first = setup(); vi.spyOn(Math, 'random').mockReturnValue(.3); // math.random(4) = 2.
  let zip!: Uint8Array, records!: ReturnType<EntityRegistry['exportRecords']>;
  try {
    expect((await executeDebugCommand('c_spawn("moonglass_rock")', first.inventory, id => first.registry.spawn(id))).ok).toBe(true);
    expect((await executeDebugCommand('c_give("moonglass_rock")', first.inventory)).ok).toBe(false);
    records = first.registry.exportRecords();
    expect(records.moonglass_rock[0].components).toEqual({ rock_type: 2 });
    expect((await executeDebugCommand('c_save()', first.inventory, undefined, async () => {
      zip = await createClusterSaveZip(first.save(), 'forest');
    })).ok).toBe(true);
  } finally { first.dispose(); }
  const files = unzipSync(zip), text = strFromU8(files['Cluster_1/Master.json']);
  const exported = JSON.parse(text) as { session: { playerFile: string } };
  const { player } = JSON.parse(strFromU8(files[`Cluster_1/${exported.session.playerFile}`])) as { player: unknown };
  const saved = deserializeSave(text, SAVE_CATALOG, player), second = setup();
  vi.mocked(Math.random).mockReturnValue(.99); // The reload's constructor rolls type 4; OnLoad restores 2.
  try {
    expect(saved.world.entities).toEqual(records);
    await second.registry.restoreAll(saved.world.entities);
    const [model] = second.scene.children, rock = prefabInstance<MoonglassRockInstance>(model)!;
    expect(rock.entityId).toBe(records.moonglass_rock[0].id);
    expect(rock.position.toArray()).toEqual([12, 0, -6]);
    expect(rock.rock_type).toBe(2);
    expect(rock.sprite.sprite.peek().clip).toMatchObject({ name: 'full', loop: false });
    await prefabDisplay(model)!.artLoaded();
    expect(rock.sprite.currentAnimation).toBe('full');
    expect(second.registry.exportRecords()).toEqual(records);
  } finally { second.dispose(); }
}, CLUSTER_SAVE_ZIP_TIMEOUT);

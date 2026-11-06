import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { afterEach, expect, it, vi } from 'vitest';
import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { StalagmiteInstance, stalagmitePrefabs, type StalagmiteId } from '../../prefab/src/stalagmite';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { prefabManager } from './prefabManagerFixture';
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

const turn = () => new Promise(resolve => setTimeout(resolve, 0));
const record = { id: 'saved-stalagmite', transform: { position: [2, 0, -3] as [number, number, number], rotationY: .4 }, components: {} };
function setup() {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
  const scene = new THREE.Scene(), awake = createSignal(true), scheduler = new GameTimeScheduler();
  const world = { scheduler, tickingarea: () => createMemo(() => awake.get()), spawnLoot: () => undefined };
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = prefabManager(displays, '/dst/data/anim', world, stalagmitePrefabs);
  const registry = new EntityRegistry([], prefabs as never, () => new THREE.Vector3(12, 0, -6)), inventory = createInventoryStore([]);
  registry.registerPrefabs(PREFAB_DEFINITIONS.stalagmites);
  const manager = {
    spawn: (id: StalagmiteId, position: THREE.Vector3, saved?: typeof record) => prefabs.spawn(id, position, saved).transform.model,
    exportRecords: () => prefabs.exportRecords(),
  };
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  return { scene, awake, registry, inventory, manager, world,
    save: () => serializeSave(template, { entities: registry.exportRecords(), inventory: inventory.exportState(), elapsedSeconds: 0,
      playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG),
    dispose() { registry.dispose(); prefabs.dispose(); displays.dispose(); inventory.dispose(); scheduler.dispose(); } };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('constructs saved ordinary and tall rocks with their source poses, colour, tags and unsaved work counts', async () => {
  const s = setup(); vi.spyOn(Math, 'random').mockReturnValue(.75);
  try {
    const logical = new StalagmiteInstance('stalagmite_tall_low', s.world, new THREE.Vector3(...record.transform.position));
    expect(fetch).not.toHaveBeenCalled(); // Source construction declares art without loading it.
    expect(logical.sprite.sprite.peek().clip).toMatchObject({ name: 'low_2', loop: false });
    expect(logical.sprite.sprite.peek().queue).toEqual([]);
    expect(logical.sprite.sprite.peek().colour).toEqual([.875, .875, .875]);
    expect(logical.components.workable!.GetWorkLeft()).toBe(2);
    expect(logical.components.workable!.OnSave()).toEqual({});
    for (const tag of ['boulder', 'inspectable', 'MINE_workable']) expect(logical.hasTag(tag)).toBe(true);
    logical.remove();
    const normal = s.manager.spawn('stalagmite_med', new THREE.Vector3(...record.transform.position), record);
    const tall = s.manager.spawn('stalagmite_tall_low', new THREE.Vector3(5, 0, 6), { ...record, id: 'tall-rock' });
    expect(prefabInstance(normal)!.sprite.sprite.peek().clip).toMatchObject({ name: 'med', loop: false });
    expect(prefabInstance(normal)!.components.workable!.GetWorkLeft()).toBe(4);
    expect(prefabInstance(normal)!.getPhysicsRadius()).toBe(3); // MakeObstaclePhysics radius 1 DST unit.
    await Promise.all([normal, tall].map(model => prefabDisplay(model)!.artLoaded()));
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/dst/data/anim/rock_stalagmite.zip'));
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/dst/data/anim/rock_stalagmite_tall.zip'));
    expect(s.manager.exportRecords()[0]).toEqual({ prefabId: 'stalagmite_med', record });
  } finally { s.dispose(); }
});

it('rebuilds the same tall rock after tile sleep with its declared pose, colour, identity and components', async () => {
  const s = setup(); vi.spyOn(Math, 'random').mockReturnValue(.25);
  try {
    const model = s.manager.spawn('stalagmite_tall_med', new THREE.Vector3(...record.transform.position), record);
    const instance = prefabInstance(model)!;
    await prefabDisplay(model)!.artLoaded();
    const { clip, colour } = instance.sprite.sprite.peek(), components = instance.components, saved = s.manager.exportRecords();
    s.awake.set(false); await turn();
    expect(instance.status.peek()).toBe('asleep'); expect(instance.sprite.loaded).toBe(false); expect(model.parent).toBeNull();
    vi.mocked(Math.random).mockReturnValue(.9); // A wake must not run the constructor's random choices again.
    s.awake.set(true); await turn(); await prefabDisplay(model)!.artLoaded();
    expect(model.parent).toBe(s.scene); expect(instance.sprite.currentAnimation).toBe('med_1');
    expect(instance.sprite.sprite.peek()).toMatchObject({ clip, colour });
    expect(instance.components).toBe(components); expect(s.manager.exportRecords()).toEqual(saved);
  } finally { s.dispose(); }
});

it('c_spawn then c_save ZIP export reloads the source ID, position, empty component state and non-looping animation', async () => {
  const first = setup(); let zip!: Uint8Array, records!: ReturnType<EntityRegistry['exportRecords']>;
  try {
    expect((await executeDebugCommand('c_spawn("stalagmite_med")', first.inventory, id => first.registry.spawn(id))).ok).toBe(true);
    expect((await executeDebugCommand('c_give("stalagmite_med")', first.inventory)).ok).toBe(false);
    // workable.savestate=false: a surviving med rock saves no progress and reloads with four work remaining.
    prefabInstance(first.scene.children[0])!.components.workable!.WorkedBy({}, 1);
    expect(prefabInstance(first.scene.children[0])!.components.workable!.GetWorkLeft()).toBe(3);
    records = first.registry.exportRecords();
    expect((await executeDebugCommand('c_save()', first.inventory, undefined, async () => {
      zip = await createClusterSaveZip(first.save(), 'forest');
    })).ok).toBe(true);
  } finally { first.dispose(); }
  const files = unzipSync(zip), text = strFromU8(files['Cluster_1/Master.json']);
  const exported = JSON.parse(text) as { session: { playerFile: string } };
  const { player } = JSON.parse(strFromU8(files[`Cluster_1/${exported.session.playerFile}`])) as { player: unknown };
  const saved = deserializeSave(text, SAVE_CATALOG, player), second = setup();
  try {
    expect(saved.world.entities).toEqual(records);
    await second.registry.restoreAll(saved.world.entities);
    const [model] = second.scene.children, instance = prefabInstance(model)!;
    expect(instance.entityId).toBe(records.stalagmite_med[0].id);
    expect(instance.position.toArray()).toEqual([12, 0, -6]);
    expect(instance.components.workable!.GetWorkLeft()).toBe(4);
    expect(instance.sprite.sprite.peek().clip).toMatchObject({ name: 'med', loop: false });
    await prefabDisplay(model)!.artLoaded(); expect(instance.sprite.currentAnimation).toBe('med');
    expect(second.registry.exportRecords()).toEqual(records);
  } finally { second.dispose(); }
}, CLUSTER_SAVE_ZIP_TIMEOUT);

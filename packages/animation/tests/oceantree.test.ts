import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { oceanTreePrefabs, OCEANTREE_ID, OceanTreeInstance } from '../../prefab/src/oceantree';
import { PrefabEntityManager, type PrefabInstance } from '../../prefab/src/prefabInstance';
import type { EntitySaveRecord } from '../../prefab/src/saveRecord';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { executeDebugCommand } from '../../../src/debugCommands';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { createPickupInventory } from './pickupFixture';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const STAGES = ['short', 'normal', 'tall'] as const;
function setup(playerPosition = new THREE.Vector3()) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), awake = createSignal(true);
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim',
    { tickingarea: () => createMemo(() => awake.get()), scheduler });
  const definitions = oceanTreePrefabs({ scheduler, spawnLoot: () => undefined });
  prefabs.register(definitions);
  const registry = new EntityRegistry([], prefabs, () => playerPosition);
  registry.registerPrefabs(PREFAB_DEFINITIONS.oceanTrees);
  const spawn = (record: EntitySaveRecord) =>
    prefabs.restoreAs(OceanTreeInstance, OCEANTREE_ID, record);
  const records = () => registry.exportRecords().oceantree ?? [];
  const requested = (archive: string) =>
    (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([url]) => String(url).endsWith(`/dst/data/anim/${archive}`));
  const dispose = () => { registry.dispose(); prefabs.dispose(); displays.dispose(); scheduler.dispose(); };
  return { scene, scheduler, awake, prefabs, registry, definitions, spawn, records, requested, dispose };
}
/** The tree's Show / Hide layer declarations. */
const layers = (inst: PrefabInstance) => Object.fromEntries([...inst.sprite.sprite.peek().appearance.values()]
  .flatMap(op => op.kind === 'layer' ? [[op.layer, op.hidden]] : []));
const sway = (inst: PrefabInstance) => inst.sprite.sprite.peek().clip;
/** The entity's own sprite meshes that are drawn; an instanced sprite hides them and the shared batch draws it. */
const ownMeshesShown = (inst: PrefabInstance) => {
  let shown = 0;
  inst.transform.model.traverse(object => { if (object instanceof THREE.Mesh && object.visible) shown++; });
  return shown;
};
/** The imported default save's trees, as the game's save reader parses them. */
async function importedTrees(): Promise<EntitySaveRecord[]> {
  const cluster = new URL('../../../public/saves/Cluster_1/', import.meta.url);
  const json = await readFile(new URL('Master.json', cluster), 'utf8');
  const { session } = JSON.parse(json) as { session: { playerFile: string } };
  const { player } = JSON.parse(await readFile(new URL(session.playerFile, cluster), 'utf8')) as { player: unknown };
  return deserializeSave(json, SAVE_CATALOG, player).world.entities.oceantree! as EntitySaveRecord[];
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('loads imported save records with the stage bank, sway clip, tags and component values oceantree.lua declares', async () => {
  const trees = await importedTrees();
  expect(trees).toHaveLength(48);
  const short = trees.find(record => record.components.growable?.stage === 1)!;
  const tall = trees.find(record => record.components.growable?.stage === 3)!;
  const { awake, spawn, records, definitions, requested, dispose } = setup();
  try {
    // Loaded asleep, as the engine loads an entity: the saved stage holds until it wakes.
    awake.set(false);
    const inst = spawn(tall);
    expect(inst.status.peek()).toBe('asleep');
    // MakeWaterObstaclePhysics, fn's AddTag in order, MakeSnowCoveredPristine, then the burnable and inspectable
    // constructors; workable's SetWorkAction(CHOP) tag is derived from its state.
    expect(inst.listTags()).toEqual(['blocker', 'ignorewalkableplatforms', 'shelter', 'plant', 'event_trigger', 'tree',
      'SnowCovered', 'canlight', 'inspectable', 'CHOP_workable']);
    expect(inst.sprite.sprite.peek().source).toMatchObject({ bank: 'oceantree_tall', buildArchive: 'oceantree_tall.zip' });
    expect(sway(inst)).toMatchObject({ name: expect.stringMatching(/^sway[12]_loop$/), loop: true });
    expect(definitions.oceantree).toMatchObject({
      assetOptions: { instancedAnimations: ['sway1_loop', 'sway2_loop'], staticBillboard: true, colour: [1, 1, 1] },
      physics: { radius: .8, height: 2 }, minimapIcon: 'oceantree_tall.png',
    });
    expect(definitions.oceantree).toMatchObject({ assets: { animationArchive: 'oceantree_tall.zip',
      buildArchives: ['oceantree_tall.zip', 'snow.zip'], bank: 'oceantree_tall', hiddenLayers: ['snow'] } });
    expect([inst.physicsRadiusOverride, inst.transform.scale.x]).toEqual([2.35, 1.1]);
    // Every bud hidden, none used; the snow layer follows the (absent) snow level.
    expect(layers(inst)).toMatchObject({ snow: true, ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map(i => [`tree_bud${i}`, true])) });
    const { workable, growable, burnable } = inst.components;
    expect([growable!.GetStage(), workable!.GetWorkLeft(), inst.drop_oceantreenut_chance]).toEqual([3, 15, 1]);
    expect([growable!.loopstages, growable!.springgrowth, growable!.magicgrowable]).toEqual([true, true, true]);
    expect(burnable.burntime).toBe(45);
    expect([inst.buds, inst.buds_used, inst.supertall_growth_progress]).toEqual([[1, 2, 3, 5, 6, 7], [], 0]);
    expect(Object.keys(inst.components)).toEqual(expect.arrayContaining(['waterphysics', 'burnable', 'propagator', 'inspectable',
      'workable', 'lootdropper', 'growable', 'simplemagicgrower', 'timer', 'hauntable', 'lunarhailbuildup', 'waxable']));
    const small = spawn(short);
    expect(small.sprite.sprite.peek().source).toMatchObject({ bank: 'oceantree_short', buildArchive: 'oceantree_short.zip' });
    expect([small.components.workable!.GetWorkLeft(), small.drop_oceantreenut_chance]).toEqual([5, undefined]);
    expect(records().sort((a, b) => a.id.localeCompare(b.id))).toEqual([short, tall].sort((a, b) => a.id.localeCompare(b.id)));
    // Waking runs growable's OnEntityWake -> LongUpdate over the saved sleeptime: with loopstages the tree may land on any
    // stage, and its bank follows the stage's Set* fn.
    awake.set(true); await settle();
    const stage = inst.components.growable!.GetStage();
    expect(inst.sprite.sprite.peek().source).toMatchObject({ bank: `oceantree_${STAGES[stage - 1]}` });
    expect(inst.components.growable!.IsGrowing()).toBe(true);
    expect(records().find(record => record.id === tall.id)!.components.growable).not.toHaveProperty('sleeptime');
    await prefabDisplay(inst.transform.model)!.artLoaded();
    await prefabDisplay(small.transform.model)!.artLoaded();
    expect(['oceantree_short.zip', 'oceantree_normal.zip', 'oceantree_tall.zip', 'snow.zip'].filter(requested)).toEqual(['oceantree_short.zip', 'oceantree_normal.zip', 'oceantree_tall.zip', 'snow.zip']);
    // The sway is drawn by the shared instanced batch: the tree's own mesh stays hidden.
    expect(ownMeshesShown(inst)).toBe(0);
    expect(ownMeshesShown(small)).toBe(0);
    // A stage set while the tree is drawn switches the archive sprite's bank and keeps it in the batch.
    const next = stage === 3 ? 1 : stage + 1;
    inst.components.growable!.SetStage(next);
    await prefabDisplay(inst.transform.model)!.artLoaded(); await settle();
    expect(inst.sprite.sprite.peek().source).toMatchObject({ bank: `oceantree_${STAGES[next - 1]}`, buildArchive: `oceantree_${STAGES[next - 1]}.zip` });
    expect(inst.sprite.currentAnimation).toMatch(/^sway[12]_loop$/);
    expect(ownMeshesShown(inst)).toBe(0);
  } finally { dispose(); }
});

it('rebuilds the declared bank, clip and layers after tile sleep', async () => {
  const { scene, awake, spawn, records, dispose } = setup();
  try {
    const saved: EntitySaveRecord = { id: 'sleeping-tree', transform: { position: [1, 0, 3], rotationY: 0 },
      components: { growable: { stage: 2, time: 900 }, oceantree: { buds: [1, 2, 3, 5, 6], buds_used: [7], supertall_growth_progress: 1 } } };
    const inst = spawn(saved);
    const model = inst.transform.model, before = inst.sprite.sprite.peek();
    // onloadpostpass's showbuds.
    expect(layers(inst)).toMatchObject({ tree_bud7: false, tree_bud1: true });
    await prefabDisplay(model)!.artLoaded();
    awake.set(false); await settle();
    expect(inst.status.peek()).toBe('asleep');
    expect(inst.sprite.loaded).toBe(false);
    expect(model.parent).toBeNull();
    awake.set(true); await settle();
    await prefabDisplay(model)!.artLoaded();
    expect(model.parent).toBe(scene);
    expect(inst.sprite.sprite.peek().source).toEqual(before.source);
    expect(sway(inst)).toEqual(before.clip);
    expect(inst.sprite.sprite.peek().appearance).toEqual(before.appearance);
    expect(records()).toEqual([saved]);
  } finally { dispose(); }
});

it('keeps a c_spawn tree through c_save and a reload, and rejects c_give', async () => {
  const first = setup(new THREE.Vector3(3, 0, -6)), second = setup(), inventory = createPickupInventory();
  try {
    expect((await executeDebugCommand('c_spawn("oceantree")', inventory, prefab => first.registry.spawn(prefab))).ok).toBe(true);
    expect((await executeDebugCommand('c_give("oceantree")', inventory)).ok).toBe(false);
    const spawned = [...first.prefabs.instances(OCEANTREE_ID)][0] as OceanTreeInstance;
    // stage 0: math.random(1, 3).
    expect(STAGES[spawned.components.growable!.GetStage() - 1]).toBeDefined();
    spawned.components.growable!.SetStage(2);
    spawned.buds_used = [3];
    spawned.supertall_growth_progress = 2;
    const before = first.registry.exportRecords();
    let json = '';
    expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
      json = serializeSave(deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG),
        { entities: before, inventory: inventory.exportState(), elapsedSeconds: 1, playerTransform: { position: [3, 0, -6], rotationY: 0 } }, SAVE_CATALOG);
    })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG).world.entities.oceantree!;
    expect(saved).toEqual(before.oceantree);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: spawned.entityId, transform: { position: [3, 0, -6] }, components: {
      growable: { stage: 2, time: expect.any(Number) },
      oceantree: { buds: [1, 2, 3, 5, 6, 7], buds_used: [3], supertall_growth_progress: 2 } } });
    await second.registry.restoreAll({ oceantree: saved });
    const loaded = second.prefabs.get(saved[0]!.id);
    if (!(loaded instanceof OceanTreeInstance)) throw new Error('The saved tree did not load');
    expect(loaded.position.toArray()).toEqual([3, 0, -6]);
    expect(loaded.sprite.sprite.peek().source).toMatchObject({ bank: 'oceantree_normal', buildArchive: 'oceantree_normal.zip' });
    expect(sway(loaded)).toMatchObject({ loop: true });
    expect([loaded.components.growable!.GetStage(), loaded.components.workable!.GetWorkLeft(), loaded.buds_used,
      loaded.supertall_growth_progress]).toEqual([2, 10, [3], 2]);
    expect(layers(loaded)).toMatchObject({ tree_bud3: false });
    expect(second.records()).toEqual(saved);
  } finally { first.dispose(); second.dispose(); inventory.dispose(); }
});

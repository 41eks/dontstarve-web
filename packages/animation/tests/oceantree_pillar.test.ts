import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import type { AnimStateJson } from '@dontstarve-web/animation/animState';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { oceanTreePillarPrefabs, OCEANTREE_PILLAR_ID, OceanTreePillarInstance } from '../../prefab/src/oceantree_pillar';
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
function setup(playerPosition = new THREE.Vector3()) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), awake = createSignal(true);
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim',
    { tickingarea: () => createMemo(() => awake.get()), scheduler });
  const definitions = oceanTreePillarPrefabs({ scheduler, spawnLoot: () => undefined,
    spawnPrefab: (id, position) => prefabs.spawn(id, position) });
  prefabs.register(definitions);
  const registry = new EntityRegistry([], prefabs, () => playerPosition);
  registry.registerPrefabs(PREFAB_DEFINITIONS.oceanTreePillars);
  const spawn = (record: EntitySaveRecord) =>
    prefabs.restore(OCEANTREE_PILLAR_ID, record) as OceanTreePillarInstance;
  const records = () => registry.exportRecords().oceantree_pillar ?? [];
  const requested = (archive: string) =>
    (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([url]) => String(url).endsWith(`/dst/data/anim/${archive}`));
  const dispose = () => { registry.dispose(); prefabs.dispose(); displays.dispose(); scheduler.dispose(); };
  return { scene, awake, prefabs, registry, definitions, spawn, records, requested, dispose };
}
/** The ripples and roots fn spawns and parents with entity:SetParent. */
const children = (inst: OceanTreePillarInstance) => [inst._ripples, inst.roots];
/** The pillar's own AnimState declaration: AddOverrideBuild's builds. */
const overrideBuilds = (inst: PrefabInstance) => {
  const op = inst.sprite.sprite.peek().appearance.get('anim-state');
  return op?.kind === 'anim-state' ? (op.state.peek() as AnimStateJson).overrideBuilds : undefined;
};
/** The imported default save's pillars, as the game's save reader parses them. */
async function importedPillars(): Promise<EntitySaveRecord[]> {
  const cluster = new URL('../../../public/saves/Cluster_1/', import.meta.url);
  const json = await readFile(new URL('Master.json', cluster), 'utf8');
  const { session } = JSON.parse(json) as { session: { playerFile: string } };
  const { player } = JSON.parse(await readFile(new URL(session.playerFile, cluster), 'utf8')) as { player: unknown };
  return deserializeSave(json, SAVE_CATALOG, player).world.entities.oceantree_pillar! as EntitySaveRecord[];
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('loads the imported save record with the clip, tags, bank and component values oceantree_pillar.lua fn declares', async () => {
  const pillars = await importedPillars();
  expect(pillars).toHaveLength(1);
  expect(pillars[0]!.components).toEqual({ oceantreePillar: { droppedvines: true } });
  const { prefabs, spawn, records, definitions, requested, dispose } = setup();
  try {
    const inst = spawn(pillars[0]!);
    // MakeWaterObstaclePhysics's blocker, fn's AddTag in order, then the inspectable and burnable constructors' tags.
    expect(inst.listTags()).toEqual(['blocker', 'shadecanopysmall', 'event_trigger', 'ignorewalkableplatforms', 'inspectable', 'canlight',
      'CHOP_workable']);
    expect(inst.sprite.sprite.peek()).toMatchObject({ clip: { name: 'idle', loop: true }, queue: [], billboard: true });
    expect(definitions.oceantree_pillar).toMatchObject({
      assets: { animationArchive: 'oceantree_pillar_small.zip', buildArchives: ['oceantree_pillar_small_build1.zip'], bank: 'oceantree_pillar_small' },
      physics: { radius: 1.5, height: 2 }, minimapIcon: 'oceantree_pillar_small.png',
    });
    expect(overrideBuilds(inst)).toEqual(['oceantree_pillar_small_build2.zip']);
    expect(inst.droppedvines).toBe(true);
    const { workable, lootdropper, burnable } = inst.components;
    expect([workable.GetWorkAction(), workable.maxwork.peek(), workable.GetWorkLeft()]).toEqual(['CHOP', 25, 25]);
    expect(lootdropper.GenerateLoot()).toEqual(['log', 'log', 'log', 'log', 'twigs', 'twigs', 'twigs']);
    expect(burnable.burntime).toBe(30);
    expect(Object.keys(inst.components)).toEqual(expect.arrayContaining(['waterphysics', 'distancefade', 'canopyshadows',
      'lootdropper', 'playerprox', 'workable', 'inspectable', 'lightningblocker', 'burnable', 'propagator']));
    expect(records()).toEqual(pillars);
    await prefabDisplay(inst.transform.model)!.artLoaded();
    for (const archive of ['oceantree_pillar_small.zip', 'oceantree_pillar_small_build1.zip', 'oceantree_pillar_small_build2.zip']) {
      expect(requested(archive)).toBe(true);
    }
    expect(inst.sprite.currentAnimation).toBe('idle');

    // ripples_fn / roots_fn: FX | NOCLICK children on the pillar's bank, build and override build, never saved.
    const [ripples, roots] = children(inst);
    expect([ripples!.prefab, roots!.prefab]).toEqual(['oceantree_pillar_ripples', 'oceantree_pillar_roots']);
    for (const child of [ripples!, roots!]) {
      expect(child.listTags()).toEqual(['FX', 'NOCLICK']);
      expect([child.entityParent, child.persists, child.position.toArray()]).toEqual([inst, false, inst.position.toArray()]);
      expect(overrideBuilds(child)).toEqual(['oceantree_pillar_small_build2.zip']);
      await prefabDisplay(child.transform.model)!.artLoaded();
    }
    expect(definitions.oceantree_pillar_ripples.assets).toEqual(definitions.oceantree_pillar.assets);
    expect(definitions.oceantree_pillar_roots.assets).toEqual(definitions.oceantree_pillar.assets);
    expect(ripples!.sprite.sprite.peek()).toMatchObject({ clip: { name: 'root_ripple', loop: true }, billboard: true });
    expect(ripples!.sprite.sprite.peek().background).toBeUndefined();
    // LAYER_WIP_BELOW_OCEAN with ANIM_SORT_ORDER_BELOW_GROUND.UNDERWATER: between the ocean floor and its surface.
    expect(roots!.sprite.sprite.peek()).toMatchObject({ clip: { name: 'root_shadow', loop: false }, billboard: true,
      background: true, meshOrder: -1.755 });
    expect(records()).toEqual(pillars);
    // The children retire with the pillar.
    inst.remove();
    expect([ripples!.isRemoved, roots!.isRemoved]).toEqual([true, true]);

    // leaves_fn, which only the unported chop_down_tree spawns: FX | NOCLICK leaf_fall_ground once, never saved.
    const leaves = prefabs.spawn('oceantree_pillar_leaves', new THREE.Vector3(4, 0, 2));
    expect(leaves.listTags()).toEqual(['FX', 'NOCLICK']);
    expect(leaves.persists).toBe(false);
    expect(definitions.oceantree_pillar_leaves.assets).toEqual(definitions.oceantree_pillar.assets);
    expect(leaves.sprite.sprite.peek()).toMatchObject({ clip: { name: 'leaf_fall_ground', loop: false }, billboard: true });
    expect(overrideBuilds(leaves)).toEqual(['oceantree_pillar_small_build2.zip']);
    await prefabDisplay(leaves.transform.model)!.artLoaded();
    expect(leaves.sprite.currentAnimation).toBe('leaf_fall_ground');
  } finally { dispose(); }
});

it('rebuilds the declared clips and override builds of the pillar, its children and leaves after tile sleep', async () => {
  const { scene, awake, prefabs, spawn, records, dispose } = setup();
  try {
    const saved: EntitySaveRecord = { id: 'sleeping-pillar', transform: { position: [1, 0, 3], rotationY: 0 }, components: {} };
    const inst = spawn(saved);
    const model = inst.transform.model, before = inst.sprite.sprite.peek();
    const kids = [...children(inst), prefabs.spawn('oceantree_pillar_leaves', new THREE.Vector3(5, 0, 3))];
    const kidsBefore = kids.map(child => child.sprite.sprite.peek());
    await prefabDisplay(model)!.artLoaded();
    for (const child of kids) await prefabDisplay(child.transform.model)!.artLoaded();
    awake.set(false); await settle();
    expect(kids.map(child => [child.status.peek(), child.sprite.loaded, child.transform.model.parent])).toEqual([
      ['asleep', false, null], ['asleep', false, null], ['asleep', false, null]]);
    expect(inst.status.peek()).toBe('asleep');
    expect(inst.sprite.loaded).toBe(false);
    expect(model.parent).toBeNull();
    awake.set(true); await settle();
    await prefabDisplay(model)!.artLoaded();
    expect(model.parent).toBe(scene);
    expect(inst.sprite.currentAnimation).toBe('idle');
    expect(inst.sprite.sprite.peek().clip).toMatchObject({ name: 'idle', loop: true });
    expect(inst.sprite.sprite.peek().appearance).toEqual(before.appearance);
    expect(overrideBuilds(inst)).toEqual(['oceantree_pillar_small_build2.zip']);
    for (const [i, child] of kids.entries()) {
      await prefabDisplay(child.transform.model)!.artLoaded();
      expect(child.transform.model.parent).toBe(scene);
      expect(child.sprite.sprite.peek().clip).toEqual(kidsBefore[i]!.clip);
      expect(child.sprite.sprite.peek().appearance).toEqual(kidsBefore[i]!.appearance);
      expect(overrideBuilds(child)).toEqual(['oceantree_pillar_small_build2.zip']);
    }
    expect(kids[0]!.sprite.currentAnimation).toBe('root_ripple');
    expect(kids[1]!.sprite.sprite.peek()).toMatchObject({ background: true, meshOrder: -1.755 });
    expect(kids[2]!.sprite.sprite.peek().clip).toMatchObject({ name: 'leaf_fall_ground', loop: false });
    expect(records()).toEqual([saved]);
  } finally { dispose(); }
});

it('keeps a c_spawn pillar through c_save and a reload, leaves its children out, and rejects c_give', async () => {
  const first = setup(new THREE.Vector3(3, 0, -6)), second = setup(), inventory = createPickupInventory();
  try {
    expect((await executeDebugCommand('c_spawn("oceantree_pillar")', inventory, prefab => first.registry.spawn(prefab))).ok).toBe(true);
    expect((await executeDebugCommand('c_give("oceantree_pillar")', inventory)).ok).toBe(false);
    // The ripples, roots and leaves are their own Prefabs: c_spawn makes a standalone one, persists = false keeps it unsaved.
    for (const id of ['oceantree_pillar_ripples', 'oceantree_pillar_roots', 'oceantree_pillar_leaves']) {
      expect((await executeDebugCommand(`c_spawn("${id}")`, inventory, prefab => first.registry.spawn(prefab))).ok).toBe(true);
      expect((await executeDebugCommand(`c_give("${id}")`, inventory)).ok).toBe(false);
    }
    // The pillar's own two children and the two standalone ones.
    expect([...first.prefabs.instances('oceantree_pillar_ripples')]).toHaveLength(2);
    expect([...first.prefabs.instances('oceantree_pillar_roots')]).toHaveLength(2);
    expect([...first.prefabs.instances('oceantree_pillar_leaves')]).toHaveLength(1);
    const spawned = [...first.prefabs.instances(OCEANTREE_PILLAR_ID)][0] as OceanTreePillarInstance;
    // A fresh pillar has not dropped its vines (startvines is not ported), so it saves nothing of its own.
    expect(spawned.droppedvines).toBeUndefined();
    expect(first.records()[0]!.components).toEqual({});
    spawned.droppedvines = true;
    const before = first.registry.exportRecords();
    let json = '';
    expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
      json = serializeSave(deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG),
        { entities: before, inventory: inventory.exportSaved(), elapsedSeconds: 1, playerTransform: { position: [3, 0, -6], rotationY: 0 } }, SAVE_CATALOG);
    })).ok).toBe(true);
    const entities = deserializeSave(json, SAVE_CATALOG).world.entities;
    expect([entities.oceantree_pillar_ripples, entities.oceantree_pillar_roots, entities.oceantree_pillar_leaves]).toEqual([undefined, undefined, undefined]);
    const saved = entities.oceantree_pillar!;
    expect(saved).toEqual(before.oceantree_pillar);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: spawned.entityId, transform: { position: [3, 0, -6] },
      components: { oceantreePillar: { droppedvines: true } } });
    await second.registry.restoreAll({ oceantree_pillar: saved });
    const loaded = second.prefabs.get(saved[0]!.id);
    if (!(loaded instanceof OceanTreePillarInstance)) throw new Error('The saved pillar did not load');
    expect(loaded.position.toArray()).toEqual([3, 0, -6]);
    expect(loaded.sprite.sprite.peek().clip).toMatchObject({ name: 'idle', loop: true });
    expect(loaded.droppedvines).toBe(true);
    expect(loaded.components.workable.GetWorkLeft()).toBe(25);
    // Only the loaded pillar's fn recreates children.
    expect(children(loaded).map(child => [child.prefab, child.entityParent === loaded])).toEqual([
      ['oceantree_pillar_ripples', true], ['oceantree_pillar_roots', true]]);
    expect([...second.prefabs.instances('oceantree_pillar_ripples'), ...second.prefabs.instances('oceantree_pillar_roots')]).toHaveLength(2);
    expect([...second.prefabs.instances('oceantree_pillar_leaves')]).toHaveLength(0);
    expect(second.records()).toEqual(saved);
  } finally { first.dispose(); second.dispose(); inventory.dispose(); }
});

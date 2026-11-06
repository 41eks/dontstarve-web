import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrefabDisplayGroup } from '@dontstarve-web/display';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { archivePropsPrefabs, type ArchiveMoonStatueInstance, type ArchiveRuneStatueInstance } from '../../prefab/src/archive_props';
import { PrefabEntityManager, prefabInstance, type PrefabInstance } from '../../prefab/src/prefabInstance';
import { createInventoryStore } from '../../../src/inventory';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { FACING } from '../src/facing';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { workTargets } from './workTargets';
import type { SpawnGroundItem } from '../../prefab/src/groundPrefab';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  const scene = new THREE.Scene(), physics = new CANNON.World(), scheduler = new GameTimeScheduler(), inventory = createInventoryStore([]);
  const displays = new PrefabDisplayGroup(scene), cameraFacing = createSignal<number>(FACING.DOWN);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { physics, tickingarea: () => createMemo(() => true) });
  const spawnGroundItem = vi.fn<SpawnGroundItem>(() => undefined), collapse = vi.fn();
  prefabs.register(archivePropsPrefabs({ scheduler, cameraFacing, spawnGroundItem, fx: { collapse },
    spawnPrefab: (id, position) => prefabs.spawn(id, position) }) as never);
  const registry = new EntityRegistry([], prefabs, () => new THREE.Vector3(0, 0, 0));
  registry.registerPrefabs(PREFAB_DEFINITIONS.archiveProps);
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  const save = () => serializeSave(template, { entities: registry.exportRecords(), inventory: inventory.exportState(), elapsedSeconds: 0,
    playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
  /** Restore every archive prop of a saved world, as the scene loader does. */
  const load = (json: string) => {
    for (const [prefabId, records] of Object.entries(deserializeSave(json, SAVE_CATALOG).world.entities)) {
      if (!(PREFAB_DEFINITIONS.archiveProps.prefabIds as readonly string[]).includes(prefabId)) continue;
      for (const record of records) prefabs.spawn(prefabId, new THREE.Vector3(...record.transform.position), record);
    }
  };
  const find = <Instance extends PrefabInstance = PrefabInstance>(id: string) =>
    scene.children.map(model => prefabInstance<PrefabInstance>(model)!).filter(inst => inst?.prefab === id) as Instance[];
  return { scene, physics, scheduler, inventory, prefabs, registry, cameraFacing, spawnGroundItem, collapse, save, load, find,
    dispose: () => { registry.dispose(); prefabs.dispose(); displays.dispose(); inventory.dispose(); scheduler.dispose(); } };
}

it('mines an archive_moon_statue down for its loot and keeps its pose through save/load', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(.5);
  const s = setup(), restored = setup();
  try {
    expect((await executeDebugCommand('c_spawn("archive_moon_statue")', s.inventory, id => s.registry.spawn(id))).ok).toBe(true);
    // math.random(4) at .5 → variant 3; workable.savestate is false, so only the pose is saved.
    expect(s.prefabs.exportRecords().map(({ prefabId, record }) => [prefabId, record.components])).toEqual([
      ['archive_moon_statue', { archiveProp: { anim: 3 } }]]);
    const [statue] = s.find<ArchiveMoonStatueInstance>('archive_moon_statue');
    expect(statue.minimap.icon).toBe('archive_moon_statue3.png');
    expect(statue.sprite.sprite.peek().clip).toMatchObject({ name: 'idle_full_3', loop: false });
    expect(statue.listTags()).toEqual(expect.arrayContaining(['structure', 'statue', 'dustable']));
    expect(s.physics.bodies).toHaveLength(1);

    let json = '';
    expect((await executeDebugCommand('c_save()', s.inventory, undefined, () => { json = s.save(); })).ok).toBe(true);
    restored.load(json);
    expect(restored.prefabs.exportRecords()).toEqual(s.prefabs.exportRecords());
    // onloadpostpass: a loaded statue loops its work state.
    expect(restored.find('archive_moon_statue')[0].sprite.sprite.peek().clip).toMatchObject({ name: 'idle_full_3', loop: true });

    // MARBLEPILLAR_MINE = 10 works; the final one drops the table (the 5% nugget misses at .5), collapses and removes the statue.
    const pickaxe = s.inventory.entities.create({ itemId: 'pickaxe', count: 1 });
    const [mine] = workTargets('MINE', s.scene);
    for (let i = 0; i < 9; i++) expect(performToolWork('MINE', mine.entity, {}, pickaxe)).toBe(true);
    expect(statue.sprite.sprite.peek().clip).toMatchObject({ name: 'idle_low_3', loop: true });
    expect(performToolWork('MINE', mine.entity, {}, pickaxe)).toBe(true);
    expect(workTargets('MINE', s.scene)).toEqual([]); expect(s.prefabs.exportRecords()).toEqual([]);
    expect(statue.isRemoved).toBe(true);
    expect(s.physics.bodies).toHaveLength(0);
    expect(s.spawnGroundItem.mock.calls.map(([item]) => item.itemId).sort()).toEqual(['moonrocknugget', 'thulecite']);
    expect(s.collapse).toHaveBeenCalledWith('small', expect.anything(), 'rock');
  } finally { s.dispose(); restored.dispose(); }
}, 20000);

it('hands out rune story lines once, saves static props and ignores the pad, the shadow and rubble worldgen items', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const s = setup(), restored = setup();
  try {
    for (const id of ['archive_rune_statue', 'archive_rune_statue', 'archive_portal', 'archive_switch_base', 'archive_ambient_sfx', 'archive_switch_pad', 'rubble1', 'rubble2']) {
      expect(await s.registry.spawn(id)).toBe(true);
    }
    // worldgenitemfn: DoTaskInTime(0, Remove).
    const rubble = [...s.find('rubble1'), ...s.find('rubble2')];
    expect(rubble.map(inst => inst.isRemoved)).toEqual([false, false]);
    s.scheduler.advance(0);
    expect(rubble.map(inst => inst.isRemoved)).toEqual([true, true]);

    const runes = s.find<ArchiveRuneStatueInstance>('archive_rune_statue');
    const status = (rune: PrefabInstance) => (rune.components as { inspectable: { getstatus(): string } }).inspectable.getstatus();
    expect([status(runes[0]), status(runes[1]), status(runes[0])]).toEqual(['LINE_1', 'LINE_2', 'LINE_1']);
    // Only a reader holding the ancient_reader tag gets the text.
    const describe = (viewer: object) => (runes[0].components as { inspectable: { descriptionfn(viewer: object): string | undefined } }).inspectable.descriptionfn(viewer);
    expect(describe({ components: { inventory: { EquipHasTag: (tag: string) => tag === 'ancient_reader' } } })).toBe('LINE_1');
    expect(describe({})).toBeUndefined();

    // SetEightFaced: the portal and its shadow child follow the camera heading.
    const [portal] = s.find('archive_portal'), [shadow] = s.find('archive_portal_shadow');
    s.cameraFacing.set(FACING.UPRIGHT);
    expect([portal.sprite.sprite.peek().facing, shadow.sprite.sprite.peek().facing]).toEqual([FACING.UPRIGHT, FACING.UPRIGHT]);
    expect(shadow.listTags()).toEqual(expect.arrayContaining(['DECOR', 'NOCLICK']));

    // The pad and the shadow (persists = false) and the self-removing rubble never reach the save.
    const records = s.prefabs.exportRecords();
    expect(records.map(({ prefabId }) => prefabId)).toEqual(['archive_rune_statue', 'archive_rune_statue', 'archive_portal', 'archive_switch_base', 'archive_ambient_sfx']);
    expect(records.filter(({ prefabId }) => prefabId === 'archive_rune_statue').map(({ record }) => record.components.archiveProp!.storyprogress)).toEqual([1, 2]);

    let json = '';
    expect((await executeDebugCommand('c_save()', s.inventory, undefined, () => { json = s.save(); })).ok).toBe(true);
    restored.load(json);
    expect(restored.prefabs.exportRecords()).toEqual(records);
    expect(restored.find('archive_portal')[0].listTags()).toEqual(expect.arrayContaining(['groundhole', 'blocker']));
    const restoredShadows = restored.find('archive_portal_shadow');
    expect(restoredShadows).toHaveLength(1);
    expect(restored.scene.children.map(model => prefabInstance(model)?.minimap.icon).filter(Boolean).sort())
      .toEqual(['archive_portal.png', 'archive_runes.png', 'archive_runes.png']);
    // A rune statue's counter resumes after the highest saved line.
    const fresh = restored.prefabs.spawn('archive_rune_statue', new THREE.Vector3(30, 0, 0));
    expect(status(fresh)).toBe('LINE_3');
    // Removing the portal removes its shadow.
    restored.find('archive_portal')[0].remove();
    expect(restoredShadows[0].isRemoved).toBe(true);
  } finally { s.dispose(); restored.dispose(); }
}, 20000);

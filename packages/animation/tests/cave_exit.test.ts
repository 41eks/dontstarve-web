import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import { createMemo } from '@dontstarve-web/signals';
import { caveExitPrefabs, CAVE_EXIT_ID, type CaveExitInstance } from '../../prefab/src/cave_exit';
import { PrefabEntityManager, prefabInstance, type PrefabInstance } from '../../prefab/src/prefabInstance';
import type { WorldMigratorShard } from '../../componets/src/worldmigrator';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { createInventoryStore } from '../../../src/inventory';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { canDoSceneAction, sceneActions } from './sceneActions';

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(shard?: WorldMigratorShard) {
  const scene = new THREE.Scene(), physics = new CANNON.World(), displays = new PrefabDisplayGroup(scene), inventory = createInventoryStore([]);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { physics, tickingarea: () => createMemo(() => true) });
  prefabs.register(caveExitPrefabs({ shard }) as never);
  const registry = new EntityRegistry([], prefabs, () => new THREE.Vector3(5, 0, 7));
  registry.registerPrefabs(PREFAB_DEFINITIONS.caveExits);
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  const save = () => serializeSave(template, { entities: registry.exportRecords(), inventory: inventory.exportState(), elapsedSeconds: 0,
    playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
  const exits = () => scene.children.map(model => prefabInstance<CaveExitInstance>(model)!).filter(inst => inst?.prefab === CAVE_EXIT_ID);
  return { scene, physics, prefabs, registry, inventory, save, exits,
    dispose: () => { registry.dispose(); prefabs.dispose(); displays.dispose(); inventory.dispose(); } };
}

it('spawns cave_exit as a solid obstacle and keeps its identity and position through c_save and reload', async () => {
  const s = setup(), restored = setup();
  try {
    expect((await executeDebugCommand('c_spawn("cave_exit")', s.inventory, id => s.registry.spawn(id))).ok).toBe(true);
    const [exit] = s.exits();
    expect(exit.minimap.icon).toBe('cave_open2.png');
    expect(s.physics.bodies).toHaveLength(1);
    // No shard link: migration_unavailable replaces the constructor's one-shot open with the no_access loop.
    expect(exit.sprite.sprite.peek().clip).toMatchObject({ name: 'no_access', loop: true });
    await prefabDisplay(exit.transform.model)!.artLoaded();

    let json = '';
    expect((await executeDebugCommand('c_save()', s.inventory, undefined, () => { json = s.save(); })).ok).toBe(true);
    const [record] = deserializeSave(json, SAVE_CATALOG).world.entities.cave_exit;
    expect([record.id, record.transform.position, record.components]).toEqual([exit.entityId, [5, 0, 7], {}]);
    restored.prefabs.spawn(CAVE_EXIT_ID, new THREE.Vector3(...record.transform.position), record);
    expect(restored.prefabs.exportRecords()).toEqual(s.prefabs.exportRecords());
    exit.remove();
    expect(s.physics.bodies).toHaveLength(0);
  } finally { s.dispose(); restored.dispose(); }
});

it('offers MIGRATE to the Master shard once it is available and hands the player over', () => {
  const migrated: unknown[][] = [];
  const s = setup({ isWorldAvailable: id => id === 'Master', isWorldFull: () => false, migratePlayer: (...args) => { migrated.push(args); } });
  const unlinked = setup();
  try {
    const exit = s.prefabs.spawn(CAVE_EXIT_ID, new THREE.Vector3(1, 0, 2)) as CaveExitInstance;
    expect(exit.sprite.sprite.peek().clip).toMatchObject({ name: 'open', loop: true });
    expect(canDoSceneAction('MIGRATE', exit.transform.model)).toBe(true);
    const player = { hasTag: (tag: string) => tag === 'player' };
    expect(exit.components.worldmigrator.Activate(player)).toBe(true);
    expect(migrated).toEqual([[player, undefined, 'Master']]);
    expect(sceneActions(unlinked.prefabs.spawn(CAVE_EXIT_ID, new THREE.Vector3(1, 0, 2)).transform.model)).not.toContain('MIGRATE');
  } finally { s.dispose(); unlinked.dispose(); }
});

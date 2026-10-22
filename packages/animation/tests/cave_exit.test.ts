import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { CaveExitManager } from '../../prefab/src/cave_exit';
import { getMigrateActions } from '../../stategraphs/src/migrate';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('renders the static cave_exit art as a solid obstacle and round-trips its record', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const scene = new THREE.Scene(), physics = new CANNON.World();
  const exits = new CaveExitManager(scene, { physics });
  try {
    const model = await exits.spawn(new THREE.Vector3(5, 0, 7));
    expect(exits.miniMapEntities.map(({ icon }) => icon)).toEqual(['cave_open2.png']);
    expect(physics.bodies).toHaveLength(1);
    exits.update(0.1, new THREE.Quaternion());
    const [{ prefabId, record }] = exits.exportRecords();
    expect([prefabId, record.id, record.transform.position]).toEqual(['cave_exit', model.userData.entityId, [5, 0, 7]]);

    const restored = new CaveExitManager(new THREE.Scene(), {});
    try {
      await restored.spawn(new THREE.Vector3(...record.transform.position), record);
      expect(restored.exportRecords()[0].record).toEqual(record);
    } finally { restored.dispose(); }
  } finally { exits.dispose(); }
  expect(physics.bodies).toHaveLength(0);
});

it('offers MIGRATE to the Master shard once it is available and hands the player over', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const migrated: unknown[][] = [];
  const shard = { isWorldAvailable: (id: string) => id === 'Master', isWorldFull: () => false, migratePlayer: (...args: unknown[]) => { migrated.push(args); } };
  const exits = new CaveExitManager(new THREE.Scene(), { shard }), unlinked = new CaveExitManager(new THREE.Scene(), {});
  try {
    const model = await exits.spawn(new THREE.Vector3(1, 0, 2));
    expect(getMigrateActions(model)[0]).toMatchObject({ button: 'left', available: true, action: { action: 'MIGRATE' } });
    const player = { hasTag: (tag: string) => tag === 'player' };
    expect(model.userData.components.worldmigrator.Activate(player)).toBe(true);
    expect(migrated).toEqual([[player, undefined, 'Master']]);
    expect(getMigrateActions(await unlinked.spawn(new THREE.Vector3(1, 0, 2)))).toEqual([]);
  } finally { exits.dispose(); unlinked.dispose(); }
});

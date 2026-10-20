import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { createClusterSaveZip, downloadClusterSave } from '../../../src/save/download';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { inventoryStateFromSave } from '../../../src/save/inventoryState';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { createInventoryStore } from '../../../src/inventory';
import { executeDebugCommand } from '../../../src/debugCommands';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const clusterDirectory = fileURLToPath(new URL('../../../public/saves/Cluster_1/', import.meta.url));
const sourceFile = (name: string) => readFile(join(clusterDirectory, name));

it.each(['Caves', 'Master'] as const)('exports current %s state and preserves every other cluster file byte for byte', async shard => {
  const template = deserializeSave((await sourceFile(`${shard}.json`)).toString(), SAVE_CATALOG);
  const inventory = createInventoryStore([]);
  vi.stubGlobal('fetch', async (url: string) => {
    const name = decodeURIComponent(new URL(url, 'http://test').pathname.split('/saves/Cluster_1/')[1]);
    return new Response(new Uint8Array(await sourceFile(name)));
  });
  let archive!: Uint8Array;
  try {
    const result = await executeDebugCommand('c_give("log", 3);c_save()', inventory, undefined, async () => {
      const json = serializeSave(template, {
        inventory: inventory.exportState(), elapsedSeconds: 42,
        playerTransform: { position: [3, 0, -6], rotationY: 0 },
        entities: { ground_item: [{ id: 'saved_ground_log', transform: { position: [9, 0, 6], rotationY: 0 },
          components: { stack: { itemId: 'log', count: 7 } } }] },
      }, SAVE_CATALOG);
      archive = await createClusterSaveZip(json, template.world.prefab);
    });
    expect(result.ok).toBe(true);
    expect(result.message).toContain('Cluster_1.zip');
    const files = unzipSync(archive);
    const members = (await readdir(clusterDirectory, { recursive: true, withFileTypes: true }))
      .filter(entry => entry.isFile()).map(entry => relative(clusterDirectory, join(entry.parentPath, entry.name)).replaceAll('\\', '/'));
    expect(Object.keys(files).sort()).toEqual(members.map(name => `Cluster_1/${name}`).sort());
    for (const name of members.filter(name => name !== `${shard}.json`)) {
      expect(files[`Cluster_1/${name}`]).toEqual(new Uint8Array(await sourceFile(name)));
    }
    const saved = deserializeSave(strFromU8(files[`Cluster_1/${shard}.json`]), SAVE_CATALOG);
    expect(saved.snapshot.parentId).toBe(template.snapshot.id);
    expect(saved.world.elapsedSeconds).toBe(42);
    expect(saved.players.local.transform.position).toEqual([3, 0, -6]);
    expect(saved.world.entities.ground_item[0]).toMatchObject({ id: 'saved_ground_log',
      transform: { position: [9, 0, 6] }, components: { stack: { itemId: 'log', count: 7 } } });
    const restored = createInventoryStore([]);
    try {
      restored.replaceState(inventoryStateFromSave(saved), SAVE_CATALOG.recipes);
      expect(restored.exportState()).toEqual(inventory.exportState());
      expect(restored.count('log')).toBe(3);
    } finally { restored.dispose(); }
  } finally { inventory.dispose(); }
});

it('reports an unreadable cluster member and starts no download', async () => {
  vi.stubGlobal('fetch', async () => new Response('unavailable', { status: 503 }));
  const createUrl = vi.spyOn(URL, 'createObjectURL');
  const inventory = createInventoryStore([]);
  try {
    const result = await executeDebugCommand('c_save()', inventory, undefined, () => downloadClusterSave('{}', 'cave'));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/保存失败：.*HTTP 503/);
    expect(createUrl).not.toHaveBeenCalled();
  } finally { inventory.dispose(); }
});

import { strToU8, zipSync } from 'fflate';
import type { SaveDocument } from './types';

const clusterFiles = import.meta.glob<string>('../../public/saves/Cluster_1/**/*', {
  eager: true, exhaustive: true, query: '?url', import: 'default',
});

/** Preserve every cluster file, replacing the active world's shard with its validated snapshot. */
export async function createClusterSaveZip(json: string, prefab: SaveDocument['world']['prefab']): Promise<Uint8Array<ArrayBuffer>> {
  const document = JSON.parse(json) as SaveDocument;
  const shard = prefab === 'cave' ? 'Caves' : 'Master';
  const activePath = `Cluster_1/${shard}.json`;
  const sourceSessionId = document.session.playerFile?.match(/^(?:Master|Caves)\/save\/session\/([^/]+)\//)?.[1]
    ?? document.session.id;
  const snapshotFile = `${shard}/save/session/${sourceSessionId}/${document.snapshot.id}.json`;
  const snapshotPath = `Cluster_1/${snapshotFile}`;
  const playerFile = document.session.playerFile?.replace(/[0-9]{10}\.json$/, `${document.snapshot.id}.json`)
    ?? `${shard}/save/session/${sourceSessionId}/local/${document.snapshot.id}.json`;
  const playerPath = `Cluster_1/${playerFile}`;
  const activeBytes = strToU8(`${JSON.stringify({ ...document, session: { ...document.session, playerFile }, players: {} }, null, 2)}\n`);
  const playerBytes = strToU8(`${JSON.stringify({ player: document.players.local, migration: null }, null, 2)}\n`);
  const indexPath = 'Cluster_1/session.json';
  const indexSource = clusterFiles['../../public/saves/Cluster_1/session.json'];
  const indexResponse = indexSource === undefined ? undefined : await fetch(indexSource);
  if (indexResponse && !indexResponse.ok) throw new Error(`Unable to save ${indexPath}: HTTP ${indexResponse.status}`);
  const oldIndex = indexResponse ? await indexResponse.json() as { snapshots?: unknown[] } : {};
  const indexBytes = strToU8(`${JSON.stringify({ activeShard: shard,
    snapshots: [...(oldIndex.snapshots ?? []), { shard, sessionId: sourceSessionId,
      snapshotId: document.snapshot.id, worldFile: snapshotFile, playerFile, migration: null }] }, null, 2)}\n`);
  const entries = await Promise.all(Object.entries(clusterFiles).map(async ([source, url]) => {
    const path = source.slice('../../public/saves/'.length);
    if (path === activePath) return [path, activeBytes] as const;
    if (path === playerPath) return [path, playerBytes] as const;
    if (path === indexPath) return [path, indexBytes] as const;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to save ${path}: HTTP ${response.status}`);
    return [path, new Uint8Array(await response.arrayBuffer())] as const;
  }));
  return zipSync({ ...Object.fromEntries(entries), [activePath]: activeBytes, [snapshotPath]: activeBytes,
    [playerPath]: playerBytes, [indexPath]: indexBytes });
}

export async function downloadClusterSave(json: string, prefab: SaveDocument['world']['prefab']): Promise<void> {
  const bytes = await createClusterSaveZip(json, prefab);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'Cluster_1.zip';
  try {
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    // Let the browser start reading the object URL before releasing it.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

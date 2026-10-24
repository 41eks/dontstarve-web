import { strToU8, zipSync } from 'fflate';
import type { SaveDocument } from './types';

const clusterFiles = import.meta.glob<string>('../../public/saves/Cluster_1/**/*', {
  eager: true, exhaustive: true, query: '?url', import: 'default',
});

/** Preserve every cluster file, replacing the active world's shard with its validated snapshot. */
export async function createClusterSaveZip(json: string, prefab: SaveDocument['world']['prefab']): Promise<Uint8Array<ArrayBuffer>> {
  const activePath = `Cluster_1/${prefab === 'cave' ? 'Caves' : 'Master'}.json`;
  const activeBytes = strToU8(json);
  const entries = await Promise.all(Object.entries(clusterFiles).map(async ([source, url]) => {
    const path = source.slice('../../public/saves/'.length);
    if (path === activePath) return [path, activeBytes] as const;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to save ${path}: HTTP ${response.status}`);
    return [path, new Uint8Array(await response.arrayBuffer())] as const;
  }));
  return zipSync({ ...Object.fromEntries(entries), [activePath]: activeBytes });
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

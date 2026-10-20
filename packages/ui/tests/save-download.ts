import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';

/** Read the active shard from a downloaded cluster through the normal JSON save loader. */
export async function readSaveDownload(path: string | null, shard: 'Caves' | 'Master' = 'Caves'): Promise<string> {
  if (!path) throw new Error('Save download was cancelled');
  const entry = unzipSync(await readFile(path))[`Cluster_1/${shard}.json`];
  if (!entry) throw new Error(`Downloaded cluster is missing ${shard}.json`);
  return strFromU8(entry);
}

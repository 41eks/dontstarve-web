import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';

/** Read the active shard from a downloaded cluster through the normal JSON save loader. */
export async function readSaveDownload(path: string | null, shard: 'Caves' | 'Master' = 'Caves'): Promise<string> {
  if (!path) throw new Error('Save download was cancelled');
  const entries = unzipSync(await readFile(path));
  const entry = entries[`Cluster_1/${shard}.json`];
  if (!entry) throw new Error(`Downloaded cluster is missing ${shard}.json`);
  const world = JSON.parse(strFromU8(entry));
  if (world.session.playerFile) {
    const player = entries[`Cluster_1/${world.session.playerFile}`];
    if (!player) throw new Error(`Downloaded cluster is missing ${world.session.playerFile}`);
    world.players = { local: JSON.parse(strFromU8(player)).player };
    delete world.session.playerFile;
  }
  return JSON.stringify(world);
}

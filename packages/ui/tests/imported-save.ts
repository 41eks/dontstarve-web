import { readFile } from 'node:fs/promises';

/** A combined document for tests that construct a small inline world from an imported shard. */
export async function readImportedSave(shard: 'Master' | 'Caves') {
  const root = new URL('../../../public/saves/Cluster_1/', import.meta.url);
  const world = JSON.parse(await readFile(new URL(`${shard}.json`, root), 'utf8'));
  const file = world.session.playerFile;
  world.players = { local: JSON.parse(await readFile(new URL(file, root), 'utf8')).player };
  delete world.session.playerFile;
  return world;
}

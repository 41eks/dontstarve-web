import { readFileSync } from 'node:fs';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';

/** Combine an imported shard with its independent Session player file for domain tests. */
export function importedSave(shard: 'Master' | 'Caves') {
  const root = new URL('../../../public/saves/Cluster_1/', import.meta.url);
  const text = readFileSync(new URL(`${shard}.json`, root), 'utf8');
  const world = JSON.parse(text) as { session: { playerFile: string } };
  const session = JSON.parse(readFileSync(new URL(world.session.playerFile, root), 'utf8')) as { player: unknown };
  return deserializeSave(text, SAVE_CATALOG, session.player);
}

import { SAVE_CATALOG } from './catalog';
import { deserializeSave, MAX_SAVE_BYTES } from './deserialize';
import type { SaveDocument } from './types';
import { field } from './validation';

export async function loadSaveJson(url: string): Promise<SaveDocument> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to load save ${url}: HTTP ${response.status}`);
  }
  if (Number(response.headers.get('content-length')) > MAX_SAVE_BYTES) {
    throw new Error('Save file is too large');
  }
  const text = await response.text();
  const playerFile = field(field(JSON.parse(text), 'session'), 'playerFile');
  if (playerFile === undefined) {
    return deserializeSave(text, SAVE_CATALOG);
  }
  if (
    typeof playerFile !== 'string' ||
    !/^(?:Master|Caves)\/save\/session\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[0-9]{10}\.json$/.test(playerFile)
  ) {
    throw new Error('Invalid Session player path');
  }
  const clusterRoot = url.indexOf('/Cluster_1/');
  if (clusterRoot < 0) {
    throw new Error('Session player path requires a cluster save');
  }
  const playerUrl = `${url.slice(0, clusterRoot + '/Cluster_1/'.length)}${playerFile}`;
  const playerResponse = await fetch(playerUrl);
  if (!playerResponse.ok) {
    throw new Error(`Unable to load Session player ${playerUrl}: HTTP ${playerResponse.status}`);
  }
  const player = field(JSON.parse(await playerResponse.text()), 'player');
  if (player === undefined) {
    throw new Error(`Missing Session player in ${playerUrl}`);
  }
  return deserializeSave(text, SAVE_CATALOG, player);
}

/** Select a bundled save relative to public/saves, defaulting to Cluster_1/Master.json. */
export function saveUrl(search: string, base: string): string {
  const selected = new URLSearchParams(search).get('save') ?? 'Cluster_1/Master.json';
  if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.json$/.test(selected)) {
    throw new Error('Invalid save path');
  }
  return `${base}saves/${selected}`;
}

/** The cluster Session index selects the shard whose source player file is not migrating. */
async function activeSaveUrl(search: string, base: string): Promise<string> {
  if (new URLSearchParams(search).has('save')) {
    return saveUrl(search, base);
  }
  const response = await fetch(`${base}saves/Cluster_1/session.json`);
  if (!response.ok) {
    return saveUrl(search, base);
  } // Legacy clusters have no Session index.
  const index: unknown = JSON.parse(await response.text());
  const snapshots = field(index, 'snapshots'),
    activeShard = field(index, 'activeShard');
  if (snapshots !== undefined) {
    if (!Array.isArray(snapshots)) {
      throw new Error('Invalid Session snapshot index');
    }
    const latest = new Map<string, SessionSnapshot>();
    for (const entry of snapshots) {
      const snapshot = sessionSnapshot(entry);
      const key = `${snapshot.shard}/${snapshot.sessionId}`;
      const previous = latest.get(key);
      if (!previous || previous.snapshotId < snapshot.snapshotId) {
        latest.set(key, snapshot);
      }
    }
    const active = [...latest.values()].filter(snapshot => snapshot.playerFile && snapshot.migration == null);
    const preferred = active.filter(snapshot => snapshot.shard === activeShard);
    const selected = preferred.length === 1 ? preferred[0] : active.length === 1 ? active[0] : undefined;
    if (!selected) {
      throw new Error(`Expected one active Session player, found ${active.length}`);
    }
    return `${base}saves/Cluster_1/${selected.worldFile}`;
  }
  if (activeShard !== 'Master' && activeShard !== 'Caves') {
    throw new Error('Invalid active Session shard');
  }
  return `${base}saves/Cluster_1/${activeShard}.json`;
}

/** One entry of the cluster's session.json snapshot index. */
interface SessionSnapshot {
  readonly shard: 'Master' | 'Caves';
  readonly sessionId: string;
  readonly snapshotId: string;
  readonly worldFile: string;
  readonly playerFile: unknown;
  readonly migration: unknown;
}

function sessionSnapshot(entry: unknown): SessionSnapshot {
  const shard = field(entry, 'shard'),
    sessionId = field(entry, 'sessionId'),
    snapshotId = field(entry, 'snapshotId');
  const worldFile = field(entry, 'worldFile');
  if (
    (shard !== 'Master' && shard !== 'Caves') ||
    typeof sessionId !== 'string' ||
    !/^[A-Za-z0-9_-]+$/.test(sessionId) ||
    typeof snapshotId !== 'string' ||
    !/^[0-9]{10}$/.test(snapshotId) ||
    typeof worldFile !== 'string' ||
    worldFile !== `${shard}/save/session/${sessionId}/${snapshotId}.json`
  ) {
    throw new Error('Invalid Session snapshot index');
  }
  return {
    shard,
    sessionId,
    snapshotId,
    worldFile,
    playerFile: field(entry, 'playerFile'),
    migration: field(entry, 'migration'),
  };
}

/** The query selecting another shard of the loaded save's cluster, e.g. `Cluster_1/Master.json` + `Caves` -> `Cluster_1/Caves.json`. */
export function shardSaveSearch(search: string, shard: string): string {
  const params = new URLSearchParams(search);
  const directory = (params.get('save') ?? 'Cluster_1/Master.json').split('/').slice(0, -1);
  params.set('save', [...directory, `${shard}.json`].join('/'));
  return `?${params}`;
}

/** A save passed inline as `?saveData=`: base64url-encoded UTF-8 JSON, validated like a bundled file. */
export function decodeSaveData(data: string): SaveDocument {
  if (!/^[A-Za-z0-9_-]*$/.test(data)) {
    throw new Error('Invalid save data');
  }
  const base64 = data
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(data.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  return deserializeSave(new TextDecoder('utf-8', { fatal: true }).decode(bytes), SAVE_CATALOG);
}

/** `?saveData=` takes precedence over `?save=`, so a page can start from a save that is not a bundled file. */
export function loadInitialSave(search: string, base: string): Promise<SaveDocument> {
  const data = new URLSearchParams(search).get('saveData');
  return data === null ? activeSaveUrl(search, base).then(loadSaveJson) : Promise.resolve(decodeSaveData(data));
}

export const initialSave = await loadInitialSave(window.location.search, import.meta.env.BASE_URL);

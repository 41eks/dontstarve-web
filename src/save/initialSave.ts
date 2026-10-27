import { SAVE_CATALOG } from './catalog';
import { deserializeSave, MAX_SAVE_BYTES } from './deserialize';
import type { SaveDocument } from './types';

export async function loadSaveJson(url: string): Promise<SaveDocument> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load save ${url}: HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > MAX_SAVE_BYTES) throw new Error('Save file is too large');
  return deserializeSave(await response.text(), SAVE_CATALOG);
}

/** Select a bundled save relative to public/saves, defaulting to Cluster_1/Master.json. */
export function saveUrl(search: string, base: string): string {
  const selected = new URLSearchParams(search).get('save') ?? 'Cluster_1/Master.json';
  if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.json$/.test(selected)) throw new Error('Invalid save path');
  return `${base}saves/${selected}`;
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
  if (!/^[A-Za-z0-9_-]*$/.test(data)) throw new Error('Invalid save data');
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(data.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  return deserializeSave(new TextDecoder('utf-8', { fatal: true }).decode(bytes), SAVE_CATALOG);
}

/** `?saveData=` takes precedence over `?save=`, so a page can start from a save that is not a bundled file. */
export function loadInitialSave(search: string, base: string): Promise<SaveDocument> {
  const data = new URLSearchParams(search).get('saveData');
  return data === null ? loadSaveJson(saveUrl(search, base)) : Promise.resolve(decodeSaveData(data));
}

export const initialSave = await loadInitialSave(window.location.search, import.meta.env.BASE_URL);

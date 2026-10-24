import { SAVE_CATALOG } from './catalog';
import { deserializeSave, MAX_SAVE_BYTES } from './deserialize';
import type { SaveDocument } from './types';

export async function loadSaveJson(url: string): Promise<SaveDocument> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load save ${url}: HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > MAX_SAVE_BYTES) throw new Error('Save file is too large');
  return deserializeSave(await response.text(), SAVE_CATALOG);
}

/** Select a bundled save relative to public/saves, e.g. ?save=Cluster_1/Caves.json. */
export function saveUrl(search: string, base: string): string {
  const selected = new URLSearchParams(search).get('save') ?? 'initial-world.json';
  if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.json$/.test(selected)) throw new Error('Invalid save path');
  return `${base}saves/${selected}`;
}

export const initialSave = await loadSaveJson(saveUrl(window.location.search, import.meta.env.BASE_URL));

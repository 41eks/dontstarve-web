import { SAVE_CATALOG } from './catalog';
import { deserializeSave, MAX_SAVE_BYTES } from './deserialize';
import type { SaveDocument } from './types';

export async function loadSaveJson(url: string): Promise<SaveDocument> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load save ${url}: HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > MAX_SAVE_BYTES) throw new Error('Save file is too large');
  return deserializeSave(await response.text(), SAVE_CATALOG);
}

export const initialSave = await loadSaveJson(`${import.meta.env.BASE_URL}saves/initial-world.json`);

import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';

/** Input flows spawn their own entities; keep the map/player without loading a developer's stress scene. */
export async function useInteractionSave(page: Page): Promise<void> {
  const save = JSON.parse(await readFile(new URL('../../../public/saves/initial-world copy.json', import.meta.url), 'utf8'));
  save.world.elapsedSeconds = 0;
  save.world.systems = { worldtemperature: { season: 'autumn', seasontemperature: 20,
    phasetemperature: 0, noisetime: 0, daylight: true } };
  for (const prefab of Object.keys(save.world.entities)) save.world.entities[prefab] = [];
  save.world.map.generator.options.size = 96;
  save.world.map.generator.options.moonTreeCount = 0;
  delete save.world.map.tiles;
  save.players.local.transform.position = [0, 0, 0];
  save.players.local.stats = { health: 150, hunger: 150, sanity: 200 };
  for (const container of Object.values(save.players.local.inventory.containers) as { slots: unknown[] }[]) container.slots = [];
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: save }));
}

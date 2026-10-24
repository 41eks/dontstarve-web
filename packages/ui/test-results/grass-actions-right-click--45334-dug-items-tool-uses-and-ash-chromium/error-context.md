# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: grass-actions.spec.ts >> right-click shovels and lights grass, and c_save preserves dug items, tool uses and ash
- Location: tests/grass-actions.spec.ts:6:1

# Error details

```
Error: ENOENT: no such file or directory, open '/home/alex/projects/dontstarve-web/public/saves/initial-world copy.json'
```

# Test source

```ts
  1  | import { readFile } from 'node:fs/promises';
  2  | import type { Page } from '@playwright/test';
  3  | 
  4  | /** Input flows spawn their own entities; keep the map/player without loading a developer's stress scene. */
  5  | export async function useInteractionSave(page: Page): Promise<void> {
> 6  |   const save = JSON.parse(await readFile(new URL('../../../public/saves/initial-world copy.json', import.meta.url), 'utf8'));
     |                           ^ Error: ENOENT: no such file or directory, open '/home/alex/projects/dontstarve-web/public/saves/initial-world copy.json'
  7  |   save.world.elapsedSeconds = 0;
  8  |   save.world.systems = { worldtemperature: { season: 'autumn', seasontemperature: 20,
  9  |     phasetemperature: 0, noisetime: 0, daylight: true } };
  10 |   for (const prefab of Object.keys(save.world.entities)) save.world.entities[prefab] = [];
  11 |   save.world.map.generator.options.size = 96;
  12 |   save.world.map.generator.options.moonTreeCount = 0;
  13 |   delete save.world.map.tiles;
  14 |   save.players.local.transform.position = [0, 0, 0];
  15 |   save.players.local.stats = { health: 150, hunger: 150, sanity: 200 };
  16 |   for (const container of Object.values(save.players.local.inventory.containers) as { slots: unknown[] }[]) container.slots = [];
  17 |   await page.route('**/saves/initial-world.json', route => route.fulfill({ json: save }));
  18 | }
  19 | 
```
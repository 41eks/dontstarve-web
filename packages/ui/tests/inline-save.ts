import type { Page } from '@playwright/test';

/** A held item's GetSaveRecord: its prefab, skin and component records. */
type HeldRecord = { id: string; prefab: string; skinname?: string; components: Record<string, unknown> };

/**
 * A minimal forest save built in the test: one unbroken deciduous map, no entities and an empty player, so a page
 * does not depend on any bundled save file.
 */
export function minimalSave(
  options: {
    position?: [number, number, number];
    stats?: { health: number; hunger: number; sanity: number };
    /** inventory.lua OnSave's items, by one-based slot. */
    items?: Record<string, HeldRecord>;
    /** inventory.lua OnSave's equip, by EQUIPSLOTS name. */
    equip?: Record<string, HeldRecord>;
  } = {},
) {
  return {
    format: 'three-roaming-save',
    schemaVersion: 1,
    gameVersion: '0.0.0',
    session: { id: 'test-session', createdAt: '2026-01-01T00:00:00.000Z' },
    snapshot: { id: '0000000001', parentId: null, savedAt: '2026-01-01T00:00:00.000Z', reason: 'manual' },
    world: {
      shardId: 'master',
      prefab: 'forest',
      elapsedSeconds: 0,
      systems: {},
      map: {
        kind: 'generated',
        generator: { id: 'test-world', options: { size: 1000, moonTreeCount: 0, moonTreeExclusionRadiusSquared: 0 } },
      },
      entities: {},
    },
    players: {
      local: {
        prefab: 'wilson',
        shardId: 'master',
        transform: { position: options.position ?? [0, 0, 0], rotationY: 0 },
        ...(options.stats ? { stats: options.stats } : {}),
        inventory: { items: options.items ?? {}, equip: options.equip ?? {} },
        builder: { bufferedBuilds: [] },
      },
    },
  };
}

/**
 * Starts the game from `save`, served as if it were a bundled save file. An exported save carries the whole map and is
 * too long for `savePageUrl`: the dev server answers 431 and the test page never loads.
 */
export async function gotoSave(page: Page, save: unknown): Promise<void> {
  const file = 'inline-test.json';
  await page.unroute(`**/saves/${file}`);
  await page.route(`**/saves/${file}`, route => route.fulfill({ json: save }));
  await page.goto(`/tests/dst-lighting.html?save=${file}`);
}

/** The page URL that starts the game from `save`, passed inline as base64url JSON in `?saveData=`. */
export function savePageUrl(save: unknown, page = '/tests/dst-lighting.html'): string {
  return `${page}?saveData=${Buffer.from(JSON.stringify(save)).toString('base64url')}`;
}

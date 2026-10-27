type SavedSlot = { slotKey: string; item: Record<string, unknown> };

/**
 * A minimal forest save built in the test: one unbroken deciduous map, no entities and an empty player, so a page
 * does not depend on any bundled save file.
 */
export function minimalSave(options: {
  position?: [number, number, number];
  stats?: { health: number; hunger: number; sanity: number };
  inventory?: SavedSlot[];
  equipment?: SavedSlot[];
} = {}) {
  return {
    format: 'three-roaming-save', schemaVersion: 1, gameVersion: '0.0.0',
    session: { id: 'test-session', createdAt: '2026-01-01T00:00:00.000Z' },
    snapshot: { id: '0000000001', parentId: null, savedAt: '2026-01-01T00:00:00.000Z', reason: 'manual' },
    world: {
      shardId: 'master', prefab: 'forest', elapsedSeconds: 0, systems: {},
      map: { kind: 'generated', generator: { id: 'test-world', options: { size: 1000, moonTreeCount: 0, moonTreeExclusionRadiusSquared: 0 } } },
      entities: {},
    },
    players: {
      local: {
        prefab: 'wilson', shardId: 'master',
        transform: { position: options.position ?? [0, 0, 0], rotationY: 0 },
        ...(options.stats ? { stats: options.stats } : {}),
        inventory: {
          containers: {
            'player:inventory': { slotCount: 15, slots: options.inventory ?? [] },
            'player:equipment': { slotCount: 3, slots: options.equipment ?? [] },
            'player:cursor': { slotCount: 1, slots: [] },
          },
          bufferedBuilds: [],
        },
      },
    },
  };
}

/** The page URL that starts the game from `save`, passed inline as base64url JSON in `?saveData=`. */
export function savePageUrl(save: unknown, page = '/tests/dst-lighting.html'): string {
  return `${page}?saveData=${Buffer.from(JSON.stringify(save)).toString('base64url')}`;
}

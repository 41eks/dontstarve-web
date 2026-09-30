import type { InventoryStack } from '@three-roaming/inventory';

export interface SavedTransform {
  position: [number, number, number];
  rotationY: number;
}

export interface SavedContainer {
  slotCount: number;
  slots: { slotKey: string; item: InventoryStack }[];
}

export interface SavedEntity {
  id: string;
  transform: SavedTransform;
  components: {
    building?: { state: 'idle' | 'closed' | 'open'; skinId?: string };
    container?: SavedContainer;
    stack?: InventoryStack;
    health?: { current: number; maximum: number };
  };
}

export interface SavedInventory {
  containers: Record<string, SavedContainer>;
  bufferedBuilds: { recipeId: string; skinId?: string }[];
}

export interface SavedPlayer {
  prefab: 'wilson';
  shardId: string;
  transform: SavedTransform;
  inventory: SavedInventory;
  stats?: { health: number; hunger: number; sanity: number };
}

export interface SaveDocument {
  format: 'three-roaming-save';
  schemaVersion: 1;
  gameVersion: string;
  session: { id: string; createdAt: string };
  snapshot: { id: string; parentId: string | null; savedAt: string; reason: string };
  world: {
    shardId: string;
    prefab: 'forest';
    seed?: string;
    elapsedSeconds: number;
    systems: {
      clock?: { day: number; phase: 'day' | 'dusk' | 'night' | 'full_moon'; phaseProgress: number };
      season?: { name: 'autumn' | 'winter' | 'spring' | 'summer'; daysRemaining: number };
      random?: { algorithm: 'xoshiro128ss'; state: number[] };
    };
    map: {
      kind: 'generated';
      generator: {
        id: string;
        seed?: string;
        options: { size: number; moonTreeCount: number; moonTreeExclusionRadiusSquared: number };
      };
    };
    entities: Record<string, SavedEntity[]>;
  };
  players: { local: SavedPlayer };
}

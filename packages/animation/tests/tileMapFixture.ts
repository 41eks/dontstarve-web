import { afterEach, beforeEach } from 'vitest';
import { Vector3 } from 'three';
import { createSignal } from '../../signals/src/signal';
import { BindTileMapSize, DisposeTileStates, GetTileStateAtPoint } from '../../componets/src/tileManager';
import type { SaveDocument } from '../../../src/save/types';

export function testMap(size = 1008): SaveDocument['world']['map'] {
  return { kind: 'generated', generator: { id: 'moon-forest',
    options: { size, moonTreeCount: 0, moonTreeExclusionRadiusSquared: 0 } } };
}

/** Standalone component tests inject their map explicitly, just as a world does. */
export function useTestTileMap(size = 1008): void {
  let unbind: () => void;
  beforeEach(() => { unbind = BindTileMapSize(size); });
  afterEach(() => unbind());
}

/** A player-position tickingarea for tests; `visit` moves the player, lets the area settle, then reconciles a forest. */
export function createTestArea() {
  const player = createSignal(new Vector3());
  const query = GetTileStateAtPoint(player);
  query(createSignal(0)); // The first query builds the grid in a later task; later targets read it at once.
  return {
    query,
    ready: new Promise<void>(resolve => setTimeout(resolve, 0)),
    async visit(position: Vector3, forest: { updateNearby(): void }) {
      player.set(position.clone());
      await new Promise(resolve => setTimeout(resolve, 0));
      forest.updateNearby();
    },
    dispose: () => DisposeTileStates(player),
  };
}

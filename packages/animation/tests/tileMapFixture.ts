import { afterEach, beforeEach } from 'vitest';
import { BindTileMapSize } from '../../componets/src/tileManager';
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

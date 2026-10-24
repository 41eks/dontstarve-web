import definitions from './groundTiles.json';

export interface GroundTileQuadCell { col: number; row: number; variant: number }
export interface GroundTileCellBounds { minCol: number; minRow: number; maxCol: number; maxRow: number }

const OCEAN_COASTAL = definitions.OCEAN_COASTAL.tileId;
export const OCEAN_COASTAL_TILE: number = OCEAN_COASTAL;
const landTiles = new Set(Object.values(definitions).map(definition => definition.tileId).filter(id => id !== OCEAN_COASTAL));

/** tiledefs.lua: INVALID and the impassable range have no land surface. */
export function isLandTile(tileId: number): boolean {
  return landTiles.has(tileId);
}

const MIXED_VARIANTS: Readonly<Record<number, Readonly<Record<number, number>>>> = {
  1: { 2: 36, 4: 44, 6: 40 }, 2: { 4: 33, 8: 41, 12: 37 },
  4: { 1: 42, 8: 34, 9: 38 }, 8: { 1: 35, 2: 43, 3: 39 },
  3: { 4: 45 }, 6: { 8: 46 }, 12: { 1: 48 }, 9: { 2: 47 },
};

/** The 48 source atlas cells: full, cardinal strips, diagonal corners and mixtures.
 * Cardinal bits: west/north/east/south = 1/2/4/8.
 * Diagonal bits: northwest/northeast/southeast/southwest = 1/2/4/8.
 * A cardinal strip already covers both adjacent corners; discard those bits.
 */
export function groundTileVariant(own: boolean, cardinal: number, diagonal: number): number {
  if (own) return 1;
  if (cardinal & 1) diagonal &= ~9;
  if (cardinal & 2) diagonal &= ~3;
  if (cardinal & 4) diagonal &= ~6;
  if (cardinal & 8) diagonal &= ~12;
  if (!cardinal) return 17 + diagonal;
  if (!diagonal) return 1 + cardinal;
  return MIXED_VARIANTS[cardinal][diagonal];
}

/** Land render masks, including skirts in neighbouring cells, for the tile types in `layerIds`.
 * Pure over a tile accessor so the terrain and the minimap worker select identical variants.
 */
export function groundTileLayerQuads(
  tileAt: (col: number, row: number) => number,
  layerIds: Iterable<number>,
  range: { min: number; max: number },
  bounds?: GroundTileCellBounds,
): Map<number, GroundTileQuadCell[]> {
  const layers = new Map<number, GroundTileQuadCell[]>([...layerIds].map(id => [id, []]));
  const { min, max } = range;
  const left = Math.max(min, bounds?.minCol ?? min), top = Math.max(min, bounds?.minRow ?? min);
  const right = Math.min(max, bounds?.maxCol ?? max), bottom = Math.min(max, bounds?.maxRow ?? max);
  if (left >= right || top >= bottom) return layers;
  // Read the halo once. Only tile types present in these nine cells can
  // contribute a mask, regardless of how many art layers the world has.
  const width = right - left + 2;
  const ids = new Uint16Array(width * (bottom - top + 2));
  for (let row = top - 1; row <= bottom; row++) for (let col = left - 1; col <= right; col++) {
    ids[(row - top + 1) * width + col - left + 1] = tileAt(col, row);
  }
  const candidates = new Set<number>();
  for (let row = top; row < bottom; row++) for (let col = left; col < right; col++) {
    const at = (row - top + 1) * width + col - left + 1, current = ids[at];
    if (!isLandTile(current) && current !== OCEAN_COASTAL) continue;
    const neighbours = [ids[at - 1], ids[at - width], ids[at + 1], ids[at + width],
      ids[at - width - 1], ids[at - width + 1], ids[at + width + 1], ids[at + width - 1]];
    candidates.clear();
    candidates.add(current);
    for (const id of neighbours) candidates.add(id);
    for (const tileId of candidates) {
      const quads = layers.get(tileId);
      if (!quads) continue;
      let cardinal = 0, diagonal = 0;
      for (let i = 0; i < 4; i++) {
        if (neighbours[i] === tileId) cardinal |= 1 << i;
        if (neighbours[i + 4] === tileId) diagonal |= 1 << i;
      }
      const variant = groundTileVariant(current === tileId, cardinal, diagonal);
      if (variant !== 17) quads.push({ col, row, variant });
    }
  }
  return layers;
}

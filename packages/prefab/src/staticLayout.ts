import { TILE_SIZE, type Vector2 } from './tile';
import layouts from './staticLayouts.json' with { type: 'json' };

export type StaticLayoutId = keyof typeof layouts;
export type StaticLayoutTile = 'GRASS' | 'WOODFLOOR';

export interface PlacedStaticLayout {
  /** Terrain cells, each the center of one world tile. */
  tiles: { position: Vector2; tile: StaticLayoutTile }[];
  /** Placed prefabs other than the layout's anchor entity, at their ground points. */
  objects: { prefab: string; position: Vector2 }[];
}

/**
 * object_layout.lua ReserveAndPlaceLayout for a static layout with `layout_position = CENTER`: the layout
 * is centered on a tile corner, ground[row][column] fills the tiles around it and each object sits at its
 * tile-unit offset (map/static_layout.lua). The authored orientation is used instead of worldgen's random flip.
 * The anchor entity (the pigking) is kept where the save puts it; the layout snaps to its nearest tile corner.
 */
export function placeStaticLayout(id: StaticLayoutId, anchor: Vector2, anchorPrefab: string): PlacedStaticLayout {
  const layout = layouts[id];
  const corner = { x: Math.round(anchor.x / TILE_SIZE) * TILE_SIZE, z: Math.round(anchor.z / TILE_SIZE) * TILE_SIZE };
  const half = layout.ground.length / 2;
  const tiles: PlacedStaticLayout['tiles'] = [];
  layout.ground.forEach((row, rowIndex) => row.forEach((name, columnIndex) => {
    if (name === null) return;
    if (name !== 'GRASS' && name !== 'WOODFLOOR') throw new Error(`Unsupported static layout tile ${name}`);
    tiles.push({ tile: name, position: {
      x: corner.x + (columnIndex - half + .5) * TILE_SIZE, z: corner.z + (rowIndex - half + .5) * TILE_SIZE } });
  }));
  const objects = layout.objects.filter(object => object.prefab !== anchorPrefab).map(object => ({
    prefab: object.prefab, position: { x: corner.x + object.x * TILE_SIZE, z: corner.z + object.y * TILE_SIZE } }));
  return { tiles, objects };
}

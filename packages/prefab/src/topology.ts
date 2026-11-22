import { GROUND_TILE_DEFINITIONS } from './groundTiles';
import { dstUnitsToWorld } from '@dontstarve-web/animation/units';
import { TILE_SIZE, type Vector2 } from './tile';
import { isLandTile, WORLD_TILES, type TurfMap } from './turfMap';

/** One TheWorld.topology.nodes entry: node.x / node.y are the centre's world X and Z, with its worldgen NODE_TYPE and tags. */
export interface TopologyNode {
  readonly x: number;
  readonly z: number;
  readonly type: number;
  /** node.tags, such as "lunacyarea"; omitted when the node has none. Worldgen leaves a few numbers among them. */
  readonly tags?: readonly (string | number)[];
}

/**
 * The map's nodeidtilemap in signed grid cells: `width` × `height` cells from (`col`, `row`), row by row, as
 * [nodeId, count] runs. Node IDs index topology.nodes from 1; 0 is no node.
 */
export interface NodeIdGridSave {
  readonly col: number;
  readonly row: number;
  readonly width: number;
  readonly height: number;
  readonly runs: readonly number[];
}

export interface TopologySave {
  readonly nodes: readonly TopologyNode[];
  readonly nodeIdGrid?: NodeIdGridSave;
}

/** TheWorld.topology and the map's per-tile node IDs (Map:GetNodeIdAtPoint). */
export class WorldTopology {
  readonly nodes: readonly TopologyNode[];
  private readonly col: number;
  private readonly row: number;
  private readonly width: number;
  private readonly height: number;
  private readonly ids: Uint16Array;

  constructor(save: TopologySave = { nodes: [] }) {
    this.nodes = save.nodes;
    const grid = save.nodeIdGrid;
    this.col = grid?.col ?? 0;
    this.row = grid?.row ?? 0;
    this.width = grid?.width ?? 0;
    this.height = grid?.height ?? 0;
    this.ids = new Uint16Array(this.width * this.height);
    let offset = 0;
    for (let index = 0; grid && index < grid.runs.length; index += 2) {
      const [id, count] = [grid.runs[index], grid.runs[index + 1]];
      this.ids.fill(id, offset, offset + count);
      offset += count;
    }
  }

  /** Map:GetNodeIdAtPoint: the node ID of the tile under the point, 0 outside the grid. */
  GetNodeIdAtPoint(point: Vector2): number {
    const c = Math.floor(point.x / TILE_SIZE) - this.col,
      r = Math.floor(point.z / TILE_SIZE) - this.row;
    return c >= 0 && c < this.width && r >= 0 && r < this.height ? this.ids[r * this.width + c] : 0;
  }

  /** TheWorld.topology.nodes[index], which is nil for 0 and for IDs whose node worldgen removed. */
  node(index: number): TopologyNode | undefined {
    return index > 0 ? this.nodes[index - 1] : undefined;
  }
}

const RENDER_LAYERS = new Map<number, number>(
  Object.values(GROUND_TILE_DEFINITIONS).map(tile => [tile.tileId, tile.renderOrder + 1]),
);

/** GetTileInfo(tile)._render_layer: world.lua numbers GroundTiles.ground from 1; a tile without ground layer is 0. */
function renderLayer(tileId: number): number {
  return RENDER_LAYERS.get(tileId) ?? 0;
}

/**
 * map.lua FindVisualNodeAtPoint_TestArea: the highest-layer tile of the wanted kind in a 3 × 3 sample `r` DST units
 * apart.
 */
function testArea(map: TurfMap, x: number, z: number, onLand: boolean, r: number): Vector2 | undefined {
  let best: { tile: number; layer: number; x: number; z: number } | undefined;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const point = { x: x + dstUnitsToWorld(dx * r), z: z + dstUnitsToWorld(dz * r) };
      const tile = map.getTileAtWorld(point);
      if (onLand === isLandTile(tile)) {
        const layer = renderLayer(tile);
        if (layer > (best?.layer ?? -1)) {
          best = { tile, layer, ...point };
        }
      }
    }
  }
  return best && best.tile !== WORLD_TILES.INVALID ? best : undefined;
}

/**
 * Map:FindVisualNodeAtPoint: the node of the land tile the point visually stands on, sampling outwards for a point on
 * the land's overhang; 0 (no node) over water.
 */
export function FindVisualNodeAtPoint(
  map: TurfMap,
  topology: WorldTopology,
  point: Vector2,
): { node: TopologyNode | undefined; index: number } {
  const onLand = map.isVisualGroundAtPoint(point);
  const best =
    testArea(map, point.x, point.z, onLand, 0.95) ??
    testArea(map, point.x, point.z, onLand, 1.25) ??
    testArea(map, point.x, point.z, onLand, 1.5);
  const index = onLand && best ? topology.GetNodeIdAtPoint(best) : 0;
  return { node: topology.node(index), index };
}

import type * as THREE from 'three';
import {
  FALLOFF_EDGES,
  type FalloffEdge,
  type GroundCellBounds,
  type GroundLayerDeclaration,
  type GroundTerrain,
  type GroundTileArt,
} from '@dontstarve-web/display';
import { TILE_SIZE, snapToTileCenter, type Vector2 } from './tile';
import {
  GROUND_FALLOFF_ART,
  GROUND_TILE_DEFINITIONS,
  groundTileMinimapArt,
  groundTileVariant,
  groundTileArt,
  type GroundTileMinimapArt,
  type GroundTileQuad,
  type GroundTileName,
} from './groundTiles';
import { groundTileLayerQuads, isLandTile, isOceanTile } from './groundTileQuads';

// tiledefs.lua preserves these vanilla GROUND IDs in WORLD_TILES.
export const WORLD_TILES = {
  ...(Object.fromEntries(Object.entries(GROUND_TILE_DEFINITIONS).map(([name, tile]) => [name, tile.tileId])) as {
    readonly [K in GroundTileName]: (typeof GROUND_TILE_DEFINITIONS)[K]['tileId'];
  }),
  INVALID: 0,
  IMPASSABLE: 1,
  FAKE_GROUND: 200,
  DIRT: 4,
  GRASS: GROUND_TILE_DEFINITIONS.GRASS.tileId,
  WOODFLOOR: GROUND_TILE_DEFINITIONS.WOODFLOOR.tileId,
  DECIDUOUS: GROUND_TILE_DEFINITIONS.DECIDUOUS.tileId,
  FARMING_SOIL: GROUND_TILE_DEFINITIONS.FARMING_SOIL.tileId,
  OCEAN_COASTAL: GROUND_TILE_DEFINITIONS.OCEAN_COASTAL.tileId,
  MONKEY_DOCK: GROUND_TILE_DEFINITIONS.MONKEY_DOCK.tileId,
} as const;

export { isLandTile, isOceanTile };

/** minimapocean.ksh draws every tile with ocean colours. */
const MINIMAP_OCEAN_TILE_IDS: ReadonlySet<number> = new Set(
  Object.values(GROUND_TILE_DEFINITIONS).flatMap(tile => ('oceanColours' in tile ? [tile.tileId] : [])),
);

const OCEAN_COLOURS = new Map(
  Object.values(GROUND_TILE_DEFINITIONS).flatMap(tile =>
    'oceanColours' in tile ? [[tile.tileId, tile.oceanColours] as const] : [],
  ),
);

export interface TurfTileSave {
  /** Signed grid coordinates: floor(world x/z / TILE_SIZE). */
  col: number;
  row: number;
  tileId: number;
  /** undertile component: the tile restored when a farm soil is dug or a dock is destroyed. */
  underTileId?: number;
  /** A ROPE_BRIDGE tile's ropebridgemanager data; the bridge covers the void, which needs no underTileId. */
  ropeBridge?: import('../../componets/src/ropebridgemanager').RopeBridgeTileSave;
}

/** GROUND_INVISIBLETILES (isinvisibletile): the renderer skips their top and skirt. */
const INVISIBLE_TILE_IDS: ReadonlySet<number> = new Set(
  Object.values(GROUND_TILE_DEFINITIONS).flatMap(tile => ('invisible' in tile && tile.invisible ? [tile.tileId] : [])),
);

/** TileGroups.LandTilesWithDefaultFalloff: land without docks and invisible tiles (world.lua AddInvalidTile). */
function hasDefaultFalloff(tileId: number): boolean {
  return isLandTile(tileId) && tileId !== WORLD_TILES.MONKEY_DOCK && !INVISIBLE_TILE_IDS.has(tileId);
}

const MAX_GROUND_RENDER_ORDER = Math.max(...Object.values(GROUND_TILE_DEFINITIONS).map(tile => tile.renderOrder));

/** LAYER_GROUND: stay within [-1, -0.6), below snow (-0.55) and LAYER_BACKGROUND decor (-0.5). */
function groundLayerRenderOrder(name: GroundTileName): number {
  return -1 + (0.4 * GROUND_TILE_DEFINITIONS[name].renderOrder) / (MAX_GROUND_RENDER_ORDER + 1);
}

/** Inclusive-exclusive signed cells; omitted on a full terrain/resource change. */
export interface TerrainCellBounds {
  minCol: number;
  minRow: number;
  maxCol: number;
  maxRow: number;
}

/** Generated terrain plus authoritative saved tile overrides and TERRAFORM changes.
 * Like world.lua, it declares the ground render layers, cliffs and ocean and owns the tiles; GroundDisplay draws them.
 */
export class TurfMap implements GroundTerrain {
  readonly size: number;
  readonly tileSize = TILE_SIZE;
  readonly defaultTileId: number;
  private readonly originalTiles = new Map<string, number>();
  private readonly dugTiles = new Map<string, TurfTileSave>();
  readonly falloffArt = GROUND_FALLOFF_ART;
  private readonly listeners = new Set<(world: Vector2, originalTileId: number) => void>();
  private readonly terrainListeners = new Set<(bounds?: TerrainCellBounds) => void>();
  private terrainNamesCache?: GroundTileName[];
  /** Effective tile id (dug override, else generated, else default) per cell; the maps stay authoritative. */
  private readonly cells: Uint16Array;
  private readonly cellMin: number;
  private readonly cellWidth: number;
  /** Cells holding a generated or saved tile; the base plane draws the rest, so deciduous skirts stay near them. */
  private readonly keyed: Uint8Array;

  private terrainNames(): GroundTileName[] {
    if (this.terrainNamesCache) {
      return this.terrainNamesCache;
    }
    const ids = new Set([...this.dugTiles.values()].map(tile => tile.tileId));
    return (this.terrainNamesCache = (Object.keys(GROUND_TILE_DEFINITIONS) as GroundTileName[]).filter(
      name =>
        ['DIRT', 'DECIDUOUS', 'GRASS', 'WOODFLOOR', 'FARMING_SOIL', 'MONKEY_DOCK', 'OCEAN_COASTAL'].includes(name) ||
        ids.has(WORLD_TILES[name]),
    ));
  }

  constructor(size: number, savedTiles: readonly TurfTileSave[] = [], defaultTileId: number = WORLD_TILES.DECIDUOUS) {
    this.size = size;
    this.defaultTileId = defaultTileId;
    const { min, max } = this.cellRange();
    this.cellMin = min;
    this.cellWidth = max - min;
    this.cells = new Uint16Array(this.cellWidth * this.cellWidth).fill(defaultTileId);
    this.keyed = new Uint8Array(this.cellWidth * this.cellWidth);
    for (const tile of savedTiles) {
      this.setDug(tile.col, tile.row, { ...tile });
    }
  }

  private setDug(col: number, row: number, tile: TurfTileSave): void {
    this.dugTiles.set(`${col},${row}`, tile);
    this.markKeyed(col, row);
    this.writeCell(col, row, tile.tileId);
  }

  private markKeyed(col: number, row: number): void {
    const c = col - this.cellMin,
      r = row - this.cellMin;
    if (c >= 0 && c < this.cellWidth && r >= 0 && r < this.cellWidth) {
      this.keyed[r * this.cellWidth + c] = 1;
    }
  }

  private isKeyed(col: number, row: number): boolean {
    const c = col - this.cellMin,
      r = row - this.cellMin;
    return c >= 0 && c < this.cellWidth && r >= 0 && r < this.cellWidth && this.keyed[r * this.cellWidth + c] === 1;
  }

  private writeCell(col: number, row: number, tileId: number): void {
    const c = col - this.cellMin,
      r = row - this.cellMin;
    if (c >= 0 && c < this.cellWidth && r >= 0 && r < this.cellWidth) {
      this.cells[r * this.cellWidth + c] = tileId;
    }
  }

  private key(world: Vector2): string {
    return `${Math.floor(world.x / TILE_SIZE)},${Math.floor(world.z / TILE_SIZE)}`;
  }

  getTileAtWorld(world: Vector2): number {
    if (
      !Number.isFinite(world.x) ||
      !Number.isFinite(world.z) ||
      world.x < -this.size / 2 ||
      world.x >= this.size / 2 ||
      world.z < -this.size / 2 ||
      world.z >= this.size / 2
    ) {
      return WORLD_TILES.INVALID;
    }
    const key = this.key(world);
    return this.dugTiles.get(key)?.tileId ?? this.originalTiles.get(key) ?? this.defaultTileId;
  }

  /** Registers generated terrain without overwriting saved dug tiles. */
  setOriginalTile(world: Vector2, tileId: number): void {
    this.setOriginalTiles([{ position: world, tileId }]);
  }

  /** Apply a generated layout before rebuilding. Saved overrides and unchanged cells need no visual update. */
  setOriginalTiles(tiles: Iterable<{ position: Vector2; tileId: number }>): void {
    let bounds: TerrainCellBounds | undefined;
    for (const { position, tileId } of tiles) {
      const col = Math.floor(position.x / TILE_SIZE),
        row = Math.floor(position.z / TILE_SIZE),
        key = `${col},${row}`;
      this.originalTiles.set(key, tileId);
      this.markKeyed(col, row);
      const effective = this.dugTiles.get(key)?.tileId ?? tileId;
      if (this.tileAt(col, row) === effective) {
        continue;
      }
      this.writeCell(col, row, effective);
      if (!bounds) {
        bounds = { minCol: col, minRow: row, maxCol: col + 1, maxRow: row + 1 };
      } else {
        bounds.minCol = Math.min(bounds.minCol, col);
        bounds.minRow = Math.min(bounds.minRow, row);
        bounds.maxCol = Math.max(bounds.maxCol, col + 1);
        bounds.maxRow = Math.max(bounds.maxRow, row + 1);
      }
    }
    if (bounds) {
      this.rebuildGeometry(bounds);
    }
  }

  /** Inclusive-exclusive signed cell range [min, max) covering the generated world on both axes. */
  cellRange(): { min: number; max: number } {
    return { min: Math.floor(-this.size / 2 / TILE_SIZE), max: Math.ceil(this.size / 2 / TILE_SIZE) };
  }

  /** Tile id of a signed grid cell; INVALID outside the world. */
  tileIdAtCell(col: number, row: number): number {
    return this.tileAt(col, row);
  }

  isVoidAtCell(col: number, row: number): boolean {
    const tile = this.tileAt(col, row);
    return !isLandTile(tile) && !isOceanTile(tile);
  }

  /** undertile:GetTileUnderneath for a signed grid cell. */
  underTileAtCell(col: number, row: number): number | undefined {
    return this.dugTiles.get(`${col},${row}`)?.underTileId;
  }

  /** Signed cells currently holding `tileId` as a saved override. */
  cellsOfTile(tileId: number): [number, number][] {
    return [...this.dugTiles.values()].filter(tile => tile.tileId === tileId).map(tile => [tile.col, tile.row]);
  }

  /** Map:SetTile plus the undertile component's record (dock tiles keep the ocean tile they cover). */
  setTile(col: number, row: number, tileId: TurfTileSave['tileId'], underTileId?: TurfTileSave['underTileId']): void {
    if (this.tileAt(col, row) === WORLD_TILES.INVALID) {
      throw new RangeError('Tile is outside the world');
    }
    this.setDug(col, row, { col, row, tileId, ...(underTileId === undefined ? {} : { underTileId }) });
    this.rebuildGeometry({ minCol: col, minRow: row, maxCol: col + 1, maxRow: row + 1 });
  }

  /** One minimap render layer per land tile type of the map; the minimap loads the art. */
  tileLayerArt(): Map<number, GroundTileMinimapArt> {
    return new Map(
      this.terrainNames()
        .filter(name => !isOceanTile(WORLD_TILES[name]))
        .map(name => [WORLD_TILES[name], groundTileMinimapArt(name)]),
    );
  }

  /** Land render masks, including skirts in neighbouring cells. UI consumes the
   * same eight-neighbour variant selection as the world terrain renderer.
   */
  tileLayerQuads(bounds?: TerrainCellBounds): ReadonlyMap<number, readonly GroundTileQuad[]> {
    const ids = this.terrainNames()
      .filter(name => !isOceanTile(WORLD_TILES[name]))
      .map(name => WORLD_TILES[name]);
    return groundTileLayerQuads((col, row) => this.tileAt(col, row), ids, this.cellRange(), bounds);
  }

  /** Tiles of the separate minimapocean.ksh pass. */
  minimapOceanTileIds(): ReadonlySet<number> {
    return MINIMAP_OCEAN_TILE_IDS;
  }

  tileCenter(world: Vector2): Vector2 {
    return snapToTileCenter(world);
  }

  /** Map:IsOceanTileAtPoint: the tile is in the ocean range, overhang included. */
  isOceanAtWorld(world: Vector2): boolean {
    return isOceanTile(this.getTileAtWorld(world));
  }

  /**
   * map.lua Map:IsOceanAtPoint: an ocean tile that the land's overhang does not cover. Boats are not ported, so no
   * platform is ever at the point.
   */
  isOceanAtPoint(world: Vector2): boolean {
    return this.isOceanAtWorld(world) && !this.isVisualGroundAtPoint(world);
  }

  /**
   * Map:IsVisualGroundAtPoint, as the engine computes it (dontstarve_steam_x64.exe 0x1400c8a50): a land tile, or the
   * part of a non-land tile the land beside it overhangs. A land side neighbour covers the quarter of the tile next to
   * it; a land corner, or a corner whose two sides are land, covers a diagonal band across that corner.
   */
  isVisualGroundAtPoint(world: Vector2): boolean {
    const tile = this.getTileAtWorld(world);
    if (tile === WORLD_TILES.INVALID) {
      return false;
    }
    if (isLandTile(tile)) {
      return true;
    }
    const col = Math.floor(world.x / TILE_SIZE),
      row = Math.floor(world.z / TILE_SIZE);
    const land = (dc: number, dr: number) => isLandTile(this.tileAt(col + dc, row + dr));
    // The engine's neighbour mask, in DST's tile axes: rows run against DST's y (the imported map negates z), so its
    // y - 1 neighbour is row + 1.
    const mask =
      (land(0, 1) ? 0x1 : 0) |
      (land(1, 0) ? 0x2 : 0) |
      (land(0, -1) ? 0x4 : 0) |
      (land(-1, 0) ? 0x8 : 0) |
      (land(1, 1) ? 0x10 : 0) |
      (land(1, -1) ? 0x20 : 0) |
      (land(-1, -1) ? 0x40 : 0) |
      (land(-1, 1) ? 0x80 : 0);
    if (mask === 0) {
      return false;
    }
    // The point within the tile, 0..1 along DST's x and y.
    const x = world.x / TILE_SIZE - col,
      y = 1 - (world.z / TILE_SIZE - row);
    if (
      (mask & 0x1 && y <= 0.25) ||
      (mask & 0x4 && y >= 0.75) ||
      (mask & 0x8 && x <= 0.25) ||
      (mask & 0x2 && x >= 0.75)
    ) {
      return true;
    }
    // Each corner: both sides and the corner land, the corner alone, or both sides without the corner.
    const low = mask & 0x89,
      right = mask & 0x13,
      up = mask & 0x4c,
      far = mask & 0x26;
    return (
      (low === 0x89 && 0.75 - x > y) ||
      (right === 0x13 && x - 0.25 > y) ||
      (up === 0x4c && y > x + 0.25) ||
      (far === 0x26 && y > 1.25 - x) ||
      (low === 0x80 && 0.25 - x >= y) ||
      (right === 0x10 && x - 0.75 >= y) ||
      (up === 0x40 && y >= x + 0.75) ||
      (far === 0x20 && y >= 1.75 - x) ||
      (low === 0x9 && 0.75 - x > y) ||
      (right === 0x3 && x - 0.25 > y) ||
      (up === 0xc && y > x + 0.25) ||
      (far === 0x6 && y > 1.25 - x)
    );
  }

  /** Map:IsLandTileAtPoint, and Map:IsAboveGroundAtPoint without allow_water: the tile is land, overhang excluded. */
  isLandTileAtPoint(world: Vector2): boolean {
    return isLandTile(this.getTileAtWorld(world));
  }

  /**
   * map.lua Map:IsPassableAtPoint without allow_water: land, or the land's overhang into a neighbouring tile
   * (Map:IsVisualGroundAtPoint). Boats are not ported, so no walkable platform adds to it.
   */
  isPassableAtPoint(world: Vector2): boolean {
    return this.isVisualGroundAtPoint(world);
  }

  /**
   * falloffdefs.lua FALLOFF: a LandTilesWithDefaultFalloff cell (not a dock or an invisible tile) gets a cliff on each
   * side whose neighbour is void or an invisible tile, such as a rope bridge over the abyss. INVISIBLE's
   * invisible_falloff on the invisible tile's own sides is not drawn.
   */
  falloffEdges(bounds?: GroundCellBounds): FalloffEdge[] {
    const edges: FalloffEdge[] = [];
    const { min, max } = this.cellRange();
    for (let row = Math.max(min, bounds?.minRow ?? min); row < Math.min(max, bounds?.maxRow ?? max); row++) {
      for (let col = Math.max(min, bounds?.minCol ?? min); col < Math.min(max, bounds?.maxCol ?? max); col++) {
        if (!hasDefaultFalloff(this.tileAt(col, row))) {
          continue;
        }
        FALLOFF_EDGES.forEach(({ dx, dz }, edge) => {
          const neighbour = this.tileAt(col + dx, row + dz);
          if (this.isVoidAtCell(col + dx, row + dz) || INVISIBLE_TILE_IDS.has(neighbour)) {
            edges.push({ col, row, edge });
          }
        });
      }
    }
    return edges;
  }

  /** The ocean pass is drawn when the saved map holds ocean tiles. */
  oceanArt(): GroundTileArt | undefined {
    return [...this.dugTiles.values()].some(tile => isOceanTile(tile.tileId))
      ? groundTileArt('OCEAN_COASTAL')
      : undefined;
  }

  /** The saved ocean tiles inside the world, or only those within `bounds`. */
  *oceanSurfaceCells(bounds?: GroundCellBounds): Iterable<readonly [number, number]> {
    const isSurface = (tile: TurfTileSave | undefined): tile is TurfTileSave =>
      tile !== undefined && isOceanTile(tile.tileId) && this.tileAt(tile.col, tile.row) !== WORLD_TILES.INVALID;
    if (!bounds) {
      for (const tile of this.dugTiles.values()) {
        if (isSurface(tile)) {
          yield [tile.col, tile.row];
        }
      }
      return;
    }
    const { min, max } = this.cellRange();
    for (let row = Math.max(min, bounds.minRow); row < Math.min(max, bounds.maxRow); row++) {
      for (let col = Math.max(min, bounds.minCol); col < Math.min(max, bounds.maxCol); col++) {
        if (isSurface(this.dugTiles.get(`${col},${row}`))) {
          yield [col, row];
        }
      }
    }
  }

  isOceanTileAt(col: number, row: number): boolean {
    return isOceanTile(this.tileAt(col, row));
  }

  /** tiledefs.lua ocean colours of a cell's tile. */
  oceanColoursAt(col: number, row: number) {
    return OCEAN_COLOURS.get(this.tileAt(col, row));
  }

  /** world.lua: one render layer per land tile type, in source layer order (ocean is its own pass); invisible tiles draw none. */
  groundLayers(): readonly GroundLayerDeclaration[] {
    return this.terrainNames()
      .filter(name => !isOceanTile(WORLD_TILES[name]) && !INVISIBLE_TILE_IDS.has(WORLD_TILES[name]))
      .map(name => ({
        tileId: WORLD_TILES[name],
        art: groundTileArt(name),
        renderOrder: groundLayerRenderOrder(name),
      }));
  }

  /** Edge-mask quads within `bounds`: every cell inside the world (void included, which carries skirts)
   * gets a quad of each declared layer among its eight neighbours. Deciduous quads stay next to generated
   * or saved cells; the base plane fills the rest of the default ground.
   */
  groundLayerQuads(bounds: GroundCellBounds): Map<number, GroundTileQuad[]> {
    const layers = new Map<number, GroundTileQuad[]>(this.groundLayers().map(({ tileId }) => [tileId, []]));
    const { min, max } = this.cellRange();
    const ids: number[] = [];
    for (let row = Math.max(min, bounds.minRow); row < Math.min(max, bounds.maxRow); row++) {
      for (let col = Math.max(min, bounds.minCol); col < Math.min(max, bounds.maxCol); col++) {
        if (this.tileAt(col, row) === WORLD_TILES.INVALID) {
          continue;
        }
        ids.length = 0;
        let keyed = false;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const id = this.tileAt(col + dx, row + dz);
            if (!ids.includes(id)) {
              ids.push(id);
            }
            keyed ||= this.isKeyed(col + dx, row + dz);
          }
        }
        for (const tileId of ids) {
          const quads = layers.get(tileId);
          if (!quads || (tileId === WORLD_TILES.DECIDUOUS && !keyed)) {
            continue;
          }
          const variant = this.variantAt(col, row, tileId);
          if (variant !== 17) {
            quads.push({ col, row, variant });
          }
        }
      }
    }
    return layers;
  }

  /** ground_overlay.ksh coverage within `bounds`: full land cells, and land skirts extending into ocean cells. */
  landOverlayQuads(bounds: GroundCellBounds): Map<number, GroundTileQuad[]> {
    const layers = new Map<number, GroundTileQuad[]>(this.groundLayers().map(({ tileId }) => [tileId, []]));
    const { min, max } = this.cellRange();
    for (let row = Math.max(min, bounds.minRow); row < Math.min(max, bounds.maxRow); row++) {
      for (let col = Math.max(min, bounds.minCol); col < Math.min(max, bounds.maxCol); col++) {
        const tileId = this.tileAt(col, row);
        if (!isOceanTile(tileId)) {
          layers.get(tileId)?.push({ col, row, variant: 1 });
        } else {
          for (const [landId, quads] of layers) {
            const variant = this.variantAt(col, row, landId);
            if (variant !== 17) {
              quads.push({ col, row, variant });
            }
          }
        }
      }
    }
    return layers;
  }

  onTerrainChanged(listener: (bounds?: TerrainCellBounds) => void): () => void {
    this.terrainListeners.add(listener);
    return () => this.terrainListeners.delete(listener);
  }

  canTerraform(world: Vector2): boolean {
    const tile = this.getTileAtWorld(world);
    return (
      tile !== WORLD_TILES.DIRT &&
      !isOceanTile(tile) &&
      Object.values(GROUND_TILE_DEFINITIONS).some(definition => definition.tileId === tile && !definition.cannotBeDug)
    );
  }

  /** map.lua CanPlaceTurfAtPoint: only bare dirt accepts turf. */
  canPlaceTurf(point: THREE.Vector3): boolean {
    return this.getTileAtWorld(point) === WORLD_TILES.DIRT;
  }

  /** map.lua CanPlantAtPoint: a land tile outside GROUND_HARD. */
  canDeployPlantAtPoint(world: THREE.Vector3): boolean {
    const tile = this.getTileAtWorld(world);
    return Object.values(GROUND_TILE_DEFINITIONS).some(
      definition => definition.tileId === tile && definition.plantable,
    );
  }

  canPlant(world: Vector2): boolean {
    const tile = this.getTileAtWorld(world);
    return tile === WORLD_TILES.DECIDUOUS || tile === WORLD_TILES.DIRT || tile === WORLD_TILES.FARMING_SOIL;
  }

  canPlow(world: Vector2): boolean {
    return this.canPlant(world) && this.getTileAtWorld(world) !== WORLD_TILES.FARMING_SOIL;
  }

  plow(world: Vector2): boolean {
    if (!this.canPlow(world)) {
      return false;
    }
    const col = Math.floor(world.x / TILE_SIZE),
      row = Math.floor(world.z / TILE_SIZE);
    this.setDug(col, row, { col, row, tileId: WORLD_TILES.FARMING_SOIL, underTileId: this.getTileAtWorld(world) });
    this.rebuildGeometry({ minCol: col, minRow: row, maxCol: col + 1, maxRow: row + 1 });
    return true;
  }

  onDig(listener: (world: Vector2, originalTileId: number) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** terraformer.lua: SetTile(..., WORLD_TILES.DIRT); dirt cannot be dug again. */
  dig(world: Vector2): boolean {
    if (!this.canTerraform(world)) {
      return false;
    }
    const originalTileId = this.getTileAtWorld(world);
    const center = snapToTileCenter(world);
    const col = Math.floor(center.x / TILE_SIZE),
      row = Math.floor(center.z / TILE_SIZE);
    const key = `${col},${row}`;
    const previous = this.dugTiles.get(key);
    if (previous?.tileId === WORLD_TILES.FARMING_SOIL && previous.underTileId !== undefined) {
      this.setDug(col, row, { col, row, tileId: previous.underTileId });
    } else {
      this.setDug(col, row, { col, row, tileId: WORLD_TILES.DIRT });
    }
    this.rebuildGeometry({ minCol: col, minRow: row, maxCol: col + 1, maxRow: row + 1 });
    for (const listener of this.listeners) {
      listener(world, originalTileId);
    }
    return true;
  }

  exportTiles(): TurfTileSave[] {
    return [...this.dugTiles.values()].map(tile => ({ ...tile }));
  }

  private tileAt(col: number, row: number): number {
    const half = this.size / 2;
    if (
      (col + 1) * TILE_SIZE <= -half ||
      col * TILE_SIZE >= half ||
      (row + 1) * TILE_SIZE <= -half ||
      row * TILE_SIZE >= half
    ) {
      return WORLD_TILES.INVALID;
    }
    return this.cells[(row - this.cellMin) * this.cellWidth + col - this.cellMin];
  }

  private variantAt(col: number, row: number, tileId: number): number {
    const is = (dx: number, dz: number) => this.tileAt(col + dx, row + dz) === tileId;
    const cardinal = Number(is(-1, 0)) | (Number(is(0, -1)) << 1) | (Number(is(1, 0)) << 2) | (Number(is(0, 1)) << 3);
    const diagonal = Number(is(-1, -1)) | (Number(is(1, -1)) << 1) | (Number(is(1, 1)) << 2) | (Number(is(-1, 1)) << 3);
    return groundTileVariant(is(0, 0), cardinal, diagonal);
  }

  private rebuildGeometry(bounds?: TerrainCellBounds): void {
    this.terrainNamesCache = undefined;
    for (const listener of this.terrainListeners) {
      listener(bounds);
    }
  }

  dispose(): void {
    this.listeners.clear();
    this.terrainListeners.clear();
  }
}

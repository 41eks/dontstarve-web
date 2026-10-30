import * as THREE from 'three';
import type { GroundCellBounds, GroundLayerDeclaration, GroundTerrain } from '@dontstarve-web/display';
import { TILE_SIZE, snapToTileCenter, type Vector2 } from './tile';
import { GROUND_TILE_DEFINITIONS, FALLOFF_EDGES, groundFalloffGeometry, sortGroundFalloffGeometry, loadGroundFalloffAssets, loadGroundTileMinimapLayer, groundTileVariant, loadGroundTileAssets,
  groundTileArt, type GroundFalloffAssets, type FalloffEdge, type GroundTileLayerImage, type GroundTileQuad, type GroundTileName } from './groundTiles';
import { OceanSurface } from './ocean';
import { mergeCellRectangles, cellRectangleGeometry } from './oceanRenderPipeline';
import { loadMinimapOcean, type MinimapOceanData } from './minimapOcean';
import type { ClockState, ReadonlySignal } from '@dontstarve-web/signals';
import { GroundDepthPrepass } from './groundDepthPrepass';
import { groundTileLayerQuads, isLandTile, isOceanTile } from './groundTileQuads';

// tiledefs.lua preserves these vanilla GROUND IDs in WORLD_TILES.
export const WORLD_TILES = {
  ...Object.fromEntries(Object.entries(GROUND_TILE_DEFINITIONS).map(([name, tile]) => [name, tile.tileId])) as {
    readonly [K in GroundTileName]: (typeof GROUND_TILE_DEFINITIONS)[K]['tileId'];
  },
  INVALID: 0, IMPASSABLE: 1, FAKE_GROUND: 200,
  DIRT: 4, GRASS: GROUND_TILE_DEFINITIONS.GRASS.tileId, WOODFLOOR: GROUND_TILE_DEFINITIONS.WOODFLOOR.tileId,
  DECIDUOUS: GROUND_TILE_DEFINITIONS.DECIDUOUS.tileId,
  FARMING_SOIL: GROUND_TILE_DEFINITIONS.FARMING_SOIL.tileId,
  OCEAN_COASTAL: GROUND_TILE_DEFINITIONS.OCEAN_COASTAL.tileId,
  MONKEY_DOCK: GROUND_TILE_DEFINITIONS.MONKEY_DOCK.tileId,
} as const;

export { isLandTile, isOceanTile };

const OCEAN_COLOURS = new Map(Object.values(GROUND_TILE_DEFINITIONS).flatMap(tile =>
  'oceanColours' in tile ? [[tile.tileId, tile.oceanColours] as const] : []));

export interface TurfTileSave {
  /** Signed grid coordinates: floor(world x/z / TILE_SIZE). */
  col: number;
  row: number;
  tileId: number;
  /** undertile component: the tile restored when a farm soil is dug or a dock is destroyed. */
  underTileId?: number;
}

const MAX_GROUND_RENDER_ORDER = Math.max(...Object.values(GROUND_TILE_DEFINITIONS).map(tile => tile.renderOrder));

/** LAYER_GROUND: stay within [-1, -0.6), below snow (-0.55) and LAYER_BACKGROUND decor (-0.5). */
function groundLayerRenderOrder(name: GroundTileName): number {
  return -1 + 0.4 * GROUND_TILE_DEFINITIONS[name].renderOrder / (MAX_GROUND_RENDER_ORDER + 1);
}

/** Inclusive-exclusive signed cells; omitted on a full terrain/resource change. */
export interface TerrainCellBounds { minCol: number; minRow: number; maxCol: number; maxRow: number }

/** Generated terrain plus authoritative saved tile overrides and TERRAFORM changes.
 * Like world.lua, it declares the ground render layers and owns the tiles; GroundDisplay draws them.
 */
export class TurfMap implements GroundTerrain {
  readonly size: number;
  readonly tileSize = TILE_SIZE;
  readonly defaultTileId: number;
  private readonly originalTiles = new Map<string, number>();
  private readonly dugTiles = new Map<string, TurfTileSave>();
  private visual?: THREE.Group;
  private oceanMesh?: THREE.Mesh;
  /** The ocean art's own material; the ocean pipeline draws the mesh with its combined material. */
  private oceanMaterial?: THREE.Material;
  private readonly listeners = new Set<(world: Vector2, originalTileId: number) => void>();
  private readonly terrainListeners = new Set<(bounds?: TerrainCellBounds) => void>();
  private ocean?: OceanSurface;
  private falloffAssets?: GroundFalloffAssets;
  private falloffMesh?: THREE.Mesh;
  private readonly depthPrepass = new GroundDepthPrepass();
  private assetBaseUrl?: string;
  private minimapLayers?: Promise<Map<number, GroundTileLayerImage>>;
  private minimapOceanData?: Promise<MinimapOceanData>;
  private terrainNamesCache?: GroundTileName[];
  /** Effective tile id (dug override, else generated, else default) per cell; the maps stay authoritative. */
  private readonly cells: Uint16Array;
  private readonly cellMin: number;
  private readonly cellWidth: number;
  /** Cells holding a generated or saved tile; the base plane draws the rest, so deciduous skirts stay near them. */
  private readonly keyed: Uint8Array;

  private terrainNames(): GroundTileName[] {
    if (this.terrainNamesCache) return this.terrainNamesCache;
    const ids = new Set([...this.dugTiles.values()].map(tile => tile.tileId));
    return this.terrainNamesCache = (Object.keys(GROUND_TILE_DEFINITIONS) as GroundTileName[]).filter(name =>
      ['DIRT', 'DECIDUOUS', 'GRASS', 'WOODFLOOR', 'FARMING_SOIL', 'MONKEY_DOCK', 'OCEAN_COASTAL'].includes(name)
      || ids.has(WORLD_TILES[name]));
  }

  constructor(size: number, savedTiles: readonly TurfTileSave[] = [], defaultTileId: number = WORLD_TILES.DECIDUOUS) {
    this.size = size;
    this.defaultTileId = defaultTileId;
    const { min, max } = this.cellRange();
    this.cellMin = min; this.cellWidth = max - min;
    this.cells = new Uint16Array(this.cellWidth * this.cellWidth).fill(defaultTileId);
    this.keyed = new Uint8Array(this.cellWidth * this.cellWidth);
    for (const tile of savedTiles) this.setDug(tile.col, tile.row, { ...tile });
  }

  private setDug(col: number, row: number, tile: TurfTileSave): void {
    this.dugTiles.set(`${col},${row}`, tile);
    this.markKeyed(col, row);
    this.writeCell(col, row, tile.tileId);
  }

  private markKeyed(col: number, row: number): void {
    const c = col - this.cellMin, r = row - this.cellMin;
    if (c >= 0 && c < this.cellWidth && r >= 0 && r < this.cellWidth) this.keyed[r * this.cellWidth + c] = 1;
  }

  private isKeyed(col: number, row: number): boolean {
    const c = col - this.cellMin, r = row - this.cellMin;
    return c >= 0 && c < this.cellWidth && r >= 0 && r < this.cellWidth && this.keyed[r * this.cellWidth + c] === 1;
  }

  private writeCell(col: number, row: number, tileId: number): void {
    const c = col - this.cellMin, r = row - this.cellMin;
    if (c >= 0 && c < this.cellWidth && r >= 0 && r < this.cellWidth) this.cells[r * this.cellWidth + c] = tileId;
  }

  private key(world: Vector2): string {
    return `${Math.floor(world.x / TILE_SIZE)},${Math.floor(world.z / TILE_SIZE)}`;
  }

  getTileAtWorld(world: Vector2): number {
    if (!Number.isFinite(world.x) || !Number.isFinite(world.z)
      || world.x < -this.size / 2 || world.x >= this.size / 2
      || world.z < -this.size / 2 || world.z >= this.size / 2) return WORLD_TILES.INVALID;
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
      const col = Math.floor(position.x / TILE_SIZE), row = Math.floor(position.z / TILE_SIZE), key = `${col},${row}`;
      this.originalTiles.set(key, tileId);
      this.markKeyed(col, row);
      const effective = this.dugTiles.get(key)?.tileId ?? tileId;
      if (this.tileAt(col, row) === effective) continue;
      this.writeCell(col, row, effective);
      if (!bounds) bounds = { minCol: col, minRow: row, maxCol: col + 1, maxRow: row + 1 };
      else {
        bounds.minCol = Math.min(bounds.minCol, col); bounds.minRow = Math.min(bounds.minRow, row);
        bounds.maxCol = Math.max(bounds.maxCol, col + 1); bounds.maxRow = Math.max(bounds.maxRow, row + 1);
      }
    }
    if (bounds) this.rebuildGeometry(bounds);
  }

  /** Inclusive-exclusive signed cell range [min, max) covering the generated world on both axes. */
  cellRange(): { min: number; max: number } {
    return { min: Math.floor(-this.size / 2 / TILE_SIZE), max: Math.ceil(this.size / 2 / TILE_SIZE) };
  }

  /** Tile id of a signed grid cell; INVALID outside the world. */
  tileIdAtCell(col: number, row: number): number { return this.tileAt(col, row); }

  isVoidAtCell(col: number, row: number): boolean {
    const tile = this.tileAt(col, row);
    return !isLandTile(tile) && !isOceanTile(tile);
  }

  /** undertile:GetTileUnderneath for a signed grid cell. */
  underTileAtCell(col: number, row: number): number | undefined { return this.dugTiles.get(`${col},${row}`)?.underTileId; }

  /** Signed cells currently holding `tileId` as a saved override. */
  cellsOfTile(tileId: number): [number, number][] {
    return [...this.dugTiles.values()].filter(tile => tile.tileId === tileId).map(tile => [tile.col, tile.row]);
  }

  /** Map:SetTile plus the undertile component's record (dock tiles keep the ocean tile they cover). */
  setTile(col: number, row: number, tileId: TurfTileSave['tileId'], underTileId?: TurfTileSave['underTileId']): void {
    if (this.tileAt(col, row) === WORLD_TILES.INVALID) throw new RangeError('Tile is outside the world');
    this.setDug(col, row, { col, row, tileId, ...(underTileId === undefined ? {} : { underTileId }) });
    this.rebuildGeometry({ minCol: col, minRow: row, maxCol: col + 1, maxRow: row + 1 });
  }

  /** Minimap render layer images (map_edge masks + mini noise) per tile id. Loaded once from the assets root of createVisual(). */
  tileLayerImages(): Promise<Map<number, GroundTileLayerImage>> {
    if (!this.minimapLayers) {
      const root = this.assetBaseUrl;
      if (root === undefined) return Promise.reject(new Error('Create terrain visuals before reading minimap layers'));
      const names = this.terrainNames();
      this.minimapLayers = Promise.all(names.map(async name =>
        [WORLD_TILES[name], await loadGroundTileMinimapLayer(root, name)] as const)).then(entries => new Map(entries));
    }
    return this.minimapLayers;
  }

  /** Land render masks, including skirts in neighbouring cells. UI consumes the
   * same eight-neighbour variant selection as the world terrain renderer.
   */
  tileLayerQuads(bounds?: TerrainCellBounds): ReadonlyMap<number, readonly GroundTileQuad[]> {
    const ids = this.terrainNames().filter(name => !isOceanTile(WORLD_TILES[name])).map(name => WORLD_TILES[name]);
    return groundTileLayerQuads((col, row) => this.tileAt(col, row), ids, this.cellRange(), bounds);
  }

  /** Data of the separate minimapocean.ksh pass that draws every ocean tile. */
  minimapOcean(): Promise<MinimapOceanData> {
    if (this.assetBaseUrl === undefined) return Promise.reject(new Error('Create terrain visuals before reading minimap ocean data'));
    return this.minimapOceanData ??= loadMinimapOcean(this.assetBaseUrl);
  }

  tileCenter(world: Vector2): Vector2 { return snapToTileCenter(world); }

  isOceanAtWorld(world: Vector2): boolean { return isOceanTile(this.getTileAtWorld(world)); }

  isPassableAtPoint(world: Vector2): boolean { return isLandTile(this.getTileAtWorld(world)); }

  bindOceanClock(clock: ReadonlySignal<ClockState>): void { this.ocean?.bindClock(clock); }
  update(dt: number): void { this.ocean?.update(dt); }

  /** world.lua: one render layer per land tile type, in source layer order (ocean is its own pass). */
  groundLayers(): readonly GroundLayerDeclaration[] {
    return this.terrainNames().filter(name => !isOceanTile(WORLD_TILES[name])).map(name =>
      ({ tileId: WORLD_TILES[name], art: groundTileArt(name), renderOrder: groundLayerRenderOrder(name) }));
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
        if (this.tileAt(col, row) === WORLD_TILES.INVALID) continue;
        ids.length = 0;
        let keyed = false;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const id = this.tileAt(col + dx, row + dz);
          if (!ids.includes(id)) ids.push(id);
          keyed ||= this.isKeyed(col + dx, row + dz);
        }
        for (const tileId of ids) {
          const quads = layers.get(tileId);
          if (!quads || (tileId === WORLD_TILES.DECIDUOUS && !keyed)) continue;
          const variant = this.variantAt(col, row, tileId);
          if (variant !== 17) quads.push({ col, row, variant });
        }
      }
    }
    return layers;
  }

  /** ground_overlay.ksh coverage within `bounds`: full land cells, and land skirts extending into ocean cells. */
  landOverlayQuads(bounds: GroundCellBounds): Map<number, GroundTileQuad[]> {
    const layers = new Map<number, GroundTileQuad[]>(this.groundLayers().map(({ tileId }) => [tileId, []]));
    const { min, max } = this.cellRange();
    for (let row = Math.max(min, bounds.minRow); row < Math.min(max, bounds.maxRow); row++)
    for (let col = Math.max(min, bounds.minCol); col < Math.min(max, bounds.maxCol); col++) {
      const tileId = this.tileAt(col, row);
      if (!isOceanTile(tileId)) {
        layers.get(tileId)?.push({ col, row, variant: 1 });
      } else {
        for (const [landId, quads] of layers) {
          const variant = this.variantAt(col, row, landId);
          if (variant !== 17) quads.push({ col, row, variant });
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
    return tile !== WORLD_TILES.DIRT && !isOceanTile(tile)
      && Object.values(GROUND_TILE_DEFINITIONS).some(definition => definition.tileId === tile && !definition.cannotBeDug);
  }

  /** map.lua CanPlaceTurfAtPoint: only bare dirt accepts turf. */
  canPlaceTurf(point: THREE.Vector3): boolean { return this.getTileAtWorld(point) === WORLD_TILES.DIRT; }

  /** map.lua CanPlantAtPoint: a land tile outside GROUND_HARD. */
  canDeployPlantAtPoint(world: THREE.Vector3): boolean {
    const tile = this.getTileAtWorld(world);
    return Object.values(GROUND_TILE_DEFINITIONS).some(definition => definition.tileId === tile && definition.plantable);
  }

  canPlant(world: Vector2): boolean {
    const tile = this.getTileAtWorld(world);
    return tile === WORLD_TILES.DECIDUOUS || tile === WORLD_TILES.DIRT || tile === WORLD_TILES.FARMING_SOIL;
  }

  canPlow(world: Vector2): boolean {
    return this.canPlant(world) && this.getTileAtWorld(world) !== WORLD_TILES.FARMING_SOIL;
  }

  plow(world: Vector2): boolean {
    if (!this.canPlow(world)) return false;
    const col = Math.floor(world.x / TILE_SIZE), row = Math.floor(world.z / TILE_SIZE);
    this.setDug(col, row, { col, row, tileId: WORLD_TILES.FARMING_SOIL,
      underTileId: this.getTileAtWorld(world) });
    this.rebuildGeometry({ minCol: col, minRow: row, maxCol: col + 1, maxRow: row + 1 });
    return true;
  }

  onDig(listener: (world: Vector2, originalTileId: number) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** terraformer.lua: SetTile(..., WORLD_TILES.DIRT); dirt cannot be dug again. */
  dig(world: Vector2): boolean {
    if (!this.canTerraform(world)) return false;
    const originalTileId = this.getTileAtWorld(world);
    const center = snapToTileCenter(world);
    const col = Math.floor(center.x / TILE_SIZE), row = Math.floor(center.z / TILE_SIZE);
    const key = `${col},${row}`;
    const previous = this.dugTiles.get(key);
    if (previous?.tileId === WORLD_TILES.FARMING_SOIL && previous.underTileId !== undefined) {
      this.setDug(col, row, { col, row, tileId: previous.underTileId });
    }
    else this.setDug(col, row, { col, row, tileId: WORLD_TILES.DIRT });
    this.rebuildGeometry({ minCol: col, minRow: row, maxCol: col + 1, maxRow: row + 1 });
    for (const listener of this.listeners) listener(world, originalTileId);
    return true;
  }

  exportTiles(): TurfTileSave[] {
    return [...this.dugTiles.values()].map((tile) => ({ ...tile }));
  }

  /** Cliffs and the ocean surface. Ground layers are declared by groundLayers() and drawn by GroundDisplay. */
  async createVisual(assetBaseUrl: string): Promise<THREE.Group> {
    if (this.visual) return this.visual;
    this.assetBaseUrl = assetBaseUrl;
    const falloff = await loadGroundFalloffAssets(assetBaseUrl);
    this.falloffAssets = falloff;
    this.visual = new THREE.Group();
    this.visual.name = 'EditableTurf';
    // Only the falloff writes depth (prepass); turf layers stay depth-free and are ordered by renderOrder.
    this.falloffMesh = new THREE.Mesh(new THREE.BufferGeometry(), falloff.material);
    this.falloffMesh.name = 'TurfFalloff';
    // Above ocean (-1.75) but below every turf layer, dirt included (>= -1): turf is drawn after, so it covers the falloff where they are coplanar.
    this.falloffMesh.renderOrder = -1.25;
    const modelView = new THREE.Matrix4();
    this.falloffMesh.onBeforeRender = (_renderer, _scene, camera, geometry) => {
      modelView.multiplyMatrices(camera.matrixWorldInverse, this.falloffMesh!.matrixWorld);
      sortGroundFalloffGeometry(geometry, modelView);
    };
    this.depthPrepass.add(this.falloffMesh);
    this.visual.add(this.falloffMesh);
    if ([...this.dugTiles.values()].some(tile => isOceanTile(tile.tileId))) {
      const assets = await loadGroundTileAssets(assetBaseUrl, 'OCEAN_COASTAL');
      this.ocean = new OceanSurface(assets.material, { size: this.size, tileSize: TILE_SIZE,
        isOceanTileAt: (col, row) => isOceanTile(this.tileAt(col, row)),
        oceanColoursAt: (col, row) => OCEAN_COLOURS.get(this.tileAt(col, row)) });
      this.oceanMaterial = assets.material;
      this.oceanMesh = new THREE.Mesh(new THREE.BufferGeometry(), assets.material);
      this.oceanMesh.name = 'TurfOcean:OCEAN_COASTAL';
      this.oceanMesh.renderOrder = -1.75;
      this.ocean.attach(this.oceanMesh);
      this.visual.add(this.oceanMesh);
    }
    this.rebuildOcean();
    this.rebuildFalloff();
    this.ocean?.rebuildColours();
    return this.visual;
  }

  private tileAt(col: number, row: number): number {
    const half = this.size / 2;
    if ((col + 1) * TILE_SIZE <= -half || col * TILE_SIZE >= half
      || (row + 1) * TILE_SIZE <= -half || row * TILE_SIZE >= half) return WORLD_TILES.INVALID;
    return this.cells[(row - this.cellMin) * this.cellWidth + col - this.cellMin];
  }

  private variantAt(col: number, row: number, tileId: number): number {
    const is = (dx: number, dz: number) => this.tileAt(col + dx, row + dz) === tileId;
    const cardinal = Number(is(-1, 0)) | Number(is(0, -1)) << 1
      | Number(is(1, 0)) << 2 | Number(is(0, 1)) << 3;
    const diagonal = Number(is(-1, -1)) | Number(is(1, -1)) << 1
      | Number(is(1, 1)) << 2 | Number(is(-1, 1)) << 3;
    return groundTileVariant(is(0, 0), cardinal, diagonal);
  }

  /** The ocean pass shades by world position, so the surface only needs the footprint of the saved ocean tiles: merged rectangles. */
  private rebuildOcean(): void {
    const mesh = this.oceanMesh;
    if (!mesh) return;
    const { min, max } = this.cellRange();
    const surface = new Set<string>();
    for (const tile of this.dugTiles.values()) {
      if (isOceanTile(tile.tileId) && this.tileAt(tile.col, tile.row) !== WORLD_TILES.INVALID) surface.add(`${tile.col},${tile.row}`);
    }
    const rects = mergeCellRectangles(max - min, (col, row) => surface.has(`${col + min},${row + min}`));
    mesh.geometry.dispose();
    mesh.geometry = cellRectangleGeometry(rects, min, TILE_SIZE, this.size / 2, new THREE.Matrix4());
    mesh.visible = rects.length > 0;
  }

  private rebuildGeometry(bounds?: TerrainCellBounds): void {
    const names = this.terrainNames();
    this.terrainNamesCache = undefined;
    if (this.terrainNames().some(name => !names.includes(name))) this.declareMinimapLayers();
    for (const listener of this.terrainListeners) listener(bounds);
    if (!this.visual) return;
    this.rebuildOcean();
    this.rebuildFalloff();
    this.ocean?.rebuildColours();
  }

  /** A newly declared layer joins the minimap's loaded layers, then redraws it. */
  private declareMinimapLayers(): void {
    const loaded = this.minimapLayers, root = this.assetBaseUrl;
    if (!loaded || root === undefined) return;
    void loaded.then(layers => Promise.all(this.terrainNames().filter(name => !layers.has(WORLD_TILES[name]))
      .map(async name => { layers.set(WORLD_TILES[name], await loadGroundTileMinimapLayer(root, name)); })))
      .then(() => { for (const listener of this.terrainListeners) listener(); })
      .catch(error => console.error('Unable to load minimap layer art', error));
  }

  /** falloffdefs.lua FALLOFF: a land cell (docks excepted) gets a cliff on each side whose neighbour is void. */
  private rebuildFalloff(): void {
    if (!this.falloffAssets || !this.falloffMesh) return;
    const edges: FalloffEdge[] = [];
    const { min, max } = this.cellRange();
    for (let row = min; row < max; row++) for (let col = min; col < max; col++) {
      const tile = this.tileAt(col, row);
      if (!isLandTile(tile) || tile === WORLD_TILES.MONKEY_DOCK) continue;
      FALLOFF_EDGES.forEach(({ dx, dz }, edge) => {
        if (this.isVoidAtCell(col + dx, row + dz)) edges.push({ col, row, edge });
      });
    }
    this.falloffMesh.geometry.dispose();
    this.falloffMesh.geometry = groundFalloffGeometry(edges, this.falloffAssets);
    this.depthPrepass.sync(this.falloffMesh);
    this.falloffMesh.visible = edges.length > 0;
  }

  dispose(): void {
    this.depthPrepass.dispose();
    this.ocean?.dispose();
    this.ocean = undefined;
    this.visual?.removeFromParent();
    this.oceanMesh?.geometry.dispose();
    this.oceanMaterial?.dispose();
    this.oceanMesh = undefined; this.oceanMaterial = undefined;
    this.falloffMesh?.geometry.dispose();
    this.falloffMesh = undefined;
    this.falloffAssets?.material.dispose();
    this.falloffAssets = undefined;
    this.listeners.clear();
    this.terrainListeners.clear();
    this.visual = undefined;
  }
}

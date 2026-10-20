import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TILE_SIZE, snapToTileCenter, type Vector2 } from './tile';
import { GROUND_TILE_DEFINITIONS, FALLOFF_EDGES, groundTileGeometry, groundFalloffGeometry, sortGroundFalloffGeometry, loadGroundFalloffAssets, loadGroundTileMinimapLayer, groundTileVariant, loadGroundTileAssets,
  type GroundTileAssets, type GroundFalloffAssets, type FalloffEdge, type GroundTileLayerImage, type GroundTileQuad, type GroundOverlayGeometry, type GroundTileName } from './groundTiles';
import { OceanSurface } from './ocean';
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

/** Inclusive-exclusive signed cells; omitted on a full terrain/resource change. */
export interface TerrainCellBounds { minCol: number; minRow: number; maxCol: number; maxRow: number }

/** Generated terrain plus authoritative saved tile overrides and TERRAFORM changes. */
export class TurfMap {
  readonly size: number;
  readonly defaultTileId: number;
  private readonly originalTiles = new Map<string, number>();
  private readonly dugTiles = new Map<string, TurfTileSave>();
  private dirt?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  private dirtAssets?: GroundTileAssets;
  private visual?: THREE.Group;
  private readonly layers = new Map<number, { mesh: THREE.Mesh; assets: GroundTileAssets }>();
  private readonly listeners = new Set<(world: Vector2, originalTileId: number) => void>();
  private readonly terrainListeners = new Set<(bounds?: TerrainCellBounds) => void>();
  private ocean?: OceanSurface;
  private falloffAssets?: GroundFalloffAssets;
  private falloffMesh?: THREE.Mesh;
  private readonly depthPrepass = new GroundDepthPrepass();
  private assetBaseUrl?: string;
  private minimapLayers?: Promise<Map<number, GroundTileLayerImage>>;
  private minimapOceanData?: Promise<MinimapOceanData>;
  private readonly layerRequests = new Map<GroundTileName, Promise<void>>();
  private terrainNamesCache?: GroundTileName[];
  /** Effective tile id (dug override, else generated, else default) per cell; the maps stay authoritative. */
  private readonly cells: Uint16Array;
  private readonly cellMin: number;
  private readonly cellWidth: number;

  private terrainNames(): GroundTileName[] {
    if (this.terrainNamesCache) return this.terrainNamesCache;
    const ids = new Set([...this.dugTiles.values()].map(tile => tile.tileId));
    return this.terrainNamesCache = (Object.keys(GROUND_TILE_DEFINITIONS) as GroundTileName[]).filter(name =>
      ['DIRT', 'DECIDUOUS', 'GRASS', 'WOODFLOOR', 'FARMING_SOIL', 'MONKEY_DOCK', 'OCEAN_COASTAL'].includes(name)
      || ids.has(WORLD_TILES[name]) || this.layers.has(WORLD_TILES[name]));
  }

  constructor(size: number, savedTiles: readonly TurfTileSave[] = [], defaultTileId: number = WORLD_TILES.DECIDUOUS) {
    this.size = size;
    this.defaultTileId = defaultTileId;
    const { min, max } = this.cellRange();
    this.cellMin = min; this.cellWidth = max - min;
    this.cells = new Uint16Array(this.cellWidth * this.cellWidth).fill(defaultTileId);
    for (const tile of savedTiles) this.setDug(tile.col, tile.row, { ...tile });
  }

  private setDug(col: number, row: number, tile: TurfTileSave): void {
    this.dugTiles.set(`${col},${row}`, tile);
    this.writeCell(col, row, tile.tileId);
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
    this.originalTiles.set(this.key(world), tileId);
    const col = Math.floor(world.x / TILE_SIZE), row = Math.floor(world.z / TILE_SIZE);
    this.writeCell(col, row, this.dugTiles.get(`${col},${row}`)?.tileId ?? tileId);
    this.rebuildGeometry({ minCol: col, minRow: row, maxCol: col + 1, maxRow: row + 1 });
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

  /** ground_overlay.ksh samples the same atlas alpha as the underlying terrain,
   * including land skirts extending into ocean cells, with world-space noise UVs.
   */
  createLandOverlay(): GroundOverlayGeometry {
    if (!this.dirtAssets) throw new Error('Create terrain visuals before ground overlays');
    const terrain = new Map<number, { assets: GroundTileAssets; quads: GroundTileQuad[] }>([
      [WORLD_TILES.DIRT, { assets: this.dirtAssets, quads: [] }],
    ]);
    for (const [tileId, { assets }] of [...this.layers].sort((a, b) => a[1].mesh.renderOrder - b[1].mesh.renderOrder)) {
      if (!isOceanTile(tileId)) terrain.set(tileId, { assets, quads: [] });
    }
    const min = Math.floor(-this.size / 2 / TILE_SIZE), max = Math.ceil(this.size / 2 / TILE_SIZE);
    for (let row = min; row < max; row++) for (let col = min; col < max; col++) {
      const tileId = this.tileAt(col, row);
      if (!isOceanTile(tileId)) {
        terrain.get(tileId)?.quads.push({ col, row, variant: 1 });
      } else {
        for (const [landId, { quads }] of terrain) {
          const variant = this.variantAt(col, row, landId);
          if (variant !== 17) quads.push({ col, row, variant });
        }
      }
    }
    const parts: THREE.BufferGeometry[] = [], atlases: THREE.Texture[] = [];
    for (const { assets, quads } of terrain.values()) {
      if (!quads.length) continue;
      parts.push(groundTileGeometry(quads, assets, this.size));
      atlases.push(assets.atlas);
    }
    if (!parts.length) return { geometry: new THREE.BufferGeometry(), atlases };
    const geometry = mergeGeometries(parts, true);
    for (const part of parts) part.dispose();
    if (!geometry) throw new Error('Unable to merge land overlay geometry');
    return { geometry, atlases };
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

  /** Prepare world art before buffering DEPLOY; update legacy minimap art only if requested. */
  prepareTurf(name: GroundTileName): Promise<void> {
    if (this.layers.has(WORLD_TILES[name]) || name === 'DIRT') return Promise.resolve();
    const pending = this.layerRequests.get(name);
    if (pending) return pending;
    const root = this.assetBaseUrl, visual = this.visual;
    if (root === undefined || !visual) return Promise.reject(new Error('Create terrain visuals before deploying turf'));
    const mini = this.minimapLayers
      ? Promise.all([loadGroundTileMinimapLayer(root, name), this.minimapLayers]) : undefined;
    const request = Promise.all([loadGroundTileAssets(root, name), mini])
      .then(([assets, minimap]) => {
        if (this.visual !== visual) { assets.material.dispose(); return; }
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), assets.material);
        mesh.name = `TurfBlend:${name}`;
        mesh.renderOrder = -1 + 0.4 * GROUND_TILE_DEFINITIONS[name].renderOrder
          / (Math.max(...Object.values(GROUND_TILE_DEFINITIONS).map(tile => tile.renderOrder)) + 1);
        mesh.receiveShadow = true;
        visual.add(mesh);
        this.layers.set(WORLD_TILES[name], { mesh, assets });
        if (minimap) minimap[1].set(WORLD_TILES[name], minimap[0]);
        // Only the new layer changes; rebuilding every layer here repeats a full-map pass per turf type.
        this.terrainNamesCache = undefined;
        this.rebuildLayer(WORLD_TILES[name], mesh, assets);
        for (const listener of this.terrainListeners) listener();
      });
    this.layerRequests.set(name, request);
    void request.catch(() => this.layerRequests.delete(name));
    return request;
  }

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

  async createDirtMesh(assetBaseUrl: string): Promise<THREE.Mesh> {
    if (this.dirt) return this.dirt;
    this.dirtAssets = await loadGroundTileAssets(assetBaseUrl, 'DIRT');
    const material = this.dirtAssets.material;
    this.dirt = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.dirt.name = 'DugTurf:DIRT';
    this.dirt.renderOrder = -1.5;
    this.dirt.receiveShadow = true;
    this.rebuildGeometry();
    return this.dirt;
  }

  /** tilemanager: layered atlas masks + noise, in source ground render order. */
  async createVisual(assetBaseUrl: string): Promise<THREE.Group> {
    if (this.visual) return this.visual;
    this.assetBaseUrl = assetBaseUrl;
    const [dirt, deciduous, grass, woodfloor, farming, dock, falloff] = await Promise.all([
      this.createDirtMesh(assetBaseUrl), loadGroundTileAssets(assetBaseUrl, 'DECIDUOUS'), loadGroundTileAssets(assetBaseUrl, 'GRASS'),
      loadGroundTileAssets(assetBaseUrl, 'WOODFLOOR'),
      loadGroundTileAssets(assetBaseUrl, 'FARMING_SOIL'), loadGroundTileAssets(assetBaseUrl, 'MONKEY_DOCK'),
      loadGroundFalloffAssets(assetBaseUrl),
    ]);
    this.falloffAssets = falloff;
    this.visual = new THREE.Group();
    this.visual.name = 'EditableTurf';
    this.visual.add(dirt);
    for (const [name, assets] of [['DECIDUOUS', deciduous], ['GRASS', grass], ['WOODFLOOR', woodfloor], ['FARMING_SOIL', farming], ['MONKEY_DOCK', dock]] as const) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), assets.material);
      mesh.name = `TurfBlend:${name}`;
      // LAYER_GROUND: stay within [-1, -0.6), below snow (-0.55) and LAYER_BACKGROUND decor (-0.5).
      mesh.renderOrder = -1 + 0.4 * GROUND_TILE_DEFINITIONS[name].renderOrder
        / (Math.max(...Object.values(GROUND_TILE_DEFINITIONS).map(tile => tile.renderOrder)) + 1);
      mesh.receiveShadow = true;
      this.visual.add(mesh);
      this.layers.set(WORLD_TILES[name], { mesh, assets });
    }
    // Only the falloff writes depth (prepass); turf layers stay depth-free and are ordered by renderOrder.
    this.falloffMesh = new THREE.Mesh(new THREE.BufferGeometry(), falloff.material);
    this.falloffMesh.name = 'TurfFalloff';
    // Above dirt (-1.5) but below every turf layer (>= -1): turf is drawn after, so it covers the falloff where they are coplanar.
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
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), assets.material);
      mesh.name = 'TurfOcean:OCEAN_COASTAL';
      mesh.renderOrder = -1.75;
      this.ocean.attach(mesh);
      this.visual.add(mesh);
      this.layers.set(WORLD_TILES.OCEAN_COASTAL, { mesh, assets });
    }
    this.rebuildGeometry();
    await Promise.all(this.terrainNames().filter(name => name !== 'DIRT' && !isOceanTile(WORLD_TILES[name])).map(name => this.prepareTurf(name)));
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

  /** Rebuild one turf layer's edge quads from the current original and dug tiles. */
  private rebuildLayer(tileId: number, mesh: THREE.Mesh, assets: GroundTileAssets): void {
    // Numeric cell keys: a full forest has over 168,000 tiles, so string keys per neighbour dominate load time.
    const { min, max } = this.cellRange();
    const width = max - min + 2;
    const cellKey = (col: number, row: number) => (row - min + 1) * width + (col - min + 1);
    const candidates = new Set<number>();
    const addAround = (col: number, row: number) => {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) candidates.add(cellKey(col + dx, row + dz));
    };
    if (tileId === WORLD_TILES.DECIDUOUS) {
      // The base plane fills distant unchanged cells. Around edited/generated
      // terrain, render its full cells as well as skirts at the source layer
      // order, so lower layers' skirts cannot leak over the original ground.
      for (const key of new Set([...this.originalTiles.keys(), ...this.dugTiles.keys()])) {
        const [col, row] = key.split(',').map(Number);
        addAround(col, row);
      }
    } else if (tileId === WORLD_TILES.FARMING_SOIL || tileId === WORLD_TILES.MONKEY_DOCK || tileId === WORLD_TILES.OCEAN_COASTAL) {
      for (const [key, tile] of this.dugTiles) {
        if (tileId === WORLD_TILES.OCEAN_COASTAL ? !isOceanTile(tile.tileId) : tile.tileId !== tileId) continue;
        const [col, row] = key.split(',').map(Number);
        if (tileId === WORLD_TILES.OCEAN_COASTAL) candidates.add(cellKey(col, row));
        else addAround(col, row);
      }
    } else {
      for (const [key, original] of this.originalTiles) {
        if ((this.dugTiles.get(key)?.tileId ?? original) !== tileId) continue;
        const [col, row] = key.split(',').map(Number);
        addAround(col, row);
      }
      for (const [key, tile] of this.dugTiles) {
        if (tile.tileId !== tileId || this.originalTiles.has(key)) continue;
        addAround(tile.col, tile.row);
      }
    }
    const edgeQuads: GroundTileQuad[] = [];
    for (const key of candidates) {
      const col = key % width + min - 1, row = Math.floor(key / width) + min - 1;
      // Skirts also fall off into impassable (void) cells; only cells outside the world have no surface.
      if (this.tileAt(col, row) === WORLD_TILES.INVALID) continue;
      const variant = tileId === WORLD_TILES.OCEAN_COASTAL ? 1 : this.variantAt(col, row, tileId);
      if (variant !== 17) edgeQuads.push({ col, row, variant });
    }
    mesh.geometry.dispose();
    mesh.geometry = groundTileGeometry(edgeQuads, assets, this.size);
    mesh.visible = edgeQuads.length > 0;
  }

  private rebuildGeometry(bounds?: TerrainCellBounds): void {
    this.terrainNamesCache = undefined;
    for (const listener of this.terrainListeners) listener(bounds);
    if (!this.dirt || !this.dirtAssets) return;
    const quads = [...this.dugTiles.values()].filter(({ tileId }) => tileId === WORLD_TILES.DIRT)
      .map((tile) => ({ ...tile, variant: 1 }));
    for (const tile of this.dugTiles.values()) {
      if (!isOceanTile(tile.tileId)) continue;
      const variant = this.variantAt(tile.col, tile.row, WORLD_TILES.DIRT);
      if (variant !== 17) quads.push({ ...tile, variant });
    }
    const geometry = groundTileGeometry(quads, this.dirtAssets, this.size);
    this.dirt.geometry.dispose();
    this.dirt.geometry = geometry;
    this.dirt.visible = quads.length > 0;
    for (const [tileId, { mesh, assets }] of this.layers) this.rebuildLayer(tileId, mesh, assets);
    this.rebuildFalloff();
    this.ocean?.rebuildColours();
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
    this.dirt?.geometry.dispose();
    this.dirtAssets?.material.dispose();
    for (const { mesh, assets } of this.layers.values()) { mesh.geometry.dispose(); assets.material.dispose(); }
    this.falloffMesh?.geometry.dispose();
    this.falloffMesh = undefined;
    this.falloffAssets?.material.dispose();
    this.falloffAssets = undefined;
    this.layers.clear();
    this.layerRequests.clear();
    this.listeners.clear();
    this.terrainListeners.clear();
    this.visual = undefined;
    this.dirt = undefined;
    this.dirtAssets = undefined;
  }
}

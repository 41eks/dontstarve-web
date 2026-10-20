import type { MinimapOceanConfig } from './minimap-ocean';
import { createMinimapTilePainter, pixelsCanvas, type MinimapPixels, type MinimapCellBounds, type MinimapTerrain, type MinimapTileLayer } from './minimap-terrain';
import type { MinimapView } from './minimap-view';

const CHUNK_CELLS = 32;
const DETAIL_PX = 32;
const OVERVIEW_BYTES = 32 * 1024 * 1024;
const DETAIL_BYTES = 64 * 1024 * 1024;
const OCEAN_SIDE = 2048;
const TASK_MS = 6;

export interface MinimapTerrainChunk extends MinimapCellBounds { readonly key: string; readonly canvas: OffscreenCanvas; readonly resolution: number }
type Chunk = MinimapTerrainChunk;
export type MinimapChunkChange = { layer: 'overview' | 'detail'; key: string; chunk?: MinimapTerrainChunk };
const release = (canvas: OffscreenCanvas) => { canvas.width = canvas.height = 0; };

/** Owns static terrain rasters. No entity state or gameplay clock is sampled here.
 * The complete overview is prepared during loading; a bounded detail cache is
 * filled cooperatively for visible chunks when the user zooms in.
 */
export class MinimapTerrainLayer {
  readonly min: number;
  readonly max: number;
  readonly overviewPixelsPerCell: number;
  private readonly overview = new Map<string, Chunk>();
  private readonly details = new Map<string, Chunk>();
  private readonly dirty = new Map<string, MinimapCellBounds>();
  private readonly requested = new Map<string, MinimapCellBounds & { resolution: number }>();
  private readonly listeners = new Set<(change: MinimapChunkChange) => void>();
  private activeView?: MinimapView;
  private pixelRatio = 1;
  private visible: readonly (MinimapCellBounds & { key: string })[] = [];
  private readonly painters = new Map<number, Map<number, ReturnType<typeof createMinimapTilePainter>>>();
  private layers?: ReadonlyMap<number, MinimapTileLayer>;
  private ocean?: MinimapOceanConfig;
  private oceanCanvas?: OffscreenCanvas;
  private oceanCells?: Uint8Array;
  private oceanDirty = true;
  private cancelOcean?: () => void;
  private preparation?: Promise<void>;
  private detailTask?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private initialized = false;
  private revision = 0;
  private drawnView = '';
  private readonly stopTerrain: () => void;
  private readonly terrain: MinimapTerrain;
  private readonly cellSize: number;
  private readonly overviewEnabled: boolean;

  /** `overview: false` skips the cached overview chunks: terrain edits only invalidate, and
   * the owner pulls rasters with `prepareInputs()` and `paintCells()`.
   */
  constructor(terrain: MinimapTerrain, cellSize: number, overviewEnabled = true) {
    this.overviewEnabled = overviewEnabled;
    this.terrain = terrain;
    this.cellSize = cellSize;
    const { min, max } = terrain.cellRange();
    this.min = min; this.max = max;
    this.overviewPixelsPerCell = Math.min(DETAIL_PX, Math.max(1, Math.floor(Math.sqrt(OVERVIEW_BYTES / 4) / (max - min))));
    this.invalidate();
    this.stopTerrain = terrain.onTerrainChanged(bounds => {
      this.invalidate(bounds);
      // Terrain mutations finish before starting any raster work.
      if (this.overviewEnabled) void Promise.resolve().then(() => this.prepare()).catch(error => console.error('Unable to update minimap terrain', error));
    });
  }

  get ready(): boolean { return !this.disposed && this.initialized && this.dirty.size === 0 && !this.oceanDirty; }

  chunks(layer: 'overview' | 'detail'): Iterable<MinimapTerrainChunk> {
    return (layer === 'overview' ? this.overview : this.details).values();
  }

  onChunkChanged(listener: (change: MinimapChunkChange) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private publish(layer: 'overview' | 'detail', key: string, chunk?: MinimapTerrainChunk): void {
    for (const listener of this.listeners) listener({ layer, key, chunk });
  }

  /** Awaited by gameReady before simulation and the first game frame start. */
  prepare(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.preparation ??= this.buildOverview().finally(() => { this.preparation = undefined; });
    return this.preparation.then(() => this.disposed || this.ready ? undefined : this.prepare());
  }

  private invalidate(bounds?: MinimapCellBounds): void {
    const side = this.max - this.min;
    if (bounds && this.oceanCells && this.ocean) {
      for (let row = Math.max(this.min, bounds.minRow); row < Math.min(this.max, bounds.maxRow); row++) {
        for (let col = Math.max(this.min, bounds.minCol); col < Math.min(this.max, bounds.maxCol); col++) {
          const i = (row - this.min) * side + col - this.min;
          const ocean = Number(this.ocean.oceanTileIds.has(this.terrain.tileIdAtCell(col, row)));
          if (this.oceanCells[i] !== ocean) { this.oceanCells[i] = ocean; this.oceanDirty = true; }
        }
      }
    } else this.oceanDirty = true;
    // A changed ocean mask can affect globally normalized shader UVs and blur.
    // Land-only edits invalidate the eight-neighbour mask halo, including across chunks.
    const changed = bounds && !this.oceanDirty ? {
      minCol: bounds.minCol - 1, minRow: bounds.minRow - 1,
      maxCol: bounds.maxCol + 1, maxRow: bounds.maxRow + 1,
    } : { minCol: this.min, minRow: this.min, maxCol: this.max, maxRow: this.max };
    for (const chunk of this.chunksIn(changed)) {
      this.dirty.set(chunk.key, chunk);
      const detail = this.details.get(chunk.key);
      if (detail) release(detail.canvas);
      this.details.delete(chunk.key);
      if (detail) this.publish('detail', chunk.key);
      this.requested.delete(chunk.key);
    }
    this.revision++;
  }

  private *chunksIn(bounds: MinimapCellBounds): Generator<MinimapCellBounds & { key: string }> {
    const startCol = Math.max(0, Math.floor((bounds.minCol - this.min) / CHUNK_CELLS));
    const startRow = Math.max(0, Math.floor((bounds.minRow - this.min) / CHUNK_CELLS));
    const endCol = Math.ceil((Math.min(this.max, bounds.maxCol) - this.min) / CHUNK_CELLS);
    const endRow = Math.ceil((Math.min(this.max, bounds.maxRow) - this.min) / CHUNK_CELLS);
    for (let row = startRow; row < endRow; row++) for (let col = startCol; col < endCol; col++) {
      const minCol = this.min + col * CHUNK_CELLS, minRow = this.min + row * CHUNK_CELLS;
      yield { key: `${col},${row}`, minCol, minRow,
        maxCol: Math.min(this.max, minCol + CHUNK_CELLS), maxRow: Math.min(this.max, minRow + CHUNK_CELLS) };
    }
  }

  private async buildOverview(): Promise<void> {
    // A mutation may have loaded a new turf's art since the preceding build.
    const [layers, ocean] = await Promise.all([this.terrain.tileLayerImages(), this.terrain.minimapOcean()]);
    if (this.disposed) return;
    this.layers = layers; this.ocean = ocean;
    let deadline = performance.now() + TASK_MS;
    while (!this.disposed && (this.oceanDirty || this.dirty.size)) {
      if (this.oceanDirty) await this.buildOcean();
      if (this.disposed) return;
      if (this.oceanDirty) continue;
      const next = this.dirty.entries().next().value;
      if (next) {
        const [key, bounds] = next;
        this.dirty.delete(key);
        const old = this.overview.get(key);
        if (old) release(old.canvas);
        const chunk = { ...bounds, key, resolution: this.overviewPixelsPerCell, canvas: this.paint(bounds, this.overviewPixelsPerCell) };
        this.overview.set(key, chunk);
        this.publish('overview', key, chunk);
        this.revision++;
      }
      if (performance.now() >= deadline) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        deadline = performance.now() + TASK_MS;
      }
    }
    if (!this.disposed) {
      this.initialized = true;
      if (this.activeView) this.updateView(this.activeView, this.pixelRatio);
    }
  }

  /** Loads layer images and the whole-world ocean raster. Returns false when disposed meanwhile. */
  async prepareInputs(): Promise<boolean> {
    const [layers, ocean] = await Promise.all([this.terrain.tileLayerImages(), this.terrain.minimapOcean()]);
    if (this.disposed) return false;
    this.layers = layers; this.ocean = ocean;
    while (!this.disposed && this.oceanDirty) await this.buildOcean();
    return !this.disposed;
  }

  /** Pixel-exact composition of the cells in `bounds`; call after `prepareInputs()`. */
  paintCells(bounds: MinimapCellBounds, pixelsPerCell: number): OffscreenCanvas {
    if (!this.layers || !this.ocean) throw new Error('Minimap terrain inputs are not prepared');
    return this.paint(bounds, pixelsPerCell);
  }

  private async buildOcean(): Promise<void> {
    const side = this.max - this.min, ocean = this.ocean!;
    const cells = this.oceanCells = new Uint8Array(side * side);
    let hasOcean = false;
    for (let row = 0; row < side; row++) for (let col = 0; col < side; col++) {
      const value = Number(ocean.oceanTileIds.has(this.terrain.tileIdAtCell(this.min + col, this.min + row)));
      cells[row * side + col] = value;
      if (value) hasOcean = true;
    }
    this.oceanDirty = false;
    // Blur and shade off the UI thread. Both blur inputs and output retain
    // whole-world UVs; chunk boundaries cannot change the coast or paper noise.
    const pixels = hasOcean ? await new Promise<MinimapPixels | undefined>((resolve, reject) => {
      const worker = new Worker(new URL('./minimap-ocean.worker.ts', import.meta.url), { type: 'module' });
      const finish = () => { worker.terminate(); this.cancelOcean = undefined; };
      this.cancelOcean = () => { finish(); resolve(undefined); };
      worker.onmessage = (event: MessageEvent<{ pixels?: MinimapPixels; error?: string }>) => {
        finish();
        if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.pixels);
      };
      worker.onerror = event => { finish(); reject(new Error(event.message)); };
      worker.postMessage({ side, cellSize: this.cellSize, cells, config: ocean, pixelsPerCell: Math.min(12, OCEAN_SIDE / side) });
    }).catch(error => { this.oceanDirty = true; throw error; }) : undefined;
    if (this.disposed) return;
    if (this.oceanCanvas) release(this.oceanCanvas);
    this.oceanCanvas = pixels ? pixelsCanvas(pixels) : undefined;
  }

  private paint(bounds: MinimapCellBounds, pixelsPerCell: number): OffscreenCanvas {
    const canvas = new OffscreenCanvas((bounds.maxCol - bounds.minCol) * pixelsPerCell, (bounds.maxRow - bounds.minRow) * pixelsPerCell);
    const context = canvas.getContext('2d')!;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    if (this.oceanCanvas) {
      const step = this.oceanCanvas.width / (this.max - this.min);
      context.drawImage(this.oceanCanvas, (bounds.minCol - this.min) * step, (bounds.minRow - this.min) * step,
        (bounds.maxCol - bounds.minCol) * step, (bounds.maxRow - bounds.minRow) * step, 0, 0, canvas.width, canvas.height);
    }
    const layers = this.layers!, ocean = this.ocean!;
    for (let row = bounds.minRow; row < bounds.maxRow; row++) for (let col = bounds.minCol; col < bounds.maxCol; col++) {
      const id = this.terrain.tileIdAtCell(col, row);
      if (id === 0 || this.terrain.isVoidAtCell?.(col, row) || ocean.oceanTileIds.has(id) || layers.has(id)) continue;
      context.fillStyle = '#808080';
      context.fillRect((col - bounds.minCol) * pixelsPerCell, (row - bounds.minRow) * pixelsPerCell, pixelsPerCell, pixelsPerCell);
    }
    let painters = this.painters.get(pixelsPerCell);
    if (!painters) { painters = new Map(); this.painters.set(pixelsPerCell, painters); }
    const quads = this.terrain.tileLayerQuads(bounds);
    for (const [id, layer] of [...layers].sort((a, b) => a[1].renderOrder - b[1].renderOrder)) {
      if (ocean.oceanTileIds.has(id) || !quads.get(id)?.length) continue;
      let paint = painters.get(id);
      if (!paint) { paint = createMinimapTilePainter(layer, pixelsPerCell); painters.set(id, paint); }
      for (const quad of quads.get(id)!) context.drawImage(paint(quad),
        (quad.col - bounds.minCol) * pixelsPerCell, (quad.row - bounds.minRow) * pixelsPerCell);
    }
    if (context.isContextLost()) throw new Error(`Minimap terrain canvas lost its context (${canvas.width} × ${canvas.height})`);
    return canvas;
  }

  /** Request visible detail independently of presentation. No per-frame drawing is needed. */
  updateView(view: MinimapView, pixelRatio = 1): void {
    this.activeView = view;
    this.pixelRatio = pixelRatio;
    if (!this.initialized) return;
    const corners = [[0, 0], [view.width, 0], [view.width, view.height], [0, view.height]].map(([x, y]) => view.screenToWorld(x, y));
    const bounds = {
      minCol: Math.floor(Math.min(...corners.map(p => p.x)) / this.cellSize),
      minRow: Math.floor(Math.min(...corners.map(p => p.z)) / this.cellSize),
      maxCol: Math.ceil(Math.max(...corners.map(p => p.x)) / this.cellSize),
      maxRow: Math.ceil(Math.max(...corners.map(p => p.z)) / this.cellSize),
    };
    this.requested.clear();
    // Match detail density to screen pixels. Near the overview scale, 8px
    // chunks cover much more world than 32px chunks within the same budget.
    const visible = this.visible = [...this.chunksIn(bounds)];
    let resolution = Math.min(DETAIL_PX, 2 ** Math.ceil(Math.log2(view.scale * this.cellSize * pixelRatio)));
    const cells = visible.reduce((sum, chunk) => sum + (chunk.maxCol - chunk.minCol) * (chunk.maxRow - chunk.minRow), 0);
    while (resolution > this.overviewPixelsPerCell && cells * resolution ** 2 * 4 > DETAIL_BYTES) resolution /= 2;
    const detail = resolution > this.overviewPixelsPerCell;
    for (const cell of visible) {
      const cached = this.details.get(cell.key);
      const high = detail && cached && cached.resolution === resolution ? cached : undefined;
      if (high) { this.details.delete(cell.key); this.details.set(cell.key, high); }
      else if (detail && !this.dirty.has(cell.key)) this.requested.set(cell.key, { ...cell, resolution });
    }
    this.scheduleDetail();
  }

  /** Canvas compositor retained for the standalone rendering comparison, not the game map. */
  draw(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, view: MinimapView): void {
    if (!this.initialized) return;
    this.updateView(view);
    const signature = [view.centerX, view.centerZ, view.zoom, view.heading, view.width, view.height, this.revision].join(',');
    if (signature === this.drawnView) return;
    this.drawnView = signature;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, view.width, view.height);
    for (const cell of this.visible) {
      const chunk = this.details.get(cell.key) ?? this.overview.get(cell.key);
      if (!chunk) continue;
      context.setTransform(...view.canvasTransform(chunk.minCol * this.cellSize, chunk.minRow * this.cellSize, this.cellSize / chunk.resolution));
      context.drawImage(chunk.canvas, 0, 0);
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
  }

  private scheduleDetail(): void {
    if (this.detailTask !== undefined || !this.requested.size || this.disposed) return;
    this.detailTask = setTimeout(() => {
      this.detailTask = undefined;
      const next = this.requested.entries().next().value;
      if (!next || this.disposed) return;
      const [key, bounds] = next;
      this.requested.delete(key);
      const old = this.details.get(key);
      if (old) release(old.canvas);
      this.details.delete(key);
      const chunk = { ...bounds, key, canvas: this.paint(bounds, bounds.resolution) };
      this.details.set(key, chunk);
      this.publish('detail', key, chunk);
      let bytes = [...this.details.values()].reduce((sum, chunk) => sum + chunk.canvas.width * chunk.canvas.height * 4, 0);
      while (bytes > DETAIL_BYTES) {
        const oldest = this.details.keys().next().value!;
        const canvas = this.details.get(oldest)!.canvas;
        bytes -= canvas.width * canvas.height * 4;
        release(canvas);
        this.details.delete(oldest);
        this.publish('detail', oldest);
      }
      this.revision++;
      this.scheduleDetail();
    }, 0);
  }

  suspend(): void {
    this.activeView = undefined;
    this.visible = [];
    if (this.detailTask !== undefined) clearTimeout(this.detailTask);
    this.detailTask = undefined;
    this.requested.clear();
    this.drawnView = '';
  }

  dispose(): void {
    this.disposed = true;
    this.cancelOcean?.();
    this.stopTerrain();
    this.suspend();
    for (const chunk of [...this.overview.values(), ...this.details.values()]) release(chunk.canvas);
    for (const painters of this.painters.values()) for (const painter of painters.values()) painter.dispose();
    this.overview.clear(); this.details.clear(); this.dirty.clear(); this.painters.clear();
    this.listeners.clear();
    if (this.oceanCanvas) release(this.oceanCanvas);
    this.oceanCanvas = undefined; this.oceanCells = undefined; this.layers = undefined; this.ocean = undefined;
  }
}

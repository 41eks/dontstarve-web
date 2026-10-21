/** Straight-alpha RGBA pixels, top row first. */
export interface MinimapPixels { readonly data: Uint8ClampedArray; readonly width: number; readonly height: number }

/** Inputs of MapLayerManager:CreateRenderLayer, in source layer order. */
export interface MinimapTileLayer {
  readonly cells: ReadonlyMap<number, MinimapPixels>;
  readonly noise: MinimapPixels;
  readonly renderOrder: number;
}

export interface MinimapTileQuad { readonly col: number; readonly row: number; readonly variant: number }
export interface MinimapTileRegion {
  readonly canvas: OffscreenCanvas;
  readonly x: number;
  readonly y: number;
  readonly size: number;
}
export interface MinimapTilePainter {
  /** Borrowed atlas region; draw synchronously before its cache slot can be evicted or disposed. */
  (quad: MinimapTileQuad): MinimapTileRegion;
  dispose(): void;
}

export interface MinimapCellBounds { minCol: number; minRow: number; maxCol: number; maxRow: number }

/** Terrain read model, independent of the live icon collection and map view. */
export interface MinimapTerrain {
  cellRange(): { min: number; max: number };
  tileIdAtCell(col: number, row: number): number;
  isVoidAtCell?(col: number, row: number): boolean;
  tileLayerImages(): Promise<ReadonlyMap<number, MinimapTileLayer>>;
  tileLayerQuads(bounds?: MinimapCellBounds): ReadonlyMap<number, readonly MinimapTileQuad[]>;
  minimapOcean(): Promise<import('./minimap-ocean').MinimapOceanConfig>;
  onTerrainChanged(listener: (bounds?: MinimapCellBounds) => void): () => void;
}

export function pixelsCanvas(pixels: MinimapPixels): OffscreenCanvas {
  const canvas = new OffscreenCanvas(pixels.width, pixels.height);
  canvas.getContext('2d', { willReadFrequently: true })!.putImageData(new ImageData(Uint8ClampedArray.from(pixels.data), pixels.width, pixels.height), 0, 0);
  return canvas;
}

/** Creating an OffscreenCanvas costs a synchronous round trip, so scaling reuses one
 * canvas per size. Sources and targets are separate: a mask already at `size` must survive its own scaling.
 */
const scratches = new Map<string, OffscreenCanvasRenderingContext2D>();
function scratch(role: 'source' | 'target', width: number, height: number): OffscreenCanvasRenderingContext2D {
  const key = `${role}:${width}x${height}`;
  let context = scratches.get(key);
  if (!context) {
    // Read back right after one draw: keep the raster on the CPU instead of waiting on the GPU.
    context = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })!;
    scratches.set(key, context);
  }
  return context;
}

function scaledPixels(pixels: MinimapPixels, size: number): Uint8ClampedArray {
  const source = scratch('source', pixels.width, pixels.height);
  source.putImageData(new ImageData(pixels.data as Uint8ClampedArray<ArrayBuffer>, pixels.width, pixels.height), 0, 0);
  const target = scratch('target', size, size);
  target.clearRect(0, 0, size, size);
  target.imageSmoothingEnabled = true;
  target.imageSmoothingQuality = 'high';
  target.drawImage(source.canvas, 0, 0, size, size);
  return target.getImageData(0, 0, size, size).data;
}

const TILE_CACHE_CAPACITY = 128;
const TILE_ATLAS_COLUMNS = 16;

/** minimap.ksh: atlas RGB *= world-space noise RGB; atlas alpha stays intact.
 * Compose before drawing to the map so multiply cannot affect the layers below.
 * Reuse masks at the 8x8 world-space noise offsets across chunk rebuilds.
 */
export function createMinimapTilePainter(layer: MinimapTileLayer, cellSize: number): MinimapTilePainter {
  const periodCells = 8;
  const period = periodCells * cellSize;
  let noise = scaledPixels(layer.noise, period);
  const masks = new Map<number, Uint8ClampedArray>();
  const tiles = new Map<string, MinimapTileRegion>();
  const canvas = new OffscreenCanvas(TILE_ATLAS_COLUMNS * cellSize, Math.ceil(TILE_CACHE_CAPACITY / TILE_ATLAS_COLUMNS) * cellSize);
  // These putImageData-backed tiles are also drawn into CPU capture chunks.
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  const wrap = (value: number) => ((value % periodCells) + periodCells) % periodCells;
  const paint: MinimapTilePainter = ({ col, row, variant }) => {
    const cx = wrap(col), cy = wrap(row);
    const key = `${variant},${cx},${cy}`;
    const cached = tiles.get(key);
    if (cached) {
      tiles.delete(key); tiles.set(key, cached);
      return cached;
    }
    let mask = masks.get(variant);
    if (!mask) {
      const cell = layer.cells.get(variant);
      if (!cell) throw new Error(`Minimap layer lacks mask ${variant}`);
      mask = scaledPixels(cell, cellSize);
      masks.set(variant, mask);
    }
    const data = new Uint8ClampedArray(mask.length);
    for (let y = 0; y < cellSize; y++) for (let x = 0; x < cellSize; x++) {
      const at = (y * cellSize + x) * 4;
      const sample = ((cy * cellSize + y) * period + cx * cellSize + x) * 4;
      for (let channel = 0; channel < 3; channel++) data[at + channel] = mask[at + channel] * noise[sample + channel] / 255;
      data[at + 3] = mask[at + 3];
    }
    // One drawable atlas per layer/resolution; reuse the least recently used slot at capacity.
    let tile: MinimapTileRegion;
    if (tiles.size === TILE_CACHE_CAPACITY) {
      const oldest = tiles.keys().next().value!;
      tile = tiles.get(oldest)!;
      tiles.delete(oldest);
    } else {
      const slot = tiles.size;
      tile = { canvas, x: slot % TILE_ATLAS_COLUMNS * cellSize,
        y: Math.floor(slot / TILE_ATLAS_COLUMNS) * cellSize, size: cellSize };
    }
    // putImageData replaces transparent pixels too, clearing the slot's previous silhouette.
    context.putImageData(new ImageData(data, cellSize, cellSize), tile.x, tile.y);
    tiles.set(key, tile);
    return tile;
  };
  paint.dispose = () => {
    canvas.width = canvas.height = 0;
    tiles.clear(); masks.clear(); noise = new Uint8ClampedArray();
  };
  return paint;
}

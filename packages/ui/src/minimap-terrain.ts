/** Straight-alpha RGBA pixels, top row first. */
export interface MinimapPixels { readonly data: Uint8ClampedArray; readonly width: number; readonly height: number }

/** Inputs of MapLayerManager:CreateRenderLayer, in source layer order. */
export interface MinimapTileLayer {
  readonly cells: ReadonlyMap<number, MinimapPixels>;
  readonly noise: MinimapPixels;
  readonly renderOrder: number;
}

export interface MinimapTileQuad { readonly col: number; readonly row: number; readonly variant: number }

export function pixelsCanvas(pixels: MinimapPixels): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  canvas.getContext('2d')!.putImageData(new ImageData(Uint8ClampedArray.from(pixels.data), pixels.width, pixels.height), 0, 0);
  return canvas;
}

function scaledPixels(pixels: MinimapPixels, size: number): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d')!;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(pixelsCanvas(pixels), 0, 0, size, size);
  return context.getImageData(0, 0, size, size).data;
}

/** minimap.ksh: atlas RGB *= world-space noise RGB; atlas alpha stays intact.
 * Compose before drawing to the map so multiply cannot affect the layers below.
 * Reuse each mask at each of the 8x8 world-space noise offsets within one rebuild.
 */
export function createMinimapTilePainter(layer: MinimapTileLayer, cellSize: number): (quad: MinimapTileQuad) => HTMLCanvasElement {
  const periodCells = 8;
  const period = periodCells * cellSize;
  const noise = scaledPixels(layer.noise, period);
  const masks = new Map<number, Uint8ClampedArray>();
  const tiles = new Map<string, HTMLCanvasElement>();
  const wrap = (value: number) => ((value % periodCells) + periodCells) % periodCells;
  return ({ col, row, variant }) => {
    const cx = wrap(col), cy = wrap(row);
    const key = `${variant},${cx},${cy}`;
    const cached = tiles.get(key);
    if (cached) return cached;
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
    const tile = pixelsCanvas({ data, width: cellSize, height: cellSize });
    tiles.set(key, tile);
    return tile;
  };
}

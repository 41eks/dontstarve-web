import type { MinimapTerrain } from './minimap-terrain';
import { MinimapTerrainLayer } from './minimap-terrain-layer';
import { MINIMAP_MARGIN_RATIO, MINIMAP_ZOOM_DEFAULT, MINIMAP_ZOOM_MAX } from './minimap-view';
import { traceMinimapAlphaOutline } from './minimap-alpha-outline';

const CHUNK_CELLS = 32;
/** Source mask/noise art is at most this many texels per cell. */
const MAX_PIXELS_PER_CELL = 32;
const MAX_SIDE = 8192;
const SAMPLE_DENSITY = .75;

export interface GroundImageOptions {
  terrain: MinimapTerrain;
  cellSize: number;
}

/** A single decoded terrain image, regenerated only for terrain edits or a larger viewport.
 * Land cells are composed directly from the tile masks and noise; ocean stays transparent over the ocean plate.
 */
export class MinimapGroundImage {
  readonly image = document.createElement('img');
  readonly hitRegion = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private readonly outline = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  private readonly options: GroundImageOptions;
  private readonly layer: MinimapTerrainLayer;
  private readonly stopTerrain: () => void;
  private revision = 0;
  private paintedRevision = -1;
  private perCell = 0;
  private requestedPerCell = 0;
  /** Lowered when this browser cannot encode or decode the image at the requested density. */
  private maxPerCell = MAX_PIXELS_PER_CELL;
  private preparation?: Promise<void>;
  private updateTask?: ReturnType<typeof setTimeout>;
  private url?: string;
  private disposed = false;

  constructor(options: GroundImageOptions) {
    this.options = options;
    this.layer = new MinimapTerrainLayer(options.terrain, options.cellSize, { overview: false, ocean: false });
    const { min, max } = options.terrain.cellRange();
    this.image.className = 'minimap__ground';
    this.image.alt = ''; this.image.draggable = false;
    for (const element of [this.image, this.hitRegion]) Object.assign(element.style, {
      position: 'absolute', display: 'block', maxWidth: 'none', pointerEvents: 'none',
      left: `${min / (max - min) * 100}%`, top: `${min / (max - min) * 100}%`, width: '100%', height: '100%',
    });
    this.hitRegion.classList.add('minimap__land-hit-region');
    this.hitRegion.setAttribute('aria-hidden', 'true');
    this.outline.classList.add('minimap__land-hit');
    this.outline.setAttribute('fill', 'transparent');
    this.outline.setAttribute('fill-rule', 'evenodd');
    this.hitRegion.append(this.outline);
    this.stopTerrain = options.terrain.onTerrainChanged(() => {
      this.revision++;
      // The owning terrain finishes replacing its cells before the composition starts.
      this.schedule();
    });
    this.requestSize(window.innerWidth, window.innerHeight);
  }

  get ready(): boolean {
    return !this.disposed && Boolean(this.url) && this.paintedRevision === this.revision && this.perCell >= this.requestedPerCell;
  }

  requestSize(width: number, height: number): void {
    if (this.disposed) return;
    // Sample at 75% of the default zoom's device-pixel density.
    // The final image is bounded to 256 MiB RGBA.
    const { min, max } = this.options.terrain.cellRange(), cells = max - min;
    const pixels = Math.ceil(1.5 * Math.max(width, height) * (window.devicePixelRatio || 1)
      * MINIMAP_ZOOM_MAX / MINIMAP_ZOOM_DEFAULT / (1 + 2 * MINIMAP_MARGIN_RATIO) * SAMPLE_DENSITY);
    const perCell = Math.max(1, Math.min(this.maxPerCell, Math.floor(MAX_SIDE / cells), Math.ceil(pixels / cells)));
    if (perCell <= this.requestedPerCell) return;
    this.requestedPerCell = perCell;
    this.schedule();
  }

  private schedule(): void {
    if (this.disposed || this.updateTask !== undefined) return;
    this.updateTask = setTimeout(() => {
      this.updateTask = undefined;
      void this.prepare().catch(error => console.error('Unable to update ground map image', error));
    }, 0);
  }

  prepare(): Promise<void> {
    clearTimeout(this.updateTask); this.updateTask = undefined;
    if (this.disposed || this.ready) return Promise.resolve();
    return this.preparation ??= this.capture().finally(() => { this.preparation = undefined; });
  }

  private async capture(): Promise<void> {
    while (!this.disposed && !this.ready) {
      const revision = this.revision, perCell = this.requestedPerCell;
      try {
        const rendered = await this.render(perCell, revision);
        if (this.disposed) return;
        if (!rendered || revision !== this.revision || perCell !== this.requestedPerCell) continue;
        const url = URL.createObjectURL(rendered.blob);
        let retained = false;
        try {
          const decoded = new Image(); decoded.src = url; await decoded.decode();
          if (this.disposed) return;
          if (revision !== this.revision || perCell !== this.requestedPerCell) continue;
          const previous = this.url;
          this.url = url; this.image.src = url;
          this.hitRegion.setAttribute('viewBox', `0 0 ${rendered.side} ${rendered.side}`);
          this.outline.setAttribute('d', rendered.outline);
          this.perCell = perCell; this.paintedRevision = revision;
          retained = true;
          if (previous) URL.revokeObjectURL(previous);
        } finally { if (!retained) URL.revokeObjectURL(url); }
      } catch (error) {
        if (this.disposed || perCell <= 1) throw error;
        // A very large image can exceed the browser's canvas, encoder or decoder limits; retry at half the density.
        this.maxPerCell = Math.floor(perCell / 2);
        this.requestedPerCell = Math.min(this.requestedPerCell, this.maxPerCell);
        console.warn(`Unable to build the ground map image at ${perCell} px per cell; retrying at ${this.requestedPerCell}`, error);
      }
    }
  }

  private async render(pixelsPerCell: number, revision: number): Promise<{ blob: Blob; outline: string; side: number } | undefined> {
    const { min, max } = this.options.terrain.cellRange();
    const side = (max - min) * pixelsPerCell;
    const stale = () => this.disposed || revision !== this.revision || pixelsPerCell !== this.requestedPerCell;
    if (!await this.layer.prepareInputs() || stale()) return undefined;
    const canvas = new OffscreenCanvas(side, side), context = canvas.getContext('2d')!;
    const outlines: string[] = [];
    try {
      // Cells are composed from the source masks and noise, one source texel per output pixel.
      for (let row = min; row < max; row += CHUNK_CELLS) for (let col = min; col < max; col += CHUNK_CELLS) {
        const bounds = { minCol: col, minRow: row, maxCol: Math.min(max, col + CHUNK_CELLS), maxRow: Math.min(max, row + CHUNK_CELLS) };
        const chunk = this.layer.paintCells(bounds, pixelsPerCell);
        const x = (col - min) * pixelsPerCell, y = (row - min) * pixelsPerCell;
        context.drawImage(chunk, x, y);
        outlines.push(traceMinimapAlphaOutline(chunk.getContext('2d')!.getImageData(0, 0, chunk.width, chunk.height), x, y));
        chunk.width = chunk.height = 0;
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        if (stale()) return undefined;
      }
      return { blob: await canvas.convertToBlob(), outline: outlines.join(''), side };
    } finally { canvas.width = canvas.height = 0; }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.updateTask); this.updateTask = undefined;
    this.stopTerrain(); this.layer.dispose(); this.image.remove(); this.image.removeAttribute('src');
    this.hitRegion.remove(); this.outline.removeAttribute('d');
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = undefined;
  }
}

import { AssetElement } from './assets';
import { MinimapView, MINIMAP_ZOOM_MAX, MINIMAP_ZOOM_MIN } from './minimap-view';
import { renderMinimapOcean, type MinimapOceanConfig } from './minimap-ocean';
import { createMinimapTilePainter, pixelsCanvas, type MinimapTileLayer, type MinimapTileQuad } from './minimap-terrain';
import { loadMinimapIcon } from '@dontstarve-web/prefab/minimapIcons';
import type { MiniMapEntity } from '@dontstarve-web/prefab/minimapEntity';
import styles from './styles/minimap.css?inline';

export type { MinimapPixels, MinimapTileLayer } from './minimap-terrain';

/** Terrain read model of the map, in signed grid cells (see TurfMap). */
export interface MinimapTerrain {
  cellRange(): { min: number; max: number };
  tileIdAtCell(col: number, row: number): number;
  tileLayerImages(): Promise<ReadonlyMap<number, MinimapTileLayer>>;
  tileLayerQuads(): ReadonlyMap<number, readonly MinimapTileQuad[]>;
  minimapOcean(): Promise<MinimapOceanConfig>;
  onTerrainChanged(listener: () => void): () => void;
}

export interface MinimapOptions {
  terrain: MinimapTerrain;
  /** World units per grid cell (TILE_SIZE). */
  cellSize: number;
  getPlayerPosition(): { x: number; z: number };
  miniMapEntities?: readonly MiniMapEntity[];
  getMiniMapEntities?(): readonly MiniMapEntity[];
}

export interface MinimapStateDetail { isOpen: boolean }

const FALLBACK_COLOUR = '#808080';
/** Base canvas pixels per grid cell. */
const CELL_PX = 32;
/** Pixels per grid cell of the ocean pass, one per world unit of a 12-unit cell. */
const OCEAN_PX = 12;
/** Seconds to ease a zoom change, as MapScreen TIMETOZOOM. */
const ZOOM_EASE_SECONDS = 0.1;
const WHEEL_ZOOM_PER_PIXEL = 0.0015;
const DRAG_THRESHOLD_PX = 3;

export class DstMinimapElement extends AssetElement {
  private options?: MinimapOptions;
  /** Exposed read-only for browser tests. */
  view?: MinimapView;
  private root!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private base?: HTMLCanvasElement;
  private layers?: ReadonlyMap<number, MinimapTileLayer>;
  private ocean?: MinimapOceanConfig;
  private baseDirty = true;
  private open = false;
  private frame = 0;
  private lastTime = 0;
  private zoomFrom = MINIMAP_ZOOM_MIN;
  private zoomTarget = MINIMAP_ZOOM_MIN;
  private zoomLeft = 0;
  private cursor = { x: 0, y: 0 };
  private drag?: { pointer: number; x: number; y: number; moved: boolean };
  private stopTerrain?: () => void;
  private resizeObserver?: ResizeObserver;
  private readonly icons = new Map<string, HTMLCanvasElement | null>();
  private iconGeneration = 0;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  get isOpen(): boolean { return this.open; }

  bind(options: MinimapOptions): void {
    this.stopTerrain?.();
    this.options = options;
    this.iconGeneration++;
    this.icons.clear();
    for (const entity of this.mapEntities()) this.loadIcon(entity.icon);
    const { min, max } = options.terrain.cellRange();
    this.view = new MinimapView((max - min) * options.cellSize);
    this.baseDirty = true;
    this.layers = undefined;
    this.ocean = undefined;
    void Promise.all([options.terrain.tileLayerImages(), options.terrain.minimapOcean()]).then(([layers, ocean]) => {
      if (this.options === options) { this.layers = layers; this.ocean = ocean; this.baseDirty = true; }
    }).catch((error: unknown) => console.error('Unable to load minimap layers', error));
    this.stopTerrain = options.terrain.onTerrainChanged(() => { this.baseDirty = true; });
    if (this.isConnected) this.resize();
  }

  setOpen(isOpen: boolean): void {
    if (isOpen === this.open || !this.options) return;
    this.open = isOpen;
    this.root.hidden = !isOpen;
    if (isOpen) {
      this.recenter();
      this.zoomFrom = this.zoomTarget = this.view!.zoom;
      this.zoomLeft = 0;
      this.resize();
      this.lastTime = performance.now();
      this.frame = requestAnimationFrame(this.tick);
    } else {
      cancelAnimationFrame(this.frame);
      this.drag = undefined;
      this.root.classList.remove('minimap--dragging');
    }
    this.dispatchEvent(new CustomEvent<MinimapStateDetail>('game:map-state', { bubbles: true, composed: true, detail: { isOpen } }));
  }

  protected render(): void {
    this.shadowRoot!.innerHTML = `
      <style>${styles}</style>
      <section class="minimap" aria-label="地图" hidden>
        <canvas class="minimap__canvas"></canvas>
        <button class="minimap__center" type="button">定位玩家</button>
      </section>
    `;
    const root = this.root = this.shadowRoot!.querySelector<HTMLElement>('.minimap')!;
    this.canvas = root.querySelector<HTMLCanvasElement>('.minimap__canvas')!;
    root.querySelector('.minimap__center')!.addEventListener('click', () => this.recenter());
    root.addEventListener('wheel', this.onWheel, { passive: false });
    root.addEventListener('pointerdown', this.onPointerDown);
    root.addEventListener('pointermove', this.onPointerMove);
    root.addEventListener('pointerup', this.onPointerEnd);
    root.addEventListener('pointercancel', this.onPointerEnd);
    window.addEventListener('keydown', this.onKeyDown);
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(root);
    if (this.open) root.hidden = false;
  }

  disconnectedCallback(): void {
    cancelAnimationFrame(this.frame);
    window.removeEventListener('keydown', this.onKeyDown);
    this.resizeObserver?.disconnect();
    this.stopTerrain?.();
    this.stopTerrain = undefined;
    this.iconGeneration++;
    this.icons.clear();
  }

  dispose(): void {
    this.setOpen(false);
    this.disconnectedCallback();
    this.options = undefined;
    this.layers = undefined;
    this.ocean = undefined;
    this.base = undefined;
    this.view = undefined;
  }

  private loadIcon(icon: string): void {
    if (!icon || this.icons.has(icon)) return;
    this.icons.set(icon, null);
    const generation = this.iconGeneration;
    void loadMinimapIcon(this.dataAsset(''), icon).then(sprite => {
      if (generation === this.iconGeneration) {
        this.icons.set(icon, pixelsCanvas({ data: Uint8ClampedArray.from(sprite.pixels), width: sprite.width, height: sprite.height }));
      }
    }).catch((error: unknown) => {
      if (generation === this.iconGeneration) console.error(`Unable to load minimap icon ${icon}`, error);
    });
  }

  private mapEntities(): readonly MiniMapEntity[] {
    return this.options?.getMiniMapEntities?.() ?? this.options?.miniMapEntities ?? [];
  }

  private recenter(): void {
    if (!this.options || !this.view) return;
    const { x, z } = this.options.getPlayerPosition();
    this.view.center(x, z);
  }

  private resize(): void {
    if (!this.view || !this.canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const width = this.root.clientWidth, height = this.root.clientHeight;
    this.canvas.width = Math.max(1, Math.round(width * ratio));
    this.canvas.height = Math.max(1, Math.round(height * ratio));
    this.view.resize(this.canvas.width, this.canvas.height);
  }

  /**
   * Ocean underneath; land layers in source order with map_edge neighbour masks.
   */
  private rebuildBase(): void {
    const { terrain } = this.options!;
    const options = this.options!;
    const { min, max } = terrain.cellRange();
    const side = (max - min) * CELL_PX;
    const base = this.base ??= document.createElement('canvas');
    base.width = base.height = side;
    const context = base.getContext('2d')!;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, side, side);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    const layers = this.layers!;
    const ocean = this.ocean!;
    const tileIds = (col: number, row: number) => terrain.tileIdAtCell(min + col, min + row);
    const hasOcean = (() => {
      for (let row = 0; row < max - min; row++) for (let col = 0; col < max - min; col++) {
        if (ocean.oceanTileIds.has(tileIds(col, row))) return true;
      }
      return false;
    })();
    if (hasOcean) {
      // minimapocean.ksh draws all ocean tiles in one pass underneath the land layers.
      const pass = renderMinimapOcean(max - min, options.cellSize, (col, row) => ocean.oceanTileIds.has(tileIds(col, row)), ocean, OCEAN_PX);
      const passCanvas = pixelsCanvas(pass);
      context.drawImage(passCanvas, 0, 0, side, side);
    }
    for (let row = min; row < max; row++) for (let col = min; col < max; col++) {
      const tileId = terrain.tileIdAtCell(col, row);
      if (tileId === 0 || ocean.oceanTileIds.has(tileId)) continue; // outside the world, or drawn by the ocean pass
      const x = (col - min) * CELL_PX, y = (row - min) * CELL_PX;
      if (!layers.has(tileId)) { context.fillStyle = FALLBACK_COLOUR; context.fillRect(x, y, CELL_PX, CELL_PX); }
    }
    const quads = terrain.tileLayerQuads();
    for (const [tileId, layer] of [...layers].sort((a, b) => a[1].renderOrder - b[1].renderOrder)) {
      if (ocean.oceanTileIds.has(tileId)) continue;
      const paint = createMinimapTilePainter(layer, CELL_PX);
      for (const quad of quads.get(tileId) ?? []) {
        context.drawImage(paint(quad), (quad.col - min) * CELL_PX, (quad.row - min) * CELL_PX);
      }
    }
    this.baseDirty = false;
  }

  private tick = (time: number): void => {
    if (!this.open) return;
    const dt = Math.min(0.1, (time - this.lastTime) / 1000);
    this.lastTime = time;
    this.advanceZoom(dt);
    this.draw();
    this.frame = requestAnimationFrame(this.tick);
  };

  private advanceZoom(dt: number): void {
    if (this.zoomLeft <= 0) return;
    this.zoomLeft = Math.max(0, this.zoomLeft - dt);
    const progress = 1 - this.zoomLeft / ZOOM_EASE_SECONDS;
    const ratio = window.devicePixelRatio || 1;
    this.view!.zoomAt(this.cursor.x * ratio, this.cursor.y * ratio, this.zoomFrom + (this.zoomTarget - this.zoomFrom) * progress);
  }

  private draw(): void {
    const { view, options } = this;
    if (!view || !options) return;
    if (!this.layers || !this.ocean) return;
    if (this.baseDirty || !this.base) this.rebuildBase();
    const context = this.canvas.getContext('2d')!;
    const { min, max } = options.terrain.cellRange();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    // Base row j covers world z from (min + j) * cell upward on screen, so flip Y.
    const cell = options.cellSize, scale = view.scale, pixel = cell * scale / CELL_PX;
    const origin = view.worldToScreen(min * cell, min * cell);
    context.setTransform(pixel, 0, 0, -pixel, origin.x, origin.z);
    context.drawImage(this.base!, 0, 0);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.strokeStyle = '#6f6248';
    context.lineWidth = 2;
    const corner = view.worldToScreen(max * cell, max * cell);
    context.strokeRect(origin.x, corner.z, corner.x - origin.x, origin.z - corner.z);

    // Player SetCanUseCache(false): project its live transform on every map
    // frame, independently of the cached terrain. Higher priority draws last.
    const entities = [...this.mapEntities()].sort((a, b) => a.priority - b.priority);
    for (const entity of entities) {
      if (!entity.enabled || !entity.icon) continue;
      this.loadIcon(entity.icon);
      const icon = this.icons.get(entity.icon);
      if (!icon) continue;
      const point = view.worldToScreen(entity.position.x, entity.position.z);
      const size = 32 * (window.devicePixelRatio || 1);
      const height = size * icon.height / icon.width;
      context.drawImage(icon, point.x - size / 2, point.z - height / 2, size, height);
    }
  }

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (!this.view) return;
    const rect = this.root.getBoundingClientRect();
    this.cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    // MapScreen accumulates the target multiplicatively, then eases toward it.
    this.zoomFrom = this.view.zoom;
    this.zoomTarget = Math.min(MINIMAP_ZOOM_MAX, Math.max(MINIMAP_ZOOM_MIN,
      this.zoomTarget * Math.min(2, Math.max(0.5, 1 - event.deltaY * WHEEL_ZOOM_PER_PIXEL))));
    this.zoomLeft = ZOOM_EASE_SECONDS;
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || (event.target as Element).closest('.minimap__center')) return;
    this.drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    this.root.setPointerCapture(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent): void => {
    const rect = this.root.getBoundingClientRect();
    this.cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const drag = this.drag;
    if (!drag || drag.pointer !== event.pointerId || !this.view) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    // Like MapWidget's drag threshold, ignore tiny jitters so clicks stay clicks.
    if (!drag.moved && dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    this.root.classList.add('minimap--dragging');
    const ratio = window.devicePixelRatio || 1;
    this.view.pan(dx * ratio, dy * ratio);
    drag.x = event.clientX;
    drag.y = event.clientY;
  };

  private onPointerEnd = (event: PointerEvent): void => {
    if (this.drag?.pointer !== event.pointerId) return;
    this.drag = undefined;
    this.root.classList.remove('minimap--dragging');
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target;
    const isTextInput = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
      || (target instanceof HTMLElement && target.isContentEditable);
    if (isTextInput || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'KeyM') this.setOpen(!this.open);
    else if (event.code === 'Escape' && this.open) this.setOpen(false);
  };
}

import { watchSignal, createEffect, type ReadonlySignal } from '@dontstarve-web/signals';
import { AssetElement } from './assets';
import { MinimapView, MINIMAP_ZOOM_DEFAULT, MINIMAP_ZOOM_MAX, MINIMAP_ZOOM_MIN } from './minimap-view';
import { MinimapDomRenderer, type MinimapInspection } from './minimap-dom';
import type { GroundImageOptions } from './minimap-ground-image';
import type { MiniMapEntity } from '@dontstarve-web/prefab/minimapEntity';
import { Vector3 } from 'three';
import { createAtlasImage, registerImageAtlases, type AtlasImageElement } from '@dontstarve-web/animation/atlasImage';
import { loadImageAtlas } from '@dontstarve-web/animation/imageAtlas';
import styles from './styles/minimap.css?inline';

export type { MinimapPixels, MinimapTileLayer } from './minimap-terrain';

export type { MinimapTerrain } from './minimap-terrain';

export interface MinimapOptions extends GroundImageOptions {
  getPlayerPosition(): { x: number; z: number };
  /** TheCamera:GetHeading() in degrees; the map's up direction follows the camera. */
  cameraHeading: ReadonlySignal<number>;
  miniMapEntities?: readonly MiniMapEntity[];
  getMiniMapEntities?(): readonly MiniMapEntity[];
}

export interface MinimapStateDetail { isOpen: boolean; autopaused: boolean }
/** Cancel the request event after accepting its action to release the map's own autopause. */
export interface MinimapActionRequestDetail { position: Vector3 }

/** How often live entity positions are sampled, in milliseconds. */
export const MINIMAP_ENTITY_SAMPLE_MS = 100;
const DRAG_THRESHOLD_PX = 3;
const ZOOM_EASE_SECONDS = 0.1;
/** PlayerProfile default 15; MapScreen applies sensitivity * direction / 60. */
const ZOOM_SENSITIVITY = 15;

/** Main-thread fullscreen DOM map. View changes transform a shared world container;
 * entity samples and terrain notifications update only their own nodes. */
export class DstMinimapElement extends AssetElement {
  private options?: MinimapOptions;
  view?: MinimapView;
  private root!: HTMLElement;
  private background?: AtlasImageElement;
  private renderer?: MinimapDomRenderer;
  private open = false;
  private autopaused = false;
  private sampleTimer?: ReturnType<typeof setInterval>;
  private drag?: { pointer: number; x: number; y: number; moved: boolean };
  private readonly headingCleanups: (() => void)[] = [];
  private resizeObserver?: ResizeObserver;
  private zoomFrame?: number;
  private zoomFrom = MINIMAP_ZOOM_DEFAULT;
  private zoomTarget = MINIMAP_ZOOM_DEFAULT;
  private zoomStartedAt = 0;
  private cursor = { x: 0, y: 0 };

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  get isOpen(): boolean { return this.open; }

  bind(options: MinimapOptions): void {
    this.disposeRenderer();
    this.releaseHeading();
    this.options = options;
    const { min, max } = options.terrain.cellRange();
    const view = this.view = new MinimapView((max - min) * options.cellSize);
    const heading = watchSignal(options.cameraHeading, stop => { this.headingCleanups.push(stop); });
    view.heading = heading.peek();
    this.renderer = new MinimapDomRenderer(options, this.dataAsset(''));
    if (this.root) this.root.insertBefore(this.renderer.root, this.root.querySelector('.minimap__center'));
    createEffect(() => {
      view.heading = heading.get();
      this.updateView();
    });
    if (this.isConnected) this.resize();
    if (this.open) this.startOpen();
  }

  /** Prepare static map art while the world generation page is still visible. */
  async prepareTerrain(): Promise<void> {
    await Promise.all([this.renderer?.prepare(), this.background?.ready]);
  }

  setView({ x, z, zoom }: { x?: number; z?: number; zoom?: number }): void {
    const { view } = this;
    if (!view) return;
    if (zoom !== undefined) view.zoom = Math.min(MINIMAP_ZOOM_MAX, Math.max(MINIMAP_ZOOM_MIN, zoom));
    if (x !== undefined || z !== undefined) view.center(x ?? view.centerX, z ?? view.centerZ);
    this.cancelZoom();
    this.updateView();
  }

  inspect(): Promise<MinimapInspection> {
    return this.renderer ? Promise.resolve(this.renderer.inspect()) : Promise.reject(new Error('Minimap is not bound'));
  }

  setOpen(isOpen: boolean): void {
    if (isOpen === this.open || !this.options) return;
    this.open = isOpen;
    this.autopaused = isOpen;
    if (this.root) this.root.hidden = !isOpen;
    if (isOpen) {
      this.resize();
      this.startOpen(this.options.getPlayerPosition());
    } else {
      this.cancelDrag();
      this.stopSampling();
      this.cancelZoom();
    }
    this.notifyMapState();
  }

  private notifyMapState(): void {
    this.dispatchEvent(new CustomEvent<MinimapStateDetail>('game:map-state', { bubbles: true, composed: true,
      detail: { isOpen: this.open, autopaused: this.autopaused } }));
  }

  protected render(): void {
    this.shadowRoot!.innerHTML = `
      <style>${styles}</style>
      <section class="minimap" aria-label="地图" hidden>
        <button class="minimap__center" type="button">定位玩家</button>
      </section>
    `;
    const root = this.root = this.shadowRoot!.querySelector<HTMLElement>('.minimap')!;
    // mapwidget.lua: map.tex from hud.xml/hud.tex, centered and stretched with SCALEMODE_FILLSCREEN.
    // Registration also supports standalone maps; the UI's shared atlas cache owns decoding and URLs.
    const archive = this.dataAsset('databundles/images.zip');
    registerImageAtlases({ 'images/hud.xml': () => loadImageAtlas(archive, 'images/hud.xml') });
    this.background = createAtlasImage('minimap__background', 'images/hud.xml', 'map.tex');
    root.prepend(this.background);
    if (this.renderer) root.insertBefore(this.renderer.root, root.querySelector('.minimap__center'));
    root.querySelector('.minimap__center')!.addEventListener('click', () => this.recenter());
    root.addEventListener('wheel', this.onWheel, { passive: false });
    root.addEventListener('pointerdown', this.onPointerDown);
    root.addEventListener('pointermove', this.onPointerMove);
    root.addEventListener('pointerup', this.onPointerEnd);
    root.addEventListener('pointercancel', this.onPointerEnd);
    root.addEventListener('lostpointercapture', this.onPointerEnd);
    root.addEventListener('contextmenu', event => event.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(root);
    if (this.options && !this.renderer) {
      this.bind(this.options);
      void this.prepareTerrain().catch(error => console.error('Unable to prepare minimap terrain', error));
    }
    root.hidden = !this.open;
    if (this.open) this.resize();
  }

  private releaseHeading(): void {
    for (const stop of this.headingCleanups.splice(0)) stop();
  }

  private disposeRenderer(): void {
    this.stopSampling();
    this.cancelZoom();
    this.renderer?.dispose();
    this.renderer = undefined;
  }

  disconnectedCallback(): void {
    this.setOpen(false);
    window.removeEventListener('keydown', this.onKeyDown);
    this.resizeObserver?.disconnect();
    this.disposeRenderer();
    this.releaseHeading();
  }

  dispose(): void {
    this.setOpen(false);
    this.disconnectedCallback();
    this.options = undefined;
    this.view = undefined;
  }

  private mapEntities(): readonly MiniMapEntity[] {
    return this.options?.getMiniMapEntities?.() ?? this.options?.miniMapEntities ?? [];
  }

  private sampleEntities = (): void => {
    this.renderer?.syncEntities(this.mapEntities());
  };

  private startOpen(center?: { x: number; z: number }): void {
    this.sampleEntities();
    this.stopSampling();
    this.sampleTimer = setInterval(this.sampleEntities, MINIMAP_ENTITY_SAMPLE_MS);
    if (center) this.view?.center(center.x, center.z);
    this.cancelZoom();
    this.updateView();
  }

  private stopSampling(): void {
    clearInterval(this.sampleTimer);
    this.sampleTimer = undefined;
  }

  private updateView(): void {
    if (this.open && this.view) this.renderer?.update(this.view);
  }

  private recenter(): void {
    if (!this.options) return;
    const { x, z } = this.options.getPlayerPosition();
    this.view?.center(x, z);
    this.updateView();
  }

  private resize(): void {
    if (!this.view || !this.root || !this.open) return;
    // DOM positions are CSS pixels; devicePixelRatio is handled by the browser.
    this.view.resize(this.root.clientWidth, this.root.clientHeight);
    this.updateView();
  }

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (!this.view || !this.open || event.deltaY === 0) return;
    const rect = this.root.getBoundingClientRect();
    this.cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    this.zoomFrom = this.view.zoom;
    this.zoomTarget = Math.min(MINIMAP_ZOOM_MAX, Math.max(MINIMAP_ZOOM_MIN,
      this.zoomTarget + this.zoomTarget * ZOOM_SENSITIVITY * Math.sign(event.deltaY) / 60));
    this.zoomStartedAt = performance.now();
    this.zoomFrame ??= requestAnimationFrame(this.advanceZoom);
  };

  private advanceZoom = (): void => {
    this.zoomFrame = undefined;
    if (!this.open || !this.view) return;
    // Input can arrive after this frame's RAF timestamp. Sample the same clock
    // as onWheel so retargeting cannot produce negative progress or reverse zoom.
    const progress = Math.min(1, (performance.now() - this.zoomStartedAt) / (ZOOM_EASE_SECONDS * 1000));
    this.view.zoomAt(this.cursor.x, this.cursor.y, this.zoomFrom + (this.zoomTarget - this.zoomFrom) * progress);
    this.updateView();
    if (progress < 1) this.zoomFrame = requestAnimationFrame(this.advanceZoom);
  };

  private cancelZoom(): void {
    if (this.zoomFrame !== undefined) cancelAnimationFrame(this.zoomFrame);
    this.zoomFrame = undefined;
    this.zoomFrom = this.zoomTarget = this.view?.zoom ?? MINIMAP_ZOOM_DEFAULT;
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.open || !this.view || event.defaultPrevented) return;
    if (event.button === 2) {
      // The browser has already hit the alpha-derived SVG silhouette. No terrain lookup on hover.
      if (!(event.target instanceof Element) || !event.target.matches('.minimap__land-hit')) return;
      event.preventDefault();
      const rect = this.root.getBoundingClientRect();
      const point = this.view.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
      const accepted = !this.dispatchEvent(new CustomEvent<MinimapActionRequestDetail>('game:map-action-request', {
        bubbles: true, composed: true, cancelable: true, detail: { position: new Vector3(point.x, 0, point.z) },
      }));
      // MapScreen keeps BLINK_MAP open and releases its autopause once an action starts.
      if (accepted && this.open && this.autopaused) { this.autopaused = false; this.notifyMapState(); }
      return;
    }
    if (event.button !== 0 || (event.target as Element).closest('.minimap__center')) return;
    this.drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    this.root.setPointerCapture(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || drag.pointer !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    // Like MapWidget's drag threshold, ignore tiny jitters so clicks stay clicks.
    if (!drag.moved && dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    this.root.classList.add('minimap--dragging');
    this.view?.pan(dx, dy);
    this.updateView();
    drag.x = event.clientX;
    drag.y = event.clientY;
  };

  private onPointerEnd = (event: PointerEvent): void => {
    if (this.drag?.pointer !== event.pointerId) return;
    this.cancelDrag();
  };

  private cancelDrag(): void {
    const pointer = this.drag?.pointer;
    this.drag = undefined;
    if (pointer !== undefined && this.root.hasPointerCapture(pointer)) this.root.releasePointerCapture(pointer);
    this.root?.classList.remove('minimap--dragging');
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target;
    const isTextInput = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
      || (target instanceof HTMLElement && target.isContentEditable);
    if (isTextInput || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'KeyM') this.setOpen(!this.open);
    else if (event.code === 'Escape' && this.open) this.setOpen(false);
  };
}

import { loadMinimapIcon, preloadMinimapAtlases } from '@dontstarve-web/prefab/minimapIcons';
import type { MiniMapEntity } from '@dontstarve-web/prefab/minimapEntity';
import { MinimapDomView } from './minimap-dom-view';
import { MinimapGroundImage, type GroundImageOptions } from './minimap-ground-image';
import { pixelsCanvas } from './minimap-terrain';
import { MINIMAP_MARGIN_RATIO, type MinimapView } from './minimap-view';

/** World cells covered by one repeat of the ocean plate. */
const OCEAN_PLATE_CELLS = 32;

export interface MinimapInspection { ready: boolean; icons: string[] }
interface Marker { element: HTMLImageElement; icon: string; x: number; z: number; order: number }

/** Main-thread DOM presentation. Terrain owns pixels, this owner owns decoded
 * image URLs/nodes; MiniMapEntity remains authoritative for live icon state.
 */
export class MinimapDomRenderer {
  readonly dom: MinimapDomView;
  readonly terrain: MinimapGroundImage;
  private readonly markers = new Map<MiniMapEntity, Marker>();
  private readonly icons = new Map<string, Promise<string | undefined>>();
  private readonly loadedIcons = new Set<string>();
  private readonly urls = new Set<string>();
  private disposed = false;
  private readonly dataRoot: string;
  private readonly worldSize: number;

  constructor(options: GroundImageOptions, dataRoot: string) {
    this.dataRoot = dataRoot;
    this.terrain = new MinimapGroundImage(options);
    const { min, max } = options.terrain.cellRange(), unit = options.cellSize;
    this.worldSize = (max - min) * unit;
    this.dom = new MinimapDomView(this.worldSize);
    const plate = document.createElement('div');
    const margin = MINIMAP_MARGIN_RATIO * 100, side = 100 + 2 * margin;
    const repeat = OCEAN_PLATE_CELLS * unit / (this.worldSize * (1 + 2 * MINIMAP_MARGIN_RATIO)) * 100;
    // Open ocean is one seamless pre-rendered plate (scripts/render-minimap-ocean.mjs), not computed per world.
    plate.className = 'minimap__ocean';
    Object.assign(plate.style, { position: 'absolute', left: `${min / (max - min) * 100 - margin}%`, top: `${min / (max - min) * 100 - margin}%`,
      width: `${side}%`, height: `${side}%`,
      backgroundImage: `url(${import.meta.env.BASE_URL}minimap/ocean.png)`, backgroundSize: `${repeat}%` });
    this.dom.overview.append(plate, this.terrain.image, this.terrain.hitRegion);
  }

  get root(): HTMLElement { return this.dom.root; }

  /** Terrain and the icon atlases are ready before the first marker or the map is shown. */
  async prepare(): Promise<void> {
    await Promise.all([
      this.terrain.prepare(),
      // A failed preload only defers the work: loadMinimapIcon requests the atlas again on demand.
      preloadMinimapAtlases(this.dataRoot).catch(error => console.error('Unable to preload minimap icon atlases', error)),
    ]);
  }

  inspect(): MinimapInspection {
    return { ready: this.terrain.ready, icons: [...this.loadedIcons] };
  }

  update(view: MinimapView): void {
    if (this.disposed) return;
    this.dom.update(view);
    this.terrain.requestSize(view.width, view.height);
  }

  /** Called on entity samples, never on pan/zoom. Identity keeps static nodes stable. */
  syncEntities(entities: readonly MiniMapEntity[]): void {
    if (this.disposed) return;
    const enabled = entities.filter(entity => entity.enabled && entity.icon).sort((a, b) => a.priority - b.priority);
    const live = new Set(enabled);
    for (const [entity, marker] of this.markers) if (!live.has(entity)) {
      marker.element.remove(); this.markers.delete(entity);
    }
    enabled.forEach((entity, order) => {
      let marker = this.markers.get(entity);
      if (!marker) {
        const element = document.createElement('img');
        element.className = 'marker'; element.alt = ''; element.draggable = false; element.hidden = true;
        this.dom.icons.append(element);
        marker = { element, icon: '', x: NaN, z: NaN, order: -1 };
        this.markers.set(entity, marker);
      }
      const { x, z } = entity.position;
      if (marker.x !== x) { marker.element.style.left = `${x / this.worldSize * 100}%`; marker.x = x; }
      if (marker.z !== z) { marker.element.style.top = `${z / this.worldSize * 100}%`; marker.z = z; }
      if (marker.order !== order) { marker.element.style.zIndex = String(order); marker.order = order; }
      if (marker.icon !== entity.icon) {
        const icon = marker.icon = entity.icon, current = marker;
        marker.element.dataset.icon = icon;
        marker.element.hidden = true;
        void this.loadIcon(icon).then(url => {
          if (!url || this.disposed || this.markers.get(entity) !== current || current.icon !== icon) return;
          current.element.src = url;
          current.element.hidden = false;
        });
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.terrain.dispose();
    this.dom.root.remove();
    this.dom.icons.replaceChildren(); this.dom.overview.replaceChildren();
    this.markers.clear(); this.icons.clear(); this.loadedIcons.clear();
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.clear();
  }

  private createUrl(blob: Blob): string {
    const url = URL.createObjectURL(blob); this.urls.add(url); return url;
  }

  private releaseUrl(url?: string): void {
    if (url && this.urls.delete(url)) URL.revokeObjectURL(url);
  }

  private loadIcon(icon: string): Promise<string | undefined> {
    let pending = this.icons.get(icon);
    if (!pending) {
      pending = (async () => {
        const sprite = await loadMinimapIcon(this.dataRoot, icon);
        if (this.disposed) return;
        const canvas = pixelsCanvas({ data: Uint8ClampedArray.from(sprite.pixels), width: sprite.width, height: sprite.height });
        let url: string | undefined;
        let retained = false;
        try {
          const blob = await canvas.convertToBlob();
          if (this.disposed) return;
          url = this.createUrl(blob);
          const decoded = new Image(); decoded.src = url; await decoded.decode();
          if (this.disposed) return;
          this.loadedIcons.add(icon);
          retained = true;
          return url;
        } finally {
          canvas.width = canvas.height = 0;
          if (!retained) this.releaseUrl(url);
        }
      })().catch(error => { if (!this.disposed) console.error(`Unable to load minimap icon ${icon}`, error); return undefined; });
      this.icons.set(icon, pending);
    }
    return pending;
  }
}

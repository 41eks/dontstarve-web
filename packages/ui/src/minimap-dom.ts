import { MinimapIcons } from '../../map/src/minimapIcons';
import { miniMapEntities, subscribeMiniMapEntities, type MiniMapMarker } from '../../map/src/minimapEntities';
import { MinimapDomView } from './minimap-dom-view';
import { MiniMapRenderer } from '../../map/src/miniMapRenderer';
import type { MinimapTerrain } from './minimap-terrain';
import type { MinimapView } from './minimap-view';

export interface MinimapTerrainOptions {
  terrain: MinimapTerrain;
  cellSize: number;
}

export interface MinimapInspection { ready: boolean; icons: string[] }
interface Marker { element: HTMLSpanElement; icon: string; x: number; z: number; priority: number }

/** Main-thread DOM presentation. The map package owns icon resources and entity
 * subscriptions; this renderer owns their DOM nodes and the terrain presentation.
 */
export class MinimapDomRenderer {
  readonly dom: MinimapDomView;
  readonly terrain: MiniMapRenderer;
  private readonly markers = new Map<MiniMapMarker, Marker>();
  private readonly icons: MinimapIcons;
  private readonly loadedIcons = new Set<string>();
  private stopWatching?: () => void;
  private disposed = false;
  private readonly worldSize: number;

  constructor(options: MinimapTerrainOptions, dataRoot: string) {
    this.icons = new MinimapIcons(dataRoot);
    // Open ocean is one seamless pre-rendered plate (scripts/render-minimap-ocean.mjs), drawn below the land layers.
    this.terrain = new MiniMapRenderer({ ...options, oceanPlateUrl: `${import.meta.env.BASE_URL}minimap/ocean.png` });
    const { min, max } = options.terrain.cellRange();
    this.worldSize = (max - min) * options.cellSize;
    this.dom = new MinimapDomView(this.worldSize);
    // The terrain is drawn in screen space, below the world container that carries the icons.
    this.dom.root.prepend(this.terrain.canvas);
  }

  get root(): HTMLElement { return this.dom.root; }
  get isListening(): boolean { return this.stopWatching !== undefined; }

  /** Opening reconciles once; declarations and tile changes update only their own nodes afterwards. */
  start(): void {
    if (this.disposed || this.stopWatching) return;
    this.terrain.start();
    const current = miniMapEntities();
    for (const entity of this.markers.keys()) if (!current.has(entity)) this.updateEntity(entity, false);
    this.stopWatching = subscribeMiniMapEntities((entity, present) => this.updateEntity(entity, present));
  }

  stop(): void { this.terrain.stop(); this.stopWatching?.(); this.stopWatching = undefined; }

  /** Terrain and the icon atlases are ready before the first marker or the map is shown. */
  async prepare(): Promise<void> {
    await Promise.all([
      this.terrain.prepare(),
      this.icons.prewarm(),
    ]);
    if (this.isListening) for (const entity of miniMapEntities()) this.updateEntity(entity, true);
  }

  inspect(): MinimapInspection {
    return { ready: this.terrain.ready && this.icons.ready, icons: [...this.loadedIcons] };
  }

  update(view: MinimapView): void {
    if (this.disposed) return;
    this.dom.update(view);
    this.terrain.update(view);
  }

  /** Map notifications carry one changed entity, never a polled list. */
  private updateEntity(entity: MiniMapMarker, present: boolean): void {
    if (this.disposed) return;
    if (!present || !entity.enabled || !entity.icon) {
      this.markers.get(entity)?.element.remove(); this.markers.delete(entity);
      return;
    }
    let marker = this.markers.get(entity);
    if (!marker) {
      const element = document.createElement('span');
      element.className = 'marker'; element.setAttribute('aria-hidden', 'true'); element.hidden = true;
      this.dom.icons.append(element);
      marker = { element, icon: '', x: NaN, z: NaN, priority: NaN };
      this.markers.set(entity, marker);
    }
    const { x, z } = entity.position;
    if (marker.x !== x) { marker.element.style.left = `${x / this.worldSize * 100}%`; marker.x = x; }
    if (marker.z !== z) { marker.element.style.top = `${z / this.worldSize * 100}%`; marker.z = z; }
    if (marker.priority !== entity.priority) { marker.element.style.zIndex = String(entity.priority); marker.priority = entity.priority; }
    if (marker.icon !== entity.icon) {
      const icon = entity.icon, index = this.icons.index(icon), region = this.icons.get(index);
      if (!region) { marker.icon = ''; marker.element.hidden = true; return; }
      marker.icon = icon;
      marker.element.dataset.icon = icon;
      marker.element.dataset.index = String(index);
      marker.element.dataset.image = region.imageUrl;
      marker.element.style.aspectRatio = `${region.width} / ${region.height}`;
      marker.element.style.backgroundImage = `url("${region.imageUrl}")`;
      marker.element.style.backgroundSize = `${region.atlasWidth / region.width * 100}% ${region.atlasHeight / region.height * 100}%`;
      marker.element.style.backgroundPosition = `${region.atlasWidth === region.width ? 0 : region.x / (region.atlasWidth - region.width) * 100}% ${region.atlasHeight === region.height ? 0 : region.y / (region.atlasHeight - region.height) * 100}%`;
      marker.element.hidden = false;
      marker.element.dataset.loaded = 'true';
      this.loadedIcons.add(icon);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.terrain.dispose();
    this.dom.root.remove();
    this.dom.icons.replaceChildren(); this.dom.overview.replaceChildren();
    this.markers.clear(); this.icons.dispose(); this.loadedIcons.clear();
  }
}

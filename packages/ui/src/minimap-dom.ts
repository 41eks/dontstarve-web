import { MinimapIcons } from '../../map/src/minimapIcons';
import { miniMapEntities, subscribeMiniMapEntities, type MiniMapMarker } from '../../map/src/minimapEntities';
import { MinimapDomView } from './minimap-dom-view';
import { MinimapGroundImage, type GroundImageOptions } from './minimap-ground-image';
import { MINIMAP_MARGIN_RATIO, type MinimapView } from './minimap-view';

/** World cells covered by one repeat of the ocean plate. */
const OCEAN_PLATE_CELLS = 32;

export interface MinimapInspection { ready: boolean; icons: string[] }
interface Marker { element: HTMLSpanElement; icon: string; x: number; z: number; priority: number }

/** Main-thread DOM presentation. The map package owns icon resources and entity
 * subscriptions; this renderer owns their DOM nodes and the terrain presentation.
 */
export class MinimapDomRenderer {
  readonly dom: MinimapDomView;
  readonly terrain: MinimapGroundImage;
  private readonly markers = new Map<MiniMapMarker, Marker>();
  private readonly icons: MinimapIcons;
  private readonly loadedIcons = new Set<string>();
  private stopWatching?: () => void;
  private disposed = false;
  private readonly worldSize: number;

  constructor(options: GroundImageOptions, dataRoot: string) {
    this.icons = new MinimapIcons(dataRoot);
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
  get isListening(): boolean { return this.stopWatching !== undefined; }

  /** Opening reconciles once; declarations and tile changes update only their own nodes afterwards. */
  start(): void {
    if (this.disposed || this.stopWatching) return;
    const current = miniMapEntities();
    for (const entity of this.markers.keys()) if (!current.has(entity)) this.updateEntity(entity, false);
    this.stopWatching = subscribeMiniMapEntities((entity, present) => this.updateEntity(entity, present));
  }

  stop(): void { this.stopWatching?.(); this.stopWatching = undefined; }

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
    this.terrain.requestSize(view.width, view.height);
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

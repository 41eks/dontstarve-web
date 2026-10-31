import type { MiniMapMarker } from '../../map/src/minimapEntities';
import type { MinimapIcon } from '../../map/src/minimapIcons';
import { MINIMAP_ZOOM_DEFAULT, type MinimapView } from './minimap-view';

interface Marker { x: number; z: number; priority: number; icon: MinimapIcon }
/** Keep the existing size at the default zoom; icons scale with the terrain thereafter. */
const DEFAULT_ICON_WIDTH = 32;

/** One viewport-sized surface avoids layout and paint layers for thousands of icons. */
export class MinimapIconView {
  readonly root = document.createElement('div');
  readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private readonly markers = new Map<MiniMapMarker, Marker>();
  private ordered?: Marker[];
  private view?: MinimapView;
  private frame?: number;
  private active = false;
  private disposed = false;

  constructor() {
    this.root.className = 'minimap__viewport';
    Object.assign(this.root.style, { position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none' });
    this.canvas.className = 'minimap__icons';
    Object.assign(this.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', zIndex: '1' });
    this.context = this.canvas.getContext('2d')!;
    this.root.append(this.canvas);
  }

  entities(): IterableIterator<MiniMapMarker> { return this.markers.keys(); }

  set(entity: MiniMapMarker, icon: MinimapIcon): void {
    if (this.disposed) return;
    let marker = this.markers.get(entity);
    if (!marker) {
      marker = { x: entity.position.x, z: entity.position.z, priority: entity.priority, icon };
      this.markers.set(entity, marker);
      this.ordered = undefined;
    } else {
      if (marker.priority !== entity.priority) this.ordered = undefined;
      // Sample only on entity notifications, preserving TileTracker's update cadence.
      marker.x = entity.position.x; marker.z = entity.position.z;
      marker.priority = entity.priority; marker.icon = icon;
    }
    this.requestFrame();
  }

  delete(entity: MiniMapMarker): void {
    if (!this.markers.delete(entity)) return;
    this.ordered = undefined;
    this.requestFrame();
  }

  start(): void { if (!this.disposed) { this.active = true; this.requestFrame(); } }

  stop(): void {
    this.active = false;
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
  }

  update(view: MinimapView): void { this.view = view; this.requestFrame(); }

  private requestFrame(): void {
    if (!this.active || this.disposed || !this.view || this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => { this.frame = undefined; this.draw(); });
  }

  private draw(): void {
    const view = this.view!;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(view.width * ratio)), height = Math.max(1, Math.round(view.height * ratio));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    const context = this.context;
    context.setTransform(width / view.width, 0, 0, height / view.height, 0, 0);
    context.clearRect(0, 0, view.width, view.height);
    // Stable sort preserves registration order for equal source priorities.
    this.ordered ??= [...this.markers.values()].sort((a, b) => a.priority - b.priority);
    const iconWidth = DEFAULT_ICON_WIDTH * MINIMAP_ZOOM_DEFAULT / view.zoom;
    for (const marker of this.ordered) {
      const point = view.worldToScreen(marker.x, marker.z), icon = marker.icon;
      const iconHeight = iconWidth * icon.height / icon.width;
      if (point.x + iconWidth / 2 < 0 || point.x - iconWidth / 2 > view.width
        || point.z + iconHeight / 2 < 0 || point.z - iconHeight / 2 > view.height) continue;
      // Project the anchor with the map heading, but keep the icon's own axes upright.
      context.drawImage(icon.image, icon.x, icon.y, icon.width, icon.height,
        point.x - iconWidth / 2, point.z - iconHeight / 2, iconWidth, iconHeight);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.markers.clear(); this.ordered = undefined; this.view = undefined;
    this.canvas.width = this.canvas.height = 0;
    this.root.remove();
  }
}

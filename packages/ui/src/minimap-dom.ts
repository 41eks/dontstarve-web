import { MinimapIcons } from '../../map/src/minimapIcons';
import { miniMapEntities, subscribeMiniMapEntities, type MiniMapMarker } from '../../map/src/minimapEntities';
import { MinimapIconView } from './minimap-icon-view';
import { MiniMapRenderer } from '../../map/src/miniMapRenderer';
import type { MinimapTerrain } from './minimap-terrain';
import type { MinimapView } from './minimap-view';

export interface MinimapTerrainOptions {
  terrain: MinimapTerrain;
  cellSize: number;
}

export interface MinimapInspection { ready: boolean; icons: string[] }

/** Main-thread map presentation. The map package owns icon resources and entity
 * subscriptions; this renderer connects them to the icon and terrain surfaces.
 */
export class MinimapDomRenderer {
  readonly dom: MinimapIconView;
  readonly terrain: MiniMapRenderer;
  private readonly icons: MinimapIcons;
  private readonly loadedIcons = new Set<string>();
  private stopWatching?: () => void;
  private disposed = false;

  constructor(options: MinimapTerrainOptions, dataRoot: string) {
    this.icons = new MinimapIcons(dataRoot);
    // Open ocean is one seamless pre-rendered plate (scripts/render-minimap-ocean.mjs), drawn below the land layers.
    this.terrain = new MiniMapRenderer({ ...options, oceanPlateUrl: `${import.meta.env.BASE_URL}minimap/ocean.png` });
    this.dom = new MinimapIconView();
    // Both surfaces use screen space; negative icon priorities still stay above terrain.
    this.dom.root.prepend(this.terrain.canvas);
  }

  get root(): HTMLElement { return this.dom.root; }
  get isListening(): boolean { return this.stopWatching !== undefined; }

  /** Opening reconciles once; later notifications update only their own icon records. */
  start(): void {
    if (this.disposed || this.stopWatching) return;
    this.terrain.start();
    this.dom.start();
    const current = miniMapEntities();
    for (const entity of this.dom.entities()) if (!current.has(entity)) this.updateEntity(entity, false);
    this.stopWatching = subscribeMiniMapEntities((entity, present) => this.updateEntity(entity, present));
  }

  stop(): void { this.terrain.stop(); this.dom.stop(); this.stopWatching?.(); this.stopWatching = undefined; }

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

  /** Map notifications update one icon and coalesce drawing into the next frame. */
  private updateEntity(entity: MiniMapMarker, present: boolean): void {
    if (this.disposed) return;
    if (!present || !entity.enabled || !entity.icon) {
      this.dom.delete(entity);
      return;
    }
    const region = this.icons.get(this.icons.index(entity.icon));
    if (!region) { this.dom.delete(entity); return; }
    this.dom.set(entity, region);
    this.loadedIcons.add(entity.icon);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.terrain.dispose();
    this.dom.dispose(); this.icons.dispose(); this.loadedIcons.clear();
  }
}

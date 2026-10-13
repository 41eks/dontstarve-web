/** MapWidget zoom clamp from MiniMapRenderer ZOOM_CLAMP_MIN / ZOOM_CLAMP_MAX. */
export const MINIMAP_ZOOM_MIN = 1;
export const MINIMAP_ZOOM_MAX = 20;

export interface MinimapPoint { x: number; z: number }

/**
 * Pure view transform of the fullscreen map. Zoom 1 fits the whole world in the
 * smaller screen dimension. Screen up is +z, as in MiniMap:WorldPosToMapPos.
 */
export class MinimapView {
  centerX = 0;
  centerZ = 0;
  zoom = MINIMAP_ZOOM_MIN;

  readonly worldSize: number;
  width: number;
  height: number;

  constructor(worldSize: number, width = 1, height = 1) {
    this.worldSize = worldSize;
    this.width = width;
    this.height = height;
  }

  /** Screen pixels per world unit. */
  get scale(): number { return Math.min(this.width, this.height) / this.worldSize * this.zoom; }

  worldToScreen(x: number, z: number): MinimapPoint {
    return { x: this.width / 2 + (x - this.centerX) * this.scale, z: this.height / 2 - (z - this.centerZ) * this.scale };
  }

  screenToWorld(x: number, y: number): MinimapPoint {
    return { x: this.centerX + (x - this.width / 2) / this.scale, z: this.centerZ - (y - this.height / 2) / this.scale };
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.clampCenter();
  }

  /** Drag by a screen-space delta. */
  pan(dx: number, dy: number): void {
    this.centerX -= dx / this.scale;
    this.centerZ += dy / this.scale;
    this.clampCenter();
  }

  /** Sets the zoom while keeping the world point under the given screen position fixed. */
  zoomAt(screenX: number, screenY: number, zoom: number): void {
    const anchor = this.screenToWorld(screenX, screenY);
    this.zoom = Math.min(MINIMAP_ZOOM_MAX, Math.max(MINIMAP_ZOOM_MIN, zoom));
    this.centerX = anchor.x - (screenX - this.width / 2) / this.scale;
    this.centerZ = anchor.z + (screenY - this.height / 2) / this.scale;
    this.clampCenter();
  }

  center(x: number, z: number): void {
    this.centerX = x;
    this.centerZ = z;
    this.clampCenter();
  }

  /** Keeps the view centre inside the world so the map never scrolls out of sight. */
  private clampCenter(): void {
    const half = this.worldSize / 2;
    this.centerX = Math.min(half, Math.max(-half, this.centerX));
    this.centerZ = Math.min(half, Math.max(-half, this.centerZ));
  }
}

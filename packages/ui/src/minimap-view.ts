/** MapWidget zoom clamp from MiniMapRenderer ZOOM_CLAMP_MIN / ZOOM_CLAMP_MAX. */
export const MINIMAP_ZOOM_MIN = 1;
export const MINIMAP_ZOOM_MAX = 20;
/** Native MiniMapRenderer constructor; Lua MapScreen reads it through GetZoom(). */
export const MINIMAP_ZOOM_DEFAULT = 3;
/** Padding on each side, relative to the terrain's side length. */
export const MINIMAP_MARGIN_RATIO = .1;

export interface MinimapPoint { x: number; z: number }

/**
 * Pure view transform of the fullscreen map. Source zoom is a distance: 1 is
 * closest and 20 furthest. At furthest zoom the padded square's side is
 * 1.5 times the viewport's longer dimension, including after resizing.
 * Screen up is the camera's ground-plane forward, so the map turns with
 * TheCamera:GetHeading(); at heading -90 it is +z, as in MiniMap:WorldPosToMapPos.
 */
export class MinimapView {
  centerX = 0;
  centerZ = 0;
  private zoomDistance = MINIMAP_ZOOM_DEFAULT;
  /** TheCamera:GetHeading() in degrees; followcamera.lua looks along (-cos h, -sin h) on the ground. */
  private headingDegrees = -90;
  private forwardX = 0;
  private forwardZ = 1;
  private rightX = -1;
  private rightZ = 0;

  readonly worldSize: number;
  width: number;
  height: number;

  constructor(worldSize: number, width = 1, height = 1) {
    this.worldSize = worldSize;
    this.width = width;
    this.height = height;
  }

  get boundsSize(): number { return this.worldSize * (1 + 2 * MINIMAP_MARGIN_RATIO); }

  get zoom(): number { return this.zoomDistance; }
  set zoom(value: number) {
    this.zoomDistance = Math.min(MINIMAP_ZOOM_MAX, Math.max(MINIMAP_ZOOM_MIN, value));
    this.clampCenter();
  }

  get heading(): number { return this.headingDegrees; }

  set heading(degrees: number) {
    this.headingDegrees = degrees;
    const radians = degrees * Math.PI / 180;
    this.forwardX = -Math.cos(radians); this.forwardZ = -Math.sin(radians);
    // Three.js is right-handed: looking along forward with +Y up, screen right is forward x up.
    this.rightX = Math.sin(radians); this.rightZ = -Math.cos(radians);
    // Cancel float residue so the unrotated map stays pixel-exact.
    for (const key of ['forwardX', 'forwardZ', 'rightX', 'rightZ'] as const) if (Math.abs(this[key]) < 1e-12) this[key] = 0;
    this.clampCenter();
  }

  /** Screen pixels per world unit. */
  get scale(): number { return 1.5 * Math.max(this.width, this.height) / this.boundsSize * MINIMAP_ZOOM_MAX / this.zoom; }

  worldToScreen(x: number, z: number): MinimapPoint {
    const dx = x - this.centerX, dz = z - this.centerZ;
    return {
      x: this.width / 2 + (dx * this.rightX + dz * this.rightZ) * this.scale,
      z: this.height / 2 - (dx * this.forwardX + dz * this.forwardZ) * this.scale,
    };
  }

  screenToWorld(x: number, y: number): MinimapPoint {
    const right = (x - this.width / 2) / this.scale, forward = -(y - this.height / 2) / this.scale;
    return {
      x: this.centerX + right * this.rightX + forward * this.forwardX,
      z: this.centerZ + right * this.rightZ + forward * this.forwardZ,
    };
  }

  /** Canvas matrix [a, b, c, d, e, f] taking a pixel grid whose origin is world (originX, originZ), `unit` world units per pixel, to the screen. */
  canvasTransform(originX: number, originZ: number, unit: number): [number, number, number, number, number, number] {
    const k = unit * this.scale, origin = this.worldToScreen(originX, originZ);
    return [this.rightX * k, -this.forwardX * k, this.rightZ * k, -this.forwardZ * k, origin.x, origin.z];
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.clampCenter();
  }

  /** Drag by a screen-space delta. */
  pan(dx: number, dy: number): void {
    const right = dx / this.scale, forward = -dy / this.scale;
    this.centerX -= right * this.rightX + forward * this.forwardX;
    this.centerZ -= right * this.rightZ + forward * this.forwardZ;
    this.clampCenter();
  }

  /** Sets the zoom while keeping the world point under the given screen position fixed. */
  zoomAt(screenX: number, screenY: number, zoom: number): void {
    const anchor = this.screenToWorld(screenX, screenY);
    this.zoom = Math.min(MINIMAP_ZOOM_MAX, Math.max(MINIMAP_ZOOM_MIN, zoom));
    const right = (screenX - this.width / 2) / this.scale, forward = -(screenY - this.height / 2) / this.scale;
    this.centerX = anchor.x - right * this.rightX - forward * this.forwardX;
    this.centerZ = anchor.z - right * this.rightZ - forward * this.forwardZ;
    this.clampCenter();
  }

  center(x: number, z: number): void {
    this.centerX = x;
    this.centerZ = z;
    this.clampCenter();
  }

  /** Every viewport corner stays within the finite world-plus-margin square. */
  private clampCenter(): void {
    const half = this.boundsSize / 2;
    const extentX = (Math.abs(this.rightX) * this.width + Math.abs(this.forwardX) * this.height) / (2 * this.scale);
    const extentZ = (Math.abs(this.rightZ) * this.width + Math.abs(this.forwardZ) * this.height) / (2 * this.scale);
    const limitX = Math.max(0, half - extentX), limitZ = Math.max(0, half - extentZ);
    this.centerX = Math.min(limitX, Math.max(-limitX, this.centerX));
    this.centerZ = Math.min(limitZ, Math.max(-limitZ, this.centerZ));
  }
}

import type { Camera, Vector3 } from 'three';

export interface ScreenPosition { x: number; y: number; }

/** TheSim:GetScreenPos for DOM UI: browser viewport pixels, measured from the top left. */
export class ScreenProjection {
  private readonly camera: Camera;
  private readonly canvas: HTMLCanvasElement;

  constructor(camera: Camera, canvas: HTMLCanvasElement) {
    this.camera = camera;
    this.canvas = canvas;
  }

  /** Snapshot a world position without mutating it; return null outside the camera's depth range. */
  GetScreenPos(position: Vector3): ScreenPosition | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.camera.updateWorldMatrix(true, false);
    const projected = position.clone().project(this.camera);
    if (![projected.x, projected.y, projected.z].every(Number.isFinite)
      || projected.z < -1 || projected.z > 1) return null;
    return {
      x: rect.left + (projected.x + 1) * rect.width / 2,
      y: rect.top + (1 - projected.y) * rect.height / 2,
    };
  }
}

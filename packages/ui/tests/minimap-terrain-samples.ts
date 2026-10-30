import type { DstMinimapElement } from '../src/minimap';

/** Test-only reads of the drawn terrain at world points inside the current view.
 * Draws one frame and reads it back in the same task; runtime drawing never reads pixels back.
 * `ocean: false` leaves out the ocean plate, so open water reads as transparent.
 */
export function sampleMapTerrain(map: HTMLElement, points: { x: number; z: number }[], { ocean = true } = {}): number[][] {
  const element = map as DstMinimapElement, view = element.view!;
  const terrain = (element as any).renderer.terrain;
  if (terrain.ocean) terrain.ocean.visible = ocean;
  try {
    terrain.draw();
    const gl: WebGLRenderingContext = terrain.renderer.getContext(), ratio = terrain.renderer.getPixelRatio();
    return points.map(point => {
      const screen = view.worldToScreen(point.x, point.z), pixel = new Uint8Array(4);
      if (screen.x < 0 || screen.z < 0 || screen.x >= view.width || screen.z >= view.height) throw new Error(`(${point.x}, ${point.z}) is outside the view`);
      gl.readPixels(Math.floor(screen.x * ratio), Math.floor((view.height - screen.z) * ratio), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return Array.from(pixel);
    });
  } finally { if (terrain.ocean) terrain.ocean.visible = true; }
}

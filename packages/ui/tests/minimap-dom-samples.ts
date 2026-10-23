import type { DstMinimapElement } from '../src/minimap';

/** Test-only reads of the actual DOM terrain images, in source/world coordinates.
 * Runtime presentation never composites or reads back a viewport canvas.
 */
export function sampleDomTerrain(map: HTMLElement, points: { x: number; z: number }[]): number[][] {
  const worldSize = (map as DstMinimapElement).view!.worldSize;
  const images = [...map.shadowRoot!.querySelectorAll<HTMLImageElement>('.minimap__terrain img')]
    .filter(image => !image.hidden && image.complete && image.naturalWidth > 0);
  const context = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })!;
  return points.map(point => {
    context.clearRect(0, 0, 1, 1);
    for (const image of images) {
      const x = parseFloat(image.style.left) / 100 * worldSize, z = parseFloat(image.style.top) / 100 * worldSize;
      const width = parseFloat(image.style.width) / 100 * worldSize, height = parseFloat(image.style.height) / 100 * worldSize;
      if (point.x < x || point.x >= x + width || point.z < z || point.z >= z + height) continue;
      const u = Math.floor((point.x - x) / width * image.naturalWidth), v = Math.floor((point.z - z) / height * image.naturalHeight);
      context.drawImage(image, u, v, 1, 1, 0, 0, 1, 1);
    }
    return Array.from(context.getImageData(0, 0, 1, 1).data);
  });
}

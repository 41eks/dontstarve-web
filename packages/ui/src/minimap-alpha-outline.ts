/** Ignore the faint, antialiased fringe of the land image when building its hit area. */
export const MINIMAP_LAND_ALPHA_THRESHOLD = 128;

/** Trace opaque pixel boundaries, including holes, into a compact orthogonal SVG path.
 * Called only while composing terrain chunks; pointer events never sample pixels or terrain.
 */
export function traceMinimapAlphaOutline(
  { data, width, height }: Pick<ImageData, 'data' | 'width' | 'height'>,
  offsetX = 0, offsetY = 0,
): string {
  const stride = width + 1;
  // Directions clockwise: right, down, left, up. Opaque pixels stay on the right.
  const edges = new Map<number, number>();
  const add = (vertex: number, direction: number) => edges.set(vertex, (edges.get(vertex) ?? 0) | 1 << direction);
  const opaque = (pixel: number) => data[pixel * 4 + 3] >= MINIMAP_LAND_ALPHA_THRESHOLD;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const pixel = y * width + x;
    if (!opaque(pixel)) continue;
    const vertex = y * stride + x;
    if (y === 0 || !opaque(pixel - width)) add(vertex, 0);
    if (x === width - 1 || !opaque(pixel + 1)) add(vertex + 1, 1);
    if (y === height - 1 || !opaque(pixel + width)) add(vertex + stride + 1, 2);
    if (x === 0 || !opaque(pixel - 1)) add(vertex + stride, 3);
  }

  const steps = [1, stride, -1, -stride], paths: string[] = [];
  for (const start of edges.keys()) {
    while (edges.has(start)) {
      let vertex = start, direction = Math.log2(edges.get(start)! & -edges.get(start)!);
      const path = [`M${offsetX + start % stride} ${offsetY + Math.floor(start / stride)}`];
      for (;;) {
        const remaining = edges.get(vertex)! & ~(1 << direction);
        if (remaining) edges.set(vertex, remaining); else edges.delete(vertex);
        vertex += steps[direction];
        if (vertex === start) { path.push('Z'); break; }
        const available = edges.get(vertex)!;
        // Turn right first at diagonally touching pixels, keeping their contours separate.
        let next = (direction + 1) % 4;
        for (const candidate of [next, direction, (direction + 3) % 4, (direction + 2) % 4]) {
          if (available & 1 << candidate) { next = candidate; break; }
        }
        if (next !== direction) path.push(direction % 2 === 0
          ? `H${offsetX + vertex % stride}` : `V${offsetY + Math.floor(vertex / stride)}`);
        direction = next;
      }
      paths.push(path.join(''));
    }
  }
  return paths.join('');
}

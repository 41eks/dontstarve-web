import type { MinimapView } from '../../ui/src/minimap-view';
import { MinimapDomView } from '../../ui/src/minimap-dom-view';

export interface DomChunk {
  readonly canvas: OffscreenCanvas;
  readonly minCol: number;
  readonly minRow: number;
  readonly maxCol: number;
  readonly maxRow: number;
}

export type ChunkElement = 'canvas' | 'img';

/** Terrain and icon anchors share world coordinates and one view transform.
 * Layout dimensions provide zoom; icons counter only the view's rotation.
 * Panning never changes individual icons; entity samples update their world positions.
 */
export class DomMap {
  private readonly dom: MinimapDomView;
  readonly root: HTMLElement;
  private readonly icons: { element: HTMLElement; x: number; z: number }[] = [];
  private readonly cellSize: number;
  private readonly worldSize: number;

  constructor(host: HTMLElement, cellSize: number, width: number, height: number, worldSize: number) {
    this.worldSize = worldSize;
    this.dom = new MinimapDomView(worldSize);
    this.root = this.dom.root;
    this.cellSize = cellSize;
    Object.assign(this.root.style, { position: 'relative', width: `${width}px`, height: `${height}px`, overflow: 'hidden', background: '#1d1a14' });
    host.append(this.root);
  }

  /** Mounts one element per chunk; returns the time spent converting canvases to elements. */
  async setChunks(chunks: Iterable<DomChunk>, element: ChunkElement): Promise<number> {
    const start = performance.now();
    const fragment = document.createDocumentFragment();
    const pending: Promise<void>[] = [];
    for (const chunk of chunks) {
      const style = {
        position: 'absolute', left: `${chunk.minCol * this.cellSize / this.worldSize * 100}%`, top: `${chunk.minRow * this.cellSize / this.worldSize * 100}%`,
        width: `${(chunk.maxCol - chunk.minCol) * this.cellSize / this.worldSize * 100}%`, height: `${(chunk.maxRow - chunk.minRow) * this.cellSize / this.worldSize * 100}%`,
      };
      if (element === 'canvas') {
        const canvas = document.createElement('canvas');
        canvas.width = chunk.canvas.width; canvas.height = chunk.canvas.height;
        canvas.getContext('2d')!.drawImage(chunk.canvas, 0, 0);
        Object.assign(canvas.style, style);
        fragment.append(canvas);
      } else {
        const image = document.createElement('img');
        Object.assign(image.style, style);
        fragment.append(image);
        pending.push(chunk.canvas.convertToBlob().then(blob => new Promise<void>(resolve => {
          image.onload = () => resolve();
          image.src = URL.createObjectURL(blob);
        })));
      }
    }
    // All icons remain above the terrain, including chunks mounted later.
    this.dom.overview.append(fragment);
    await Promise.all(pending);
    return Math.round(performance.now() - start);
  }

  setIcons(positions: { x: number; z: number }[]): void {
    while (this.icons.length > positions.length) this.icons.pop()!.element.remove();
    for (let i = 0; i < positions.length; i++) {
      const position = positions[i];
      let icon = this.icons[i];
      if (!icon) {
        const element = document.createElement('div');
        element.className = 'marker';
        Object.assign(element.style, { height: '32px', borderRadius: '50%', background: '#e8dcc0' });
        this.dom.icons.append(element);
        this.icons.push(icon = { element, x: NaN, z: NaN });
      }
      if (icon.x !== position.x) { icon.element.style.left = `${position.x / this.worldSize * 100}%`; icon.x = position.x; }
      if (icon.z !== position.z) { icon.element.style.top = `${position.z / this.worldSize * 100}%`; icon.z = position.z; }
    }
  }

  update(view: MinimapView): void {
    this.dom.update(view);
  }
}

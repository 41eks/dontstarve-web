import * as THREE from 'three';
import type { MinimapView } from '../../ui/src/minimap-view';

export interface TerrainChunk {
  readonly canvas: OffscreenCanvas;
  readonly minCol: number;
  readonly minRow: number;
  readonly resolution: number;
}

/** Terrain chunks as textured quads in screen pixels: each chunk uploads once, a frame is
 * 625 transformed quads, and no canvas-to-canvas drawImage is involved.
 */
export class ThreeTerrainRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1);
  private readonly quad = new THREE.BufferGeometry();
  private readonly meshes: { mesh: THREE.Mesh; chunk: TerrainChunk }[] = [];

  private readonly cellSize: number;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, cellSize: number) {
    this.cellSize = cellSize;
    this.renderer = new THREE.WebGLRenderer({ canvas: canvas as HTMLCanvasElement, alpha: true, antialias: false });
    this.renderer.setClearColor(0x000000, 0);
    this.quad.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
    this.quad.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    this.quad.setIndex([0, 1, 2, 0, 2, 3]);
  }

  setChunks(chunks: Iterable<TerrainChunk>): void {
    for (const chunk of chunks) {
      const texture = new THREE.CanvasTexture(chunk.canvas as unknown as HTMLCanvasElement);
      texture.flipY = false;
      texture.colorSpace = THREE.NoColorSpace;
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
      const mesh = new THREE.Mesh(this.quad, material);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.meshes.push({ mesh, chunk });
    }
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.left = 0; this.camera.right = width; this.camera.top = 0; this.camera.bottom = height;
    this.camera.updateProjectionMatrix();
  }

  render(view: MinimapView): void {
    for (const { mesh, chunk } of this.meshes) {
      const [a, b, c, d, e, f] = view.canvasTransform(chunk.minCol * this.cellSize, chunk.minRow * this.cellSize, this.cellSize / chunk.resolution);
      const w = chunk.canvas.width, h = chunk.canvas.height;
      mesh.matrix.set(a * w, c * h, 0, e, b * w, d * h, 0, f, 0, 0, 1, 0, 0, 0, 0, 1);
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Blocks until the GPU has finished, so timings include rasterisation. */
  flush(): void {
    const gl = this.renderer.getContext();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  }

  dispose(): void {
    for (const { mesh } of this.meshes) {
      (mesh.material as THREE.MeshBasicMaterial).map?.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.quad.dispose();
    this.renderer.dispose();
  }
}

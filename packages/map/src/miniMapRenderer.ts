import * as THREE from 'three';
import type { MinimapCellBounds, MinimapPixels, MinimapTerrain, MinimapTileLayer, MinimapTileQuad } from '../../ui/src/minimap-terrain';
import { MINIMAP_MARGIN_RATIO, type MinimapView } from '../../ui/src/minimap-view';

/** Geometry is grouped for culling and terrain edits only; every chunk draws into the same frame. */
const CHUNK_CELLS = 32;
/** World cells per repeat of a minimap noise texture, as the world ground's noise. */
const NOISE_PERIOD_CELLS = 8;
/** World cells covered by one repeat of the ocean plate (scripts/render-minimap-ocean.mjs). */
const OCEAN_PLATE_CELLS = 32;
/** Cells with a land id but no loaded layer art. */
const MISSING_ART_ID = -1;
const YIELD_MS = 8;
/** Positions are 2D (x, z); nothing is culled or depth-sorted, so skip three's 3D bounds. */
const UNBOUNDED = new THREE.Sphere(new THREE.Vector3(), Infinity);

const VERTEX = `
precision highp float;
uniform mat3 view;
uniform float noiseRepeat;
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
varying vec2 vNoiseUv;
void main() {
  gl_Position = vec4((view * vec3(position, 1.0)).xy, 0.0, 1.0);
  vUv = uv;
  // minimap.ksh: noise_uv = PS_POS.xz * NOISE_REPEAT_SIZE.
  vNoiseUv = position * noiseRepeat;
}`;

/** minimap.ksh: atlas RGB *= world-space noise RGB; the atlas alpha is the mask. Output is premultiplied. */
const LAYER_FRAGMENT = `
precision mediump float;
uniform sampler2D atlas;
uniform sampler2D noise;
varying vec2 vUv;
varying vec2 vNoiseUv;
void main() {
  vec4 colour = texture2D(atlas, vUv);
  colour.rgb *= texture2D(noise, vNoiseUv).rgb;
  gl_FragColor = vec4(colour.rgb * colour.a, colour.a);
}`;

const OCEAN_FRAGMENT = `
precision mediump float;
uniform sampler2D atlas;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(atlas, vUv); }`;

const FLAT_FRAGMENT = `
precision mediump float;
void main() { gl_FragColor = vec4(0.502, 0.502, 0.502, 1.0); }`;

interface Chunk extends MinimapCellBounds {
  readonly meshes: THREE.Mesh[];
  dirty: boolean;
}

export interface MiniMapRendererOptions {
  terrain: MinimapTerrain;
  cellSize: number;
  /** The pre-rendered seamless open-ocean plate. */
  oceanPlateUrl: string;
}

/** MiniMapRenderer: one render layer per tile type (MapLayerManager:CreateRenderLayer), drawn with
 * minimap.ksh into a viewport-sized canvas. A frame is drawn only for a view change or a visible
 * terrain edit; terrain edits rebuild only the geometry of the chunks they touch.
 */
export class MiniMapRenderer {
  readonly canvas = document.createElement('canvas');
  private readonly options: MiniMapRendererOptions;
  private renderer?: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly viewMatrix = new THREE.Matrix3();
  private readonly chunks = new Map<string, Chunk>();
  private readonly materials = new Map<number, THREE.RawShaderMaterial>();
  private readonly textures = new Map<MinimapPixels, THREE.DataTexture>();
  private layers?: ReadonlyMap<number, MinimapTileLayer>;
  private oceanIds?: ReadonlySet<number>;
  private oceanTexture?: THREE.Texture;
  private ocean?: THREE.Mesh;
  private view?: MinimapView;
  private frame?: number;
  private preparation?: Promise<void>;
  private prepared = false;
  private active = false;
  private disposed = false;
  private readonly stopTerrain: () => void;

  constructor(options: MiniMapRendererOptions) {
    this.options = options;
    this.canvas.className = 'minimap__terrain-canvas';
    Object.assign(this.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
    this.stopTerrain = options.terrain.onTerrainChanged(bounds => {
      // Variants read the eight neighbours, so an edit reaches one cell beyond its bounds.
      this.invalidate(bounds && { minCol: bounds.minCol - 1, minRow: bounds.minRow - 1, maxCol: bounds.maxCol + 1, maxRow: bounds.maxRow + 1 });
    });
  }

  get ready(): boolean { return this.prepared && !this.disposed; }

  /** Loads the layer art and builds every chunk while the loading page is still visible. */
  prepare(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return this.preparation ??= this.load();
  }

  private async load(): Promise<void> {
    const { terrain, cellSize, oceanPlateUrl } = this.options;
    const [layers, ocean, plate] = await Promise.all([
      terrain.tileLayerImages(), terrain.minimapOcean(), new THREE.TextureLoader().loadAsync(oceanPlateUrl),
    ]);
    if (this.disposed) { plate.dispose(); return; }
    this.layers = layers; this.oceanIds = ocean.oceanTileIds;
    plate.colorSpace = THREE.NoColorSpace;
    // Row 0 at the plate's minimum z, as its CSS background was laid out.
    plate.flipY = false;
    plate.needsUpdate = true;
    plate.wrapS = plate.wrapT = THREE.RepeatWrapping;
    this.oceanTexture = plate;
    this.ocean = this.createOcean(plate, cellSize);
    this.scene.add(this.ocean);
    const { min, max } = terrain.cellRange();
    for (let row = min; row < max; row += CHUNK_CELLS) for (let col = min; col < max; col += CHUNK_CELLS) {
      this.chunks.set(`${col},${row}`, { minCol: col, minRow: row, maxCol: Math.min(max, col + CHUNK_CELLS),
        maxRow: Math.min(max, row + CHUNK_CELLS), meshes: [], dirty: true });
    }
    let deadline = performance.now() + YIELD_MS;
    for (const chunk of this.chunks.values()) {
      if (chunk.dirty) this.build(chunk);
      if (performance.now() >= deadline) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        if (this.disposed) return;
        deadline = performance.now() + YIELD_MS;
      }
    }
    this.prepared = true;
    this.requestFrame();
  }

  /** Open: draw the current view and follow terrain edits. Closed: edits only mark chunks. */
  start(): void { this.active = true; this.requestFrame(); }

  stop(): void {
    this.active = false;
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
  }

  update(view: MinimapView): void {
    this.view = view;
    this.requestFrame();
  }

  /** The visible land the map's land cursor and BLINK_MAP target accept. */
  isLandAt(x: number, z: number): boolean {
    const { terrain, cellSize } = this.options;
    const col = Math.floor(x / cellSize), row = Math.floor(z / cellSize), { min, max } = terrain.cellRange();
    if (col < min || col >= max || row < min || row >= max) return false;
    const id = terrain.tileIdAtCell(col, row);
    return id !== 0 && !terrain.isVoidAtCell?.(col, row) && this.oceanIds !== undefined && !this.oceanIds.has(id);
  }

  private invalidate(bounds?: MinimapCellBounds): void {
    for (const chunk of this.chunks.values()) {
      if (bounds && (chunk.maxCol <= bounds.minCol || chunk.minCol >= bounds.maxCol
        || chunk.maxRow <= bounds.minRow || chunk.minRow >= bounds.maxRow)) continue;
      chunk.dirty = true;
    }
    this.requestFrame();
  }

  private requestFrame(): void {
    if (!this.active || !this.prepared || this.disposed || this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => { this.frame = undefined; this.draw(); });
  }

  private draw(): void {
    const view = this.view;
    if (!view || this.disposed) return;
    const renderer = this.renderer ??= this.createRenderer();
    const pixelRatio = window.devicePixelRatio || 1;
    if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
    const size = renderer.getSize(new THREE.Vector2());
    if (size.x !== view.width || size.y !== view.height) renderer.setSize(view.width, view.height, false);
    // World (x, z) to clip space through the view's screen transform.
    const [a, b, c, d, e, f] = view.canvasTransform(0, 0, 1);
    const sx = 2 / view.width, sy = -2 / view.height;
    this.viewMatrix.set(a * sx, c * sx, e * sx - 1, b * sy, d * sy, f * sy + 1, 0, 0, 1);
    const visible = this.visibleCells(view);
    for (const chunk of this.chunks.values()) {
      const shown = chunk.maxCol > visible.minCol && chunk.minCol < visible.maxCol && chunk.maxRow > visible.minRow && chunk.minRow < visible.maxRow;
      if (shown && chunk.dirty) this.build(chunk);
      for (const mesh of chunk.meshes) mesh.visible = shown;
    }
    renderer.render(this.scene, this.camera);
  }

  private visibleCells(view: MinimapView): MinimapCellBounds {
    const corners = [[0, 0], [view.width, 0], [view.width, view.height], [0, view.height]].map(([x, y]) => view.screenToWorld(x, y));
    const { cellSize } = this.options;
    return {
      minCol: Math.floor(Math.min(...corners.map(p => p.x)) / cellSize), maxCol: Math.ceil(Math.max(...corners.map(p => p.x)) / cellSize),
      minRow: Math.floor(Math.min(...corners.map(p => p.z)) / cellSize), maxRow: Math.ceil(Math.max(...corners.map(p => p.z)) / cellSize),
    };
  }

  private build(chunk: Chunk): void {
    for (const mesh of chunk.meshes.splice(0)) { this.scene.remove(mesh); mesh.geometry.dispose(); }
    chunk.dirty = false;
    const { terrain } = this.options, layers = this.layers!, oceanIds = this.oceanIds!;
    // Land ids whose art has not loaded are drawn flat grey, below every layer.
    const missing: MinimapTileQuad[] = [];
    for (let row = chunk.minRow; row < chunk.maxRow; row++) for (let col = chunk.minCol; col < chunk.maxCol; col++) {
      const id = terrain.tileIdAtCell(col, row);
      if (id !== 0 && !oceanIds.has(id) && !layers.has(id) && !terrain.isVoidAtCell?.(col, row)) missing.push({ col, row, variant: 1 });
    }
    if (missing.length) this.addMesh(chunk, MISSING_ART_ID, missing);
    for (const [id, quads] of terrain.tileLayerQuads(chunk)) {
      if (quads.length && layers.has(id) && !oceanIds.has(id)) this.addMesh(chunk, id, quads);
    }
  }

  private addMesh(chunk: Chunk, id: number, quads: readonly MinimapTileQuad[]): void {
    const layer = this.layers!.get(id), size = this.options.cellSize;
    const positions = new Float32Array(quads.length * 8), uvs = new Float32Array(quads.length * 8);
    const indices = new Uint16Array(quads.length * 6);
    quads.forEach(({ col, row, variant }, i) => {
      const x0 = col * size, z0 = row * size, x1 = x0 + size, z1 = z0 + size;
      positions.set([x0, z0, x1, z0, x0, z1, x1, z1], i * 8);
      const mask = layer?.masks.get(variant);
      if (layer && !mask) throw new Error(`Minimap layer ${id} lacks mask ${variant}`);
      if (mask) uvs.set([mask.u0, mask.v0, mask.u1, mask.v0, mask.u0, mask.v1, mask.u1, mask.v1], i * 8);
      const v = i * 4;
      indices.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 2));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.boundingSphere = UNBOUNDED;
    const mesh = new THREE.Mesh(geometry, this.material(id, layer));
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    // Source layer order; chunks never overlap, so only the order within a cell matters.
    mesh.renderOrder = layer?.renderOrder ?? -1;
    chunk.meshes.push(mesh);
    this.scene.add(mesh);
  }

  private material(id: number, layer: MinimapTileLayer | undefined): THREE.RawShaderMaterial {
    let material = this.materials.get(id);
    if (material) return material;
    material = new THREE.RawShaderMaterial({
      vertexShader: VERTEX, fragmentShader: layer ? LAYER_FRAGMENT : FLAT_FRAGMENT,
      uniforms: {
        view: { value: this.viewMatrix },
        noiseRepeat: { value: 1 / (NOISE_PERIOD_CELLS * this.options.cellSize) },
        atlas: { value: layer && this.texture(layer.atlas, false) },
        noise: { value: layer && this.texture(layer.noise, true) },
      },
      // The view transform may mirror the winding.
      transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    this.materials.set(id, material);
    return material;
  }

  private createOcean(plate: THREE.Texture, cellSize: number): THREE.Mesh {
    const { min, max } = this.options.terrain.cellRange(), world = (max - min) * cellSize;
    const x0 = min * cellSize - MINIMAP_MARGIN_RATIO * world, x1 = max * cellSize + MINIMAP_MARGIN_RATIO * world;
    const repeat = (x1 - x0) / (OCEAN_PLATE_CELLS * cellSize);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([x0, x0, x1, x0, x0, x1, x1, x1]), 2));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, repeat, 0, 0, repeat, repeat, repeat]), 2));
    geometry.setIndex([0, 2, 1, 1, 2, 3]);
    geometry.boundingSphere = UNBOUNDED;
    const material = new THREE.RawShaderMaterial({
      vertexShader: VERTEX, fragmentShader: OCEAN_FRAGMENT,
      uniforms: { view: { value: this.viewMatrix }, noiseRepeat: { value: 0 }, atlas: { value: plate } },
      depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = -2;
    return mesh;
  }

  /** Byte-exact sources, as the composed image used: no colour-space conversion. */
  private texture(pixels: MinimapPixels, repeat: boolean): THREE.DataTexture {
    let texture = this.textures.get(pixels);
    if (texture) return texture;
    texture = new THREE.DataTexture(new Uint8Array(pixels.data.buffer, pixels.data.byteOffset, pixels.data.length), pixels.width, pixels.height, THREE.RGBAFormat);
    texture.colorSpace = THREE.NoColorSpace;
    texture.flipY = false;
    texture.wrapS = texture.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    texture.magFilter = THREE.LinearFilter;
    // The atlas XML excludes each mask's gutter; mipmaps would bleed neighbouring masks.
    texture.minFilter = repeat ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    texture.generateMipmaps = repeat;
    texture.needsUpdate = true;
    this.textures.set(pixels, texture);
    return texture;
  }

  private createRenderer(): THREE.WebGLRenderer {
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: false, premultipliedAlpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = true;
    return renderer;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.stopTerrain();
    for (const chunk of this.chunks.values()) for (const mesh of chunk.meshes) mesh.geometry.dispose();
    this.chunks.clear();
    if (this.ocean) { this.ocean.geometry.dispose(); (this.ocean.material as THREE.Material).dispose(); }
    for (const material of this.materials.values()) material.dispose();
    for (const texture of this.textures.values()) texture.dispose();
    this.oceanTexture?.dispose();
    this.materials.clear(); this.textures.clear();
    this.renderer?.dispose();
    this.renderer = undefined;
    this.canvas.remove();
  }
}

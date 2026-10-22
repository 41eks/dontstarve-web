import * as THREE from 'three';

import { spritePerfSpan } from './spritePerf';

import {
  findImage,
  loadAnimationArchive,
  type Animation,
  type BuildPackage,
  type ResolvedSprite,
} from './animationAssets';

export interface RgbaSpriteAtlasOptions {
  animationName: string;
  frameIndices?: readonly number[];
  padding?: number;
  columns?: number;
  resolutionScale?: number;
}

export interface RgbaSpriteAtlasFrame {
  animationName: string;
  frameIndex: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface RgbaSpriteAtlas {
  texture: THREE.Texture;
  frames: RgbaSpriteAtlasFrame[];
  frameRate: number;
  resolutionScale: number;
  width: number;
  height: number;
}

export interface RgbaSpriteFrameGeometryOptions {
  anchor?: 'asset-origin' | 'bottom';
}

interface FrameLayout {
  animationName: string;
  frameIndex: number;
  sprites: ResolvedSprite[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
  atlasX: number;
  atlasY: number;
}

function createCanvas(width: number, height: number) {
  if (typeof document === 'undefined') {
    throw new Error('RGBA sprite atlas composition requires a browser canvas');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create a 2D canvas context');
  return context;
}

function transformedBounds(sprites: ResolvedSprite[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const { element, image } of sprites) {
    const [a, b, c, d, tx, ty] = element.matrix;
    const x0 = image.x - image.width / 2;
    const y0 = image.y - image.height / 2;
    const x1 = x0 + image.width;
    const y1 = y0 + image.height;
    for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) {
      const transformedX = a * x + c * y + tx;
      const transformedY = b * x + d * y + ty;
      minX = Math.min(minX, transformedX);
      minY = Math.min(minY, transformedY);
      maxX = Math.max(maxX, transformedX);
      maxY = Math.max(maxY, transformedY);
    }
  }

  if (!Number.isFinite(minX)) {
    throw new Error('Cannot compose an empty sprite frame');
  }
  minX = Math.floor(minX);
  minY = Math.floor(minY);
  maxX = Math.ceil(maxX);
  maxY = Math.ceil(maxY);
  return { minX, minY, maxX, maxY };
}

function resolveFrame(
  buildPackage: BuildPackage,
  animation: Animation,
  frameIndex: number,
): FrameLayout {
  const frame = animation.frames[frameIndex];
  if (!frame) {
    throw new Error(`Animation ${animation.name} does not contain frame ${frameIndex}`);
  }
  const sprites = [...frame.elements]
    .sort((a, b) => b.z - a.z)
    .map((element) => {
      const image = findImage(buildPackage.build, element.imageHash, element.imageIndex);
      return image
        ? { element, image, materials: [] as THREE.MeshBasicMaterial[] }
        : undefined;
    })
    .filter((sprite): sprite is ResolvedSprite => Boolean(sprite));
  return layoutFrame(animation, frameIndex, sprites);
}

function layoutFrame(animation: Animation, frameIndex: number, sprites: ResolvedSprite[]): FrameLayout {
  const bounds = transformedBounds(sprites);
  return {
    animationName: animation.name,
    frameIndex,
    sprites,
    ...bounds,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
    pixelWidth: 0,
    pixelHeight: 0,
    atlasX: 0,
    atlasY: 0,
  };
}

/** Pixels uploaded per step; a 4096² source is decoded in a few small steps rather than one long task. */
const DECODE_CHUNK_PIXELS = 1 << 19;

/** Writes the RGBA texels row-chunk by row-chunk, so no single step copies the whole texture. */
function* decodeTextureSteps(texture: BuildPackage['atlases'][number]): Generator<void, HTMLCanvasElement> {
  const canvas = createCanvas(texture.width, texture.height);
  const context = context2d(canvas);
  const { width, height, pixels } = texture;
  const rows = Math.max(1, Math.floor(DECODE_CHUNK_PIXELS / width));
  for (let y = 0; y < height; y += rows) {
    const count = Math.min(rows, height - y);
    const end = spritePerfSpan('step:decode-chunk', `${width}x${height} rows ${y}`);
    const chunk = context.createImageData(width, count);
    chunk.data.set(pixels.subarray(y * width * 4, (y + count) * width * 4));
    context.putImageData(chunk, 0, y);
    end();
    yield;
  }
  return canvas;
}

function decodedTextureCanvas(texture: BuildPackage['atlases'][number]) {
  return drain(decodeTextureSteps(texture));
}

export function composeRgbaSpriteAtlas(
  buildPackage: BuildPackage,
  animation: Animation,
  options: Omit<RgbaSpriteAtlasOptions, 'animationName'> = {},
): RgbaSpriteAtlas {
  let sources: HTMLCanvasElement[] | undefined;
  return drain(composeAtlasSteps(animation, index => resolveFrame(buildPackage, animation, index),
    sprite => (sources ??= buildPackage.atlases.map(decodedTextureCanvas))[sprite.image.sampler ?? 0], options));
}

function drain<T>(steps: Generator<void, T>): T {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

/** Decoded source atlases are shared by every appearance built from the same texture. */
const decodedSources = new WeakMap<THREE.Texture, HTMLCanvasElement>();

/** Precompose resolved split builds/hidden symbols into bounded pages for instanced drawing. */
export function composeResolvedRgbaSpriteAtlases(
  animation: Animation,
  frames: readonly ResolvedSprite[][],
  maxTextureSize: number,
): RgbaSpriteAtlas[] {
  return drain(composeResolvedSteps(animation, frames, maxTextureSize));
}

export interface RgbaSpriteAtlasComposer {
  /** Composes frames until `budgetMs` has elapsed; returns the pages once every frame is drawn. */
  step(budgetMs: number): RgbaSpriteAtlas[] | undefined;
}

/** `composeResolvedRgbaSpriteAtlases()` split into per-frame steps so a caller can spread it over several frames. */
export function createResolvedRgbaSpriteAtlasComposer(
  animation: Animation,
  frames: readonly ResolvedSprite[][],
  maxTextureSize: number,
  renderer?: THREE.WebGLRenderer,
): RgbaSpriteAtlasComposer {
  const steps = composeResolvedSteps(animation, frames, maxTextureSize, renderer && canComposeAtlasOnGpu(renderer) ? renderer : undefined);
  let pages: RgbaSpriteAtlas[] | undefined;
  return {
    step(budgetMs) {
      if (pages) return pages;
      const deadline = performance.now() + budgetMs;
      do {
        const end = spritePerfSpan('step:next', animation.name);
        const next = steps.next();
        end();
        if (next.done) return pages = next.value;
      } while (performance.now() < deadline);
      return undefined;
    },
  };
}

function* composeResolvedSteps(
  animation: Animation,
  frames: readonly ResolvedSprite[][],
  maxTextureSize: number,
  gpu?: THREE.WebGLRenderer,
): Generator<void, RgbaSpriteAtlas[]> {
  const endLayout = spritePerfSpan('step:layout', `${frames.length} frames`);
  const layouts = frames.map((sprites, index) => layoutFrame(animation, index, sprites));
  // Preserve the source texel density instead of expanding downscaled DST atlases
  // back to their build-coordinate dimensions (which can triple each axis).
  let density = 0;
  for (const sprites of frames) for (const { image, materials } of sprites) {
    const texture = materials[image.sampler ?? 0].map!;
    if (!(texture instanceof THREE.DataTexture)) throw new Error('Instanced sprite source must be a decoded atlas');
    density = Math.max(density, texture.image.width / image.canvasWidth!, texture.image.height / image.canvasHeight!);
  }
  const resolutionScale = Math.min(1, density);
  // A clip uses one origin and one texel grid. Cropping and rounding each frame
  // independently changes its sampling phase and stretches the last partial
  // texel back onto the quad, making stationary parts wobble between frames.
  let boundsMinX = Infinity, boundsMinY = Infinity, boundsMaxX = -Infinity, boundsMaxY = -Infinity;
  for (const frame of layouts) {
    boundsMinX = Math.min(boundsMinX, frame.minX); boundsMinY = Math.min(boundsMinY, frame.minY);
    boundsMaxX = Math.max(boundsMaxX, frame.maxX); boundsMaxY = Math.max(boundsMaxY, frame.maxY);
  }
  const minX = Math.floor(boundsMinX * resolutionScale) / resolutionScale;
  const minY = Math.floor(boundsMinY * resolutionScale) / resolutionScale;
  const maxX = Math.ceil(boundsMaxX * resolutionScale) / resolutionScale;
  const maxY = Math.ceil(boundsMaxY * resolutionScale) / resolutionScale;
  for (const frame of layouts) Object.assign(frame, { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY });
  const cellWidth = Math.ceil((maxX - minX) * resolutionScale) + 4;
  const cellHeight = Math.ceil((maxY - minY) * resolutionScale) + 4;
  const columns = Math.floor(maxTextureSize / cellWidth), rows = Math.floor(maxTextureSize / cellHeight);
  if (columns < 1 || rows < 1) throw new Error('Sprite frame exceeds the maximum atlas size');
  const capacity = columns * rows;
  endLayout();
  for (const sprites of gpu ? [] : frames) for (const { image, materials } of sprites) {
    const texture = materials[image.sampler ?? 0].map;
    if (!(texture instanceof THREE.DataTexture)) throw new Error('Instanced sprite source must be a decoded atlas');
    if (decodedSources.has(texture)) continue;
    decodedSources.set(texture, yield* decodeTextureSteps({ width: texture.image.width, height: texture.image.height,
      pixels: texture.image.data as Uint8Array }));
  }
  const sourceOf = ({ image, materials }: ResolvedSprite) => decodedSources.get(materials[image.sampler ?? 0].map!)!;
  const pages: RgbaSpriteAtlas[] = [];
  for (let offset = 0; offset < frames.length; offset += capacity) {
    const frameIndices = frames.slice(offset, offset + capacity).map((_, index) => index + offset);
    const options = { columns, frameIndices, resolutionScale };
    pages.push(gpu ? yield* composeGpuPageSteps(gpu, animation, frameIndices.map(index => layouts[index]), options)
      : yield* composeAtlasSteps(animation, index => layouts[index], sourceOf, options));
  }
  return pages;
}

/** Assigns each frame its texel size and cell in one grid page; returns the page size. */
function layoutAtlasPage(layouts: FrameLayout[], options: Omit<RgbaSpriteAtlasOptions, 'animationName'>) {
  const padding = Math.max(0, Math.floor(options.padding ?? 2));
  const resolutionScale = options.resolutionScale ?? 1;
  if (!Number.isFinite(resolutionScale) || resolutionScale <= 0) {
    throw new Error('RGBA sprite atlas resolutionScale must be greater than 0');
  }
  layouts.forEach((frame) => {
    frame.pixelWidth = Math.max(1, Math.ceil(frame.width * resolutionScale));
    frame.pixelHeight = Math.max(1, Math.ceil(frame.height * resolutionScale));
  });
  const columns = Math.max(
    1,
    Math.min(layouts.length, Math.floor(options.columns ?? Math.ceil(Math.sqrt(layouts.length)))),
  );
  const rows = Math.ceil(layouts.length / columns);
  const cellWidth = Math.max(...layouts.map((frame) => frame.pixelWidth)) + padding * 2;
  const cellHeight = Math.max(...layouts.map((frame) => frame.pixelHeight)) + padding * 2;
  layouts.forEach((frame, index) => {
    frame.atlasX = (index % columns) * cellWidth + padding;
    frame.atlasY = Math.floor(index / columns) * cellHeight + padding;
  });
  return { width: cellWidth * columns, height: cellHeight * rows, resolutionScale };
}

function atlasResult(animation: Animation, layouts: FrameLayout[], texture: THREE.Texture, width: number, height: number,
  resolutionScale: number): RgbaSpriteAtlas {
  return {
    texture,
    frameRate: animation.frameRate,
    resolutionScale,
    width,
    height,
    frames: layouts.map((frame) => ({
      animationName: frame.animationName,
      frameIndex: frame.frameIndex,
      minX: frame.minX,
      minY: frame.minY,
      maxX: frame.maxX,
      maxY: frame.maxY,
      width: frame.width,
      height: frame.height,
      u0: frame.atlasX / width,
      v0: 1 - (frame.atlasY + frame.pixelHeight) / height,
      u1: (frame.atlasX + frame.pixelWidth) / width,
      v1: 1 - frame.atlasY / height,
    })),
  };
}

/** Rendering premultiplied 16-bit colour needs one of these; without them the canvas path composes instead. */
export function canComposeAtlasOnGpu(renderer: THREE.WebGLRenderer): boolean {
  return renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
}

const GPU_VERTEX = `
  uniform vec2 size;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.x / size.x * 2.0 - 1.0, 1.0 - position.y / size.y * 2.0, 0.0, 1.0);
  }
`;

/** Source texels are sRGB-decoded by the sampler, so parts blend in linear light; output is premultiplied. */
const GPU_PART_FRAGMENT = `
  uniform sampler2D map;
  varying vec2 vUv;
  void main() {
    vec4 texel = texture2D(map, vUv);
    gl_FragColor = vec4(texel.rgb * texel.a, texel.a);
  }
`;

const GPU_RESOLVE_VERTEX = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const GPU_RESOLVE_FRAGMENT = `
  uniform sampler2D map;
  varying vec2 vUv;
  void main() {
    vec4 texel = texture2D(map, vUv);
    gl_FragColor = vec4(texel.a > 0.0 ? texel.rgb / texel.a : vec3(0.0), texel.a);
  }
`;

/** Runs `draw` against the renderer and puts back the state the surrounding pass was using. */
function withRendererState(renderer: THREE.WebGLRenderer, draw: () => void) {
  const target = renderer.getRenderTarget();
  const face = renderer.getActiveCubeFace(), level = renderer.getActiveMipmapLevel();
  const autoClear = renderer.autoClear, clearAlpha = renderer.getClearAlpha();
  const clearColor = renderer.getClearColor(new THREE.Color());
  const { info } = renderer, counters = { ...info.render }, autoReset = info.autoReset;
  info.autoReset = false;
  try { draw(); } finally {
    renderer.setRenderTarget(target, face, level);
    renderer.autoClear = autoClear;
    renderer.setClearColor(clearColor, clearAlpha);
    Object.assign(info.render, counters);
    info.autoReset = autoReset;
  }
}

/**
 * One atlas page composed on the GPU: every part is a textured quad drawn in source z order into a premultiplied
 * half-float target, then resolved to a straight-alpha sRGB texture like the canvas path produces. No source
 * texture is decoded into a second CPU copy.
 */
function* composeGpuPageSteps(
  renderer: THREE.WebGLRenderer,
  animation: Animation,
  layouts: FrameLayout[],
  options: Omit<RgbaSpriteAtlasOptions, 'animationName'>,
): Generator<void, RgbaSpriteAtlas> {
  if (layouts.length === 0) throw new Error('At least one sprite frame is required');
  const { width, height, resolutionScale } = layoutAtlasPage(layouts, options);
  const sources = new Set<THREE.Texture>();
  for (const frame of layouts) for (const { image, materials } of frame.sprites) sources.add(materials[image.sampler ?? 0].map!);
  for (const texture of sources) {
    const end = spritePerfSpan('step:gpu-upload', texture.name || texture.uuid);
    renderer.initTexture(texture);
    end();
    yield;
  }

  const size = { value: new THREE.Vector2(width, height) };
  const materialIndex = new Map<THREE.Texture, number>();
  const partMaterials = [...sources].map((map, index) => {
    materialIndex.set(map, index);
    return new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, size }, vertexShader: GPU_VERTEX, fragmentShader: GPU_PART_FRAGMENT,
      transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
  });
  const accumulation = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, depthBuffer: false,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
  const target = new THREE.WebGLRenderTarget(width, height, { depthBuffer: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(), camera = new THREE.Camera();
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), partMaterials);
  mesh.frustumCulled = false;
  scene.add(mesh);

  try {
    withRendererState(renderer, () => {
      renderer.setRenderTarget(accumulation);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
    });
    yield;
    for (const frame of layouts) {
      const end = spritePerfSpan('step:gpu-frame', `${frame.sprites.length} parts`);
      const count = frame.sprites.length;
      const positions = new Float32Array(count * 12), uvs = new Float32Array(count * 8), indices = new Uint16Array(count * 6);
      const geometry = new THREE.BufferGeometry();
      let run = -1, runStart = 0;
      frame.sprites.forEach((sprite, part) => {
        const { element, image, materials } = sprite;
        const [a, b, c, d, tx, ty] = element.matrix;
        const x0 = image.x - image.width / 2, y0 = image.y - image.height / 2;
        const x1 = x0 + image.width, y1 = y0 + image.height;
        // Build UVs may describe the original atlas size while the shipped texture is downscaled; the normalised
        // rectangle matches what the ordinary sprite mesh samples. Data rows are stored top-down (flipY false).
        const u0 = image.bbx! / image.canvasWidth!, u1 = (image.bbx! + image.width) / image.canvasWidth!;
        const v0 = image.bby! / image.canvasHeight!, v1 = (image.bby! + image.height) / image.canvasHeight!;
        const corners = [[x0, y0, u0, v0], [x1, y0, u1, v0], [x1, y1, u1, v1], [x0, y1, u0, v1]];
        corners.forEach(([x, y, u, v], corner) => {
          const vertex = part * 4 + corner;
          positions[vertex * 3] = ((a * x + c * y + tx - frame.minX) * resolutionScale) + frame.atlasX;
          positions[vertex * 3 + 1] = ((b * x + d * y + ty - frame.minY) * resolutionScale) + frame.atlasY;
          uvs[vertex * 2] = u; uvs[vertex * 2 + 1] = v;
        });
        indices.set([0, 1, 2, 0, 2, 3].map(index => index + part * 4), part * 6);
        // Layers keep their z order; consecutive parts from one source texture share a draw.
        const material = materialIndex.get(materials[image.sampler ?? 0].map!)!;
        if (material !== run) {
          if (run >= 0) geometry.addGroup(runStart * 6, (part - runStart) * 6, run);
          run = material; runStart = part;
        }
      });
      geometry.addGroup(runStart * 6, (count - runStart) * 6, run);
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      mesh.geometry = geometry;
      withRendererState(renderer, () => {
        renderer.setRenderTarget(accumulation);
        renderer.autoClear = false;
        renderer.render(scene, camera);
      });
      geometry.dispose();
      end();
      yield;
    }

    const endResolve = spritePerfSpan('step:gpu-resolve', `${width}x${height}`);
    const resolve = new THREE.ShaderMaterial({
      uniforms: { map: { value: accumulation.texture } }, vertexShader: GPU_RESOLVE_VERTEX,
      fragmentShader: GPU_RESOLVE_FRAGMENT, blending: THREE.NoBlending, depthTest: false, depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), resolve);
    quad.frustumCulled = false;
    const resolveScene = new THREE.Scene();
    resolveScene.add(quad);
    try {
      withRendererState(renderer, () => {
        renderer.setRenderTarget(target);
        renderer.autoClear = false;
        renderer.render(resolveScene, camera);
      });
    } finally { quad.geometry.dispose(); resolve.dispose(); }
    endResolve();
  } finally {
    mesh.geometry.dispose();
    partMaterials.forEach(material => material.dispose());
    accumulation.dispose();
  }
  target.texture.addEventListener('dispose', () => target.dispose());
  return atlasResult(animation, layouts, target.texture, width, height, resolutionScale);
}

function* composeAtlasSteps(
  animation: Animation,
  resolve: (index: number) => FrameLayout,
  sourceOf: (sprite: ResolvedSprite) => HTMLCanvasElement,
  options: Omit<RgbaSpriteAtlasOptions, 'animationName'>,
): Generator<void, RgbaSpriteAtlas> {
  const frameIndices = options.frameIndices ?? animation.frames.map((_, index) => index);
  if (frameIndices.length === 0) throw new Error('At least one sprite frame is required');
  const layouts = frameIndices.map(resolve);
  const { width, height, resolutionScale } = layoutAtlasPage(layouts, options);
  const endCanvas = spritePerfSpan('step:canvas', `${width}x${height}`);
  const canvas = createCanvas(width, height);
  const context = context2d(canvas);
  endCanvas();
  yield;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  for (const frame of layouts) {
    const endFrame = spritePerfSpan('step:draw-frame', `${frame.sprites.length} parts`);
    for (const sprite of frame.sprites) {
      const { element, image } = sprite;
      const source = sourceOf(sprite);
      if (!source) {
        throw new Error(`Sprite frame references missing atlas ${image.sampler ?? 0}`);
      }
      const [a, b, c, d, tx, ty] = element.matrix;
      const x0 = image.x - image.width / 2;
      const y0 = image.y - image.height / 2;
      // Build UVs may describe the original atlas size while the shipped texture
      // is downscaled. Match the normalized UVs used by the ordinary sprite mesh.
      const sourceScaleX = source.width / image.canvasWidth!;
      const sourceScaleY = source.height / image.canvasHeight!;
      context.setTransform(
        a * resolutionScale,
        b * resolutionScale,
        c * resolutionScale,
        d * resolutionScale,
        (tx - frame.minX) * resolutionScale + frame.atlasX,
        (ty - frame.minY) * resolutionScale + frame.atlasY,
      );
      context.drawImage(
        source,
        image.bbx! * sourceScaleX,
        image.bby! * sourceScaleY,
        image.width * sourceScaleX,
        image.height * sourceScaleY,
        x0,
        y0,
        image.width,
        image.height,
      );
    }
    endFrame();
    yield;
  }
  context.resetTransform();

  const endTexture = spritePerfSpan('step:texture', `${width}x${height}`);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  endTexture();

  return atlasResult(animation, layouts, texture, width, height, resolutionScale);
}

export async function createRgbaSpriteAtlas(
  assetBaseUrl: string,
  file: string,
  options: RgbaSpriteAtlasOptions,
): Promise<RgbaSpriteAtlas> {
  const { buildPackage, animations } = await loadAnimationArchive(file, assetBaseUrl);
  const animation = animations.animations.find(
    (candidate) => candidate.name === options.animationName,
  );
  if (!animation) {
    throw new Error(`Sprite animation ${options.animationName} is unavailable in ${file}`);
  }
  return composeRgbaSpriteAtlas(buildPackage, animation, options);
}

export function updateRgbaSpriteFrameGeometry(
  geometry: THREE.BufferGeometry,
  frame: RgbaSpriteAtlasFrame,
  options: RgbaSpriteFrameGeometryOptions = {},
) {
  const yOffset = options.anchor === 'bottom' ? -frame.maxY : 0;
  let positions = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  let uvs = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!positions || positions.count !== 4) {
    positions = new THREE.BufferAttribute(new Float32Array(12), 3);
    positions.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', positions);
  }
  if (!uvs || uvs.count !== 4) {
    uvs = new THREE.BufferAttribute(new Float32Array(8), 2);
    uvs.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('uv', uvs);
  }
  positions.setXYZ(0, frame.minX, frame.minY + yOffset, 0);
  positions.setXYZ(1, frame.maxX, frame.minY + yOffset, 0);
  positions.setXYZ(2, frame.maxX, frame.maxY + yOffset, 0);
  positions.setXYZ(3, frame.minX, frame.maxY + yOffset, 0);
  uvs.setXY(0, frame.u0, frame.v1);
  uvs.setXY(1, frame.u1, frame.v1);
  uvs.setXY(2, frame.u1, frame.v0);
  uvs.setXY(3, frame.u0, frame.v0);
  positions.needsUpdate = true;
  uvs.needsUpdate = true;
  return geometry;
}

export function createRgbaSpriteFrameGeometry(
  frame: RgbaSpriteAtlasFrame,
  options: RgbaSpriteFrameGeometryOptions = {},
) {
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return updateRgbaSpriteFrameGeometry(geometry, frame, options);
}

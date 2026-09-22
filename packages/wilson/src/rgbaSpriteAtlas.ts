import * as THREE from 'three';

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
  texture: THREE.CanvasTexture;
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

function decodedTextureCanvas(texture: BuildPackage['atlases'][number]) {
  const canvas = createCanvas(texture.width, texture.height);
  const context = context2d(canvas);
  const imageData = context.createImageData(texture.width, texture.height);
  imageData.data.set(texture.pixels);
  context.putImageData(imageData, 0, 0);
  return canvas;
}

export function composeRgbaSpriteAtlas(
  buildPackage: BuildPackage,
  animation: Animation,
  options: Omit<RgbaSpriteAtlasOptions, 'animationName'> = {},
): RgbaSpriteAtlas {
  const frameIndices = options.frameIndices ?? animation.frames.map((_, index) => index);
  if (frameIndices.length === 0) throw new Error('At least one sprite frame is required');
  const padding = Math.max(0, Math.floor(options.padding ?? 2));
  const resolutionScale = options.resolutionScale ?? 1;
  if (!Number.isFinite(resolutionScale) || resolutionScale <= 0) {
    throw new Error('RGBA sprite atlas resolutionScale must be greater than 0');
  }
  const layouts = frameIndices.map((frameIndex) =>
    resolveFrame(buildPackage, animation, frameIndex)
  );
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
  const width = cellWidth * columns;
  const height = cellHeight * rows;
  const canvas = createCanvas(width, height);
  const context = context2d(canvas);
  const sourceCanvases = buildPackage.atlases.map(decodedTextureCanvas);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  layouts.forEach((frame, layoutIndex) => {
    frame.atlasX = (layoutIndex % columns) * cellWidth + padding;
    frame.atlasY = Math.floor(layoutIndex / columns) * cellHeight + padding;
    for (const { element, image } of frame.sprites) {
      const source = sourceCanvases[image.sampler ?? 0];
      if (!source) {
        throw new Error(`Sprite frame references missing atlas ${image.sampler ?? 0}`);
      }
      const [a, b, c, d, tx, ty] = element.matrix;
      const x0 = image.x - image.width / 2;
      const y0 = image.y - image.height / 2;
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
        image.bbx!,
        image.bby!,
        image.width,
        image.height,
        x0,
        y0,
        image.width,
        image.height,
      );
    }
  });
  context.resetTransform();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

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

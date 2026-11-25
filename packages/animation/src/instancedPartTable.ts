import * as THREE from 'three';
import type { Animation, ResolvedSprite } from './animationAssets';
import { isPremultipliedSrgbAtlas } from './atlasFormat';

/** The source textures one part batch can sample; an appearance whose parts use more is composed instead. */
export const MAX_PART_TEXTURES = 4;
/** RGBA32F texels per (frame, slot) row: the part's quad affine, its translation/page/light, its UV rectangle. */
export const PART_TEXELS = 3;
const PART_FLOATS = PART_TEXELS * 4;

/** A frame of a part table, bounded like a composed atlas frame: one clip-wide rectangle for every frame. */
export interface InstancedPartFrame {
  readonly frameIndex: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly width: number;
  readonly height: number;
}

/**
 * An appearance drawn part by part straight from its build atlases, instead of composed into per-frame cells. Each
 * entity is `slots` instances, one per part slot in source z order; the vertex shader fetches the slot's row of the
 * current frame. Row (frame f, slot s) starts at texel (s * PART_TEXELS, f):
 * - texel 0: the unit quad's 2×2 matrix (a·w, b·w, c·h, d·h);
 * - texel 1: its translation (a·x0 + c·y0 + tx, b·x0 + d·y0 + ty), the texture index, the symbol light override;
 * - texel 2: the UV rectangle (u0, v0, u1, v1).
 * A frame with fewer parts leaves its last slots zero: a degenerate quad that draws nothing.
 */
export interface InstancedPartTable {
  readonly kind: 'parts';
  readonly animationName: string;
  readonly slots: number;
  readonly frames: readonly InstancedPartFrame[];
  /** The build atlases the parts sample, by texture index. */
  readonly textures: readonly THREE.Texture[];
  /** Whether each texture is a premultiplied-sRGB BC page (`PREMULTIPLIED_SRGB_TEXEL`). */
  readonly premultiplied: readonly boolean[];
  /** The first part's material, whose colour the batch takes as a composed page's batch does. */
  readonly source: THREE.MeshBasicMaterial;
  readonly data: Float32Array;
  readonly texture: THREE.DataTexture;
  /** GPU bytes of the table (the build atlases belong to their assets). */
  readonly bytes: number;
}

export function isInstancedPartTable(page: object): page is InstancedPartTable {
  return (page as Partial<InstancedPartTable>).kind === 'parts';
}

/** The table frame drawn for `frame`, holding the last frame past the end as a composed appearance does. */
export function partTableFrame(table: InstancedPartTable, frame: number): InstancedPartFrame {
  return table.frames[Math.min(frame, table.frames.length - 1)];
}

/**
 * Builds the part table of `animation` from its resolved frames: the same parts, transforms and UVs the ordinary
 * merged frame geometry uses, with no composition. Returns undefined when its parts sample more than
 * MAX_PART_TEXTURES textures.
 */
export function createInstancedPartTable(
  animation: Animation,
  resolve: (frameIndex: number) => ResolvedSprite[],
): InstancedPartTable | undefined {
  const frameCount = Math.max(1, animation.frames.length);
  const resolved: ResolvedSprite[][] = [];
  const textures: THREE.Texture[] = [];
  let slots = 1;
  let source: THREE.MeshBasicMaterial | undefined;
  for (let index = 0; index < frameCount; index++) {
    const sprites = index < animation.frames.length ? resolve(index) : [];
    resolved.push(sprites);
    slots = Math.max(slots, sprites.length);
    for (const { image, materials } of sprites) {
      const material = materials[image.sampler ?? 0];
      const texture = material?.map;
      if (!texture) {
        throw new Error('Instanced sprite part must sample a build atlas');
      }
      source ??= material;
      if (!textures.includes(texture)) {
        if (textures.length === MAX_PART_TEXTURES) {
          return undefined;
        }
        textures.push(texture);
      }
    }
  }
  if (!source) {
    return undefined;
  }

  const rowFloats = slots * PART_FLOATS;
  const data = new Float32Array(frameCount * rowFloats);
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let frame = 0; frame < frameCount; frame++) {
    const sprites = resolved[frame];
    for (let slot = 0; slot < sprites.length; slot++) {
      const { element, image, materials, lightOverride = 0 } = sprites[slot];
      const [a, b, c, d, tx, ty] = element.matrix;
      const x0 = image.x - image.width / 2,
        y0 = image.y - image.height / 2;
      const w = image.width,
        h = image.height;
      const offset = frame * rowFloats + slot * PART_FLOATS;
      data[offset] = a * w;
      data[offset + 1] = b * w;
      data[offset + 2] = c * h;
      data[offset + 3] = d * h;
      const ox = a * x0 + c * y0 + tx,
        oy = b * x0 + d * y0 + ty;
      data[offset + 4] = ox;
      data[offset + 5] = oy;
      data[offset + 6] = textures.indexOf(materials[image.sampler ?? 0].map!);
      data[offset + 7] = lightOverride;
      data[offset + 8] = image.bbx! / image.canvasWidth!;
      data[offset + 9] = image.bby! / image.canvasHeight!;
      data[offset + 10] = (image.bbx! + w) / image.canvasWidth!;
      data[offset + 11] = (image.bby! + h) / image.canvasHeight!;
      for (const [x, y] of [
        [ox, oy],
        [ox + a * w, oy + b * w],
        [ox + c * h, oy + d * h],
        [ox + a * w + c * h, oy + b * w + d * h],
      ]) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (!Number.isFinite(minX)) {
    minX = minY = maxX = maxY = 0;
  }
  const frames: InstancedPartFrame[] = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    frames.push({ frameIndex, minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY });
  }

  const texture = new THREE.DataTexture(data, slots * PART_TEXELS, frameCount, THREE.RGBAFormat, THREE.FloatType);
  texture.name = `${animation.name} parts`;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return {
    kind: 'parts',
    animationName: animation.name,
    slots,
    frames,
    textures,
    premultiplied: textures.map(isPremultipliedSrgbAtlas),
    source,
    data,
    texture,
    bytes: data.byteLength,
  };
}

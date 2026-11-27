import * as THREE from 'three';
import { alphaMaskTexel, type AlphaMask } from './alphaMask';

const textureUv = new THREE.Vector2();
const instancedProxies = new WeakSet<THREE.Object3D>();

/** A render-hidden source mesh still supplies the instanced entity's exact input shape. */
export function setInstancedSpriteProxy(object: THREE.Object3D, enabled: boolean): void {
  if (enabled) {
    instancedProxies.add(object);
  } else {
    instancedProxies.delete(object);
  }
}

export function isInstancedSpriteProxy(object: THREE.Object3D): boolean {
  return instancedProxies.has(object);
}

const pickPreparations = new WeakMap<THREE.Object3D, () => void>();

/**
 * Runs `prepare` before a pick tests `root` or anything under it: a batched billboard's display turns its source
 * geometry to the current camera, which it does not follow while the batches draw it.
 */
export function registerPickPreparation(root: THREE.Object3D, prepare: () => void): () => void {
  pickPreparations.set(root, prepare);
  return () => {
    if (pickPreparations.get(root) === prepare) {
      pickPreparations.delete(root);
    }
  };
}

/** Brings the pickable geometry of `object` and its ancestors' owners up to date, before its world matrices are. */
export function prepareSpritePick(object: THREE.Object3D): void {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    pickPreparations.get(node)?.();
  }
}

function wrapPixel(index: number, size: number, wrapping: THREE.Wrapping): number {
  if (wrapping === THREE.RepeatWrapping) {
    return ((index % size) + size) % size;
  }
  if (wrapping === THREE.MirroredRepeatWrapping) {
    const period = ((index % (2 * size)) + 2 * size) % (2 * size);
    return period < size ? period : 2 * size - period - 1;
  }
  return Math.max(0, Math.min(size - 1, index));
}

const alphaMasks = new WeakMap<THREE.Source<unknown>, AlphaMask>();

/** The picking coverage of an atlas source, which outlives the RGBA or blocks released after the GPU upload. */
export function setAtlasAlphaMask(source: THREE.Source<unknown>, alpha: AlphaMask): void {
  alphaMasks.set(source, alpha);
}

/**
 * Sample the atlas coverage, using the same UV transform, orientation and filtering as the sprite. A mask gives 0 or 1
 * per texel (covered at full opacity), so its filtered value is the covered share; a decoded RGBA gives the alpha.
 */
function atlasAlpha(texture: THREE.Texture, uv: THREE.Vector2): number {
  const { width, height, data: pixels } = texture.image as { width: number; height: number; data?: Uint8Array | null };
  const mask = alphaMasks.get(texture.source);
  if ((!mask && !pixels) || width === 0 || height === 0) {
    return 1;
  }
  if (texture.matrixAutoUpdate) {
    texture.updateMatrix();
  }
  texture.transformUv(textureUv.copy(uv));
  const x = textureUv.x * width,
    y = textureUv.y * height;
  const texel = (x: number, y: number) => {
    const column = wrapPixel(x, width, texture.wrapS),
      row = wrapPixel(y, height, texture.wrapT);
    return mask ? alphaMaskTexel(mask, column, row) : pixels![(row * width + column) * 4 + 3] / 255;
  };
  if (texture.magFilter === THREE.NearestFilter) {
    return texel(Math.floor(x), Math.floor(y));
  }
  // Linear texels are centred at (i + .5) / size, including interpolation across wrapped edges.
  const x0 = Math.floor(x - 0.5),
    y0 = Math.floor(y - 0.5);
  const fx = x - 0.5 - x0,
    fy = y - 0.5 - y0;
  const top = texel(x0, y0) * (1 - fx) + texel(x0 + 1, y0) * fx;
  const bottom = texel(x0, y0 + 1) * (1 - fx) + texel(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Geometry supplies triangle UVs/material groups; transparent atlas pixels do not intercept input. */
export function raycastSprite(
  this: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>,
  raycaster: THREE.Raycaster,
  hits: THREE.Intersection[],
): void {
  const start = hits.length;
  THREE.Mesh.prototype.raycast.call(this, raycaster, hits);
  let kept = start;
  for (let index = start; index < hits.length; index++) {
    const hit = hits[index],
      material = this.material[hit.face?.materialIndex ?? 0];
    if (!material?.visible) {
      continue;
    }
    const texture = material.map,
      uv = texture?.channel === 1 ? hit.uv1 : hit.uv;
    let alpha = material.opacity;
    // DST animation atlases have an alpha mask (compressed pages only that) or are RGBA unsigned-byte DataTextures.
    // Preserve geometric picking for other maps.
    if (
      texture &&
      uv &&
      (alphaMasks.has(texture.source) ||
        (texture instanceof THREE.DataTexture &&
          texture.format === THREE.RGBAFormat &&
          texture.type === THREE.UnsignedByteType))
    ) {
      alpha *= atlasAlpha(texture, uv);
    }
    if (alpha > 0 && alpha >= material.alphaTest) {
      hits[kept++] = hit;
    }
  }
  hits.length = kept;
}

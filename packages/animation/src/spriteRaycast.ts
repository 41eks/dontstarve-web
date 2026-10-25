import * as THREE from 'three';

const textureUv = new THREE.Vector2();
const instancedProxies = new WeakSet<THREE.Object3D>();

/** A render-hidden source mesh still supplies the instanced entity's exact input shape. */
export function setInstancedSpriteProxy(object: THREE.Object3D, enabled: boolean): void {
  if (enabled) instancedProxies.add(object); else instancedProxies.delete(object);
}

export function isInstancedSpriteProxy(object: THREE.Object3D): boolean { return instancedProxies.has(object); }

function wrapPixel(index: number, size: number, wrapping: THREE.Wrapping): number {
  if (wrapping === THREE.RepeatWrapping) return ((index % size) + size) % size;
  if (wrapping === THREE.MirroredRepeatWrapping) {
    const period = ((index % (2 * size)) + 2 * size) % (2 * size);
    return period < size ? period : 2 * size - period - 1;
  }
  return Math.max(0, Math.min(size - 1, index));
}

const alphaMasks = new WeakMap<THREE.Source<unknown>, Uint8Array>();

/** One alpha byte per texel of an atlas source, which outlives the RGBA released after the GPU upload. */
export function setAtlasAlphaMask(source: THREE.Source<unknown>, alpha: Uint8Array): void { alphaMasks.set(source, alpha); }

/** Sample the existing decoded atlas, using the same UV transform, orientation and filtering as the sprite. */
function atlasAlpha(texture: THREE.DataTexture, uv: THREE.Vector2): number {
  const { width, height } = texture.image;
  const mask = alphaMasks.get(texture.source);
  const data = mask ?? texture.image.data, stride = mask ? 1 : 4, channel = mask ? 0 : 3;
  if (!data || width === 0 || height === 0) return 1;
  if (texture.matrixAutoUpdate) texture.updateMatrix();
  texture.transformUv(textureUv.copy(uv));
  const x = textureUv.x * width, y = textureUv.y * height;
  const texel = (x: number, y: number) => data[(wrapPixel(y, height, texture.wrapT) * width
    + wrapPixel(x, width, texture.wrapS)) * stride + channel] / 255;
  if (texture.magFilter === THREE.NearestFilter) return texel(Math.floor(x), Math.floor(y));
  // Linear texels are centred at (i + .5) / size, including interpolation across wrapped edges.
  const x0 = Math.floor(x - .5), y0 = Math.floor(y - .5);
  const fx = x - .5 - x0, fy = y - .5 - y0;
  const top = texel(x0, y0) * (1 - fx) + texel(x0 + 1, y0) * fx;
  const bottom = texel(x0, y0 + 1) * (1 - fx) + texel(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Geometry supplies triangle UVs/material groups; transparent atlas pixels do not intercept input. */
export function raycastSprite(this: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>,
  raycaster: THREE.Raycaster, hits: THREE.Intersection[]): void {
  const start = hits.length;
  THREE.Mesh.prototype.raycast.call(this, raycaster, hits);
  let kept = start;
  for (let index = start; index < hits.length; index++) {
    const hit = hits[index], material = this.material[hit.face?.materialIndex ?? 0];
    if (!material?.visible) continue;
    const texture = material.map, uv = texture?.channel === 1 ? hit.uv1 : hit.uv;
    let alpha = material.opacity;
    // DST animation atlases are RGBA unsigned-byte DataTextures. Preserve geometric picking for other maps.
    if (texture instanceof THREE.DataTexture && texture.format === THREE.RGBAFormat
      && texture.type === THREE.UnsignedByteType && uv) alpha *= atlasAlpha(texture, uv);
    if (alpha > 0 && alpha >= material.alphaTest) hits[kept++] = hit;
  }
  hits.length = kept;
}

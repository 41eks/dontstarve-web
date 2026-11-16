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

const drawnPlane = new THREE.Plane(), planeHit = new THREE.Vector3(), viewHit = new THREE.Vector3();
const originView = new THREE.Vector3(), axisX = new THREE.Vector3(), axisY = new THREE.Vector3(), cameraForward = new THREE.Vector3();
const modelView = new THREE.Matrix4(), localHit = new THREE.Vector3(), meshNormal = new THREE.Vector3();
const drawnRaycaster = new THREE.Raycaster();

/**
 * Sprite quads are drawn about their projected origin (spriteProjection.ts): what is drawn is the mesh flattened onto
 * the screen-parallel plane through its origin. The pointer's point on that plane is mapped back onto the mesh's own
 * plane, and the triangles are tested there, so a flat OnGround sprite is picked where it is drawn. A camera-facing
 * billboard already lies on that plane.
 */
function raycastAsDrawn(mesh: THREE.Mesh, raycaster: THREE.Raycaster, hits: THREE.Intersection[]): void {
  const camera = raycaster.camera as THREE.Camera | undefined;
  if (!camera) { THREE.Mesh.prototype.raycast.call(mesh, raycaster, hits); return; }
  modelView.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld);
  originView.setFromMatrixPosition(modelView);
  axisX.setFromMatrixColumn(modelView, 0); axisY.setFromMatrixColumn(modelView, 1);
  const det = axisX.x * axisY.y - axisY.x * axisX.y;
  camera.getWorldDirection(cameraForward);
  drawnPlane.setFromNormalAndCoplanarPoint(cameraForward, planeHit.setFromMatrixPosition(mesh.matrixWorld));
  // Edge-on to the screen, the drawn sprite has no area.
  if (Math.abs(det) < 1e-9 || !raycaster.ray.intersectPlane(drawnPlane, planeHit)) return;
  const distance = raycaster.ray.origin.distanceTo(planeHit);
  if (distance < raycaster.near || distance > raycaster.far) return;
  viewHit.copy(planeHit).applyMatrix4(camera.matrixWorldInverse).sub(originView);
  localHit.set((viewHit.x * axisY.y - axisY.x * viewHit.y) / det, (axisX.x * viewHit.y - viewHit.x * axisX.y) / det, 0)
    .applyMatrix4(mesh.matrixWorld);
  meshNormal.setFromMatrixColumn(mesh.matrixWorld, 2).normalize();
  drawnRaycaster.layers.mask = raycaster.layers.mask;
  drawnRaycaster.ray.origin.copy(localHit).addScaledVector(meshNormal, 1);
  drawnRaycaster.ray.direction.copy(meshNormal).negate();
  drawnRaycaster.near = 0; drawnRaycaster.far = Infinity;
  const start = hits.length;
  THREE.Mesh.prototype.raycast.call(mesh, drawnRaycaster, hits);
  // The ray meets the drawn sprite at this distance; the hit point stays on the mesh.
  for (let index = start; index < hits.length; index++) hits[index].distance = distance;
}

/** Geometry supplies triangle UVs/material groups; transparent atlas pixels do not intercept input. */
export function raycastSprite(this: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>,
  raycaster: THREE.Raycaster, hits: THREE.Intersection[]): void {
  const start = hits.length;
  raycastAsDrawn(this, raycaster, hits);
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

import * as THREE from 'three';
import { markSpatialGeometryBounds, publishSpriteSpatialBounds } from './spatialBounds';
import type { DecodedTexture } from './parseKtex';
import type { AnimElement, BuildImage, ParsedAnim, ParsedBuild, BuildPackage } from './animationArchive';
import { loadAnimationArchivePart } from './animationArchiveLoader';

export { smallHash } from './animationArchive';
export type { Matrix2D, AnimElement, Animation, ParsedAnim, BuildImage, ParsedBuild, BuildPackage } from './animationArchive';
export { disposeAnimationAssets } from './animationArchiveLoader';

export interface ResolvedSprite {
  element: AnimElement;
  image: BuildImage;
  materials: THREE.MeshBasicMaterial[];
}

export async function loadAnim(file: string, assetBaseUrl: string): Promise<ParsedAnim> {
  const animations = await loadAnimationArchivePart(file, assetBaseUrl, 'animation');
  if (!animations) throw new Error(`${file} does not contain anim.bin`);
  return animations;
}

export function loadBuild(file: string, assetBaseUrl: string): Promise<BuildPackage> {
  return loadAnimationArchivePart(file, assetBaseUrl, 'build');
}

async function loadArchivePair<AnimationPart>(build: Promise<BuildPackage>, animation: Promise<AnimationPart>) {
  // Drain both worker responses on failure so an immediate retry cannot reuse
  // the other part's still-pending failed request.
  const [buildResult, animationResult] = await Promise.allSettled([build, animation]);
  if (buildResult.status === 'rejected') throw buildResult.reason;
  if (animationResult.status === 'rejected') throw animationResult.reason;
  return { buildPackage: buildResult.value, animations: animationResult.value };
}

export async function loadAnimationArchive(file: string, assetBaseUrl: string) {
  return loadArchivePair(
    loadBuild(file, assetBaseUrl), loadAnim(file, assetBaseUrl),
  );
}

/** Skin builds often reuse their prefab's bank and contain no anim.bin. */
export async function loadSpriteSkinArchive(file: string, assetBaseUrl: string) {
  return loadArchivePair(
    loadBuild(file, assetBaseUrl), loadAnimationArchivePart(file, assetBaseUrl, 'animation'),
  );
}

export function findImage(build: ParsedBuild, hash: number, frameIndex: number) {
  let result: BuildImage | undefined;
  for (const image of build.symbols.get(hash) ?? []) {
    if (image.index <= frameIndex && image.index + image.duration > frameIndex &&
      (!result || image.index > result.index)) result = image;
  }
  return result?.vertexCount ? result : undefined;
}

export interface SpriteMaterialOptions {
  /** AnimState:SetMultColour multiplies texture RGB and alpha independently. */
  readonly multColour?: readonly [number, number, number, number];
  /** AnimState:UsePointFiltering selects nearest-neighbour texture sampling. */
  readonly pointFiltering?: boolean;
}

export function createAtlasTexture(atlas: DecodedTexture, pointFiltering = false): THREE.DataTexture {
  const texture = new THREE.DataTexture(atlas.pixels, atlas.width, atlas.height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.magFilter = pointFiltering ? THREE.NearestFilter : THREE.LinearFilter;
  texture.minFilter = pointFiltering ? THREE.NearestFilter : THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createMaterials(buildPackage: BuildPackage, options: SpriteMaterialOptions = {}) {
  const [red, green, blue, alpha] = options.multColour ?? [1, 1, 1, 1];
  return buildPackage.atlases.map((atlas) => {
    return new THREE.MeshBasicMaterial({
      map: createAtlasTexture(atlas, options.pointFiltering),
      color: new THREE.Color().setRGB(red, green, blue),
      opacity: alpha,
      transparent: true,
      alphaTest: 0.01,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      // Mirrored DST parts reverse winding. Two separate face passes would
      // reorder those parts around the torso despite the correct index order.
      forceSinglePass: true,
      toneMapped: false,
    });
  });
}

/** One resolved animation frame, built once and drawn by every controller of the same factory. */
export interface SharedFrame {
  readonly geometry: THREE.BufferGeometry;
  readonly materials: THREE.MeshBasicMaterial[];
  readonly visible: boolean;
}

/**
 * Frame geometry shared by identical sprites (same build, materials and animation, no overrides). Sharing replaces
 * the per-instance resolve + vertex rewrite + GPU upload of every animation step with a geometry swap.
 * Instances and the generic mesh-disposal helpers cannot free it: the cache owns the buffers until dispose().
 */
export class FrameGeometryCache {
  private readonly frames = new Map<string, SharedFrame>();
  private readonly ids = new WeakMap<object, number>();
  private nextId = 1;

  idOf(object: object): number {
    let id = this.ids.get(object);
    if (id === undefined) this.ids.set(object, id = this.nextId++);
    return id;
  }

  get(key: string, resolve: () => ResolvedSprite[]): SharedFrame {
    let frame = this.frames.get(key);
    if (!frame) {
      const builder = new SpriteFrameRenderer(new THREE.Group());
      builder.show(resolve());
      frame = builder.snapshot();
      // Per-instance disposal paths (traverse + geometry.dispose()) must not free a buffer other sprites draw.
      frame.geometry.dispose = () => {};
      this.frames.set(key, frame);
    }
    return frame;
  }

  dispose(): void {
    for (const { geometry } of this.frames.values()) THREE.BufferGeometry.prototype.dispose.call(geometry);
    this.frames.clear();
  }
}

/**
 * The frustum-cull sphere is this much larger than the drawn quads, so a swarm whose billboard orientation or position
 * lags the camera by a frame (for example while turning) is not culled at the screen corners. The tight bounds stay in
 * geometry.boundingBox and are what spatial queries publish.
 */
const CULL_RADIUS_SCALE = 2;
const tightSphere = new THREE.Sphere();

export class SpriteFrameRenderer {
  private readonly visual: THREE.Group;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly materials: THREE.MeshBasicMaterial[] = [];
  private readonly materialIndices = new Map<THREE.MeshBasicMaterial, number>();
  private readonly mesh: THREE.Mesh;
  private positions = new Float32Array();
  private uvs = new Float32Array();
  private quadCapacity = 0;

  constructor(visual: THREE.Group) {
    this.visual = visual;
    this.mesh = new THREE.Mesh(this.geometry, this.materials);
    // The frame geometry is rewritten by show(), which keeps its bounding sphere current.
    this.geometry.boundingSphere = new THREE.Sphere();
    this.geometry.boundingBox = new THREE.Box3();
    visual.add(this.mesh);
  }

  /** Draw a frame owned by a FrameGeometryCache instead of this renderer's own buffers. */
  showShared(frame: SharedFrame): void {
    this.mesh.geometry = frame.geometry;
    this.mesh.material = frame.materials;
    this.mesh.visible = frame.visible;
    if (frame.visible && frame.geometry.boundingBox) publishSpriteSpatialBounds(this.visual, frame.geometry.boundingBox.getBoundingSphere(tightSphere));
  }

  /** The current own frame, detached from this renderer's later rewrites. */
  snapshot(): SharedFrame {
    const geometry = this.geometry.clone();
    return { geometry, materials: [...this.materials], visible: this.mesh.visible };
  }

  /** The own buffers are only separate from the mesh's geometry while a shared frame is displayed. */
  dispose(): void { if (this.mesh.geometry !== this.geometry) this.geometry.dispose(); }

  show(sprites: ResolvedSprite[]) {
    this.mesh.geometry = this.geometry;
    this.mesh.material = this.materials;
    if (sprites.length === 0) {
      this.mesh.visible = false;
      this.geometry.setDrawRange(0, 0);
      return;
    }
    if (sprites.length > 0x3fff) {
      throw new Error(`A sprite frame cannot contain more than ${0x3fff} parts`);
    }

    this.ensureCapacity(sprites.length);
    this.mesh.visible = true;
    this.materials.length = 0;
    this.materialIndices.clear();
    this.geometry.clearGroups();

    let currentMaterialIndex = -1;
    let groupStart = 0;
    let groupCount = 0;

    for (let spriteIndex = 0; spriteIndex < sprites.length; spriteIndex++) {
      const { element, image, materials } = sprites[spriteIndex];
      const material = materials[image.sampler ?? 0];
      if (!material) {
        throw new Error(`Sprite part ${spriteIndex} references a missing atlas material`);
      }

      let materialIndex = this.materialIndices.get(material);
      if (materialIndex === undefined) {
        materialIndex = this.materials.length;
        this.materials.push(material);
        this.materialIndices.set(material, materialIndex);
      }
      if (materialIndex !== currentMaterialIndex) {
        if (groupCount > 0) {
          this.geometry.addGroup(groupStart, groupCount, currentMaterialIndex);
        }
        currentMaterialIndex = materialIndex;
        groupStart = spriteIndex * 6;
        groupCount = 6;
      } else {
        groupCount += 6;
      }

      const [a, b, c, d, tx, ty] = element.matrix;
      const x0 = image.x - image.width / 2;
      const y0 = image.y - image.height / 2;
      const x1 = x0 + image.width;
      const y1 = y0 + image.height;
      const positionOffset = spriteIndex * 12;
      this.setPosition(positionOffset, x0, y0, a, b, c, d, tx, ty);
      this.setPosition(positionOffset + 3, x1, y0, a, b, c, d, tx, ty);
      this.setPosition(positionOffset + 6, x1, y1, a, b, c, d, tx, ty);
      this.setPosition(positionOffset + 9, x0, y1, a, b, c, d, tx, ty);

      const u0 = image.bbx! / image.canvasWidth!;
      const v0 = image.bby! / image.canvasHeight!;
      const u1 = (image.bbx! + image.width) / image.canvasWidth!;
      const v1 = (image.bby! + image.height) / image.canvasHeight!;
      const uvOffset = spriteIndex * 8;
      this.uvs[uvOffset] = u0;
      this.uvs[uvOffset + 1] = v0;
      this.uvs[uvOffset + 2] = u1;
      this.uvs[uvOffset + 3] = v0;
      this.uvs[uvOffset + 4] = u1;
      this.uvs[uvOffset + 5] = v1;
      this.uvs[uvOffset + 6] = u0;
      this.uvs[uvOffset + 7] = v1;
    }

    if (groupCount > 0) {
      this.geometry.addGroup(groupStart, groupCount, currentMaterialIndex);
    }
    this.geometry.setDrawRange(0, sprites.length * 6);
    this.updateBoundingSphere(sprites.length * 4);
    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('uv').needsUpdate = true;
    markSpatialGeometryBounds(this.geometry);
  }

  /** Bounds only the drawn vertices; stale capacity beyond the draw range is ignored. */
  private updateBoundingSphere(vertexCount: number) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let offset = 0; offset < vertexCount * 3; offset += 3) {
      const x = this.positions[offset], y = this.positions[offset + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    this.geometry.boundingBox!.min.set(minX, minY, 0);
    this.geometry.boundingBox!.max.set(maxX, maxY, 0);
    publishSpriteSpatialBounds(this.visual, this.geometry.boundingBox!.getBoundingSphere(tightSphere));
    const sphere = this.geometry.boundingSphere!;
    sphere.center.set((minX + maxX) / 2, (minY + maxY) / 2, 0);
    sphere.radius = Math.hypot(maxX - minX, maxY - minY) / 2 * CULL_RADIUS_SCALE;
  }

  private setPosition(
    offset: number,
    x: number,
    y: number,
    a: number,
    b: number,
    c: number,
    d: number,
    tx: number,
    ty: number,
  ) {
    this.positions[offset] = a * x + c * y + tx;
    this.positions[offset + 1] = b * x + d * y + ty;
    this.positions[offset + 2] = 0;
  }

  private ensureCapacity(quadCount: number) {
    if (quadCount <= this.quadCapacity) return;

    this.quadCapacity = THREE.MathUtils.ceilPowerOfTwo(Math.max(quadCount, 16));
    this.positions = new Float32Array(this.quadCapacity * 4 * 3);
    this.uvs = new Float32Array(this.quadCapacity * 4 * 2);
    const indices = new Uint16Array(this.quadCapacity * 6);
    for (let quadIndex = 0; quadIndex < this.quadCapacity; quadIndex++) {
      const vertexOffset = quadIndex * 4;
      const indexOffset = quadIndex * 6;
      indices.set([
        vertexOffset, vertexOffset + 1, vertexOffset + 2,
        vertexOffset, vertexOffset + 2, vertexOffset + 3,
      ], indexOffset);
    }

    const positionAttribute = new THREE.BufferAttribute(this.positions, 3);
    const uvAttribute = new THREE.BufferAttribute(this.uvs, 2);
    positionAttribute.setUsage(THREE.DynamicDrawUsage);
    uvAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', positionAttribute);
    this.geometry.setAttribute('uv', uvAttribute);
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  }
}

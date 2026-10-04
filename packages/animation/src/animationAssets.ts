import * as THREE from 'three';
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

export function createAtlasTexture(atlas: DecodedTexture): THREE.DataTexture {
  const texture = new THREE.DataTexture(atlas.pixels, atlas.width, atlas.height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createMaterials(buildPackage: BuildPackage) {
  return buildPackage.atlases.map((atlas) => {
    return new THREE.MeshBasicMaterial({
      map: createAtlasTexture(atlas),
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

export class SpriteFrameRenderer {
  private readonly geometry = new THREE.BufferGeometry();
  private readonly materials: THREE.MeshBasicMaterial[] = [];
  private readonly materialIndices = new Map<THREE.MeshBasicMaterial, number>();
  private readonly mesh: THREE.Mesh;
  private positions = new Float32Array();
  private uvs = new Float32Array();
  private quadCapacity = 0;

  constructor(visual: THREE.Group) {
    this.mesh = new THREE.Mesh(this.geometry, this.materials);
    this.mesh.frustumCulled = false;
    visual.add(this.mesh);
  }

  show(sprites: ResolvedSprite[]) {
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
    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('uv').needsUpdate = true;
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

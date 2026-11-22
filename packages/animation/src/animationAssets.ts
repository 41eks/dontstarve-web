import * as THREE from 'three';
import { markSpatialGeometryBounds, publishSpriteSpatialBounds } from './spatialBounds';
import type { AnimElement, BuildAtlas, BuildImage, ParsedAnim, ParsedBuild, BuildPackage } from './animationArchive';
import { canReloadAtlasData, loadAnimationArchivePart, reloadAtlasData } from './animationArchiveLoader';
import { isPremultipliedSrgbAtlas, markPremultipliedSrgbAtlas, PREMULTIPLIED_SRGB_TEXEL } from './atlasFormat';
import type { BcType } from './parseKtex';
import { raycastSprite, setAtlasAlphaMask, setInstancedSpriteProxy } from './spriteRaycast';
import { setSpriteRenderGroupDrawn } from './renderOrder';
import {
  hasOceanShading,
  injectOceanShading,
  NO_OCEAN_SHADING,
  oceanShadingMaterialUniforms,
  type OceanShadingSource,
  type SpriteOceanShading,
} from './oceanShading';

export { smallHash } from './animationArchive';
export { atlasPixels } from './animationArchive';
export type {
  Matrix2D,
  AnimElement,
  Animation,
  ParsedAnim,
  BuildAtlas,
  BuildImage,
  ParsedBuild,
  BuildPackage,
} from './animationArchive';
export { disposeAnimationAssets } from './animationArchiveLoader';

export interface ResolvedSprite {
  element: AnimElement;
  image: BuildImage;
  materials: THREE.MeshBasicMaterial[];
  /** AnimState:SetSymbolLightOverride of the part's symbol, baked into the merged frame as a vertex attribute. */
  lightOverride?: number;
}

export async function loadAnim(file: string, assetBaseUrl: string): Promise<ParsedAnim> {
  const animations = await loadAnimationArchivePart(file, assetBaseUrl, 'animation');
  if (!animations) {
    throw new Error(`${file} does not contain anim.bin`);
  }
  return animations;
}

/** `compressedAtlases` keeps BC pages as blocks for the scene renderer (`atlasCompressionEnabled`); RGBA otherwise. */
export function loadBuild(file: string, assetBaseUrl: string, compressedAtlases = false): Promise<BuildPackage> {
  return loadAnimationArchivePart(file, assetBaseUrl, 'build', compressedAtlases);
}

async function loadArchivePair<AnimationPart>(build: Promise<BuildPackage>, animation: Promise<AnimationPart>) {
  // Drain both worker responses on failure so an immediate retry cannot reuse
  // the other part's still-pending failed request.
  const [buildResult, animationResult] = await Promise.allSettled([build, animation]);
  if (buildResult.status === 'rejected') {
    throw buildResult.reason;
  }
  if (animationResult.status === 'rejected') {
    throw animationResult.reason;
  }
  return { buildPackage: buildResult.value, animations: animationResult.value };
}

export async function loadAnimationArchive(file: string, assetBaseUrl: string) {
  return loadArchivePair(loadBuild(file, assetBaseUrl), loadAnim(file, assetBaseUrl));
}

/** Skin builds often reuse their prefab's bank and contain no anim.bin. */
export async function loadSpriteSkinArchive(file: string, assetBaseUrl: string, compressedAtlases = false) {
  return loadArchivePair(
    loadBuild(file, assetBaseUrl, compressedAtlases),
    loadAnimationArchivePart(file, assetBaseUrl, 'animation'),
  );
}

export function findImage(build: ParsedBuild, hash: number, frameIndex: number) {
  const images = build.symbols.get(hash) ?? [];
  let result: BuildImage | undefined;
  for (const image of images) {
    if (
      image.index <= frameIndex &&
      image.index + image.duration > frameIndex &&
      (!result || image.index > result.index)
    ) {
      result = image;
    }
  }
  // The animation loops its timeline; an absent build image stays invisible.
  // Wrapping symbol indices draws unrelated art (e.g. birch leaf slots 17..19).
  return result?.vertexCount ? result : undefined;
}

export interface SpriteMaterialOptions {
  /** AnimState:SetMultColour multiplies texture RGB and alpha independently. */
  readonly multColour?: readonly [number, number, number, number];
  /** AnimState:UsePointFiltering selects nearest-neighbour texture sampling. */
  readonly pointFiltering?: boolean;
}

/**
 * One three.js Source per atlas and filtering, so every texture of it shares one GPU copy (three counts its users).
 * The RGBA or BC blocks leave the CPU after that copy is made; a GPU copy made without data (a restored context, a new
 * renderer) reads the page again from its archive and uploads it. One renderer draws the build atlases.
 */
interface AtlasImage {
  data: Uint8Array | null;
  width: number;
  height: number;
}

interface AtlasSource {
  readonly atlas: BuildAtlas;
  readonly source: THREE.Source<AtlasImage>;
  /** RGBA pages upload `image.data`; a compressed page uploads its blocks as the one level every texture shares. */
  readonly image: AtlasImage;
  readonly mipmaps?: THREE.CompressedTextureMipmap[];
  readonly textures: Set<THREE.Texture>;
  reload?: Promise<void>;
}

const atlasSources = new WeakMap<BuildAtlas, [linear?: AtlasSource, point?: AtlasSource]>();
const sourceRecords = new WeakMap<THREE.Source<unknown>, AtlasSource>();
const pendingReloads = new Set<Promise<void>>();
/** The level data of a compressed page whose blocks were released; three reads none while the source is not ready. */
const RELEASED_BLOCKS = new Uint8Array(0);
const BC_FORMATS: Record<BcType, THREE.CompressedPixelFormat> = {
  1: THREE.RGBA_S3TC_DXT1_Format,
  2: THREE.RGBA_S3TC_DXT3_Format,
  3: THREE.RGBA_S3TC_DXT5_Format,
};

function setAtlasData(record: AtlasSource, data: Uint8Array | undefined): void {
  if (record.mipmaps) {
    record.mipmaps[0].data = data ?? RELEASED_BLOCKS;
  } else {
    record.image.data = data ?? null;
  }
  record.source.dataReady = data !== undefined;
}

function atlasSource(atlas: BuildAtlas, pointFiltering: boolean): AtlasSource {
  let sources = atlasSources.get(atlas);
  if (!sources) {
    atlasSources.set(atlas, (sources = []));
  }
  const slot = pointFiltering ? 1 : 0;
  let record = sources[slot];
  if (!record) {
    const { width, height, bcType } = atlas;
    const image: AtlasImage = { data: null, width, height };
    const source = new THREE.Source(image);
    const mipmaps = bcType ? [{ data: RELEASED_BLOCKS, width, height }] : undefined;
    if (bcType && bcType !== 1) {
      markPremultipliedSrgbAtlas(source);
    }
    if (atlas.alpha) {
      setAtlasAlphaMask(source, atlas.alpha);
    }
    sources[slot] = record = { atlas, source, image, mipmaps, textures: new Set() };
    sourceRecords.set(source, record);
    // Without data three allocates the texture and calls onUpdate, which starts the reload.
    setAtlasData(record, bcType ? atlas.blocks : atlas.pixels);
  }
  return record;
}

function onAtlasUpload(texture: THREE.Texture): void {
  const record = sourceRecords.get(texture.source);
  if (!record) {
    return;
  }
  if (!record.source.dataReady) {
    reloadAtlasSource(record);
    return;
  }
  // The GPU holds the texels now. Keep them only when they could not be read again or picking still reads them.
  if (!record.atlas.alpha || !canReloadAtlasData(record.atlas)) {
    return;
  }
  setAtlasData(record, undefined);
  if (record.mipmaps) {
    record.atlas.blocks = undefined;
  } else {
    record.atlas.pixels = undefined;
  }
}

function reloadAtlasSource(record: AtlasSource): void {
  if (record.reload || !canReloadAtlasData(record.atlas)) {
    return;
  }
  const reload = reloadAtlasData(record.atlas)
    .then(
      data => {
        setAtlasData(record, data);
        // Each renderer uploads once through whichever of these textures it binds first.
        for (const texture of record.textures) {
          texture.needsUpdate = true;
        }
      },
      error => console.error('Unable to reload a released animation atlas', error),
    )
    .finally(() => {
      record.reload = undefined;
      pendingReloads.delete(reload);
    });
  record.reload = reload;
  pendingReloads.add(reload);
}

/** An RGBA DataTexture, or a CompressedTexture of the page's BC blocks when its build was loaded compressed. */
export function createAtlasTexture(atlas: BuildAtlas, pointFiltering = false): THREE.Texture {
  const record = atlasSource(atlas, pointFiltering);
  const texture =
    record.mipmaps && atlas.bcType
      ? new THREE.CompressedTexture(record.mipmaps, atlas.width, atlas.height, BC_FORMATS[atlas.bcType])
      : new THREE.DataTexture(null, atlas.width, atlas.height, THREE.RGBAFormat);
  texture.source = record.source;
  // A premultiplied page is sampled raw and decoded by its material (`AtlasSpriteMaterial`).
  texture.colorSpace = isPremultipliedSrgbAtlas(texture) ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.magFilter = pointFiltering ? THREE.NearestFilter : THREE.LinearFilter;
  texture.minFilter = pointFiltering ? THREE.NearestFilter : THREE.LinearFilter;
  // Only this texture needs binding: a Source version bump would upload the shared pixels again.
  texture.version++;
  texture.onUpdate = onAtlasUpload;
  record.textures.add(texture);
  texture.addEventListener('dispose', () => record.textures.delete(texture));
  return texture;
}

/**
 * Uploads an atlas texture to `renderer` when it has not been, and reports whether its pixels are on the GPU.
 * False while a released atlas is decoded again; offscreen composition waits rather than drawing it blank.
 */
export function prepareAtlasTexture(renderer: THREE.WebGLRenderer, texture: THREE.Texture): boolean {
  renderer.initTexture(texture);
  return sourceRecords.get(texture.source)?.reload === undefined;
}

/** The RGBA of an atlas texture for CPU composition, or undefined while a released atlas is decoded again. */
export function atlasTexturePixels(texture: THREE.Texture): Uint8Array | undefined {
  const record = sourceRecords.get(texture.source);
  if (!record) {
    const { data } = texture.image as { data?: unknown };
    return data instanceof Uint8Array ? data : undefined;
  }
  if (record.mipmaps) {
    throw new Error('A compressed atlas has no RGBA; compose it on the GPU');
  }
  if (!record.image.data) {
    reloadAtlasSource(record);
  }
  return record.image.data ?? undefined;
}

/** Resolves once every atlas being decoded again has its pixels back. */
export async function atlasReloadsSettled(): Promise<void> {
  while (pendingReloads.size) {
    await Promise.all(pendingReloads);
  }
}

/**
 * A build atlas material. Its compile hook is a method rather than an assigned callback, so clones (dressed, tinted or
 * bloom copies) still decode a premultiplied-sRGB page, while the hooks a renderer layers on (world lighting) stay off
 * clones as before. Straight-alpha pages compile as a plain MeshBasicMaterial.
 */
export class AtlasSpriteMaterial extends THREE.MeshBasicMaterial {
  override onBeforeCompile(shader: THREE.WebGLProgramParametersWithUniforms, _renderer?: THREE.WebGLRenderer): void {
    if (!isPremultipliedSrgbAtlas(this.map)) {
      return;
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_pars_fragment>', `#include <map_pars_fragment>\n${PREMULTIPLIED_SRGB_TEXEL}`)
      .replace(
        '#include <map_fragment>',
        '#ifdef USE_MAP\n  diffuseColor *= dstPremultipliedSrgbTexel(texture2D(map, vMapUv));\n#endif',
      );
  }

  override customProgramCacheKey(): string {
    return isPremultipliedSrgbAtlas(this.map) ? 'dst-premultiplied-srgb-atlas' : '';
  }
}

export function createMaterials(buildPackage: BuildPackage, options: SpriteMaterialOptions = {}) {
  const [red, green, blue, alpha] = options.multColour ?? [1, 1, 1, 1];
  return buildPackage.atlases.map(atlas => {
    return new AtlasSpriteMaterial({
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
    if (id === undefined) {
      this.ids.set(object, (id = this.nextId++));
    }
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
    for (const { geometry } of this.frames.values()) {
      THREE.BufferGeometry.prototype.dispose.call(geometry);
    }
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
/** Depth-buffer steps towards the camera: past float rounding between coplanar billboards, far below any real gap. */
export const DEPTH_OFFSET_UNITS = -4;

export class SpriteFrameRenderer {
  private readonly visual: THREE.Group;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly materials: THREE.MeshBasicMaterial[] = [];
  private readonly materialIndices = new Map<THREE.MeshBasicMaterial, number>();
  private readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
  private positions = new Float32Array();
  private uvs = new Float32Array();
  private lightOverrides = new Float32Array();
  private quadCapacity = 0;
  private instanced = false;
  private frameVisible = false;
  /** The source materials of the shown frame, which the mesh draws directly unless a depth offset is set. */
  private shown: THREE.MeshBasicMaterial[] = this.materials;
  /**
   * Private copies drawn with a depth offset or this entity's ocean shading, keyed by their source; shared source
   * materials stay unchanged.
   */
  private offsetCopies?: Map<THREE.MeshBasicMaterial, THREE.MeshBasicMaterial>;
  private readonly offsetMaterials: THREE.MeshBasicMaterial[] = [];
  private depthOffset = false;
  private oceanShading: SpriteOceanShading = NO_OCEAN_SHADING;
  /** The shading the copies were compiled with: a uniform per copy, rewritten in place when only the values change. */
  private readonly oceanUniforms = new Map<
    THREE.MeshBasicMaterial,
    Extract<OceanShadingSource, { kind: 'uniforms' }>
  >();

  constructor(visual: THREE.Group) {
    this.visual = visual;
    this.mesh = new THREE.Mesh(this.geometry, this.materials);
    // Frame parts are baked into geometry; this private mesh stays at identity.
    this.mesh.matrixAutoUpdate = false;
    this.mesh.raycast = raycastSprite;
    // The frame geometry is rewritten by show(), which keeps its bounding sphere current.
    this.geometry.boundingSphere = new THREE.Sphere();
    this.geometry.boundingBox = new THREE.Box3();
    visual.add(this.mesh);
  }

  /** Keep exact source alpha picking while the visible frame is drawn by an instance batch. */
  setInstanced(enabled: boolean): void {
    this.instanced = enabled;
    this.mesh.visible = this.frameVisible && !enabled;
    setSpriteRenderGroupDrawn(this.visual, this.mesh.visible);
    setInstancedSpriteProxy(this.mesh, enabled && this.frameVisible);
  }

  /**
   * Draw towards the camera by a few depth-buffer steps, through private copies of the shown materials. An effect drawn
   * after its owner on the owner's plane is then not hidden by the depth the owner's instance batch wrote, whatever the
   * camera heading. Frames drawn by an instance batch take the offset from their batch (`InstancedSprite.setDepthOffset`).
   */
  setDepthOffset(enabled: boolean): void {
    if (enabled === this.depthOffset) {
      return;
    }
    this.depthOffset = enabled;
    this.rebuildCopies();
  }

  /**
   * AnimState:SetFloatParams and SetOceanBlendParams of this entity, through private copies of the shown materials.
   * Frames drawn by an instance batch take them from their batch (`InstancedSprite.setOceanShading`).
   */
  setOceanShading(shading: SpriteOceanShading): void {
    const before = hasOceanShading(this.oceanShading);
    this.oceanShading = shading;
    if (before !== hasOceanShading(shading)) {
      this.rebuildCopies();
      return;
    }
    for (const uniforms of this.oceanUniforms.values()) {
      uniforms.float.value.set(...shading.float);
      uniforms.blend.value = shading.blend;
    }
  }

  /** The copies follow which of the depth offset and the ocean shading apply: any compiles a fresh set. */
  private rebuildCopies(): void {
    this.disposeOffsetCopies();
    this.offsetCopies = this.depthOffset || hasOceanShading(this.oceanShading) ? new Map() : undefined;
    this.draw(this.shown);
  }

  /** Copy the sources' current state (opacity, tint) into the depth-offset copies after their owner changed them. */
  syncDepthOffset(): void {
    for (const [source, copy] of this.offsetCopies ?? []) {
      this.copyOffset(source, copy);
    }
  }

  private draw(materials: THREE.MeshBasicMaterial[]): void {
    this.shown = materials;
    const copies = this.offsetCopies;
    if (!copies) {
      this.mesh.material = materials;
      return;
    }
    this.offsetMaterials.length = 0;
    for (const source of materials) {
      let copy = copies.get(source);
      if (!copy) {
        copy = this.copyOffset(source, new THREE.MeshBasicMaterial());
        copies.set(source, copy);
      }
      this.offsetMaterials.push(copy);
    }
    this.mesh.material = this.offsetMaterials;
  }

  private copyOffset(source: THREE.MeshBasicMaterial, copy: THREE.MeshBasicMaterial): THREE.MeshBasicMaterial {
    copy.copy(source);
    // Material.copy omits compile callbacks; the copy must compile to the source's program.
    copy.onBeforeCompile = source.onBeforeCompile;
    copy.customProgramCacheKey = source.customProgramCacheKey;
    if (hasOceanShading(this.oceanShading)) {
      let shading = this.oceanUniforms.get(copy);
      if (!shading) {
        this.oceanUniforms.set(copy, (shading = oceanShadingMaterialUniforms(this.oceanShading)));
      }
      const uniforms = shading;
      copy.onBeforeCompile = (shader, renderer) => {
        source.onBeforeCompile(shader, renderer);
        injectOceanShading(shader, uniforms);
      };
      copy.customProgramCacheKey = () => `${source.customProgramCacheKey()}|dst-ocean-shading`;
    }
    copy.polygonOffset = this.depthOffset;
    copy.polygonOffsetFactor = 0;
    copy.polygonOffsetUnits = this.depthOffset ? DEPTH_OFFSET_UNITS : 0;
    copy.needsUpdate = true;
    return copy;
  }

  private disposeOffsetCopies(): void {
    for (const copy of this.offsetCopies?.values() ?? []) {
      copy.dispose();
    }
    this.offsetCopies?.clear();
    this.oceanUniforms.clear();
  }

  /** Draw a frame owned by a FrameGeometryCache instead of this renderer's own buffers. */
  showShared(frame: SharedFrame): void {
    this.mesh.geometry = frame.geometry;
    this.draw(frame.materials);
    this.frameVisible = frame.visible;
    this.mesh.visible = frame.visible && !this.instanced;
    setSpriteRenderGroupDrawn(this.visual, this.mesh.visible);
    if (frame.visible && frame.geometry.boundingBox) {
      publishSpriteSpatialBounds(this.visual, frame.geometry.boundingBox.getBoundingSphere(tightSphere));
    }
  }

  /** The current own frame, detached from this renderer's later rewrites. */
  snapshot(): SharedFrame {
    const geometry = this.geometry.clone();
    return { geometry, materials: [...this.materials], visible: this.mesh.visible };
  }

  /** The own buffers are only separate from the mesh's geometry while a shared frame is displayed. */
  dispose(): void {
    setInstancedSpriteProxy(this.mesh, false);
    if (this.mesh.geometry !== this.geometry) {
      this.geometry.dispose();
    }
    this.disposeOffsetCopies();
  }

  show(sprites: ResolvedSprite[]) {
    this.mesh.geometry = this.geometry;
    this.draw(this.materials);
    if (sprites.length === 0) {
      this.frameVisible = false;
      this.mesh.visible = false;
      setSpriteRenderGroupDrawn(this.visual, false);
      this.geometry.setDrawRange(0, 0);
      return;
    }
    if (sprites.length > 0x3fff) {
      throw new Error(`A sprite frame cannot contain more than ${0x3fff} parts`);
    }

    this.ensureCapacity(sprites.length);
    this.frameVisible = true;
    this.mesh.visible = !this.instanced;
    setSpriteRenderGroupDrawn(this.visual, this.mesh.visible);
    this.materials.length = 0;
    this.materialIndices.clear();
    this.geometry.clearGroups();

    let currentMaterialIndex = -1;
    let groupStart = 0;
    let groupCount = 0;

    for (let spriteIndex = 0; spriteIndex < sprites.length; spriteIndex++) {
      const { element, image, materials, lightOverride = 0 } = sprites[spriteIndex];
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
      this.lightOverrides.fill(lightOverride, spriteIndex * 4, spriteIndex * 4 + 4);
    }

    if (groupCount > 0) {
      this.geometry.addGroup(groupStart, groupCount, currentMaterialIndex);
    }
    this.geometry.setDrawRange(0, sprites.length * 6);
    this.updateBoundingSphere(sprites.length * 4);
    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('uv').needsUpdate = true;
    this.geometry.getAttribute('spriteLightOverride').needsUpdate = true;
    markSpatialGeometryBounds(this.geometry);
    // The own frame's materials were rebuilt in place above.
    if (this.offsetCopies) {
      this.draw(this.materials);
    }
  }

  /** Bounds only the drawn vertices; stale capacity beyond the draw range is ignored. */
  private updateBoundingSphere(vertexCount: number) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (let offset = 0; offset < vertexCount * 3; offset += 3) {
      const x = this.positions[offset],
        y = this.positions[offset + 1];
      if (x < minX) {
        minX = x;
      }
      if (x > maxX) {
        maxX = x;
      }
      if (y < minY) {
        minY = y;
      }
      if (y > maxY) {
        maxY = y;
      }
    }
    this.geometry.boundingBox!.min.set(minX, minY, 0);
    this.geometry.boundingBox!.max.set(maxX, maxY, 0);
    publishSpriteSpatialBounds(this.visual, this.geometry.boundingBox!.getBoundingSphere(tightSphere));
    const sphere = this.geometry.boundingSphere!;
    sphere.center.set((minX + maxX) / 2, (minY + maxY) / 2, 0);
    sphere.radius = (Math.hypot(maxX - minX, maxY - minY) / 2) * CULL_RADIUS_SCALE;
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
    if (quadCount <= this.quadCapacity) {
      return;
    }

    this.quadCapacity = THREE.MathUtils.ceilPowerOfTwo(Math.max(quadCount, 16));
    this.positions = new Float32Array(this.quadCapacity * 4 * 3);
    this.uvs = new Float32Array(this.quadCapacity * 4 * 2);
    this.lightOverrides = new Float32Array(this.quadCapacity * 4);
    const indices = new Uint16Array(this.quadCapacity * 6);
    for (let quadIndex = 0; quadIndex < this.quadCapacity; quadIndex++) {
      const vertexOffset = quadIndex * 4;
      const indexOffset = quadIndex * 6;
      indices.set(
        [vertexOffset, vertexOffset + 1, vertexOffset + 2, vertexOffset, vertexOffset + 2, vertexOffset + 3],
        indexOffset,
      );
    }

    const positionAttribute = new THREE.BufferAttribute(this.positions, 3);
    const uvAttribute = new THREE.BufferAttribute(this.uvs, 2);
    positionAttribute.setUsage(THREE.DynamicDrawUsage);
    uvAttribute.setUsage(THREE.DynamicDrawUsage);
    const lightOverrideAttribute = new THREE.BufferAttribute(this.lightOverrides, 1).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', positionAttribute);
    this.geometry.setAttribute('uv', uvAttribute);
    // Read by the world lighting as each part's minimum light (AnimState:SetSymbolLightOverride).
    this.geometry.setAttribute('spriteLightOverride', lightOverrideAttribute);
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  }
}

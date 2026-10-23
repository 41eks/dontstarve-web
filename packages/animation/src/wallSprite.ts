import * as THREE from 'three';
import {
  createMaterials,
  FrameGeometryCache,
  findImage,
  loadAnim,
  loadBuild,
  smallHash,
  SpriteFrameRenderer,
  type Animation,
  type Matrix2D,
  type ParsedAnim,
  type ParsedBuild,
  type ResolvedSprite,
} from './animationAssets';
import { registerSpriteRenderGroup } from './renderOrder';
import type { TransientSpriteAnimationController } from './sprite';

/** Extra symbol drawn over the main one; `imageIndices` pairs positionally with the main list. */
export interface StaticSpriteOverlay {
  symbol: string;
  imageIndices: readonly number[];
}

export interface StaticSpriteOptions {
  /** Build image frames the sprite can draw, e.g. `[4, 14]` for `wall_segment-4` and `wall_segment-14`. */
  imageIndices: readonly number[];
  /** Frame shown first; defaults to the first entry of `imageIndices`. */
  imageIndex?: number;
  name?: string;
  scale?: number;
  symbol?: string;
  /** Source skin build; missing symbols fall back to the base wall build. */
  skinArchive?: string;
  /**
   * Symbol stacked on top of `symbol`, e.g. `wall_dreadstone` draws
   * `wall_segment_red` over `wall_segment_base`.
   */
  overlay?: StaticSpriteOverlay;
  /** Optional animation-only archive for transient wall hit feedback. */
  animationArchive?: string;
  /** Anchor transient transforms to this pose so the static foot point stays fixed. */
  restAnimation?: string;
}

export interface StaticSpriteController extends TransientSpriteAnimationController {
  /** Switches to another of the sprite's `imageIndices` frames. */
  showImage(imageIndex: number): void;
  setFacing(facing: number): void;
  /**
   * AnimState:PlayAnimation(name, false) held on its final frame between transient clips.
   * `undefined` shows the static build image (the source rest pose).
   */
  setPose(name: string | undefined): void;
  readonly pose: string | undefined;
  setColour(colour: readonly number[]): void;
  setOpacity(opacity: number): void;
  dispose(): void;
  copyPlaybackFrom(source: StaticSpriteController): void;
}

const IDENTITY_MATRIX: Matrix2D = [1, 0, 0, 1, 0, 0];

/** Static wall poses with optional directional hit animation feedback. */
class StaticSprite implements StaticSpriteController {
  private readonly renderer: SpriteFrameRenderer;
  private readonly frames: ReadonlyMap<number, ResolvedSprite[]>;
  private imageIndex?: number;
  private onComplete?: () => void;
  private facing?: number;
  private clip?: Animation;
  private poseName?: string;
  private elapsed = 0;
  private readonly builds: readonly { build: ParsedBuild; materials: THREE.MeshBasicMaterial[] }[];
  private readonly animations?: ParsedAnim;
  private readonly restAnimation?: string;
  private readonly frameCache?: FrameGeometryCache;
  private readonly privateMaterials = new Map<THREE.MeshBasicMaterial, THREE.MeshBasicMaterial>();

  constructor(
    visual: THREE.Group,
    frames: ReadonlyMap<number, ResolvedSprite[]>,
    imageIndex: number,
    builds: readonly { build: ParsedBuild; materials: THREE.MeshBasicMaterial[] }[],
    animations?: ParsedAnim,
    restAnimation?: string,
    frameCache?: FrameGeometryCache,
  ) {
    this.frameCache = frameCache;
    this.builds = builds;
    this.animations = animations;
    this.restAnimation = restAnimation;
    this.renderer = new SpriteFrameRenderer(visual);
    this.frames = frames;
    this.showImage(imageIndex);
  }

  start() {}
  get currentAnimation(): string { return this.clip?.name ?? this.poseName ?? this.restAnimation ?? ''; }
  get pose(): string | undefined { return this.poseName; }

  setPose(name: string | undefined) {
    if (name !== undefined && this.animations) this.findAnimation(name);
    this.poseName = name;
    if (!this.clip) this.showRest();
  }

  playOnce(name: string, onComplete?: () => void) {
    if (this.animations) {
      this.clip = this.findAnimation(name);
      this.elapsed = 0;
      this.showAnimationFrame(0);
    }
    this.onComplete = onComplete;
  }

  playTransient(name: string) { this.playOnce(name); }

  copyPlaybackFrom(source: StaticSpriteController) {
    if (!(source instanceof StaticSprite)) throw new Error('Incompatible static sprite controller');
    this.facing = source.facing;
    this.poseName = source.poseName;
    this.showImage(source.imageIndex!);
    if (!source.clip) this.showRest();
    this.onComplete = source.onComplete;
    if (source.clip) {
      this.clip = this.findAnimation(source.clip.name);
      this.elapsed = source.elapsed;
      this.showAnimationFrame(Math.min(this.clip.frames.length - 1, Math.floor(this.elapsed * this.clip.frameRate)));
    }
  }

  setFacing(facing: number) {
    if (this.facing === facing) return;
    this.facing = facing;
    if (this.clip) {
      this.clip = this.findAnimation(this.clip.name);
      this.showAnimationFrame(Math.min(this.clip.frames.length - 1, Math.floor(this.elapsed * this.clip.frameRate)));
    } else if (this.poseName) this.showRest();
  }

  update(dt: number) {
    if (this.clip) {
      this.elapsed += Math.min(dt, 0.1);
      const frame = Math.floor(this.elapsed * this.clip.frameRate);
      if (frame < this.clip.frames.length) { this.showAnimationFrame(frame); return; }
      this.clip = undefined;
      this.showRest();
    }
    if (!this.onComplete) return;
    const onComplete = this.onComplete;
    this.onComplete = undefined;
    onComplete();
  }

  showImage(imageIndex: number) {
    if (imageIndex === this.imageIndex) return;
    const sprites = this.frames.get(imageIndex);
    if (!sprites) throw new Error(`Static sprite has no image ${imageIndex}`);
    this.imageIndex = imageIndex;
    if (!this.clip) this.showRest();
  }

  private showRest() {
    if (this.poseName === undefined || !this.animations) { this.show(`image:${this.imageIndex}`, () => this.frames.get(this.imageIndex!)!); return; }
    const pose = this.findAnimation(this.poseName);
    this.showFrame(pose, pose.frames.length - 1);
  }

  private findAnimation(name: string): Animation {
    const candidates = this.animations!.animations.filter((animation) => animation.name === name);
    const clip = candidates.find((animation) => this.facing !== undefined && (animation.facing & this.facing) !== 0) ?? candidates[0];
    if (!clip) throw new Error(`Static sprite animation ${name} is unavailable`);
    return clip;
  }

  private showAnimationFrame(frame: number) { this.showFrame(this.clip!, frame); }

  private show(key: string, resolve: () => ResolvedSprite[]): void {
    if (!this.frameCache) { this.renderer.show(resolve()); return; }
    const frame = this.frameCache.get(key, resolve);
    this.renderer.showShared(this.privateMaterials.size === 0 ? frame : {
      ...frame, materials: frame.materials.map(material => this.privateMaterials.get(material) ?? material),
    });
  }

  private dress(apply: (material: THREE.MeshBasicMaterial) => void): void {
    for (const { materials } of this.builds) for (const source of materials) {
      let material = this.privateMaterials.get(source);
      if (!material) { material = source.clone(); this.privateMaterials.set(source, material); }
      apply(material);
    }
    if (this.clip) this.showAnimationFrame(Math.min(this.clip.frames.length - 1, Math.floor(this.elapsed * this.clip.frameRate)));
    else this.showRest();
  }

  setColour(colour: readonly number[]): void {
    const r = colour[0] ?? 1, g = colour[1] ?? 1, b = colour[2] ?? 1;
    if (this.builds.every(({ materials }) => materials.every(source => {
      const value = (this.privateMaterials.get(source) ?? source).color;
      return value.r === r && value.g === g && value.b === b;
    }))) return;
    this.dress(material => material.color.setRGB(r, g, b));
  }
  setOpacity(opacity: number): void {
    if (this.builds.every(({ materials }) => materials.every(source => (this.privateMaterials.get(source) ?? source).opacity === opacity))) return;
    this.dress(material => { material.transparent = true; material.opacity = opacity; });
  }
  dispose(): void {
    this.onComplete = undefined;
    this.renderer.dispose();
    for (const material of this.privateMaterials.values()) material.dispose();
    this.privateMaterials.clear();
  }

  private showFrame(clip: Animation, frame: number) {
    const rest = this.restAnimation ? this.findAnimation(this.restAnimation).frames[0] : undefined;
    this.show(`anim:${this.frameCache?.idOf(clip)}:${frame}`, () => [...clip.frames[frame].elements].sort((a, b) => b.z - a.z).flatMap((element): ResolvedSprite[] => {
      const source = this.builds.find(({ build }) => findImage(build, element.imageHash, element.imageIndex));
      if (!source) return [];
      const image = findImage(source.build, element.imageHash, element.imageIndex)!;
      const anchor = rest?.elements.find((part) => part.imageHash === element.imageHash);
      const matrix: Matrix2D = [...element.matrix];
      if (anchor) { matrix[4] -= anchor.matrix[4]; matrix[5] -= anchor.matrix[5]; }
      return [{ element: { ...element, matrix }, image, materials: source.materials }];
    }));
  }
}

function staticSpriteFrame(
  builds: readonly { build: ParsedBuild; materials: THREE.MeshBasicMaterial[] }[],
  symbolHash: number,
  imageIndex: number,
): ResolvedSprite {
  const source = builds.find(({ build }) => findImage(build, symbolHash, imageIndex));
  if (!source) {
    throw new Error(`Build ${builds[0].build.name} has no drawable image ${symbolHash}-${imageIndex}`);
  }
  const image = findImage(source.build, symbolHash, imageIndex)!;
  return {
    element: {
      imageHash: symbolHash,
      imageIndex,
      layerHash: symbolHash,
      matrix: IDENTITY_MATRIX,
      z: 0,
    },
    image,
    materials: source.materials,
  };
}

/**
 * Renders build images from an archive that ships no anim.bin. Build symbols
 * such as `wall_segment` hold one image per state or facing, so a static prefab
 * draws one of those images at a time rather than animating it.
 */
export async function createStaticSprite(
  assetBaseUrl: string,
  file: string,
  options: StaticSpriteOptions,
): Promise<THREE.Group> {
  const factory = await createStaticSpriteFactory(assetBaseUrl, file, options);
  const sprite = factory.create();
  sprite.userData.disposeSharedSprite = () => factory.dispose();
  return sprite;
}

/** One immutable frame/atlas source; each entity owns only its controller, meshes and private appearance. */
export interface StaticSpriteFactory {
  create(): THREE.Group;
  disposeSprite(sprite: THREE.Group): void;
  dispose(): void;
}

export async function createStaticSpriteFactory(
  assetBaseUrl: string,
  file: string,
  options: StaticSpriteOptions,
): Promise<StaticSpriteFactory> {
  const [buildPackage, animations, skinPackage] = await Promise.all([
    loadBuild(file, assetBaseUrl),
    options.animationArchive ? loadAnim(options.animationArchive, assetBaseUrl) : undefined,
    options.skinArchive ? loadBuild(options.skinArchive, assetBaseUrl) : undefined,
  ]);
  const build = buildPackage.build;
  const symbolHash = options.symbol ? smallHash(options.symbol) : build.symbols.keys().next().value;
  if (symbolHash === undefined) throw new Error(`Build ${build.name} does not contain any symbol`);
  if (!options.imageIndices.length) throw new Error(`Static sprite ${file} must offer at least one build image`);
  const overlay = options.overlay;
  if (overlay && overlay.imageIndices.length !== options.imageIndices.length) {
    throw new Error(`Static sprite ${file} overlay must pair with every image index`);
  }
  const overlayHash = overlay ? smallHash(overlay.symbol) : undefined;
  const builds = [skinPackage, buildPackage].filter(entry => entry !== undefined)
    .map(entry => ({ build: entry.build, materials: createMaterials(entry) }));
  const frames = new Map<number, ResolvedSprite[]>(options.imageIndices.map((imageIndex, position) => {
    const sprites = [staticSpriteFrame(builds, symbolHash, imageIndex)];
    if (overlay && overlayHash !== undefined) sprites.push(staticSpriteFrame(builds, overlayHash, overlay.imageIndices[position]));
    return [imageIndex, sprites];
  }));
  const cache = new FrameGeometryCache();
  const sprites = new Set<THREE.Group>();
  let disposed = false;
  const disposeSprite = (sprite: THREE.Group) => {
    if (!sprites.delete(sprite)) return;
    (sprite.userData.animationController as StaticSpriteController).dispose();
    sprite.removeFromParent();
    sprite.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
  };
  return {
    create() {
      if (disposed) throw new Error('Static sprite factory has been disposed');
      const sprite = new THREE.Group();
      sprite.name = options.name ?? build.name;
      sprite.userData.billboard = true;
      const visual = new THREE.Group();
      const scale = options.scale ?? 0.02;
      visual.scale.set(scale, -scale, scale);
      sprite.add(visual);
      registerSpriteRenderGroup(sprite, visual);
      sprite.userData.animationController = new StaticSprite(visual, frames, options.imageIndex ?? options.imageIndices[0],
        builds, animations, options.restAnimation, cache);
      sprites.add(sprite);
      return sprite;
    },
    disposeSprite,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const sprite of sprites) disposeSprite(sprite);
      cache.dispose();
      for (const { materials } of builds) for (const material of materials) { material.map?.dispose(); material.dispose(); }
    },
  };
}

import * as THREE from 'three';
import {
  createMaterials,
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
  private elapsed = 0;
  private readonly build: ParsedBuild;
  private readonly materials: THREE.MeshBasicMaterial[];
  private readonly animations?: ParsedAnim;
  private readonly restAnimation?: string;

  constructor(
    visual: THREE.Group,
    frames: ReadonlyMap<number, ResolvedSprite[]>,
    imageIndex: number,
    build: ParsedBuild,
    materials: THREE.MeshBasicMaterial[],
    animations?: ParsedAnim,
    restAnimation?: string,
  ) {
    this.build = build;
    this.materials = materials;
    this.animations = animations;
    this.restAnimation = restAnimation;
    this.renderer = new SpriteFrameRenderer(visual);
    this.frames = frames;
    this.showImage(imageIndex);
  }

  start() {}
  get currentAnimation(): string { return this.clip?.name ?? this.restAnimation ?? ''; }

  playOnce(name: string, onComplete?: () => void) {
    if (this.animations) {
      this.clip = this.findAnimation(name);
      this.elapsed = 0;
      this.showAnimationFrame(0);
    }
    this.onComplete = onComplete;
  }

  playTransient(name: string) { this.playOnce(name); }

  setFacing(facing: number) {
    if (this.facing === facing) return;
    this.facing = facing;
    if (this.clip) {
      this.clip = this.findAnimation(this.clip.name);
      this.showAnimationFrame(Math.min(this.clip.frames.length - 1, Math.floor(this.elapsed * this.clip.frameRate)));
    }
  }

  update(dt: number) {
    if (this.clip) {
      this.elapsed += Math.min(dt, 0.1);
      const frame = Math.floor(this.elapsed * this.clip.frameRate);
      if (frame < this.clip.frames.length) { this.showAnimationFrame(frame); return; }
      this.clip = undefined;
      this.renderer.show(this.frames.get(this.imageIndex!)!);
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
    if (!this.clip) this.renderer.show(sprites);
  }

  private findAnimation(name: string): Animation {
    const candidates = this.animations!.animations.filter((animation) => animation.name === name);
    const clip = candidates.find((animation) => this.facing !== undefined && (animation.facing & this.facing) !== 0) ?? candidates[0];
    if (!clip) throw new Error(`Static sprite animation ${name} is unavailable`);
    return clip;
  }

  private showAnimationFrame(frame: number) {
    const rest = this.restAnimation ? this.findAnimation(this.restAnimation).frames[0] : undefined;
    this.renderer.show([...this.clip!.frames[frame].elements].sort((a, b) => b.z - a.z).flatMap((element): ResolvedSprite[] => {
      const image = findImage(this.build, element.imageHash, element.imageIndex);
      if (!image) return [];
      const anchor = rest?.elements.find((part) => part.imageHash === element.imageHash);
      const matrix: Matrix2D = [...element.matrix];
      if (anchor) { matrix[4] -= anchor.matrix[4]; matrix[5] -= anchor.matrix[5]; }
      return [{ element: { ...element, matrix }, image, materials: this.materials }];
    }));
  }
}

function staticSpriteFrame(
  build: ParsedBuild,
  symbolHash: number,
  imageIndex: number,
  materials: THREE.MeshBasicMaterial[],
): ResolvedSprite {
  const image = findImage(build, symbolHash, imageIndex);
  if (!image) {
    throw new Error(`Build ${build.name} has no drawable image ${symbolHash}-${imageIndex}`);
  }
  return {
    element: {
      imageHash: symbolHash,
      imageIndex,
      layerHash: symbolHash,
      matrix: IDENTITY_MATRIX,
      z: 0,
    },
    image,
    materials,
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
  const [buildPackage, animations] = await Promise.all([
    loadBuild(file, assetBaseUrl),
    options.animationArchive ? loadAnim(options.animationArchive, assetBaseUrl) : undefined,
  ]);
  const build = buildPackage.build;
  const symbolHash = options.symbol ? smallHash(options.symbol) : build.symbols.keys().next().value;
  if (symbolHash === undefined) {
    throw new Error(`Build ${build.name} does not contain any symbol`);
  }
  if (!options.imageIndices.length) {
    throw new Error(`Static sprite ${file} must offer at least one build image`);
  }

  const sprite = new THREE.Group();
  sprite.name = options.name ?? build.name;
  sprite.userData.billboard = true;

  const visual = new THREE.Group();
  const scale = options.scale ?? 0.02;
  visual.scale.set(scale, -scale, scale);
  sprite.add(visual);
  registerSpriteRenderGroup(sprite, visual);

  const materials = createMaterials(buildPackage);
  const overlay = options.overlay;
  if (overlay && overlay.imageIndices.length !== options.imageIndices.length) {
    throw new Error(`Static sprite ${file} overlay must pair with every image index`);
  }
  const overlayHash = overlay ? smallHash(overlay.symbol) : undefined;
  const frames = new Map<number, ResolvedSprite[]>(options.imageIndices.map((imageIndex, position) => {
    const sprites = [staticSpriteFrame(build, symbolHash, imageIndex, materials)];
    if (overlay && overlayHash !== undefined) {
      sprites.push(staticSpriteFrame(build, overlayHash, overlay.imageIndices[position], materials));
    }
    return [imageIndex, sprites];
  }));
  sprite.userData.animationController = new StaticSprite(
    visual,
    frames,
    options.imageIndex ?? options.imageIndices[0],
    build, materials, animations, options.restAnimation,
  );
  return sprite;
}

import * as THREE from 'three';
import {
  createMaterials,
  findImage,
  loadAnimationArchive,
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

export interface SpriteAnimationController {
  start(name: string): void;
  playOnce(name: string, onComplete?: () => void): void;
  update(dt: number): void;
}

export interface AnimatedSpriteOptions {
  initialAnimation: string;
  name?: string;
  scale?: number;
}

export interface StaticSpriteOptions {
  /** Build image frames the sprite can draw, e.g. `[4, 14]` for `wall_segment-4` and `wall_segment-14`. */
  imageIndices: readonly number[];
  /** Frame shown first; defaults to the first entry of `imageIndices`. */
  imageIndex?: number;
  name?: string;
  scale?: number;
  symbol?: string;
}

export interface StaticSpriteController extends SpriteAnimationController {
  /** Switches to another of the sprite's `imageIndices` frames. */
  showImage(imageIndex: number): void;
}

const IDENTITY_MATRIX: Matrix2D = [1, 0, 0, 1, 0, 0];

class SpriteController implements SpriteAnimationController {
  private readonly renderer: SpriteFrameRenderer;
  private readonly build: ParsedBuild;
  private readonly animations: ParsedAnim;
  private readonly materials: THREE.MeshBasicMaterial[];
  private animation!: Animation;
  private animationName = '';
  private elapsed = 0;
  private frameIndex = -1;
  private loop = true;
  private onComplete?: () => void;

  constructor(
    visual: THREE.Group,
    build: ParsedBuild,
    animations: ParsedAnim,
    materials: THREE.MeshBasicMaterial[],
    initialAnimation: string,
  ) {
    this.renderer = new SpriteFrameRenderer(visual);
    this.build = build;
    this.animations = animations;
    this.materials = materials;
    this.selectAnimation(initialAnimation, true);
  }

  start(name: string) {
    if (name === this.animationName && this.loop) return;
    this.selectAnimation(name, true);
  }

  playOnce(name: string, onComplete?: () => void) {
    this.selectAnimation(name, false, onComplete);
  }

  update(dt: number) {
    this.elapsed += Math.min(dt, 0.1);
    const elapsedFrame = Math.floor(this.elapsed * this.animation.frameRate);
    if (!this.loop && elapsedFrame >= this.animation.frames.length) {
      const completion = this.onComplete;
      this.onComplete = undefined;
      completion?.();
      return;
    }

    const nextFrame = this.loop
      ? elapsedFrame % this.animation.frames.length
      : elapsedFrame;
    this.showFrame(nextFrame);
  }

  private selectAnimation(name: string, loop: boolean, onComplete?: () => void) {
    const animation = this.animations.animations.find((candidate) => candidate.name === name);
    if (!animation) throw new Error(`Sprite animation ${name} is unavailable`);
    if (!animation.frames.length) throw new Error(`Sprite animation ${name} has no frames`);
    this.animation = animation;
    this.animationName = name;
    this.loop = loop;
    this.onComplete = onComplete;
    this.elapsed = 0;
    this.frameIndex = -1;
    this.showFrame(0);
  }

  private showFrame(index: number) {
    if (index === this.frameIndex) return;
    this.frameIndex = index;
    const sprites = [...this.animation.frames[index].elements]
      .sort((a, b) => b.z - a.z)
      .map((element) => {
        const image = findImage(this.build, element.imageHash, element.imageIndex);
        return image ? { element, image, materials: this.materials } : undefined;
      })
      .filter((sprite): sprite is ResolvedSprite => Boolean(sprite));
    this.renderer.show(sprites);
  }
}

export async function createAnimatedSprite(
  assetBaseUrl: string,
  file: string,
  options: AnimatedSpriteOptions,
): Promise<THREE.Group> {
  const { buildPackage, animations } = await loadAnimationArchive(file, assetBaseUrl);
  const sprite = new THREE.Group();
  sprite.name = options.name ?? buildPackage.build.name;
  sprite.userData.billboard = true;

  const visual = new THREE.Group();
  const scale = options.scale ?? 0.02;
  visual.scale.set(scale, -scale, scale);
  sprite.add(visual);
  registerSpriteRenderGroup(sprite, visual);

  const controller = new SpriteController(
    visual,
    buildPackage.build,
    animations,
    createMaterials(buildPackage),
    options.initialAnimation,
  );
  sprite.userData.animationController = controller;
  return sprite;
}

/** Stands in for a {@link SpriteAnimationController} on sprites that never animate. */
class StaticSprite implements StaticSpriteController {
  private readonly renderer: SpriteFrameRenderer;
  private readonly frames: ReadonlyMap<number, ResolvedSprite[]>;
  private imageIndex?: number;
  private onComplete?: () => void;

  constructor(
    visual: THREE.Group,
    frames: ReadonlyMap<number, ResolvedSprite[]>,
    imageIndex: number,
  ) {
    this.renderer = new SpriteFrameRenderer(visual);
    this.frames = frames;
    this.showImage(imageIndex);
  }

  start() {}

  playOnce(_name: string, onComplete?: () => void) {
    this.onComplete = onComplete;
  }

  update() {
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
    this.renderer.show(sprites);
  }
}

function staticSpriteFrame(
  build: ParsedBuild,
  symbolHash: number,
  imageIndex: number,
  materials: THREE.MeshBasicMaterial[],
): ResolvedSprite[] {
  const image = findImage(build, symbolHash, imageIndex);
  if (!image) {
    throw new Error(`Build ${build.name} has no drawable image ${symbolHash}-${imageIndex}`);
  }
  return [{
    element: {
      imageHash: symbolHash,
      imageIndex,
      layerHash: symbolHash,
      matrix: IDENTITY_MATRIX,
      z: 0,
    },
    image,
    materials,
  }];
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
  const buildPackage = await loadBuild(file, assetBaseUrl);
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
  const frames = new Map(options.imageIndices.map((imageIndex) => [
    imageIndex,
    staticSpriteFrame(build, symbolHash, imageIndex, materials),
  ]));
  sprite.userData.animationController = new StaticSprite(
    visual,
    frames,
    options.imageIndex ?? options.imageIndices[0],
  );
  return sprite;
}

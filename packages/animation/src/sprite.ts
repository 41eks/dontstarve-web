import * as THREE from 'three';
import {
  createMaterials,
  findImage,
  loadAnimationArchive,
  loadBuild,
  loadSpriteSkinArchive,
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
  /** Restore a stable one-shot end pose without replaying its animation. */
  initialFrame?: 'first' | 'last';
  name?: string;
  scale?: number;
  /** Skin build archive; missing symbols fall back to the base build. */
  skinArchive?: string;
  /** Restrict replacement to these symbols, e.g. researchlab4's machine_hat. */
  skinSymbols?: readonly string[];
  /** Symbols DST explicitly keeps from the base build even when wearing a skin. */
  baseSymbols?: readonly string[];
  /** Additional skin animation banks drawn over the main frame in the same mesh. */
  skinAnimationBanks?: readonly string[];
}

interface SpriteSkin {
  build: ParsedBuild;
  materials: THREE.MeshBasicMaterial[];
  animations?: ParsedAnim;
  symbols?: ReadonlySet<number>;
  baseSymbols: ReadonlySet<number>;
  animationBanks: ReadonlySet<number>;
}

/** One archive and set of atlas materials shared by independent animated entities. */
export interface AnimatedSpriteFactory {
  create(options: AnimatedSpriteOptions): THREE.Group;
  disposeSprite(sprite: THREE.Group): void;
  dispose(): void;
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
  private frameKey = '';
  private layers: Animation[] = [];
  private loop = true;
  private onComplete?: () => void;
  private readonly skin?: SpriteSkin;

  constructor(
    visual: THREE.Group,
    build: ParsedBuild,
    animations: ParsedAnim,
    materials: THREE.MeshBasicMaterial[],
    initialAnimation: string,
    skin?: SpriteSkin,
  ) {
    this.renderer = new SpriteFrameRenderer(visual);
    this.build = build;
    this.animations = animations;
    this.materials = materials;
    this.skin = skin;
    this.selectAnimation(initialAnimation, true);
  }

  start(name: string) {
    if (name === this.animationName && this.loop) return;
    this.selectAnimation(name, true);
  }

  playOnce(name: string, onComplete?: () => void) {
    this.selectAnimation(name, false, onComplete);
  }

  holdLastFrame(name: string) {
    this.selectAnimation(name, false);
    this.elapsed = this.animation.frames.length / this.animation.frameRate;
    this.showFrame(this.animation.frames.length - 1);
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
    const baseAnimation = this.animations.animations.find((candidate) => candidate.name === name);
    if (!baseAnimation) throw new Error(`Sprite animation ${name} is unavailable`);
    const animation = this.skin?.animations?.animations.find((candidate) =>
      candidate.name === name && candidate.bankHash === baseAnimation.bankHash,
    ) ?? baseAnimation;
    if (!animation.frames.length) throw new Error(`Sprite animation ${name} has no frames`);
    this.animation = animation;
    this.animationName = name;
    this.loop = loop;
    this.onComplete = onComplete;
    this.elapsed = 0;
    this.frameKey = '';
    this.layers = this.skin?.animations?.animations.filter((candidate) =>
      candidate.name === name && this.skin!.animationBanks.has(candidate.bankHash),
    ) ?? [];
    this.showFrame(0);
  }

  private showFrame(index: number) {
    const layerIndices = this.layers.map((layer) => {
      const frame = Math.floor(this.elapsed * layer.frameRate);
      return this.loop ? frame % layer.frames.length : Math.min(frame, layer.frames.length - 1);
    });
    const key = `${index}:${layerIndices.join(',')}`;
    if (key === this.frameKey) return;
    this.frameKey = key;
    const frames = [this.animation.frames[index], ...this.layers.map((layer, i) => layer.frames[layerIndices[i]])];
    const sprites = frames.flatMap((frame) => [...frame.elements]
      .sort((a, b) => b.z - a.z)
      .map((element) => {
        const skin = this.skin;
        if (skin && !skin.baseSymbols.has(element.imageHash)
          && (skin.symbols === undefined || skin.symbols.has(element.imageHash))) {
          const image = findImage(skin.build, element.imageHash, element.imageIndex);
          if (image) return { element, image, materials: skin.materials };
        }
        const image = findImage(this.build, element.imageHash, element.imageIndex);
        return image ? { element, image, materials: this.materials } : undefined;
      })
      .filter((sprite): sprite is ResolvedSprite => Boolean(sprite)));
    this.renderer.show(sprites);
  }
}

export async function createAnimatedSprite(
  assetBaseUrl: string,
  file: string,
  options: AnimatedSpriteOptions,
): Promise<THREE.Group> {
  const { buildPackage, animations } = await loadAnimationArchive(file, assetBaseUrl);
  const skinArchive = options.skinArchive
    ? await loadSpriteSkinArchive(options.skinArchive, assetBaseUrl) : undefined;
  const skin: SpriteSkin | undefined = skinArchive ? {
    build: skinArchive.buildPackage.build,
    materials: createMaterials(skinArchive.buildPackage),
    animations: skinArchive.animations,
    symbols: options.skinSymbols ? new Set(options.skinSymbols.map(smallHash)) : undefined,
    baseSymbols: new Set(options.baseSymbols?.map(smallHash)),
    animationBanks: new Set(options.skinAnimationBanks?.map(smallHash)),
  } : undefined;
  return createSprite(buildPackage.build, animations, createMaterials(buildPackage), options, skin);
}

export async function createAnimatedSpriteFactory(
  assetBaseUrl: string,
  file: string,
): Promise<AnimatedSpriteFactory> {
  const { buildPackage, animations } = await loadAnimationArchive(file, assetBaseUrl);
  const materials = createMaterials(buildPackage);
  const sprites = new Set<THREE.Group>();
  let disposed = false;
  const disposeSprite = (sprite: THREE.Group) => {
    if (!sprites.delete(sprite)) return;
    sprite.removeFromParent();
    sprite.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
  };
  return {
    create(options) {
      if (disposed) throw new Error('Animated sprite factory has been disposed');
      const sprite = createSprite(buildPackage.build, animations, materials, options);
      sprites.add(sprite);
      return sprite;
    },
    disposeSprite,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const sprite of sprites) disposeSprite(sprite);
      for (const material of materials) {
        material.map?.dispose();
        material.dispose();
      }
    },
  };
}

function createSprite(
  build: ParsedBuild,
  animations: ParsedAnim,
  materials: THREE.MeshBasicMaterial[],
  options: AnimatedSpriteOptions,
  skin?: SpriteSkin,
): THREE.Group {
  const sprite = new THREE.Group();
  sprite.name = options.name ?? build.name;
  sprite.userData.billboard = true;

  const visual = new THREE.Group();
  const scale = options.scale ?? 0.02;
  visual.scale.set(scale, -scale, scale);
  sprite.add(visual);
  registerSpriteRenderGroup(sprite, visual);

  const controller = new SpriteController(
    visual,
    build,
    animations,
    materials,
    options.initialAnimation,
    skin,
  );
  if (options.initialFrame === 'last') controller.holdLastFrame(options.initialAnimation);
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

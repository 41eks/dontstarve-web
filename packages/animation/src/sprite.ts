import * as THREE from 'three';
import {
  createMaterials,
  findImage,
  loadAnimationArchive,
  loadSpriteSkinArchive,
  smallHash,
  SpriteFrameRenderer,
  type Animation,
  type BuildPackage,
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

export interface TransientSpriteAnimationController extends SpriteAnimationController {
  readonly currentAnimation: string;
  /** Brief feedback, then restore the interrupted clip, pose and callback. */
  playTransient(name: string): void;
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

export class SpriteController implements TransientSpriteAnimationController {
  protected readonly visual: THREE.Group;
  private readonly renderer: SpriteFrameRenderer;
  private readonly build: ParsedBuild;
  protected readonly animations: ParsedAnim;
  private readonly materials: THREE.MeshBasicMaterial[];
  protected animation!: Animation;
  protected animationName = '';
  protected elapsed = 0;
  protected frameKey = '';
  private layers: Animation[] = [];
  protected loop = true;
  private onComplete?: () => void;
  private transientRestore?: () => void;
  private readonly skin?: SpriteSkin;

  constructor(
    visual: THREE.Group,
    build: ParsedBuild,
    animations: ParsedAnim,
    materials: THREE.MeshBasicMaterial[],
    initialAnimation: string,
    skin?: SpriteSkin,
  ) {
    this.visual = visual;
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

  get currentAnimation(): string { return this.animationName; }

  playOnce(name: string, onComplete?: () => void) {
    this.selectAnimation(name, false, onComplete);
  }

  playTransient(name: string) {
    const { animationName, elapsed, loop, onComplete } = this;
    const restore = this.transientRestore ?? (() => {
      this.selectAnimation(animationName, loop, onComplete);
      this.elapsed = elapsed;
      const frame = Math.floor(elapsed * this.animation.frameRate);
      this.showFrame(loop ? frame % this.animation.frames.length : Math.min(frame, this.animation.frames.length - 1));
    });
    this.selectAnimation(name, false, restore);
    this.transientRestore = restore;
  }

  holdLastFrame(name: string) {
    this.selectAnimation(name, false);
    this.elapsed = this.animation.frames.length / this.animation.frameRate;
    this.showFrame(this.animation.frames.length - 1);
  }

  protected findAnimation(name: string): Animation {
    const base = this.animations.animations.find((candidate) => candidate.name === name);
    if (!base) throw new Error(`Sprite animation ${name} is unavailable`);
    return this.skin?.animations?.animations.find((candidate) =>
      candidate.name === name && candidate.bankHash === base.bankHash,
    ) ?? base;
  }

  protected isLayerVisible(_layerHash: number): boolean { return true; }

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
    const animation = this.findAnimation(name);
    if (!animation.frames.length) throw new Error(`Sprite animation ${name} has no frames`);
    this.animation = animation;
    this.animationName = name;
    this.loop = loop;
    this.onComplete = onComplete;
    this.transientRestore = undefined;
    this.elapsed = 0;
    this.frameKey = '';
    this.layers = this.skin?.animations?.animations.filter((candidate) =>
      candidate.name === name && this.skin!.animationBanks.has(candidate.bankHash),
    ) ?? [];
    this.showFrame(0);
  }

  protected showFrame(index: number) {
    const layerIndices = this.layers.map((layer) => {
      const frame = Math.floor(this.elapsed * layer.frameRate);
      return this.loop ? frame % layer.frames.length : Math.min(frame, layer.frames.length - 1);
    });
    const key = `${index}:${layerIndices.join(',')}`;
    if (key === this.frameKey) return;
    this.frameKey = key;
    const frames = [this.animation.frames[index], ...this.layers.map((layer, i) => layer.frames[layerIndices[i]])];
    const sprites = frames.flatMap((frame) => [...frame.elements]
      .filter((element) => this.isLayerVisible(element.layerHash))
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
  return createSpriteFactory(buildPackage, animations);
}

/** Share loaded atlases while allowing specialized sprite controllers. */
export function createSpriteFactory(
  buildPackage: BuildPackage,
  animations: ParsedAnim,
  controllerClass: typeof SpriteController = SpriteController,
): AnimatedSpriteFactory {
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
      const sprite = createSprite(buildPackage.build, animations, materials, options, undefined, controllerClass);
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
  controllerClass: typeof SpriteController = SpriteController,
): THREE.Group {
  const sprite = new THREE.Group();
  sprite.name = options.name ?? build.name;
  sprite.userData.billboard = true;

  const visual = new THREE.Group();
  const scale = options.scale ?? 0.02;
  visual.scale.set(scale, -scale, scale);
  sprite.add(visual);
  registerSpriteRenderGroup(sprite, visual);

  const controller = new controllerClass(
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

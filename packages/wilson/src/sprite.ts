import * as THREE from 'three';
import {
  createMaterials,
  findImage,
  loadAnimationArchive,
  SpriteFrameRenderer,
  type Animation,
  type ParsedAnim,
  type ParsedBuild,
  type ResolvedSprite,
} from './animationAssets';

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

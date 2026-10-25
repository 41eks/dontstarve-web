import {
  atlasPixels, findImage, loadAnimationArchive, type Animation, type BuildPackage,
} from '@dontstarve-web/animation/animationAssets';
import { createEffect, type ReadonlySignal } from '@dontstarve-web/signals';

/** playerhud.lua CreateOverlays / GoSane / GoInsane: an ungraded UIAnim. */
export class SanityVignette {
  readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private readonly stopState: () => void;
  private buildPackage?: BuildPackage;
  private atlases: HTMLCanvasElement[] = [];
  private animations = new Map<string, Animation>();
  private animationName = '';
  private elapsed = 0;
  private drawnFrame = -1;
  private disposed = false;

  private constructor(sane: ReadonlySignal<boolean>) {
    // constants.lua RESOLUTION_X/Y and SCALEMODE_FIXEDSCREEN_NONDYNAMIC.
    this.canvas.width = 1280;
    this.canvas.height = 720;
    this.canvas.className = 'sanity-vignette';
    this.canvas.setAttribute('aria-hidden', 'true');
    Object.assign(this.canvas.style, {
      position: 'fixed', inset: '0', width: '100%', height: '100%',
      pointerEvents: 'none', zIndex: '1',
    });
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Unable to create DST vignette canvas');
    this.context = context;
    this.stopState = createEffect(() => this.play(sane.get() ? 'basic' : 'insane'));
  }

  static async create(sane: ReadonlySignal<boolean>, animRoot: string): Promise<SanityVignette> {
    const vignette = new SanityVignette(sane);
    try {
      const { buildPackage, animations } = await loadAnimationArchive('vig.zip', animRoot);
      vignette.buildPackage = buildPackage;
      vignette.animations = new Map(animations.animations.map(animation => [animation.name, animation]));
      for (const name of ['basic', 'insane']) {
        if (!vignette.animations.has(name)) throw new Error(`vig.zip: missing ${name} animation`);
      }
      vignette.atlases = buildPackage.atlases.map(texture => {
        const canvas = document.createElement('canvas');
        canvas.width = texture.width;
        canvas.height = texture.height;
        const context = canvas.getContext('2d')!;
        const image = context.createImageData(texture.width, texture.height);
        image.data.set(atlasPixels(texture));
        context.putImageData(image, 0, 0);
        return canvas;
      });
      vignette.draw();
      return vignette;
    } catch (error) {
      vignette.dispose();
      throw error;
    }
  }

  private play(name: string): void {
    if (this.disposed || name === this.animationName) return;
    this.animationName = name;
    this.canvas.dataset.animation = name;
    this.elapsed = 0;
    this.drawnFrame = -1;
    this.draw();
  }

  /** Driven by active game dt: AnimateWhilePaused(false), with source 12 Hz. */
  update(dt: number): void {
    const animation = this.animations.get(this.animationName);
    if (this.disposed || !animation || !Number.isFinite(dt) || dt <= 0) return;
    this.elapsed = (this.elapsed + dt) % (animation.frames.length / animation.frameRate);
    this.draw();
  }

  private draw(): void {
    const animation = this.animations.get(this.animationName);
    if (this.disposed || !animation || !this.buildPackage) return;
    const frameIndex = Math.floor(this.elapsed * animation.frameRate) % animation.frames.length;
    if (frameIndex === this.drawnFrame) return;
    const context = this.context;
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    context.save();
    // UIAnim is anchored at the source origin, not the changing frame bounds.
    context.translate(this.canvas.width / 2, this.canvas.height / 2);
    for (const element of [...animation.frames[frameIndex].elements].sort((a, b) => b.z - a.z)) {
      const image = findImage(this.buildPackage.build, element.imageHash, element.imageIndex);
      if (!image) continue;
      context.save();
      context.transform(...element.matrix);
      context.drawImage(this.atlases[image.sampler ?? 0],
        image.bbx!, image.bby!, image.width, image.height,
        image.x - image.width / 2, image.y - image.height / 2, image.width, image.height);
      context.restore();
    }
    context.restore();
    this.drawnFrame = frameIndex;
    this.canvas.dataset.frame = String(frameIndex);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopState();
    this.canvas.remove();
    this.canvas.width = this.canvas.height = 0;
    for (const atlas of this.atlases) atlas.width = atlas.height = 0;
    this.atlases = [];
    this.animations.clear();
    this.buildPackage = undefined;
  }
}

import { findImage, loadAnimationArchive, type Animation } from '@dontstarve-web/animation/animationAssets';
import { drawFrame as drawUiFrame, uiAnimAsset, type UiAnimAsset } from './badge/ui-anim';

interface Clip {
  animation: Animation;
  frameRate: number;
  frameCount: number;
}

/**
 * A UI animation drawn part by part from its build atlases each frame (`ui-anim.ts`), as the badges are. Composing
 * every frame into an atlas instead kept ~50 MB of canvases for saving.zip, whose own art is 0.5 MB.
 */
interface BackgroundAsset {
  art: UiAnimAsset;
  clips: Map<string, Clip>;
  /** The union of every clip's frame bounds, in build units: one origin across clips. */
  minX: number;
  minY: number;
  width: number;
  height: number;
}

const requests = new Map<string, Promise<BackgroundAsset>>();

function loadBackground(url: string): Promise<BackgroundAsset> {
  let request = requests.get(url);
  if (request) {
    return request;
  }
  request = (async () => {
    const split = url.lastIndexOf('/');
    const { buildPackage, animations } = await loadAnimationArchive(url.slice(split + 1), url.slice(0, split));
    const art = uiAnimAsset(buildPackage, animations.animations);
    const clips = new Map<string, Clip>();
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const animation of animations.animations) {
      clips.set(animation.name, { animation, frameRate: animation.frameRate, frameCount: animation.frames.length });
      // An empty frame (the final close frame) draws nothing and does not widen the bounds.
      for (const frame of animation.frames) {
        for (const element of frame.elements) {
          const image = findImage(buildPackage.build, element.imageHash, element.imageIndex);
          if (!image) {
            continue;
          }
          const [a, b, c, d, tx, ty] = element.matrix;
          const x0 = image.x - image.width / 2,
            y0 = image.y - image.height / 2;
          for (const [x, y] of [
            [x0, y0],
            [x0 + image.width, y0],
            [x0, y0 + image.height],
            [x0 + image.width, y0 + image.height],
          ]) {
            minX = Math.min(minX, a * x + c * y + tx);
            minY = Math.min(minY, b * x + d * y + ty);
            maxX = Math.max(maxX, a * x + c * y + tx);
            maxY = Math.max(maxY, b * x + d * y + ty);
          }
        }
      }
    }
    if (!Number.isFinite(minX)) {
      throw new Error(`${url} has no drawable frames`);
    }
    minX = Math.floor(minX);
    minY = Math.floor(minY);
    return { art, clips, minX, minY, width: Math.ceil(maxX) - minX, height: Math.ceil(maxY) - minY };
  })();
  requests.set(url, request);
  request.catch(() => requests.delete(url));
  return request;
}

/** Plays original DST UI frames on a canvas, keeping one origin across clips. */
export class AnimatedBackground {
  private asset?: BackgroundAsset;
  private animation = '';
  private onComplete?: () => void;
  private startedAt?: number;
  private requestId?: number;
  private disposed = false;
  private percent?: number;

  constructor(
    canvas: HTMLCanvasElement,
    url: string,
    onLayout: (asset: { width: number; height: number; originX: number; originY: number }) => void,
  ) {
    this.canvas = canvas;
    this.canvas.dataset.archive = url;
    void loadBackground(url)
      .then(asset => {
        if (this.disposed) {
          return;
        }
        this.asset = asset;
        this.canvas.width = asset.width;
        this.canvas.height = asset.height;
        onLayout({ width: asset.width, height: asset.height, originX: -asset.minX, originY: -asset.minY });
        this.canvas.dataset.loaded = 'true';
        if (this.percent === undefined) {
          this.requestId = requestAnimationFrame(this.tick);
        } else {
          this.drawPercent();
        }
      })
      .catch((error: unknown) => {
        if (this.disposed) {
          return;
        }
        this.canvas.dataset.error = error instanceof Error ? error.message : String(error);
      });
  }

  private readonly canvas: HTMLCanvasElement;

  playOnce(name: string, onComplete?: () => void): void {
    this.percent = undefined;
    this.animation = name;
    this.canvas.dataset.animation = name;
    this.canvas.dataset.playing = 'true';
    this.onComplete = onComplete;
    this.startedAt = undefined;
    if (this.asset && this.requestId === undefined) {
      this.requestId = requestAnimationFrame(this.tick);
    }
  }

  /** AnimState:SetPercent selects a pose only when its input changes. */
  setPercent(name: string, percent: number): void {
    if (this.disposed) {
      return;
    }
    if (this.requestId !== undefined) {
      cancelAnimationFrame(this.requestId);
    }
    this.requestId = undefined;
    this.animation = name;
    this.percent = Math.max(0, Math.min(1, percent));
    this.onComplete = undefined;
    this.canvas.dataset.animation = name;
    this.canvas.dataset.percent = String(this.percent);
    this.canvas.dataset.playing = 'false';
    this.drawPercent();
  }

  private drawPercent(): void {
    const clip = this.asset?.clips.get(this.animation);
    if (!clip || this.percent === undefined) {
      return;
    }
    this.drawFrame(clip, Math.min(clip.frameCount - 1, Math.floor(this.percent * clip.frameCount)));
  }

  private drawFrame(clip: Clip, frameIndex: number): void {
    const asset = this.asset!;
    const context = this.canvas.getContext('2d')!;
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    context.save();
    context.translate(-asset.minX, -asset.minY);
    drawUiFrame(context, asset.art, clip.animation, frameIndex);
    context.restore();
    this.canvas.dataset.frame = String(frameIndex);
  }

  dispose(): void {
    this.disposed = true;
    if (this.requestId !== undefined) {
      cancelAnimationFrame(this.requestId);
    }
    this.requestId = undefined;
    this.onComplete = undefined;
  }

  private readonly tick = (time: number) => {
    this.requestId = undefined;
    if (!this.asset || this.disposed) {
      return;
    }
    const clip = this.asset.clips.get(this.animation);
    if (!clip) {
      return;
    }
    this.startedAt ??= time;
    const elapsedFrame = Math.floor(((time - this.startedAt) / 1000) * clip.frameRate);
    const frameIndex = Math.min(elapsedFrame, clip.frameCount - 1);
    this.drawFrame(clip, frameIndex);
    if (elapsedFrame >= clip.frameCount) {
      this.canvas.dataset.playing = 'false';
      const complete = this.onComplete;
      this.onComplete = undefined;
      complete?.();
      return;
    }
    this.requestId = requestAnimationFrame(this.tick);
  };
}

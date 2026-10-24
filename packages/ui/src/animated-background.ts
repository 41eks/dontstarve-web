import { loadAnimationArchive } from '@dontstarve-web/animation/animationAssets';
import { composeRgbaSpriteAtlas, type RgbaSpriteAtlasFrame } from '@dontstarve-web/animation/rgbaSpriteAtlas';

interface Clip {
  source: HTMLCanvasElement;
  width: number;
  height: number;
  frames: Map<number, RgbaSpriteAtlasFrame>;
  frameRate: number;
  frameCount: number;
}

interface BackgroundAsset {
  clips: Map<string, Clip>;
  minX: number;
  minY: number;
  width: number;
  height: number;
}

const requests = new Map<string, Promise<BackgroundAsset>>();

function loadBackground(url: string): Promise<BackgroundAsset> {
  let request = requests.get(url);
  if (request) return request;
  request = (async () => {
    const split = url.lastIndexOf('/');
    const { buildPackage, animations } = await loadAnimationArchive(url.slice(split + 1), url.slice(0, split));
    const clips = new Map<string, Clip>();
    const allFrames: RgbaSpriteAtlasFrame[] = [];
    for (const animation of animations.animations) {
      // The final close frame is empty. Preserve its timing without composing
      // an empty frame, which has no drawable bounds.
      const frameIndices = animation.frames.flatMap((frame, index) => frame.elements.length ? [index] : []);
      const atlas = composeRgbaSpriteAtlas(buildPackage, animation, { frameIndices });
      clips.set(animation.name, {
        source: atlas.texture.image as HTMLCanvasElement,
        width: atlas.width, height: atlas.height,
        frames: new Map(atlas.frames.map((frame) => [frame.frameIndex, frame])),
        frameRate: animation.frameRate, frameCount: animation.frames.length,
      });
      allFrames.push(...atlas.frames);
      atlas.texture.dispose();
    }
    const minX = Math.min(...allFrames.map((frame) => frame.minX));
    const minY = Math.min(...allFrames.map((frame) => frame.minY));
    return {
      clips, minX, minY,
      width: Math.max(...allFrames.map((frame) => frame.maxX)) - minX,
      height: Math.max(...allFrames.map((frame) => frame.maxY)) - minY,
    };
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
    void loadBackground(url).then((asset) => {
      if (this.disposed) return;
      this.asset = asset;
      this.canvas.width = asset.width;
      this.canvas.height = asset.height;
      onLayout({ width: asset.width, height: asset.height, originX: -asset.minX, originY: -asset.minY });
      this.canvas.dataset.loaded = 'true';
      if (this.percent === undefined) this.requestId = requestAnimationFrame(this.tick);
      else this.drawPercent();
    }).catch((error: unknown) => {
      if (this.disposed) return;
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
    if (this.asset && this.requestId === undefined) this.requestId = requestAnimationFrame(this.tick);
  }

  /** AnimState:SetPercent selects a pose only when its input changes. */
  setPercent(name: string, percent: number): void {
    if (this.disposed) return;
    if (this.requestId !== undefined) cancelAnimationFrame(this.requestId);
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
    if (!clip || this.percent === undefined) return;
    this.drawFrame(clip, Math.min(clip.frameCount - 1, Math.floor(this.percent * clip.frameCount)));
  }

  private drawFrame(clip: Clip, frameIndex: number): void {
    const frame = clip.frames.get(frameIndex);
    const context = this.canvas.getContext('2d')!;
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (frame) context.drawImage(clip.source,
      frame.u0 * clip.width, (1 - frame.v1) * clip.height, frame.width, frame.height,
      frame.minX - this.asset!.minX, frame.minY - this.asset!.minY, frame.width, frame.height);
    this.canvas.dataset.frame = String(frameIndex);
  }

  dispose(): void {
    this.disposed = true;
    if (this.requestId !== undefined) cancelAnimationFrame(this.requestId);
    this.requestId = undefined;
    this.onComplete = undefined;
  }

  private readonly tick = (time: number) => {
    this.requestId = undefined;
    if (!this.asset || this.disposed) return;
    const clip = this.asset.clips.get(this.animation);
    if (!clip) return;
    this.startedAt ??= time;
    const elapsedFrame = Math.floor((time - this.startedAt) / 1000 * clip.frameRate);
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

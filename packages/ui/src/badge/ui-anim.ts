import {
  atlasPixels,
  findImage,
  loadAnimationArchive,
  loadBuild,
  type Animation,
  type BuildPackage,
} from '@dontstarve-web/animation/animationAssets';
import { createMemo, createSignal, type ReadonlySignal } from '@dontstarve-web/signals';

/** UIAnim art: one build with its atlases as canvases, and the bank's animations when the archive has them. */
export interface UiAnimAsset {
  readonly buildPackage: BuildPackage;
  readonly atlases: HTMLCanvasElement[];
  readonly animations: Map<string, Animation>;
  /** AnimState:SetMultColour, baked into cached copies of the atlases. */
  readonly tinted: Map<string, HTMLCanvasElement[]>;
}

export type Rgb = readonly [number, number, number];

const FPS = 30;
const requests = new Map<string, Promise<UiAnimAsset>>();

function atlasCanvas(width: number, height: number, pixels: Uint8Array): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  const image = context.createImageData(width, height);
  image.data.set(pixels);
  context.putImageData(image, 0, 0);
  return canvas;
}

export function uiAnimAsset(buildPackage: BuildPackage, animations: Animation[] = []): UiAnimAsset {
  return {
    buildPackage,
    atlases: buildPackage.atlases.map(atlas => atlasCanvas(atlas.width, atlas.height, atlasPixels(atlas))),
    animations: new Map(animations.map(animation => [animation.name, animation])),
    tinted: new Map(),
  };
}

/** Loads `anim/<name>.zip`; a build-only archive (an icon build) has no animations. */
export function loadUiAnim(animRoot: string, name: string, withAnimation = true): Promise<UiAnimAsset> {
  const key = `${animRoot}/${name}`;
  let request = requests.get(key);
  if (!request) {
    request = withAnimation
      ? loadAnimationArchive(`${name}.zip`, animRoot).then(archive =>
          uiAnimAsset(archive.buildPackage, archive.animations.animations),
        )
      : loadBuild(`${name}.zip`, animRoot).then(buildPackage => uiAnimAsset(buildPackage));
    requests.set(key, request);
    void request.catch(() => requests.delete(key));
  }
  return request;
}

function tintedAtlases(asset: UiAnimAsset, color: Rgb): HTMLCanvasElement[] {
  const key = color.join(',');
  let atlases = asset.tinted.get(key);
  if (atlases) {
    return atlases;
  }
  atlases = asset.atlases.map(source => {
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(source, 0, 0);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let pixel = 0; pixel < image.data.length; pixel += 4) {
      for (let channel = 0; channel < 3; channel++) {
        image.data[pixel + channel] *= color[channel];
      }
    }
    context.putImageData(image, 0, 0);
    return canvas;
  });
  asset.tinted.set(key, atlases);
  return atlases;
}

export function requireAnimation(asset: UiAnimAsset, name: string): Animation {
  const animation = asset.animations.get(name);
  if (!animation) {
    throw new Error(`${asset.buildPackage.build.name} has no animation ${name}`);
  }
  return animation;
}

export interface SymbolOverride {
  readonly asset: UiAnimAsset;
  readonly symbol: number;
}

export interface DrawOptions {
  /** AnimState:SetMultColour (rgb) */
  readonly tint?: Rgb;
  /** AnimState:SetMultColour (alpha) */
  readonly alpha?: number;
  /** AnimState:OverrideSymbol, keyed by the original symbol hash. */
  readonly overrides?: ReadonlyMap<number, SymbolOverride>;
  /** AnimState:Hide(layer), by layer hash. */
  readonly hiddenLayers?: ReadonlySet<number>;
  /** Widget:SetScale */
  readonly scale?: readonly [number, number];
}

export function drawFrame(
  context: CanvasRenderingContext2D,
  asset: UiAnimAsset,
  animation: Animation,
  frame: number,
  options: DrawOptions = {},
): void {
  context.save();
  if (options.scale) {
    context.scale(options.scale[0], options.scale[1]);
  }
  if (options.alpha !== undefined) {
    context.globalAlpha *= options.alpha;
  }
  for (const element of [...animation.frames[frame].elements].sort((a, b) => b.z - a.z)) {
    if (options.hiddenLayers?.has(element.layerHash)) {
      continue;
    }
    const override = options.overrides?.get(element.imageHash);
    const source = override?.asset ?? asset;
    const image = findImage(source.buildPackage.build, override?.symbol ?? element.imageHash, element.imageIndex);
    if (!image) {
      continue;
    }
    const atlases = options.tint ? tintedAtlases(source, options.tint) : source.atlases;
    context.save();
    context.transform(...element.matrix);
    context.drawImage(
      atlases[image.sampler ?? 0],
      image.bbx!,
      image.bby!,
      image.width,
      image.height,
      image.x - image.width / 2,
      image.y - image.height / 2,
      image.width,
      image.height,
    );
    context.restore();
  }
  context.restore();
}

/** AnimState:SetPercent(anim, percent). */
export function percentFrame(animation: Animation, percent: number): number {
  return Math.max(0, Math.min(animation.frames.length - 1, Math.floor(percent * animation.frames.length)));
}

/** GetCurrentAnimationLength, in milliseconds. */
export function animationLength(asset: UiAnimAsset, name: string): number {
  return (requireAnimation(asset, name).frames.length / FPS) * 1000;
}

const canonical = new WeakMap<Animation, readonly number[]>();

/**
 * Each frame's first frame with the same elements. A clip whose frames are identical, like sanity_arrow's four empty
 * "neutral" frames, draws one picture while it loops.
 */
function canonicalFrames(animation: Animation): readonly number[] {
  let frames = canonical.get(animation);
  if (!frames) {
    const first = new Map<string, number>();
    frames = animation.frames.map((frame, index) => {
      const key = JSON.stringify(frame.elements);
      if (!first.has(key)) {
        first.set(key, index);
      }
      return first.get(key)!;
    });
    canonical.set(animation, frames);
  }
  return frames;
}

interface Step {
  readonly anim: string;
  readonly loop: boolean;
}

interface Timeline {
  readonly start: number;
  readonly steps: readonly Step[];
}

/** The drawn animation and frame. */
export interface AnimFrame {
  readonly anim: string;
  readonly frame: number;
}

/**
 * One UIAnim's AnimState timeline: PlayAnimation replaces the queue and PushAnimation appends; a looping step repeats
 * only while it is the last queued, and a finished non-looping queue holds its last frame. Times are badge
 * milliseconds on the badge's clock signal. The drawn animation and frame are memos of it, so a reader is notified
 * only when the drawn frame changes, not on every clock tick.
 */
export class AnimQueue {
  private readonly timeline = createSignal<Timeline>({ start: 0, steps: [] });
  private readonly asset: UiAnimAsset;
  private readonly current: ReadonlySignal<AnimFrame | undefined>;

  constructor(asset: UiAnimAsset, clock: ReadonlySignal<number>) {
    this.asset = asset;
    const anim = createMemo(() => this.at(this.timeline.get(), clock.get())?.anim);
    // The drawn picture's frame, so stepping between identical frames notifies nobody.
    const frame = createMemo(() => {
      const current = this.at(this.timeline.get(), clock.get());
      const animation = current && this.asset.animations.get(current.anim);
      return animation ? canonicalFrames(animation)[current.frame] : current?.frame;
    });
    this.current = createMemo(() => {
      const name = anim.get();
      const index = frame.get();
      return name === undefined || index === undefined ? undefined : { anim: name, frame: index };
    });
  }

  private frames(anim: string): number {
    return Math.max(1, this.asset.animations.get(anim)?.frames.length ?? 1);
  }

  private at({ start, steps }: Timeline, time: number): (AnimFrame & { over: boolean }) | undefined {
    if (steps.length === 0) {
      return undefined;
    }
    let elapsed = Math.floor((Math.max(0, time - start) * FPS) / 1000);
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];
      const count = this.frames(step.anim);
      if (step.loop && index === steps.length - 1) {
        return { anim: step.anim, frame: elapsed % count, over: false };
      }
      if (elapsed < count) {
        return { anim: step.anim, frame: elapsed, over: false };
      }
      elapsed -= count;
    }
    const step = steps[steps.length - 1];
    return { anim: step.anim, frame: this.frames(step.anim) - 1, over: true };
  }

  PlayAnimation(time: number, anim: string, loop = false): void {
    this.timeline.set({ start: time, steps: [{ anim, loop }] });
  }

  PushAnimation(time: number, anim: string, loop = true): void {
    const timeline = this.timeline.value;
    if (timeline.steps.length === 0 || this.resolve(time).over) {
      this.PlayAnimation(time, anim, loop);
    } else {
      this.timeline.set({ start: timeline.start, steps: [...timeline.steps, { anim, loop }] });
    }
  }

  get playing(): boolean {
    return this.timeline.value.steps.length > 0;
  }

  resolve(time: number): AnimFrame & { over: boolean } {
    return this.at(this.timeline.value, time) ?? { anim: '', frame: 0, over: true };
  }

  /** AnimState:IsCurrentAnimation */
  IsCurrentAnimation(time: number, anim: string): boolean {
    return this.playing && this.resolve(time).anim === anim;
  }

  /** Draws the current frame; nothing until the first PlayAnimation. Reading it tracks only the drawn frame. */
  draw(context: CanvasRenderingContext2D, options?: DrawOptions): void {
    const current = this.current.get();
    if (current) {
      drawFrame(context, this.asset, requireAnimation(this.asset, current.anim), current.frame, options);
    }
  }
}

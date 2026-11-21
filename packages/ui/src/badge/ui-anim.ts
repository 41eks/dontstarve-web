import {
  atlasPixels,
  findImage,
  loadAnimationArchive,
  loadBuild,
  type Animation,
  type BuildPackage,
} from '@dontstarve-web/animation/animationAssets';

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

interface Step {
  readonly anim: string;
  readonly loop: boolean;
}

/**
 * One UIAnim's AnimState timeline: PlayAnimation replaces the queue and PushAnimation appends; a looping step repeats
 * only while it is the last queued, and a finished non-looping queue holds its last frame. Times are badge
 * milliseconds.
 */
export class AnimQueue {
  private start = 0;
  private steps: Step[] = [];
  private readonly asset: UiAnimAsset;

  constructor(asset: UiAnimAsset) {
    this.asset = asset;
  }

  private frames(anim: string): number {
    return Math.max(1, this.asset.animations.get(anim)?.frames.length ?? 1);
  }

  PlayAnimation(time: number, anim: string, loop = false): void {
    this.start = time;
    this.steps = [{ anim, loop }];
  }

  PushAnimation(time: number, anim: string, loop = true): void {
    if (this.steps.length === 0 || this.resolve(time).over) {
      this.PlayAnimation(time, anim, loop);
    } else {
      this.steps.push({ anim, loop });
    }
  }

  get playing(): boolean {
    return this.steps.length > 0;
  }

  resolve(time: number): { anim: string; frame: number; over: boolean } {
    let elapsed = Math.floor((Math.max(0, time - this.start) * FPS) / 1000);
    for (let index = 0; index < this.steps.length; index++) {
      const step = this.steps[index];
      const count = this.frames(step.anim);
      if (step.loop && index === this.steps.length - 1) {
        return { anim: step.anim, frame: elapsed % count, over: false };
      }
      if (elapsed < count) {
        return { anim: step.anim, frame: elapsed, over: false };
      }
      elapsed -= count;
    }
    const step = this.steps[this.steps.length - 1];
    return { anim: step.anim, frame: this.frames(step.anim) - 1, over: true };
  }

  /** AnimState:IsCurrentAnimation */
  IsCurrentAnimation(time: number, anim: string): boolean {
    return this.playing && this.resolve(time).anim === anim;
  }

  /** Draws the current frame; nothing until the first PlayAnimation. */
  draw(context: CanvasRenderingContext2D, time: number, options?: DrawOptions): void {
    if (!this.playing) {
      return;
    }
    const { anim, frame } = this.resolve(time);
    drawFrame(context, this.asset, requireAnimation(this.asset, anim), frame, options);
  }
}

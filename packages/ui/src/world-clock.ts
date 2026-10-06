import {
  findImage, loadAnimationArchive, loadBuild, smallHash,
  type Animation, type BuildPackage,
} from '@dontstarve-web/animation/animationAssets';
import { loadImageAtlas } from '@dontstarve-web/animation/imageAtlas';
import type { DecodedTexture } from '@dontstarve-web/animation/parseKtex';

type ClockPhase = 'day' | 'dusk' | 'night';
export interface WorldClockState {
  cycles: number;
  phase: ClockPhase;
  /** Fraction of the complete day, as in clocktick.time. */
  time: number;
  daySegments: number;
  duskSegments: number;
  moonPhase: 'new' | 'quarter' | 'half' | 'threequarter' | 'full';
  waxing: boolean;
  playerAge?: number;
}

export const INITIAL_CLOCK_STATE: WorldClockState = {
  cycles: 0, phase: 'day', time: 0, daySegments: 10, duskSegments: 4,
  moonPhase: 'new', waxing: true,
};
type AnimationAsset = {
  buildPackage: BuildPackage;
  atlases: HTMLCanvasElement[];
  animations: Map<string, Animation>;
};
type ClockAssets = {
  clock: AnimationAsset;
  moon: AnimationAsset;
  moonPhases: AnimationAsset;
  face: HTMLCanvasElement;
  rim: HTMLCanvasElement;
  hand: HTMLCanvasElement;
  wedges: HTMLCanvasElement[];
};

const TRANSITIONS: Record<ClockPhase, string> = {
  day: 'trans_night_day', dusk: 'trans_day_dusk', night: 'trans_dusk_night',
};
const requests = new Map<string, Promise<ClockAssets>>();

function textureCanvas(texture: DecodedTexture): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = texture.width;
  canvas.height = texture.height;
  const context = canvas.getContext('2d')!;
  const image = context.createImageData(texture.width, texture.height);
  image.data.set(texture.pixels);
  context.putImageData(image, 0, 0);
  return canvas;
}

function animationAsset(buildPackage: BuildPackage, animations: Animation[] = []): AnimationAsset {
  return {
    buildPackage,
    atlases: buildPackage.atlases.map(textureCanvas),
    animations: new Map(animations.map((animation) => [animation.name, animation])),
  };
}

function loadClockAssets(dataRoot: string): Promise<ClockAssets> {
  let request = requests.get(dataRoot);
  if (request) return request;
  request = (async () => {
    const animRoot = `${dataRoot}anim`;
    const [clock, moon, moonPhases, hud] = await Promise.all([
      loadAnimationArchive('clock_transitions.zip', animRoot),
      loadAnimationArchive('moon_phases_clock.zip', animRoot),
      loadBuild('moon_phases.zip', animRoot),
      loadImageAtlas(`${dataRoot}databundles/images.zip`, 'images/hud.xml'),
    ]);
    const wedge = textureCanvas(hud.require('clock_wedge.tex'));
    const wedges = Array.from({ length: 4 }, (_, index) => {
      const canvas = document.createElement('canvas');
      canvas.width = wedge.width;
      canvas.height = wedge.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(wedge, 0, 0);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const color = index < 2 ? [254, 212, 86] : [165, 91, 82];
      const darken = index % 2 === 0 ? 0.75 : 1;
      for (let pixel = 0; pixel < image.data.length; pixel += 4) {
        for (let channel = 0; channel < 3; channel++) {
          image.data[pixel + channel] *= color[channel] / 255 * darken;
        }
      }
      context.putImageData(image, 0, 0);
      return canvas;
    });
    return {
      clock: animationAsset(clock.buildPackage, clock.animations.animations),
      moon: animationAsset(moon.buildPackage, moon.animations.animations),
      moonPhases: animationAsset(moonPhases),
      face: textureCanvas(hud.require('clock_NIGHT.tex')),
      rim: textureCanvas(hud.require('clock_rim.tex')),
      hand: textureCanvas(hud.require('clock_hand.tex')),
      wedges,
    };
  })();
  requests.set(dataRoot, request);
  void request.catch(() => requests.delete(dataRoot));
  return request;
}

function drawAnimation(
  context: CanvasRenderingContext2D, asset: AnimationAsset,
  animation: Animation, frame: number, moonOverride?: AnimationAsset, moonSymbol = 'moon_full',
): void {
  for (const element of [...animation.frames[frame].elements].sort((a, b) => b.z - a.z)) {
    const isMoon = moonOverride && element.imageHash === smallHash('swap_moon');
    const source = isMoon ? moonOverride : asset;
    const image = findImage(source.buildPackage.build,
      isMoon ? smallHash(moonSymbol) : element.imageHash, isMoon ? 0 : element.imageIndex);
    if (!image) continue;
    context.save();
    context.transform(...element.matrix);
    context.drawImage(source.atlases[image.sampler ?? 0],
      image.bbx!, image.bby!, image.width, image.height,
      image.x - image.width / 2, image.y - image.height / 2, image.width, image.height);
    context.restore();
  }
}

function animationAt(asset: AnimationAsset, first: string | undefined, idle: string, elapsed: number) {
  const transition = first ? asset.animations.get(first) : undefined;
  const duration = transition ? transition.frames.length / transition.frameRate * 1000 : 0;
  if (transition && elapsed < duration) {
    return { animation: transition, frame: Math.floor(elapsed * transition.frameRate / 1000) };
  }
  const animation = asset.animations.get(idle)!;
  return { animation, frame: Math.floor((elapsed - duration) * animation.frameRate / 1000) % animation.frames.length };
}

/** UIClockPage's layered DST clock, fitted to the survival HUD. */
export class WorldClock {
  private assets?: ClockAssets;
  private state?: WorldClockState;
  private clockTransition?: string;
  private clockElapsed = 0;
  private moonAnimation = 'hidden';
  private moonElapsed = 0;
  private readonly canvas: HTMLCanvasElement;
  private disposed = false;
  private focused = false;
  private readonly observer: ResizeObserver;

  constructor(canvas: HTMLCanvasElement, dataRoot: string) {
    this.canvas = canvas;
    canvas.dataset.state = 'loading';
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    canvas.parentElement!.addEventListener('mouseenter', this.showSurvived);
    canvas.parentElement!.addEventListener('mouseleave', this.hideSurvived);
    canvas.parentElement!.addEventListener('focus', this.showSurvived);
    canvas.parentElement!.addEventListener('blur', this.hideSurvived);
    void loadClockAssets(dataRoot).then((assets) => {
      if (this.disposed) return;
      this.assets = assets;
      this.resize();
      canvas.dataset.state = 'ready';
      this.draw();
    }).catch((error: unknown) => {
      if (this.disposed) return;
      canvas.dataset.state = 'error';
      canvas.dataset.error = error instanceof Error ? error.message : String(error);
    });
  }

  dispose(): void {
    this.disposed = true;
    this.observer.disconnect();
    this.canvas.parentElement!.removeEventListener('mouseenter', this.showSurvived);
    this.canvas.parentElement!.removeEventListener('mouseleave', this.hideSurvived);
    this.canvas.parentElement!.removeEventListener('focus', this.showSurvived);
    this.canvas.parentElement!.removeEventListener('blur', this.hideSurvived);
  }

  private readonly showSurvived = () => { this.focused = true; this.draw(); };
  private readonly hideSurvived = () => { this.focused = false; this.draw(); };

  private resize(): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    this.canvas.height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    this.draw();
  }

  /** World events and animation time both follow the simulation, including pauses. */
  update(state: WorldClockState, dt = 0): void {
    this.clockElapsed += Math.max(0, dt) * 1000;
    this.moonElapsed += Math.max(0, dt) * 1000;
    const previous = this.state;
    if (previous?.phase !== state.phase) {
      this.clockTransition = previous ? TRANSITIONS[state.phase] : undefined;
      this.clockElapsed = 0;
      if (previous?.phase === 'night') {
        this.moonAnimation = 'trans_in';
        this.moonElapsed = 0;
      }
      if (state.phase === 'night') {
        this.moonAnimation = previous ? 'trans_out' : 'idle';
        this.moonElapsed = 0;
      }
    } else if (state.phase === 'night'
      && (previous.moonPhase !== state.moonPhase || previous.waxing !== state.waxing)) {
      this.moonAnimation = 'trans_out';
      this.moonElapsed = 0;
    }
    if (previous) {
      const prevSegment = Math.floor(previous.time * 16);
      const nextSegment = Math.floor(state.time * 16);
      // uiclock.lua OnClockTick: pulse only when crossing a daytime wedge.
      if (prevSegment < state.daySegments && prevSegment !== nextSegment && nextSegment < state.daySegments) {
        this.clockTransition = 'pulse_day';
        this.clockElapsed = 0;
      }
    }
    this.state = { ...state };
    this.draw();
  }

  private draw(): void {
    if (this.disposed || !this.assets || !this.state) return;
    const assets = this.assets;
    const { phase, time, cycles, moonPhase, waxing, daySegments, duskSegments } = this.state;
    const day = cycles + 1;
    const rotation = time * 360;
    const { canvas } = this;
    const context = canvas.getContext('2d')!;
    const scale = Math.min(canvas.width / 182, canvas.height / 144);
    context.resetTransform();
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(scale, 0, 0, scale, canvas.width / 2 + 20 * scale, canvas.height / 2);

    // UIClock child order: moon, transition, face, wedges, rim, hand, text.
    const moonSymbols = {
      full: 'moon_full', new: 'moon_new',
      quarter: waxing ? 'moon_quarter_wax' : 'moon_quarter',
      half: waxing ? 'moon_half_wax' : 'moon_half',
      threequarter: waxing ? 'moon_three_quarter_wax' : 'moon_three_quarter',
    };
    if (this.moonAnimation !== 'hidden') {
      if (this.moonAnimation === 'trans_in') {
        const animation = assets.moon.animations.get('trans_in')!;
        const frame = Math.floor(this.moonElapsed * animation.frameRate / 1000);
        if (frame < animation.frames.length) {
          drawAnimation(context, assets.moon, animation, frame, assets.moonPhases, moonSymbols[moonPhase]);
        }
      } else {
        const moon = animationAt(assets.moon,
          this.moonAnimation === 'trans_out' ? 'trans_out' : undefined, 'idle', this.moonElapsed);
        drawAnimation(context, assets.moon, moon.animation, moon.frame, assets.moonPhases, moonSymbols[moonPhase]);
      }
    }
    const clock = animationAt(assets.clock, this.clockTransition, `idle_${phase}`, this.clockElapsed);
    drawAnimation(context, assets.clock, clock.animation, clock.frame);
    const centeredImage = (image: HTMLCanvasElement, size: number) => {
      context.drawImage(image, -image.width * size / 2, -image.height * size / 2, image.width * size, image.height * size);
    };
    centeredImage(assets.face, 0.5);
    for (let index = 0; index < daySegments + duskSegments; index++) {
      const wedge = assets.wedges[(index < daySegments ? 0 : 2) + index % 2];
      context.save();
      context.rotate(index * Math.PI / 8);
      context.drawImage(wedge, 0, -wedge.height * 0.4, wedge.width * 0.4, wedge.height * 0.4);
      context.restore();
    }
    centeredImage(assets.rim, 0.5);
    context.save();
    context.rotate(rotation * Math.PI / 180);
    centeredImage(assets.hand, 0.5);
    context.restore();

    context.fillStyle = '#ece4ce';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.shadowColor = '#17140f';
    context.shadowBlur = 2;
    context.font = "700 16px Georgia, 'Noto Sans SC', serif";
    context.fillText(this.focused ? '已生存' : '世界', 5, -12);
    context.font = "700 20px Georgia, 'Noto Sans SC', serif";
    context.fillText(`${this.focused ? this.state.playerAge ?? day : day}日`, 5, 12);
    context.shadowBlur = 0;
    canvas.dataset.phase = phase;
    canvas.dataset.animation = clock.animation.name;
    canvas.dataset.moon = phase === 'night' ? 'visible' : 'hidden';
    canvas.dataset.rotation = rotation.toFixed(2);
    canvas.dataset.day = String(day);
    canvas.dataset.moonPhase = moonPhase;
    canvas.dataset.moonSymbol = moonSymbols[moonPhase];
    canvas.parentElement!.setAttribute('aria-label', `世界第 ${day} 日，${{ day: '白天', dusk: '黄昏', night: '夜晚' }[phase]}`);
  }
}

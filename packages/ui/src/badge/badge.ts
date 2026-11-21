import { smallHash } from '@dontstarve-web/animation/animationAssets';
import {
  AnimQueue,
  animationLength,
  drawFrame,
  loadUiAnim,
  percentFrame,
  requireAnimation,
  type DrawOptions,
  type Rgb,
  type SymbolOverride,
  type UiAnimAsset,
} from './ui-anim';

export const ICON = smallHash('icon');
export const FRAME_LAYER = smallHash('frame');
const RED: Rgb = [1, 0, 0];
const GREEN: Rgb = [0, 1, 0];

export interface BadgeArt {
  readonly meter: UiAnimAsset;
  readonly pulse: UiAnimAsset;
  readonly icon: UiAnimAsset;
}

/** Badge._ctor's status_meter + hunger_health_pulse art, with the icon build circleframe overrides "icon" from. */
export async function loadBadgeArt(animRoot: string, iconbuild: string): Promise<BadgeArt> {
  const [meter, pulse, icon] = await Promise.all([
    loadUiAnim(animRoot, 'status_meter'),
    loadUiAnim(animRoot, 'hunger_health_pulse'),
    loadUiAnim(animRoot, iconbuild, iconbuild !== 'status_hunger'),
  ]);
  return { meter, pulse, icon };
}

export function drawBadgeText(context: CanvasRenderingContext2D, value: string, x: number, y: number, scale = 1): void {
  context.save();
  context.fillStyle = '#ffffff';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.shadowColor = '#000000';
  context.shadowBlur = 3;
  context.font = `${33 * scale}px Georgia, 'Noto Sans SC', serif`;
  context.fillText(value, x, y);
  context.restore();
}

/**
 * widgets/badge.lua without circular_meter or a custom anim: pulse, warning, backing, anim, anim_bonus, circleframe,
 * underNumber and num, drawn in that child order. Badge time only runs while the HUD's game frames do
 * (dont_update_while_paused).
 */
export abstract class Badge {
  time = 0;
  percent = 1;
  focused = false;
  protected num = '';
  private readonly pulse: AnimQueue;
  private pulseColour: Rgb = GREEN;
  private readonly warning: AnimQueue;
  private warningColour: Rgb = RED;
  private warningShown = false;
  private warningstarted = false;
  private warningDelayUntil: number | undefined;
  protected anim: { tint: Rgb; frame: number };
  protected circleframe: { frame: number; overrides: Map<number, SymbolOverride>; hiddenLayers?: Set<number> };
  protected readonly backingOverrides = new Map<number, SymbolOverride>();

  protected readonly art: BadgeArt;

  constructor(art: BadgeArt, tint: Rgb) {
    this.art = art;
    this.pulse = new AnimQueue(art.pulse);
    this.warning = new AnimQueue(art.pulse);
    this.anim = { tint, frame: 0 };
    this.circleframe = { frame: 0, overrides: new Map([[ICON, { asset: art.icon, symbol: ICON }]]) };
  }

  /** num's string. */
  get number(): string {
    return this.num;
  }

  /** The arrow animation the badge last played, 'neutral' before its first update. */
  abstract get arrow(): string;

  get warningVisible(): boolean {
    return this.warningShown;
  }

  /** Badge:SetPercent(val, max) */
  SetPercent(val: number, max = 100): void {
    this.anim.frame = percentFrame(requireAnimation(this.art.meter, 'anim'), 1 - val);
    this.circleframe.frame = percentFrame(requireAnimation(this.art.meter, 'frame'), 1 - val);
    this.num = String(Math.ceil(val * max));
    this.percent = val;
  }

  private pulseWith(colour: Rgb, delay: number): void {
    this.pulseColour = colour;
    this.pulse.PlayAnimation(this.time, 'pulse');
    this.warningShown = false;
    this.warningDelayUntil = this.time + delay;
  }

  PulseGreen(): void {
    this.pulseWith(GREEN, 2 * animationLength(this.art.pulse, 'pulse'));
  }

  PulseRed(): void {
    this.pulseWith(RED, animationLength(this.art.pulse, 'pulse'));
  }

  StopWarning(): void {
    if (this.warningstarted) {
      this.warningstarted = false;
      this.warningShown = false;
    }
  }

  StartWarning(colour: Rgb = RED): void {
    this.warningColour = colour;
    if (!this.warningstarted) {
      this.warningstarted = true;
      if (this.warningDelayUntil === undefined && !this.warningShown) {
        this.showWarning();
      }
    }
  }

  private showWarning(): void {
    this.warningShown = true;
    this.warning.PlayAnimation(this.time, 'pulse', true);
  }

  /** Advances badge time by `dt` milliseconds and runs the widget's OnUpdate. */
  advance(dt: number): void {
    this.time += dt;
    if (this.warningDelayUntil !== undefined && this.time >= this.warningDelayUntil) {
      // CheckWarning
      this.warningDelayUntil = undefined;
      if (this.warningstarted && !this.warningShown) {
        this.showWarning();
      }
    }
    this.OnUpdate();
  }

  protected abstract OnUpdate(): void;

  /** underNumber's children. */
  protected drawUnderNumber(_context: CanvasRenderingContext2D): void {}

  /** num, and children added after it. */
  protected drawNumber(context: CanvasRenderingContext2D): void {
    if (this.focused) {
      drawBadgeText(context, this.num, 3, 0);
    }
  }

  draw(context: CanvasRenderingContext2D): void {
    const { meter } = this.art;
    this.pulse.draw(context, this.time, { tint: this.pulseColour });
    if (this.warningShown) {
      this.warning.draw(context, this.time, { tint: this.warningColour });
    }
    drawFrame(context, meter, requireAnimation(meter, 'bg'), 0, { overrides: this.backingOverrides });
    drawFrame(context, meter, requireAnimation(meter, 'anim'), this.anim.frame, { tint: this.anim.tint });
    // anim_bonus is hidden: these badges never pass SetPercent a bonus value.
    const circleframe: DrawOptions = this.circleframe;
    drawFrame(context, meter, requireAnimation(meter, 'frame'), this.circleframe.frame, circleframe);
    this.drawUnderNumber(context);
    this.drawNumber(context);
  }
}

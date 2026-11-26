import { smallHash } from '@dontstarve-web/animation/animationAssets';
import { createSignal, readonlySignal, type ReadonlySignal } from '@dontstarve-web/signals';
import {
  AnimQueue,
  animationLength,
  drawFrame,
  loadUiAnim,
  percentFrame,
  requireAnimation,
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
 *
 * Everything draw shows is a signal, and each AnimQueue's frame a memo of the badge clock, so a reactive draw reruns
 * only when the picture changes.
 */
export abstract class Badge {
  /** Badge milliseconds; the AnimQueues' frames are memos of it. */
  protected readonly clock = createSignal(0);
  percent = 1;
  private readonly focusedState = createSignal(false);
  private readonly numState = createSignal('');
  /** num's string, tracked. */
  readonly numberSignal: ReadonlySignal<string> = readonlySignal(this.numState);
  private readonly pulse: AnimQueue;
  private readonly pulseColour = createSignal<Rgb>(GREEN);
  private readonly warning: AnimQueue;
  private readonly warningColour = createSignal<Rgb>(RED);
  private readonly warningShown = createSignal(false);
  private warningstarted = false;
  private warningDelayUntil: number | undefined;
  protected readonly animTint: ReturnType<typeof createSignal<Rgb>>;
  private readonly animFrame = createSignal(0);
  private readonly circleframeFrame = createSignal(0);
  /** circleframe's override of "icon". */
  protected readonly iconOverride: ReturnType<typeof createSignal<SymbolOverride>>;
  /** circleframe's hidden layers. */
  protected circleframeHidden: ReadonlySet<number> | undefined;
  protected readonly backingOverrides = createSignal<ReadonlyMap<number, SymbolOverride>>(new Map());

  protected readonly art: BadgeArt;

  constructor(art: BadgeArt, tint: Rgb) {
    this.art = art;
    this.pulse = new AnimQueue(art.pulse, this.clock);
    this.warning = new AnimQueue(art.pulse, this.clock);
    this.animTint = createSignal(tint);
    this.iconOverride = createSignal<SymbolOverride>({ asset: art.icon, symbol: ICON });
  }

  get time(): number {
    return this.clock.value;
  }

  get focused(): boolean {
    return this.focusedState.value;
  }

  /** Badge:OnGainFocus / OnLoseFocus show and hide num. */
  set focused(value: boolean) {
    this.focusedState.set(value);
  }

  /** num's string. */
  get number(): string {
    return this.numState.value;
  }

  /** The arrow animation the badge last played, 'neutral' before its first update. */
  abstract get arrow(): string;

  get warningVisible(): boolean {
    return this.warningShown.value;
  }

  /** Badge:SetPercent(val, max) */
  SetPercent(val: number, max = 100): void {
    this.animFrame.set(percentFrame(requireAnimation(this.art.meter, 'anim'), 1 - val));
    this.circleframeFrame.set(percentFrame(requireAnimation(this.art.meter, 'frame'), 1 - val));
    this.numState.set(String(Math.ceil(val * max)));
    this.percent = val;
  }

  private pulseWith(colour: Rgb, delay: number): void {
    this.pulseColour.set(colour);
    this.pulse.PlayAnimation(this.time, 'pulse');
    this.warningShown.set(false);
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
      this.warningShown.set(false);
    }
  }

  StartWarning(colour: Rgb = RED): void {
    this.warningColour.set(colour);
    if (!this.warningstarted) {
      this.warningstarted = true;
      if (this.warningDelayUntil === undefined && !this.warningShown.value) {
        this.showWarning();
      }
    }
  }

  private showWarning(): void {
    this.warningShown.set(true);
    this.warning.PlayAnimation(this.time, 'pulse', true);
  }

  /** Advances badge time by `dt` milliseconds and runs the widget's OnUpdate. */
  advance(dt: number): void {
    this.clock.set(this.time + dt);
    if (this.warningDelayUntil !== undefined && this.time >= this.warningDelayUntil) {
      // CheckWarning
      this.warningDelayUntil = undefined;
      if (this.warningstarted && !this.warningShown.value) {
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
    if (this.focusedState.get()) {
      drawBadgeText(context, this.numState.get(), 3, 0);
    }
  }

  /** Draws the badge, reading its state through signals so a reactive caller reruns only when the picture changes. */
  draw(context: CanvasRenderingContext2D): void {
    const { meter } = this.art;
    this.pulse.draw(context, { tint: this.pulseColour.get() });
    if (this.warningShown.get()) {
      this.warning.draw(context, { tint: this.warningColour.get() });
    }
    drawFrame(context, meter, requireAnimation(meter, 'bg'), 0, { overrides: this.backingOverrides.get() });
    drawFrame(context, meter, requireAnimation(meter, 'anim'), this.animFrame.get(), { tint: this.animTint.get() });
    // anim_bonus is hidden: these badges never pass SetPercent a bonus value.
    drawFrame(context, meter, requireAnimation(meter, 'frame'), this.circleframeFrame.get(), {
      overrides: new Map([[ICON, this.iconOverride.get()]]),
      hiddenLayers: this.circleframeHidden,
    });
    this.drawUnderNumber(context);
    this.drawNumber(context);
  }
}

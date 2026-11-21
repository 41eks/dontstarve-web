import { smallHash } from '@dontstarve-web/animation/animationAssets';
import { createSignal } from '@dontstarve-web/signals';
import { Badge, FRAME_LAYER, ICON, type BadgeArt } from './badge';
import { AnimQueue, drawFrame, percentFrame, requireAnimation, type Rgb, type UiAnimAsset } from './ui-anim';
import type { BadgeOwner } from './owner';

const SANITY_TINT: Rgb = [232 / 255, 123 / 255, 15 / 255];
const LUNACY_TINT: Rgb = [191 / 255, 232 / 255, 240 / 255];
const BLACK: Rgb = [0, 0, 0];
const SANITY_MODE_INSANITY = 0;
const SANITY_MODE_LUNACY = 1;
const FRAME_MS = 1000 / 30;

/** constants.lua RATE_SCALE */
const INCREASE_RATE_SCALE_ANIM: Record<number, string> = {
  1: 'arrow_loop_increase_most',
  2: 'arrow_loop_increase_more',
  3: 'arrow_loop_increase',
};
const DECREASE_RATE_SCALE_ANIM: Record<number, string> = {
  4: 'arrow_loop_decrease_most',
  5: 'arrow_loop_decrease_more',
  6: 'arrow_loop_decrease',
};
/** TUNING.SLEEP_SANITY_PER_TICK / TUNING.SLEEP_TICK_PERIOD */
const SLEEP_RATE = 1 / 1;

export interface SanityBadgeArt extends BadgeArt {
  readonly arrow: UiAnimAsset;
}

/** widgets/sanitybadge.lua; sanity has no ghost drain source yet, so ghostanim stays hidden. */
export class SanityBadge extends Badge {
  private sanitymode = SANITY_MODE_INSANITY;
  private val = 1;
  private max = 100;
  private penaltypercent = 0;
  private readonly topperFrame = createSignal(0);
  private readonly circleframe2: AnimQueue;
  private readonly circleframe2Options;
  private readonly sanityarrow: AnimQueue;
  private arrowdir: string | undefined;
  private transitionAt: number | undefined;
  /** SpawnTransitionFX: a sibling UIAnim at the badge's position, killed on animover. */
  private readonly transitionFx = createSignal<AnimQueue | undefined>(undefined);
  private readonly hideFrame = new Set([FRAME_LAYER]);

  private readonly owner: BadgeOwner;

  constructor(art: SanityBadgeArt, owner: BadgeOwner) {
    super(art, SANITY_TINT);
    this.owner = owner;
    this.topperFrame.set(percentFrame(requireAnimation(art.meter, 'anim'), 1));
    this.circleframeHidden = this.hideFrame;
    this.circleframe2 = new AnimQueue(art.icon, this.clock);
    this.circleframe2Options = {
      overrides: new Map([[smallHash('frame_circle'), { asset: art.meter, symbol: smallHash('frame_circle') }]]),
      hiddenLayers: new Set([smallHash('FX')]),
    };
    this.circleframe2.PlayAnimation(0, 'frame');
    this.sanityarrow = new AnimQueue(art.arrow, this.clock);
    this.sanityarrow.PlayAnimation(0, 'neutral');
  }

  get mode(): number {
    return this.sanitymode;
  }

  get arrow(): string {
    return this.arrowdir ?? 'neutral';
  }

  /** SanityBadge:DoTransition */
  private DoTransition(): void {
    const mode = this.owner.components.sanity?.GetSanityMode() ?? SANITY_MODE_INSANITY;
    if (this.sanitymode !== mode) {
      this.sanitymode = mode;
      const { icon } = this.art;
      if (mode === SANITY_MODE_INSANITY) {
        this.backingOverrides.set(new Map());
        this.animTint.set(SANITY_TINT);
        this.iconOverride.set({ asset: icon, symbol: ICON });
      } else {
        this.backingOverrides.set(new Map([[smallHash('bg'), { asset: icon, symbol: smallHash('lunacy_bg') }]]));
        this.animTint.set(LUNACY_TINT);
        this.iconOverride.set({ asset: icon, symbol: smallHash('lunacy_icon') });
      }
      this.SetPercent(this.val, this.max);
    }
    this.transitionAt = undefined;
  }

  /** SanityBadge:SetPercent(val, max, penaltypercent) */
  SetSanityPercent(val: number, max: number, penaltypercent = 0): void {
    this.val = val;
    this.max = max;
    this.SetPercent(val, max);
    this.penaltypercent = penaltypercent;
    this.topperFrame.set(percentFrame(requireAnimation(this.art.meter, 'anim'), 1 - penaltypercent));

    const mode = this.owner.components.sanity?.GetSanityMode() ?? SANITY_MODE_INSANITY;
    if (mode !== this.sanitymode) {
      if (this.transitionAt !== undefined) {
        this.transitionAt = undefined;
        this.DoTransition();
      }
      const anim = this.sanitymode !== SANITY_MODE_INSANITY ? 'transition_sanity' : 'transition_lunacy';
      this.circleframe2.PlayAnimation(this.time, anim);
      const fx = new AnimQueue(this.art.icon, this.clock);
      fx.PlayAnimation(this.time, anim);
      this.transitionFx.set(fx);
      this.circleframe2.PushAnimation(this.time, 'frame', false);
      this.transitionAt = this.time + 6 * FRAME_MS;
    }
  }

  get penalty(): number {
    return this.penaltypercent;
  }

  override PulseGreen(): void {
    if (this.sanitymode === SANITY_MODE_LUNACY) {
      super.PulseRed();
    } else {
      super.PulseGreen();
    }
  }

  override PulseRed(): void {
    if (this.sanitymode === SANITY_MODE_LUNACY) {
      super.PulseGreen();
    } else {
      super.PulseRed();
    }
  }

  protected OnUpdate(): void {
    if (this.transitionAt !== undefined && this.time >= this.transitionAt) {
      this.DoTransition();
    }
    if (this.transitionFx.peek()?.resolve(this.time).over) {
      this.transitionFx.set(undefined);
    }
    const sanity = this.owner.components.sanity;
    let anim = 'neutral';
    if (sanity) {
      if (this.owner.hasTag('sleeping')) {
        // At night, sanity pings between .9999 and 1 of max, so make an exception for the arrow.
        if (sanity.GetPercentWithPenalty() < 1) {
          anim =
            INCREASE_RATE_SCALE_ANIM[
              (SLEEP_RATE > 0.2 && 1) || (SLEEP_RATE > 0.1 && 2) || (SLEEP_RATE > 0.01 && 3) || 0
            ];
        }
      } else {
        const ratescale = sanity.GetRateScale();
        if (INCREASE_RATE_SCALE_ANIM[ratescale]) {
          if (sanity.GetPercentWithPenalty() < 1) {
            anim = INCREASE_RATE_SCALE_ANIM[ratescale];
          }
        } else if (DECREASE_RATE_SCALE_ANIM[ratescale]) {
          if (sanity.GetPercentWithPenalty() > 0) {
            anim = DECREASE_RATE_SCALE_ANIM[ratescale];
          }
        }
      }
    }
    if (this.arrowdir !== anim) {
      this.arrowdir = anim;
      this.sanityarrow.PlayAnimation(this.time, anim, true);
    }
  }

  protected override drawUnderNumber(context: CanvasRenderingContext2D): void {
    const { meter } = this.art;
    drawFrame(context, meter, requireAnimation(meter, 'anim'), this.topperFrame.get(), {
      tint: BLACK,
      scale: [1, -1],
    });
    this.circleframe2.draw(context, this.circleframe2Options);
    this.sanityarrow.draw(context);
  }

  override draw(context: CanvasRenderingContext2D): void {
    super.draw(context);
    this.transitionFx.get()?.draw(context, { hiddenLayers: this.hideFrame });
  }
}

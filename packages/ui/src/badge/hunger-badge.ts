import { Badge, type BadgeArt } from './badge';
import { AnimQueue, loadUiAnim, type UiAnimAsset } from './ui-anim';
import type { BadgeOwner } from './owner';

const TRACKING_MAX = 150;
const DRAIN_TAGS = ['sleeping', 'swimming_floater', 'wonkey_run', 'gallop_run'];
const DRAIN_STATE_TAGS = ['floating_predict_move', 'monkey_predict_run', 'gallop_predict_run'];

export interface HungerBadgeArt extends BadgeArt {
  readonly arrow: UiAnimAsset;
}

export function loadArrow(animRoot: string): Promise<UiAnimAsset> {
  return loadUiAnim(animRoot, 'sanity_arrow');
}

/** widgets/hungerbadge.lua */
export class HungerBadge extends Badge {
  private readonly hungerarrow: AnimQueue;
  private arrowdir: string | undefined;
  private tracking: { i1: number; i2: number; t: number; history: number[] } | undefined;

  private readonly owner: BadgeOwner;

  constructor(art: HungerBadgeArt, owner: BadgeOwner) {
    super(art, [255 / 255, 204 / 255, 51 / 255]);
    this.owner = owner;
    this.hungerarrow = new AnimQueue(art.arrow);
    this.hungerarrow.PlayAnimation(0, 'neutral');
  }

  get arrow(): string {
    return this.arrowdir ?? 'neutral';
  }

  protected OnUpdate(): void {
    let anim = 'neutral';
    const hunger = this.owner.components.hunger;
    if (hunger) {
      let gain = false,
        drain = false;
      if (this.owner.hasTag('wintersfeastbuff')) {
        gain = true;
      } else {
        if (this.owner.hasTag('hungerregenbuff')) {
          gain = true;
        }
        if (
          DRAIN_TAGS.some(tag => this.owner.hasTag(tag)) ||
          DRAIN_STATE_TAGS.some(tag => this.owner.sg?.hasStateTag(tag))
        ) {
          drain = true;
        }
      }

      if (gain && drain) {
        // Has both; the rates are unknown, so track the percent history.
        const tick = Math.floor((this.time * 30) / 1000);
        if (this.tracking === undefined) {
          this.tracking = { i1: 0, i2: 0, t: tick, history: [hunger.GetPercent()] };
        } else if (this.tracking.t !== tick) {
          const tracking = this.tracking;
          tracking.i2 = (tracking.i2 + 1) % TRACKING_MAX;
          if (tracking.i2 === tracking.i1) {
            tracking.i1 = (tracking.i1 + 1) % TRACKING_MAX;
          }
          tracking.history[tracking.i2] = hunger.GetPercent();
          tracking.t = tick;
        }
        const pct1 = this.tracking.history[this.tracking.i1];
        const pct2 = this.tracking.history[this.tracking.i2];
        if (pct1 > pct2) {
          gain = false;
        } else if (pct1 < pct2) {
          drain = false;
        } else {
          gain = drain = false;
        }
      } else {
        this.tracking = undefined;
      }

      if (gain) {
        if (hunger.GetPercent() < 1) {
          anim = 'arrow_loop_increase';
        }
      } else if (drain && hunger.GetPercent() > 0) {
        anim = 'arrow_loop_decrease';
      }
    }

    if (this.arrowdir !== anim) {
      this.arrowdir = anim;
      this.hungerarrow.PlayAnimation(this.time, anim, true);
    }
  }

  protected override drawUnderNumber(context: CanvasRenderingContext2D): void {
    this.hungerarrow.draw(context, this.time);
  }
}

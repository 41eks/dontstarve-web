import { Badge, FRAME_LAYER, type BadgeArt } from './badge';
import { AnimQueue, drawFrame, percentFrame, requireAnimation, type UiAnimAsset } from './ui-anim';
import type { BadgeOwner } from './owner';

const BLACK = [0, 0, 0] as const;

export interface HealthBadgeArt extends BadgeArt {
  readonly arrow: UiAnimAsset;
  /** status_abigail: the bufficon's build. */
  readonly buff: UiAnimAsset;
}

/**
 * widgets/healthbadge.lua with the arrow branches whose sources exist here (starving, sleep healing and regen
 * equipment). Effigies, ghostly elixir buffs, acid, corrosives, health regen debuffs and the WX-78 shield have no
 * source yet, so their children stay hidden; the bufficon shows its idle buff_none.
 */
export class HealthBadge extends Badge {
  private topperFrame = 0;
  private readonly circleframe2: AnimQueue;
  private readonly sanityarrow: AnimQueue;
  private readonly bufficon: AnimQueue;
  private arrowdir: string | undefined;

  private readonly owner: BadgeOwner;

  constructor(art: HealthBadgeArt, owner: BadgeOwner) {
    super(art, [174 / 255, 21 / 255, 21 / 255]);
    this.owner = owner;
    // circleframe:Hide("frame") leaves the heart icon; circleframe2 draws the ring.
    this.circleframe.hiddenLayers = new Set([FRAME_LAYER]);
    this.topperFrame = percentFrame(requireAnimation(art.meter, 'anim'), 1);
    this.circleframe2 = new AnimQueue(art.meter);
    this.circleframe2.PlayAnimation(0, 'frame');
    this.sanityarrow = new AnimQueue(art.arrow);
    this.sanityarrow.PlayAnimation(0, 'neutral');
    this.bufficon = new AnimQueue(art.buff);
    this.bufficon.PlayAnimation(0, 'buff_none');
  }

  get arrow(): string {
    return this.arrowdir ?? 'neutral';
  }

  /** HealthBadge:SetPercent(val, max, penaltypercent) */
  SetHealthPercent(val: number, max: number, penaltypercent = 0): void {
    this.SetPercent(val, max);
    this.topperFrame = percentFrame(requireAnimation(this.art.meter, 'anim'), 1 - penaltypercent);
  }

  protected OnUpdate(): void {
    const { components } = this.owner;
    const down = components.hunger?.IsStarving() ? '_most' : undefined;
    // Show the up-arrow when we're sleeping (but not in a straw roll: that doesn't heal us).
    const up =
      down === undefined &&
      (components.sleepingbaguser?.bed?.healthsleep === true || components.inventory?.EquipHasTag('regen') === true) &&
      components.health?.IsHurt() === true;
    const anim = (down !== undefined && `arrow_loop_decrease${down}`) || (!up && 'neutral') || 'arrow_loop_increase';
    if (this.arrowdir !== anim) {
      this.arrowdir = anim;
      this.sanityarrow.PlayAnimation(this.time, anim, true);
    }
  }

  protected override drawUnderNumber(context: CanvasRenderingContext2D): void {
    const { meter } = this.art;
    drawFrame(context, meter, requireAnimation(meter, 'anim'), this.topperFrame, { tint: BLACK, scale: [1, -1] });
    this.circleframe2.draw(context, this.time);
    this.sanityarrow.draw(context, this.time);
    this.bufficon.draw(context, this.time, { scale: [-1, 1] });
  }
}

import { loadBadgeArt } from './badge';
import { HealthBadge } from './health-badge';
import { HungerBadge, loadArrow } from './hunger-badge';
import { SanityBadge } from './sanity-badge';
import { loadUiAnim } from './ui-anim';
import type { BadgeOwner, StatDeltaData } from './owner';

export async function loadStatusArt(animRoot: string) {
  const [arrow, buff, hunger, health, sanity] = await Promise.all([
    loadArrow(animRoot),
    loadUiAnim(animRoot, 'status_abigail'),
    loadBadgeArt(animRoot, 'status_hunger'),
    loadBadgeArt(animRoot, 'status_health'),
    loadBadgeArt(animRoot, 'status_sanity'),
  ]);
  return { hunger: { ...hunger, arrow }, health: { ...health, arrow, buff }, sanity: { ...sanity, arrow } };
}
export type StatusArt = Awaited<ReturnType<typeof loadStatusArt>>;

/** widgets/statusdisplays.lua's player mode: the brain, stomach and heart badges and their owner's delta events. */
export class StatusDisplays {
  readonly brain: SanityBadge;
  readonly stomach: HungerBadge;
  readonly heart: HealthBadge;
  private healthpenalty = 0;
  private readonly stops: (() => void)[];

  private readonly owner: BadgeOwner;

  constructor(art: StatusArt, owner: BadgeOwner) {
    this.owner = owner;
    this.brain = new SanityBadge(art.sanity, owner);
    this.stomach = new HungerBadge(art.hunger, owner);
    this.heart = new HealthBadge(art.health, owner);
    const { health, hunger, sanity } = owner.components;
    // OnSetPlayerMode
    this.stops = [
      owner.ListenForEvent('healthdelta', (_inst, data) => this.HealthDelta(data)),
      owner.ListenForEvent('hungerdelta', (_inst, data) => this.HungerDelta(data)),
      owner.ListenForEvent('sanitydelta', (_inst, data) => this.SanityDelta(data)),
    ];
    if (health) {
      this.SetHealthPercent(health.GetPercent());
    }
    if (hunger) {
      this.SetHungerPercent(hunger.GetPercent());
    }
    if (sanity) {
      this.SetSanityPercent(sanity.GetPercent());
    }
  }

  dispose(): void {
    this.stops.splice(0).forEach(stop => stop());
  }

  advance(dt: number): void {
    this.brain.advance(dt);
    this.stomach.advance(dt);
    this.heart.advance(dt);
  }

  private SetHealthPercent(pct: number): void {
    const health = this.owner.components.health!;
    this.healthpenalty = health.penalty;
    this.heart.SetHealthPercent(pct, health.maxhealth, this.healthpenalty);
    if (pct <= 0.33) {
      this.heart.StartWarning();
    } else {
      this.heart.StopWarning();
    }
  }

  private HealthDelta(data: StatDeltaData): void {
    const oldpenalty = this.healthpenalty;
    this.SetHealthPercent(data.newpercent);
    // The health penalty pulse takes priority.
    if (oldpenalty > this.healthpenalty) {
      this.heart.PulseGreen();
    } else if (oldpenalty < this.healthpenalty) {
      this.heart.PulseRed();
    } else if (data.overtime) {
      // Ignore the red pulse for healthdelta overtime.
      if (data.newpercent > data.oldpercent) {
        this.heart.PulseGreen();
      }
    } else if (data.newpercent > data.oldpercent) {
      this.heart.PulseGreen();
    } else if (data.newpercent < data.oldpercent) {
      this.heart.PulseRed();
    }
  }

  private SetHungerPercent(pct: number): void {
    this.stomach.SetPercent(pct, this.owner.components.hunger!.max);
    if (pct <= 0) {
      this.stomach.StartWarning();
    } else {
      this.stomach.StopWarning();
    }
  }

  private HungerDelta(data: StatDeltaData): void {
    this.SetHungerPercent(data.newpercent);
    if (!data.overtime) {
      if (data.newpercent > data.oldpercent) {
        this.stomach.PulseGreen();
      } else if (data.newpercent < data.oldpercent) {
        this.stomach.PulseRed();
      }
    }
  }

  private SetSanityPercent(pct: number): [number, number] {
    const sanity = this.owner.components.sanity!;
    const oldpenalty = this.brain.penalty;
    const newpenalty = sanity.GetPenaltyPercent();
    this.brain.SetSanityPercent(pct, sanity.max, newpenalty);
    if (sanity.IsInsane() || sanity.IsEnlightened()) {
      this.brain.StartWarning();
    } else {
      this.brain.StopWarning();
    }
    return [oldpenalty, newpenalty];
  }

  private SanityDelta(data: StatDeltaData): void {
    const [oldpenalty, newpenalty] = this.SetSanityPercent(data.newpercent);
    let green = false,
      red = false;
    if (!data.overtime) {
      if (data.newpercent > data.oldpercent) {
        green = true;
      } else if (data.newpercent < data.oldpercent) {
        red = true;
      }
    }
    if (newpenalty > oldpenalty) {
      red = true;
    } else if (newpenalty < oldpenalty) {
      green = true;
    }
    if (red) {
      this.brain.PulseRed();
    } else if (green) {
      this.brain.PulseGreen();
    }
  }
}

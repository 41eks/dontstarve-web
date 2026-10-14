import { createMemo, createSignal, readonlySignal, WorldContentKey, type GetWatchWorldContent, type ReadonlySignal, type SeasonState } from '../../signals/src';
import { GameTimeScheduler } from './gameTimeScheduler';
import { ComponentTimer } from './timer';
import type { BurnableInst } from './burnable';

const SPRING_FIRE_RANGE_MOD = .67; // tuning.lua

// standardcomponents.lua MakeSmall/Medium/LargePropagator, plus bare AddComponent("propagator").
// Each randomized value is [base, random variation].
const PROPAGATOR_SETTINGS = {
  default: { flashpoint: [100, 0], propagaterange: [3, 0], heatoutput: [5, 0], decayrate: 1, acceptsheat: false },
  small: { flashpoint: [5, 5], propagaterange: [3, 2], heatoutput: [3, 2], decayrate: .5, acceptsheat: true },
  medium: { flashpoint: [15, 10], propagaterange: [5, 2], heatoutput: [5, 3.5], decayrate: .5, acceptsheat: true },
  large: { flashpoint: [45, 10], propagaterange: [6, 2], heatoutput: [6, 3.5], decayrate: .5, acceptsheat: true },
} as const;

function randomValue([base, variation]: readonly [number, number]): number {
  if (variation === 0) return base;
  return base + Math.random() * variation;
}

/** Dry-weather structure heat branches of components/propagator.lua. */
export class Propagator {
  readonly flashpoint: number;
  readonly propagaterange: number;
  /** Own copy of the watched season: the watch cleanup disposes memos that read it, so the range memo reads this. */
  private readonly seasonSignal = createSignal<SeasonState | undefined>(undefined);
  private stopSeason?: () => void;
  private readonly propagationRangeMemo;
  readonly propagationRange: ReadonlySignal<number>;
  heatoutput: number;
  readonly decayrate: number;
  acceptsheat: boolean;
  currentheat = createSignal(0);
  private heatThisUpdate = 0;
  private maxHeatThisUpdate = 0;
  /** Written by burnable (Ignite/Extinguish) or the owning prefab; changes manage the update task. */
  readonly spreading = createSignal(false);
  private readonly stopTask: () => void;
  private pauseheating = false;
  private readonly scheduler: GameTimeScheduler;
  private readonly ownsScheduler: boolean;
  private readonly updateTimer: ComponentTimer;
  private readonly updatingMemo;
  readonly timer;
  readonly updating;
  private removed = false;
  readonly inst: BurnableInst;
  private readonly nearby: (radius: number) => readonly BurnableInst[];
  private readonly unitsPerMeter: number;
  constructor(inst: BurnableInst, size: keyof typeof PROPAGATOR_SETTINGS,
    nearby: (radius: number) => readonly BurnableInst[], unitsPerMeter = 1, scheduler?: GameTimeScheduler,
    getWatchWorldContent?: GetWatchWorldContent, fixed?: { propagaterange?: number; heatoutput?: number }) {
    this.inst = inst; this.nearby = nearby; this.unitsPerMeter = unitsPerMeter;
    const season = this.watchSeason(getWatchWorldContent);
    this.scheduler = scheduler ?? season?.scheduler ?? new GameTimeScheduler();
    this.ownsScheduler = !scheduler && !season;
    this.updateTimer = new ComponentTimer(this.scheduler, () => this.updateHeat());
    this.updatingMemo = createMemo(() => this.updateTimer.snapshot.get().status === 'scheduled');
    this.timer = this.updateTimer.snapshot;
    this.updating = readonlySignal(this.updatingMemo);
    const settings = PROPAGATOR_SETTINGS[size];
    this.flashpoint = randomValue(settings.flashpoint);
    this.propagaterange = fixed?.propagaterange ?? randomValue(settings.propagaterange);
    this.propagationRangeMemo = createMemo(() => this.propagaterange
      * (this.seasonSignal.get()?.season === 'spring' ? SPRING_FIRE_RANGE_MOD : 1));
    this.propagationRange = readonlySignal(this.propagationRangeMemo);
    this.heatoutput = fixed?.heatoutput ?? randomValue(settings.heatoutput);
    this.decayrate = settings.decayrate;
    this.acceptsheat = settings.acceptsheat;
    // this.calculateHeatCap();
    this.heatThisUpdate = 0;
    this.maxHeatThisUpdate = this.flashpoint / (1 + 3 * (1 - (1 - Math.random()) ** 3)) * .5;
    // Synchronous, so Ignite/Extinguish arm or cancel the task before the next scheduler advance.
    this.stopTask = this.spreading.subscribe(() => this.reschedule());
  }
  /** Bind world content when an inventory inst first enters the ground prefab system. */
  setWorldContent(getWatchWorldContent: GetWatchWorldContent | undefined): void {
    if (this.removed) return;
    this.stopSeason?.(); this.stopSeason = undefined;
    this.seasonSignal.set(undefined);
    this.watchSeason(getWatchWorldContent);
  }
  private watchSeason(getWatchWorldContent?: GetWatchWorldContent) {
    const season = getWatchWorldContent?.(WorldContentKey.Season, stop => { this.stopSeason = stop; });
    if (season) { this.seasonSignal.set(season.peek()); season.subscribe(value => this.seasonSignal.set(value)); }
    return season;
  }
  /** StartUpdating while spreading or holding heat; StopUpdating once spreading ended and the heat is gone. */
  private reschedule(): void {
    if (this.removed) return;
    const scheduled = this.updateTimer.snapshot.peek().status === 'scheduled';
    const spreading = this.spreading.peek();
    if (spreading || this.currentheat.peek() > 0) {
      // propagator.lua starts its periodic task after .5 + random() * .67 seconds.
      if (!scheduled) this.updateTimer.start(spreading ? .5 : .5 + Math.random() * .67);
    } else if (scheduled) this.updateTimer.stop();
  }
  AcceptsHeat(): boolean { return !this.removed && this.acceptsheat && !this.pauseheating; }
  AddHeat(amount: number): void {
    if (!this.AcceptsHeat() || this.inst.hasTag('fireimmune')) return;
    const heat = Math.min(amount, this.maxHeatThisUpdate - this.heatThisUpdate);
    this.heatThisUpdate += heat;
    this.currentheat.set(this.currentheat.peek() + heat);
    this.reschedule();
    if (this.currentheat.peek() > this.flashpoint) {
      this.pauseheating = true;
      this.inst.components.burnable?.StartWildfire();
    }
  }
  NearbyHeat(radius: number): number { return this.nearby(radius * this.unitsPerMeter).reduce((sum, inst) => sum + (inst.components.propagator?.currentheat.peek() ?? 0), 0); }
  Update(dt: number): void {
    if (this.removed || !Number.isFinite(dt) || dt <= 0) return;
    if (this.ownsScheduler) this.scheduler.advance(dt);
  }
  private updateHeat(): void {
    if (this.removed || this.inst.isRemoved) return;
    // this.calculateHeatCap();
    this.heatThisUpdate = 0;
    this.maxHeatThisUpdate = this.flashpoint / (1 + 3 * (1 - (1 - Math.random()) ** 3)) * .5;
    const ch = this.currentheat.peek();
    this.currentheat.set(Math.max(0, ch - .5 * this.decayrate));
    const spreading = this.spreading.peek();
    if (spreading) {
      const position = this.inst.getPosition();
      const range = this.propagationRange.peek() * this.unitsPerMeter;
      for (const target of this.nearby(range)) {
        if (target === this.inst || target.isRemoved || target.hasTag('INLIMBO')) continue;
        const distanceSquared = target.getPosition().distanceToSquared(position);
        const nrp = target.components.propagator;
        nrp?.AddHeat(this.heatoutput * Math.max(.1, 1 - distanceSquared / range ** 2) * .5);
      }
    }
    if (spreading || this.currentheat.peek() > 0) this.updateTimer.start(.5);
  }
  dispose(): void {
    this.stopTask(); this.spreading.set(false); this.removed = true;
    this.updateTimer.stop(); this.updatingMemo.dispose(); this.propagationRangeMemo.dispose(); this.stopSeason?.();
    if (this.ownsScheduler) this.scheduler.dispose();
  }
  // private calculateHeatCap(): void {
  //   this.heatThisUpdate = 0;
  //   this.maxHeatThisUpdate = this.flashpoint / (1 + 3 * (1 - (1 - Math.random()) ** 3)) * .5;
  // }
}

import { watchSignal, createEffect, createSignal, readonlySignal, type Signal, type ReadonlySignal, type SeasonState, type WorldSeason } from '@dontstarve-web/signals';
import { ComponentTimer } from '../../componets/src/timer';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';

export type LeafBuild = 'normal' | 'red' | 'orange' | 'yellow' | 'barren';
export type LeafState = 'normal' | 'colorful' | 'barren';
export interface DeciduousTreeSave {
  stump?: true;
  /** onsave data.burnt, and the pending acorn drop that burntcone records. */
  burnt?: true;
  burntcone?: true;
  build?: LeafBuild;
  leaf_state: LeafState;
  target_leaf_state: LeafState;
  leaveschangetime?: number;
}
export interface LeafWorld {
  season: ReadonlySignal<SeasonState>;
  secondsUntilNextDay(now: number): number;
  /** seasons.lua calendar inputs, when the world has a seasonal calendar. */
  seasonCalendar?(): { remainingDays: number; lengths: Record<WorldSeason, number> };
}
interface LeafOwner {
  lastWorkTime(): number | undefined;
  applyBuild(): void;
  updateLoot(): void;
  setShelter(value: boolean): void;
  playTransition(kind: 'drop_leaves' | 'grow_leaves'): number;
  sway(): void;
  spawnLeafFx(): void;
}
const nextSeason: Record<WorldSeason, WorldSeason> = { autumn: 'winter', winter: 'spring', spring: 'summer', summer: 'autumn' };
const leafStateFor = (season: WorldSeason): LeafState => season === 'autumn' ? 'colorful' : season === 'winter' ? 'barren' : 'normal';

/** deciduoustrees.lua's normal-tree leaf tasks. Logical completion belongs to game time, even without art. */
export class DeciduousTreeLeaves {
  private readonly buildSignal = createSignal<LeafBuild>('normal');
  private readonly leafSignal = createSignal<LeafState>('normal');
  private readonly targetSignal = createSignal<LeafState>('normal');
  private readonly changeTimer: ComponentTimer;
  private readonly completionTimer: ComponentTimer;
  private readonly idleFxTimer: ComponentTimer;
  private readonly dayTimer: ComponentTimer;
  private readonly delayedFx = new Set<ComponentTimer>();
  readonly state;
  private awake = false;
  private stopped = false;
  private readonly idlePeriod: number;

  private readonly scheduler: GameTimeScheduler;
  private readonly world: LeafWorld;
  private readonly season: Signal<SeasonState>;
  private readonly signalCleanups: (() => void)[] = [];
  private readonly owner: LeafOwner;
  private readonly random: () => number;
  constructor(scheduler: GameTimeScheduler, world: LeafWorld, owner: LeafOwner, random: () => number) {
    this.scheduler = scheduler; this.world = world; this.owner = owner; this.random = random;
    this.season = watchSignal(world.season, stop => { this.signalCleanups.push(stop); });
    this.idlePeriod = 30 + Math.floor(random() * 31);
    this.changeTimer = new ComponentTimer(scheduler, () => this.OnChangeLeaves());
    this.completionTimer = new ComponentTimer(scheduler, () => this.GrowLeaves());
    this.idleFxTimer = new ComponentTimer(scheduler, () => { owner.spawnLeafFx(); this.UpdateIdleLeafFx(); });
    this.dayTimer = new ComponentTimer(scheduler, () => { this.OnCyclesChanged(); this.ArmDay(); });
    this.state = Object.freeze({ build: readonlySignal(this.buildSignal), leaf: readonlySignal(this.leafSignal),
      target: readonlySignal(this.targetSignal), changeTimer: this.changeTimer.snapshot,
      completionTimer: this.completionTimer.snapshot, idleFxTimer: this.idleFxTimer.snapshot, dayTimer: this.dayTimer.snapshot });
    let first = true, previous = this.season.peek().season;
    createEffect(() => {
      const season = this.season.get().season;
      if (first) first = false;
      else if (season !== previous && !this.stopped && this.leafSignal.peek() !== leafStateFor(season)) {
        this.targetSignal.set(leafStateFor(season)); this.changeTimer.stop(); this.OnChangeLeaves();
      }
      previous = season;
    });
  }
  Initialize(saved?: DeciduousTreeSave): void {
    if (saved) {
      this.buildSignal.set(saved.build ?? 'normal'); this.leafSignal.set(saved.leaf_state); this.targetSignal.set(saved.target_leaf_state);
      this.stopped = saved.stump === true;
      this.owner.applyBuild(); this.owner.updateLoot(); this.owner.setShelter(!this.stopped && this.buildSignal.peek() !== 'barren');
      if (!this.stopped && saved.leaveschangetime !== undefined) this.changeTimer.start(saved.leaveschangetime);
      else if (!this.stopped && saved.leaf_state !== saved.target_leaf_state) this.OnChangeLeaves();
    } else {
      this.targetSignal.set(leafStateFor(this.season.peek().season)); this.OnChangeLeaves();
    }
    this.ArmDay();
  }
  private ArmDay(): void { if (!this.stopped) this.dayTimer.start(this.world.secondsUntilNextDay(this.scheduler.now)); }
  private OnCyclesChanged(): void {
    const calendar = this.world.seasonCalendar?.();
    if (!calendar || calendar.remainingDays > 3 || this.changeTimer.remainingSeconds !== undefined) return;
    const current = this.season.peek().season;
    let next = nextSeason[current];
    while (next !== current && calendar.lengths[next] <= 0) next = nextSeason[next];
    if (next === current || calendar.lengths[next] <= 0) return;
    this.targetSignal.set(leafStateFor(next)); this.changeTimer.stop();
    if (this.targetSignal.peek() !== this.leafSignal.peek()) this.changeTimer.start(30 + Math.floor(this.random() * 871));
  }
  private OnChangeLeaves(): void {
    if (this.stopped) { this.changeTimer.stop(); return; }
    const lastWork = this.owner.lastWorkTime();
    // Preserve Lua's literal comparison; this is deliberately not a "worked recently" test.
    if (lastWork !== undefined && lastWork < this.scheduler.now - 10) { this.changeTimer.start(11); return; }
    this.changeTimer.stop(); this.completionTimer.stop();
    const target = this.targetSignal.peek();
    if (target !== 'barren') {
      this.buildSignal.set(target === 'colorful' ? (['red', 'orange', 'yellow'] as const)[Math.min(2, Math.floor(this.random() * 3))] : 'normal');
      this.owner.applyBuild();
      if (this.leafSignal.peek() === 'barren') this.completionTimer.start(this.owner.playTransition('grow_leaves'));
      else this.GrowLeaves();
    } else {
      this.completionTimer.start(this.owner.playTransition('drop_leaves')); this.SpawnLeafFxAfter(11 / 30);
    }
    this.owner.setShelter(this.buildSignal.peek() !== 'barren');
  }
  private GrowLeaves(): void {
    if (this.stopped) return;
    if (this.targetSignal.peek() === 'barren') this.buildSignal.set('barren');
    this.leafSignal.set(this.targetSignal.peek()); this.owner.applyBuild(); this.owner.updateLoot();
    this.owner.sway(); this.UpdateIdleLeafFx();
  }
  /** The source's animover listener survives interrupted leaf clips and finishes on the next one-shot. */
  OnAnimation(duration: number): void {
    if (this.completionTimer.remainingSeconds !== undefined) this.completionTimer.start(duration);
  }
  SpawnLeafFxAfter(seconds: number): void {
    if (this.stopped) return;
    const task = new ComponentTimer(this.scheduler, () => { this.delayedFx.delete(task); this.owner.spawnLeafFx(); });
    this.delayedFx.add(task); task.start(seconds);
  }
  SetAwake(awake: boolean): void { this.awake = awake; this.UpdateIdleLeafFx(); }
  private UpdateIdleLeafFx(): void {
    if (!this.stopped && this.awake && this.leafSignal.peek() === 'colorful') {
      if (this.idleFxTimer.remainingSeconds === undefined) this.idleFxTimer.start(this.idlePeriod);
    } else this.idleFxTimer.stop();
  }
  OnSave(): DeciduousTreeSave {
    const build = this.buildSignal.peek(), remaining = this.changeTimer.remainingSeconds;
    return { ...(this.stopped ? { stump: true as const } : {}), ...(build !== 'normal' ? { build } : {}),
      leaf_state: this.leafSignal.peek(), target_leaf_state: this.targetSignal.peek(),
      ...(remaining !== undefined ? { leaveschangetime: remaining } : {}) };
  }
  Stop(): void {
    this.stopped = true; this.changeTimer.stop(); this.completionTimer.stop(); this.idleFxTimer.stop(); this.dayTimer.stop();
    for (const task of this.delayedFx) task.stop(); this.delayedFx.clear();
  }
  dispose(): void {
    this.Stop();
    for (const stop of this.signalCleanups.splice(0).reverse()) stop();
  }
}

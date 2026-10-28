import { ComponentTimer } from './timer';
import type { GameTimeScheduler } from './gameTimeScheduler';

export interface ChildSpawnerChild<Home> {
  readonly id: string;
  setHome(home?: Home): void;
  ListenForEvent(name: string, fn: () => void): () => void;
  remove(): void;
}
export interface ChildSpawnerSave {
  childreninside: number; childrenoutside: string[];
  spawning?: boolean; regening?: boolean; queued_spawn?: boolean;
  timetonextspawn?: number; timetonextregen?: number; emergencychildreninside?: number;
}

/** childspawner.lua's normal children branch. Ownership is separate from the inside population. */
export class ChildSpawner<Home, Child extends ChildSpawnerChild<Home>> {
  readonly childrenoutside = new Set<Child>();
  childreninside = 1;
  maxchildren = 1;
  onchildkilled?: (child: Child) => void;
  ongohome?: (child: Child) => void;
  private readonly listeners = new Map<Child, (() => void)[]>();
  private readonly regen: ComponentTimer;
  readonly timer;
  private readonly spawnTick: ComponentTimer;
  private readonly queuedSpawn: ComponentTimer;
  readonly spawnTimer;
  private nextRegen = 0;
  private nextSpawn = 0;
  private spawnPeriod = 20;
  private spawnVariance = 2;
  private tickPeriod = 0;
  private spawning = false;
  private queued = false;
  private regening = true;
  private awake = true;
  private spawnChild?: () => Child | undefined;
  private readonly home: Home;
  private readonly random: () => number;
  constructor(home: Home, scheduler: GameTimeScheduler, saved?: ChildSpawnerSave, random = Math.random) {
    this.home = home; this.random = random;
    this.childreninside = saved?.childreninside ?? 1;
    this.spawning = saved?.spawning ?? false;
    this.queued = saved?.queued_spawn ?? false;
    this.regening = saved?.regening ?? true;
    this.nextSpawn = saved?.timetonextspawn ?? 0;
    this.nextRegen = saved?.timetonextregen ?? 0;
    this.regen = new ComponentTimer(scheduler, () => {
      this.childreninside = Math.min(this.maxchildren, this.childreninside + 1);
      this.nextRegen = 20 + (this.random() * 2 - 1) * 2;
      this.startRegen();
    });
    this.timer = this.regen.snapshot;
    this.spawnTick = new ComponentTimer(scheduler, () => {
      if (!this.spawning || this.queued || !this.spawnChild || this.childreninside === 0) return;
      this.nextSpawn -= this.tickPeriod;
      if (this.nextSpawn < 0) {
        this.nextSpawn = this.spawnPeriod + (this.random() * 2 - 1) * this.spawnVariance;
        if (this.awake) this.SpawnChild(); else this.QueueSpawnChild();
      }
      if (this.spawning && !this.queued && this.childreninside > 0) this.spawnTick.start(this.tickPeriod);
    });
    this.queuedSpawn = new ComponentTimer(scheduler, () => {
      if (!this.awake || !this.queued) return;
      this.queued = false;
      if (this.spawning) this.SpawnChild();
      this.startSpawnUpdate();
    });
    this.spawnTimer = this.spawnTick.snapshot;
    if (!saved?.childrenoutside.length) this.startRegen();
  }
  get numchildrenoutside(): number { return this.childrenoutside.size; }
  TakeOwnership(child: Child): void {
    if (this.childrenoutside.has(child)) return;
    child.setHome(this.home); this.childrenoutside.add(child);
    this.listeners.set(child, ['ontrapped', 'death', 'onremove', 'detachchild'].map(event =>
      child.ListenForEvent(event, () => this.OnChildKilled(child))));
    if (this.childreninside + this.numchildrenoutside >= this.maxchildren) {
      this.nextRegen = this.regen.remainingSeconds ?? this.nextRegen; this.regen.stop();
    }
  }
  OnChildKilled(child: Child): void {
    if (!this.childrenoutside.has(child)) return;
    this.forget(child); this.onchildkilled?.(child); this.startRegen();
  }
  GoHome(child: Child): boolean {
    if (!this.childrenoutside.has(child)) return false;
    // Source calls ongohome before removing the child. Remove listeners first so
    // its onremove does not also execute the death/capture callback.
    this.ongohome?.(child); this.forget(child); child.remove();
    this.childreninside = Math.min(this.maxchildren, this.childreninside + 1);
    this.regen.stop(); return true;
  }
  private forget(child: Child): void {
    this.listeners.get(child)?.forEach(stop => stop()); this.listeners.delete(child); this.childrenoutside.delete(child);
  }
  private startRegen(): void {
    if (this.regening && this.childreninside + this.numchildrenoutside < this.maxchildren && this.timer.peek().status !== 'scheduled')
      this.regen.start(this.nextRegen);
  }
  /** childspawner.lua normal spawning branch; the periodic update interval is sampled once per task. */
  ConfigureSpawning(spawn: () => Child | undefined, period: number, variance = period * .1): void {
    this.spawnChild = spawn;
    this.spawnPeriod = period; this.spawnVariance = variance;
    if (!this.spawning) this.nextSpawn = period;
    this.startSpawnUpdate();
  }
  StartSpawning(): void { this.spawning = true; this.nextSpawn = 0; this.startSpawnUpdate(); }
  StopRegen(): void { this.regening = false; this.regen.stop(); }
  AddChildrenInside(count: number): void {
    this.childreninside = Math.min(this.maxchildren, this.childreninside + count);
    this.startSpawnUpdate();
  }
  OnEntitySleep(): void { this.awake = false; }
  OnEntityWake(): void {
    this.awake = true;
    if (this.queued) this.queuedSpawn.start(0);
  }
  private startSpawnUpdate(): void {
    if (!this.spawnChild || !this.spawning || this.queued || this.childreninside === 0
      || this.spawnTick.snapshot.peek().status === 'scheduled') return;
    this.tickPeriod = 5 + this.random() * 5;
    this.spawnTick.start(this.tickPeriod);
  }
  private QueueSpawnChild(): void { this.queued = true; this.spawnTick.stop(); }
  private SpawnChild(): Child | undefined {
    if (!this.awake || this.childreninside === 0) return;
    const child = this.spawnChild?.();
    if (child) { this.childreninside--; this.TakeOwnership(child); }
    return child;
  }
  OnSave(): ChildSpawnerSave { return { childreninside: this.childreninside,
    childrenoutside: [...this.childrenoutside].map(child => child.id),
    ...(this.spawnChild ? { spawning: this.spawning, regening: this.regening, queued_spawn: this.queued,
      timetonextspawn: Math.floor(this.nextSpawn), timetonextregen: Math.floor(this.nextRegen), emergencychildreninside: 0 } : {}) }; }
  LoadPostPass(resolve: (id: string) => Child | undefined, ids: readonly string[]): string[] {
    const pending: string[] = [];
    for (const id of ids) { const child = resolve(id); if (child) this.TakeOwnership(child); else pending.push(id); }
    if (!pending.length) this.startRegen(); return pending;
  }
  dispose(): void { this.regen.stop(); this.spawnTick.stop(); this.queuedSpawn.stop(); for (const child of this.childrenoutside) this.forget(child); }
}

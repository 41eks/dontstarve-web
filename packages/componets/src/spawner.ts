import { ComponentTimer } from './timer';
import type { GameTimeScheduler } from './gameTimeScheduler';

/** spawner.lua's single persistent child: occupancy differs from ownership. */
export interface SpawnerChild {
  ListenForEvent(name: string, fn: () => void): () => void;
  setHome(home: unknown): void;
  enterHome(): void;
  leaveHome(): void;
}
export class Spawner<T extends SpawnerChild> {
  child?: T;
  private occupied = false;
  private queued = false;
  private retry = 0;
  private readonly task: ComponentTimer;
  readonly timer;
  private readonly stops: (() => void)[] = [];
  onoccupied?: () => void;
  onvacate?: (child: T) => void;
  private readonly inst: unknown;
  private readonly spawn: () => T;
  private readonly delay: number;
  constructor(inst: unknown, scheduler: GameTimeScheduler, spawn: () => T, delay: number) {
    this.inst = inst; this.spawn = spawn; this.delay = delay;
    this.task = new ComponentTimer(scheduler, () => this.ReleaseChild()); this.timer = this.task.snapshot;
  }
  SpawnWithDelay(delay: number): void { this.task.start(Math.max(0, delay)); }
  IsSpawnPending(): boolean { return this.timer.peek().status === 'scheduled'; }
  CancelSpawning(): void { this.task.stop(); }
  SetQueueSpawning(queued: boolean, retry = 0): void { this.queued = queued; this.retry = retry; }
  IsOccupied(): boolean { return this.child !== undefined && this.occupied; }
  TakeOwnership(child: T): void {
    if (this.child !== child) {
      this.stops.splice(0).forEach(stop => stop()); this.child = child;
      for (const event of ['ontrapped', 'death', 'detachchild', 'onremove']) this.stops.push(child.ListenForEvent(event, () => this.OnChildKilled(child)));
    }
    child.setHome(this.inst);
  }
  GoHome(child: T): boolean {
    if (this.child !== child || this.occupied) return false;
    this.occupied = true; child.enterHome(); this.onoccupied?.(); return true;
  }
  ReleaseChild(): boolean {
    this.CancelSpawning();
    if (!this.child) { const child = this.spawn(); this.TakeOwnership(child); this.GoHome(child); this.CancelSpawning(); }
    if (!this.IsOccupied()) return false;
    if (this.queued) { this.SpawnWithDelay(this.retry); return false; }
    this.occupied = false; this.TakeOwnership(this.child!); this.child!.leaveHome(); this.onvacate?.(this.child!); return true;
  }
  private OnChildKilled(child: T): void {
    if (this.child !== child) return;
    this.stops.splice(0).forEach(stop => stop()); this.child = undefined; this.occupied = false; this.SpawnWithDelay(this.delay);
  }
  get remainingSeconds(): number | undefined { return this.task.remainingSeconds; }
  dispose(): void { this.CancelSpawning(); this.stops.splice(0).forEach(stop => stop()); }
}

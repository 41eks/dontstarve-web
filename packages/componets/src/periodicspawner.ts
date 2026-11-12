import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import type { GameTimeScheduler } from './gameTimeScheduler';
import { ComponentTimer } from './timer';
import type { Vector3 } from 'three';

export interface PeriodicSpawnerInst {
  getPosition(): Vector3;
}

/** TheSim:FindEntities for the configured prefab: the host resolves it and excludes INLIMBO entities. */
export type FindPrefabPositions = () => Iterable<ReadonlyVector3>;

/** periodicspawner.lua's scheduled spawn/retry and persistence; host supplies prefab/map validation. */
export class PeriodicSpawner {
  private readonly timer: ComponentTimer;
  private readonly random: () => number;
  private readonly trySpawn: () => { spawned: boolean; retrySeconds?: number };
  private basetime = 40;
  private randtime = 60;
  private disposed = false;
  private range?: number;
  private density?: number;
  private spacing?: number;
  private readonly inst: PeriodicSpawnerInst;
  private readonly findPrefabPositions?: FindPrefabPositions;

  constructor(inst: PeriodicSpawnerInst, scheduler: GameTimeScheduler, trySpawn: PeriodicSpawner['trySpawn'], random = Math.random,
    findPrefabPositions?: FindPrefabPositions) {
    this.inst = inst; this.trySpawn = trySpawn; this.random = random;
    this.findPrefabPositions = findPrefabPositions;
    this.timer = new ComponentTimer(scheduler, () => this.DoSpawn());
  }

  get timerState() { return this.timer.snapshot; }
  get remainingSeconds(): number | undefined { return this.timer.remainingSeconds; }

  SetRandomTimes(basetime: number, variance: number, noReset = false): void {
    this.basetime = basetime; this.randtime = variance;
    if (!noReset && this.timer.snapshot.peek().status === 'scheduled') this.Start();
  }
  Start(timeoverride?: number): void {
    if (!this.disposed) this.timer.start(timeoverride ?? this.basetime + this.random() * this.randtime);
  }
  Stop(): void { this.timer.stop(); }
  SetDensityInRange(range: number, density: number): void { this.range = range; this.density = density; }
  SetMinimumSpacing(spacing: number): void { this.spacing = spacing; }
  TrySpawn() {
    if (this.disposed) return { spawned: false, retrySeconds: this.basetime * .25 };
    if (this.findPrefabPositions && (this.range !== undefined || this.spacing !== undefined)) {
      const density = this.density ?? 0;
      if (density <= 0) return { spawned: false };
      const origin = this.inst.getPosition(), radius = this.range ?? this.spacing!;
      let count = 0;
      for (const point of this.findPrefabPositions()) {
        const distanceSquared = point.distanceToSquared(origin);
        if (distanceSquared > radius ** 2) continue;
        // TrySpawn checks the default spawn point (the inst's foot), before beefalo's OnSpawn
        // moves the new manure behind it. A density failure uses the normal randomized retry.
        if (this.range === undefined || (this.spacing !== undefined
          && (this.spacing >= this.range || distanceSquared < this.spacing ** 2))) return { spawned: false };
        if (++count >= density) return { spawned: false };
      }
    }
    return this.trySpawn();
  }
  DoSpawn(): void {
    if (this.disposed) return;
    this.Start(this.TrySpawn().retrySeconds);
  }
  OnSave(): { time: number } | undefined {
    const time = this.timer.remainingSeconds;
    return time !== undefined && time > 0 ? { time: Math.floor(time) } : undefined;
  }
  OnLoad(data?: { time?: number }): void { if (data?.time !== undefined) this.Start(data.time); }
  dispose(): void { this.disposed = true; this.Stop(); }
}

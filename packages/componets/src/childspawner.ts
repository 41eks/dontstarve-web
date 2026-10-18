import { ComponentTimer } from './timer';
import type { GameTimeScheduler } from './gameTimeScheduler';

export interface ChildSpawnerChild<Home> {
  readonly id: string;
  setHome(home?: Home): void;
  ListenForEvent(name: string, fn: () => void): () => void;
  remove(): void;
}
export interface ChildSpawnerSave { childreninside: number; childrenoutside: string[] }

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
  private nextRegen = 0;
  private readonly home: Home;
  private readonly random: () => number;
  constructor(home: Home, scheduler: GameTimeScheduler, saved?: ChildSpawnerSave, random = Math.random) {
    this.home = home; this.random = random;
    this.childreninside = saved?.childreninside ?? 1;
    this.regen = new ComponentTimer(scheduler, () => {
      this.childreninside = Math.min(this.maxchildren, this.childreninside + 1);
      this.nextRegen = 20 + (this.random() * 2 - 1) * 2;
      this.startRegen();
    });
    this.timer = this.regen.snapshot;
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
    if (this.childreninside + this.numchildrenoutside < this.maxchildren && this.timer.peek().status !== 'scheduled')
      this.regen.start(this.nextRegen);
  }
  OnSave(): ChildSpawnerSave { return { childreninside: this.childreninside,
    childrenoutside: [...this.childrenoutside].map(child => child.id) }; }
  LoadPostPass(resolve: (id: string) => Child | undefined, ids: readonly string[]): string[] {
    const pending: string[] = [];
    for (const id of ids) { const child = resolve(id); if (child) this.TakeOwnership(child); else pending.push(id); }
    if (!pending.length) this.startRegen(); return pending;
  }
  dispose(): void { this.regen.stop(); for (const child of this.childrenoutside) this.forget(child); }
}

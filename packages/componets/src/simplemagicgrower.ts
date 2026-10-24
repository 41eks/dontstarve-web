import type { Growable } from './growable';
import type { GameTimeScheduler } from './gameTimeScheduler';
import { ComponentTimer } from './timer';

/** simplemagicgrower.lua: advance one stage at a time, stopping at the configured harvest stage. */
export class SimpleMagicGrower {
  private lastStage?: number;
  private readonly task: ComponentTimer;
  readonly timer;
  private removed = false;
  private readonly inst: { addTag(tag: string): void; removeTag(tag: string): void };
  private readonly growable: Growable;
  constructor(inst: { addTag(tag: string): void; removeTag(tag: string): void }, growable: Growable, scheduler: GameTimeScheduler) {
    this.inst = inst; this.growable = growable;
    this.task = new ComponentTimer(scheduler, () => this.Grow());
    this.timer = this.task.snapshot;
  }
  SetLastStage(stage: number): void { this.lastStage = stage; }
  Grow(): void {
    if (this.removed || this.lastStage === undefined) return;
    if (this.growable.GetStage() < this.lastStage) {
      this.growable.DoGrowth(); this.task.start(Math.random());
    } else {
      this.growable.StartGrowing(); this.inst.removeTag('magicgrowth');
    }
  }
  StartGrowing(): void { if (!this.removed) { this.inst.addTag('magicgrowth'); this.Grow(); } }
  dispose(): void { this.removed = true; this.task.stop(); this.inst.removeTag('magicgrowth'); }
}

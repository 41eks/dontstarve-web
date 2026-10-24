import { createSignal, readonlySignal } from '../../signals/src';
import { ComponentTimer } from './timer';
import type { GameTimeScheduler } from './gameTimeScheduler';

export interface FreezableInst {
  isValid(): boolean;
  isDead(): boolean;
  addTag(tag: string): void;
  removeTag(tag: string): void;
  PushEvent(name: string): void;
  ListenForEvent(name: string, fn: (data: unknown) => void): () => void;
  stopBrain(): void;
  restartBrain(): void;
  readonly components: { combat?: { DropTarget(): void }; locomotor?: { Stop(): void } };
}
/** freezable.lua's default resistance branch (no boss diminishing returns). Freeze state is not saved. */
export class Freezable {
  resistance = 1;
  wearofftime = 10;
  private readonly cold = createSignal(0);
  private readonly mode = createSignal<'NORMAL' | 'FROZEN' | 'THAWING'>('NORMAL');
  readonly coldness = readonlySignal(this.cold);
  readonly state = readonlySignal(this.mode);
  private readonly wearoff: ComponentTimer;
  readonly timer;
  private readonly inst: FreezableInst;
  private readonly stopAttacked: () => void;
  constructor(inst: FreezableInst, scheduler: GameTimeScheduler) {
    this.inst = inst; inst.addTag('freezable');
    this.wearoff = new ComponentTimer(scheduler, () => {
      if (this.mode.peek() === 'FROZEN') this.Thaw();
      else if (this.mode.peek() === 'THAWING') this.Unfreeze();
      else if (this.cold.peek() > 0) { this.cold.set(Math.max(0, this.cold.peek() - 1)); if (this.cold.peek() > 0) this.wearoff.start(this.wearofftime); }
    });
    this.timer = this.wearoff.snapshot;
    this.stopAttacked = inst.ListenForEvent('attacked', () => { if (inst.isValid() && this.IsFrozen()) this.Unfreeze(); });
  }
  IsFrozen(): boolean { return this.mode.peek() !== 'NORMAL'; }
  IsThawing(): boolean { return this.mode.peek() === 'THAWING'; }
  AddColdness(amount: number, freezetime?: number, nofreeze = false): void {
    this.cold.set(Math.max(0, this.cold.peek() + amount));
    if (amount <= 0) return;
    if (this.IsFrozen() || this.cold.peek() >= this.resistance && !nofreeze) this.Freeze(freezetime);
    else this.wearoff.start(this.wearofftime);
  }
  Freeze(seconds = this.wearofftime): void {
    if (!this.inst.isValid() || this.inst.isDead()) return;
    const previous = this.mode.peek(); this.mode.set('FROZEN'); this.wearoff.start(seconds);
    this.inst.stopBrain(); this.inst.components.combat?.DropTarget(); this.inst.components.locomotor?.Stop();
    if (previous !== 'FROZEN') this.inst.PushEvent('freeze');
  }
  Thaw(seconds = this.wearofftime): void {
    if (!this.IsFrozen() || this.inst.isDead()) return;
    this.mode.set('THAWING'); this.cold.set(0); this.inst.PushEvent('onthaw'); this.wearoff.start(seconds);
  }
  Unfreeze(): void {
    if (!this.IsFrozen()) return;
    this.mode.set('NORMAL'); this.cold.set(0);
    if (!this.inst.isDead()) { this.inst.restartBrain(); this.inst.PushEvent('unfreeze'); }
  }
  dispose(): void { this.wearoff.stop(); this.stopAttacked(); this.inst.removeTag('freezable'); }
}

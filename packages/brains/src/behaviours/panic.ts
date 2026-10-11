import { BehaviourNode, READY, RUNNING } from '../behaviourtree';
import type { BrainInst } from '../types';

/** behaviours/panic.lua: run in a fresh random direction every .25–.5 seconds. */
export class Panic extends BehaviourNode {
  private readonly inst: BrainInst;
  private waittime = 0;

  constructor(inst: BrainInst) {
    super('Panic');
    this.inst = inst;
  }

  override Visit(): void {
    if (this.status === READY) {
      this.PickNewDirection();
      this.status = RUNNING;
    } else {
      if (this.now > this.waittime) this.PickNewDirection();
      this.Sleep(this.waittime - this.now);
    }
  }

  PickNewDirection(): void {
    this.inst.components.locomotor!.RunInDirection(this.context.random() * 360);
    this.waittime = this.now + .25 + this.context.random() * .25;
  }
}

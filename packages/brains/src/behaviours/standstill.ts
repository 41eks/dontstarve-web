import type { LocoMotor } from '../../../componets/src/locomotor';
import { BehaviourNode, RUNNING } from '../behaviourtree';

/** The unconditional branch of behaviours/standstill.lua. */
export class StandStill extends BehaviourNode {
  private readonly inst: { readonly components: { locomotor: LocoMotor } };
  constructor(inst: { readonly components: { locomotor: LocoMotor } }) {
    super('StandStill');
    this.inst = inst;
  }

  override Visit(): void {
    this.status = RUNNING;
    this.inst.components.locomotor.Stop();
    this.Sleep(0.5);
  }
}

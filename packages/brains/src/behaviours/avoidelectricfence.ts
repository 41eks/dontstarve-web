import { BehaviourNode, READY, RUNNING } from '../behaviourtree';
import { DEGREES, RADIANS } from '../simutil';
import type { BrainEntity, BrainInst } from '../types';

export interface ElectricField { readonly fences: readonly BrainEntity[] }

/** behaviours/avoidelectricfence.lua: run directly away from every fence of the field that shocked us. */
export class AvoidElectricFence extends BehaviourNode {
  private readonly inst: BrainInst;
  private run_angle?: number;
  private readonly onelectrocute = () => { this.inst.brain?.ForceUpdate(); };
  private readonly shocked_by_field = (field?: unknown) => {
    this.run_angle = this.GetRunAngle(field as ElectricField);
    this.inst.brain?.ForceUpdate();
  };

  constructor(inst: BrainInst) {
    super('AvoidElectricFence');
    this.inst = inst;
    inst._has_electric_fence_panic_trigger = true;
    inst.ListenForEvent('startelectrocute', this.onelectrocute);
    inst.ListenForEvent('shocked_by_new_field', this.shocked_by_field);
  }

  override OnStop = (): void => {
    this.inst.RemoveEventCallback('startelectrocute', this.onelectrocute);
    this.inst.RemoveEventCallback('shocked_by_new_field', this.shocked_by_field);
  };

  GetRunAngle(field: ElectricField): number {
    let xs = 0, zs = 0;
    for (const fence of field.fences) {
      const { x, z } = fence.getPosition();
      const angle = this.inst.getAngleToPoint(x, 0, z) * DEGREES;
      xs -= Math.cos(angle);
      zs -= Math.sin(angle);
    }
    return ((Math.atan2(zs, xs) * RADIANS) % 360 + 360) % 360;
  }

  override Visit(): void {
    if (this.status === READY && this.run_angle !== undefined) {
      this.status = RUNNING;
      this.inst.components.combat?.DropTarget();
    }
    if (this.status === RUNNING) this.inst.components.locomotor!.RunInDirection(this.run_angle!);
  }
}

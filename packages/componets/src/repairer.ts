import type { WorkInst } from './workable';

/** repairer.lua: material and repair values advertise the corresponding item actions. */
export class Repairer {
  private readonly inst: WorkInst;
  readonly repairmaterial: string;
  readonly workrepairvalue: number;
  readonly healthrepairvalue: number;
  constructor(inst: WorkInst, repairmaterial: string, workrepairvalue: number, healthrepairvalue = 0) {
    this.inst = inst; this.repairmaterial = repairmaterial;
    this.workrepairvalue = workrepairvalue; this.healthrepairvalue = healthrepairvalue;
    inst.addTag('repairer');
    if (workrepairvalue > 0) inst.addTag(`work_${repairmaterial}`);
    if (healthrepairvalue > 0) inst.addTag(`health_${repairmaterial}`);
  }
  dispose(): void {
    this.inst.removeTag('repairer');
    this.inst.removeTag(`work_${this.repairmaterial}`);
    this.inst.removeTag(`health_${this.repairmaterial}`);
  }
}

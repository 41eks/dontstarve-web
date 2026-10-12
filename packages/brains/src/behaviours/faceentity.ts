import { BehaviourNode, FAILED, READY, RUNNING, SUCCESS } from '../behaviourtree';
import type { BrainEntity, BrainInst, Vec3 } from '../types';

export interface FaceEntityInst extends BrainInst {
  readonly sg: {
    hasStateTag(tag: string): boolean;
    hasState(name: string): boolean;
    goToState(name: string): void;
  };
  facePoint(point: Vec3): void;
}

/** behaviours/faceentity.lua: stop once on acquisition, rotate only when the state permits it. */
export class FaceEntity extends BehaviourNode {
  private target?: BrainEntity;
  private starttime = 0;
  private readonly inst: FaceEntityInst;
  private readonly getfn: (inst: FaceEntityInst) => BrainEntity | undefined;
  private readonly keepfn: (inst: FaceEntityInst, target: BrainEntity) => boolean;
  private readonly timeout?: number;
  private readonly customalert?: string;

  constructor(inst: FaceEntityInst, getfn: FaceEntity['getfn'], keepfn: FaceEntity['keepfn'],
    timeout?: number, customalert?: string) {
    super('FaceEntity');
    this.inst = inst; this.getfn = getfn; this.keepfn = keepfn;
    this.timeout = timeout; this.customalert = customalert;
  }

  override Visit(): void {
    if (this.status === READY) {
      this.target = this.getfn(this.inst);
      if (this.target) {
        this.status = RUNNING;
        this.inst.components.locomotor?.Stop();
        this.starttime = this.now;
      } else this.status = FAILED;
    }
    if (this.status === RUNNING) {
      const sg = this.inst.sg;
      if (sg.hasStateTag('idle') && !sg.hasStateTag('alert') && sg.hasState('alert')) {
        sg.goToState(this.customalert ?? 'alert');
      }
      if (this.timeout !== undefined && this.now - this.starttime > this.timeout) {
        this.status = SUCCESS;
        return;
      }
      if (!this.target?.isValid() || !this.keepfn(this.inst, this.target)) this.status = FAILED;
      else if (sg.hasStateTag('canrotate')) this.inst.facePoint(this.target.getPosition());
      this.Sleep(.5);
    }
  }
}

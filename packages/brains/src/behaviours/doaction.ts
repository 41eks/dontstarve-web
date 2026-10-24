import type { BufferedAction } from '../../../stategraphs/src/bufferedaction';
import { BehaviourNode, FAILED, READY, RUNNING, SUCCESS, type BehaviourStatus } from '../behaviourtree';
import { FunctionOrValue } from '../simutil';
import type { BrainInst } from '../types';

/** behaviours/doaction.lua: push the buffered action chosen by `getactionfn` and wait for its outcome. */
export class DoAction extends BehaviourNode {
  private readonly inst: BrainInst;
  private readonly shouldrun?: boolean | (() => boolean);
  private readonly getactionfn: (inst: BrainInst) => BufferedAction | undefined;
  private readonly timeout?: number;
  private action?: BufferedAction;
  private time = 0;
  private pendingstatus?: BehaviourStatus;

  constructor(inst: BrainInst, getactionfn: (inst: BrainInst) => BufferedAction | undefined, name?: string,
    run?: boolean | (() => boolean), timeout?: number) {
    super(name ?? 'DoAction');
    this.inst = inst;
    this.shouldrun = run;
    this.getactionfn = getactionfn;
    this.timeout = timeout;
  }

  OnFail(): void { this.pendingstatus = FAILED; }
  OnSucceed(): void { this.pendingstatus = SUCCESS; }

  override Visit(): void {
    if (this.status === READY) {
      const action = this.getactionfn(this.inst);
      this.action = action;
      this.pendingstatus = undefined;
      if (action) {
        action.addFailAction(() => { if (action === this.action && this.pendingstatus === undefined) this.OnFail(); });
        action.addSuccessAction(() => { if (action === this.action) this.OnSucceed(); });
        this.inst.components.locomotor!.PushAction(action, FunctionOrValue(this.shouldrun ?? false));
        this.time = this.now;
        this.status = RUNNING;
      } else this.status = FAILED;
    }
    if (this.status === RUNNING) {
      if (this.timeout !== undefined && this.now - this.time > this.timeout) this.status = FAILED;
      if (this.pendingstatus) this.status = this.pendingstatus;
      else if (!this.action!.isValid()) this.status = FAILED;
    }
  }
}

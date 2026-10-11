import type { WorkInst } from './workable';
import type { Burnable } from './burnable';

export interface LightTarget extends WorkInst { components: { burnable?: Burnable }; }

/** components/lighter.lua: the item delegates ignition to the target's burnable. */
export class Lighter {
  onlight?: (inst: WorkInst, target: LightTarget) => void;
  readonly inst: WorkInst;
  constructor(inst: WorkInst) { this.inst = inst; inst.addTag('lighter'); }
  Light(target: LightTarget, doer?: WorkInst): void {
    if (target.components.burnable && !((target.hasTag('fueldepleted') && !target.hasTag('burnableignorefuel')) || target.hasTag('INLIMBO'))) {
      target.components.burnable.Ignite(false, this.inst, doer);
      this.onlight?.(this.inst, target);
    }
    target.PushEvent?.('onlighterlight', undefined);
  }
  dispose(): void { this.inst.removeTag('lighter'); this.onlight = undefined; }
}

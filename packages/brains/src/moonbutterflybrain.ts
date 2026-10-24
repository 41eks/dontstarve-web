import { BT, PriorityNode } from './behaviourtree';
import { Brain } from './brain';
import { ElectricFencePanicTrigger, PanicTrigger } from './braincommon';
import { RunAway } from './behaviours/runaway';
import { Wander } from './behaviours/wander';
import { RUN_AWAY_PARAMS } from './butterflybrain';
import type { BrainInst } from './types';

const RUN_AWAY_DIST = 5;
const STOP_RUN_AWAY_DIST = 10;
const MAX_WANDER_DIST = 20;

const GetHomePos = (inst: BrainInst) => inst.components.knownlocations?.GetLocation('home');

/** brains/moonbutterflybrain.lua */
export class MoonButterflyBrain extends Brain {
  protected override OnStart(): void {
    const inst = this.inst;
    const root = new PriorityNode([
      PanicTrigger(inst),
      ElectricFencePanicTrigger(inst),
      new RunAway(inst, RUN_AWAY_PARAMS, RUN_AWAY_DIST, STOP_RUN_AWAY_DIST),
      new Wander(inst, GetHomePos, MAX_WANDER_DIST),
    ], 1);
    this.bt = new BT(inst, root);
  }

  protected override OnInitializationComplete(): void {
    this.inst.components.knownlocations?.RememberLocation('home', this.inst.getPosition(), true);
  }
}

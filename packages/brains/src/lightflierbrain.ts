import { Brain } from './brain';
import { BT, PriorityNode, WhileNode, ActionNode, EventNode, ParallelNode, WaitNode } from './behaviourtree';
import { Panic } from './behaviours/panic';
import { PanicTrigger, ElectricFencePanicTrigger } from './braincommon';
import { RunAway } from './behaviours/runaway';
import { Wander } from './behaviours/wander';
import { DoAction } from './behaviours/doaction';
import { BufferedAction } from '../../stategraphs/src/bufferedaction';
import type { BrainEntity, BrainInst } from './types';

export interface LightFlierBrainHome extends BrainEntity {
  readonly returningHome?: BrainEntity;
  readonly childrenOutside: number;
  canGoHome(): boolean;
}
export interface LightFlierBrainInst extends BrainInst {
  readonly home?: LightFlierBrainHome;
  readonly bornAt: number;
  readonly lastAttacked: number;
  readonly inFormation: boolean;
  readonly sg: { hasStateTag(tag: string): boolean };
  formationActive(active: boolean): void;
  findHome(): void;
  wentHome(home: BrainEntity): boolean;
}

/** brains/lightflierbrain.lua: formation direct drive follows panic, avoidance and home actions. */
export class LightFlierBrain extends Brain {
  private readonly fly: LightFlierBrainInst;
  private readonly unit: number;
  constructor(inst: LightFlierBrainInst, unit = 1) { super(inst); this.fly = inst; this.unit = unit; }
  protected override OnStart(): void {
    const inst = this.fly, unit = this.unit;
    const gohome = () => {
      inst.findHome(); const home = inst.home;
      if (!home?.isValid() || !home.canGoHome() || inst.sg.hasStateTag('busy')
        || !(home.returningHome === inst || inst.getTime() - inst.bornAt > 60 && home.childrenOutside > 1)) return;
      return new BufferedAction('GOHOME', () => inst.wentHome(home),
        () => inst.isValid() && home.isValid() && home.canGoHome(), { target: home, distance: unit });
    };
    class Root extends PriorityNode {
      override Visit(): void {
        if (this.lasttime === undefined || this.lasttime + .25 < this.now) inst.formationActive(false);
        super.Visit();
      }
    }
    this.bt = new BT(inst, new Root([
      new EventNode(inst, 'panic', new ParallelNode([new Panic(inst), new WaitNode(6)])),
      PanicTrigger(inst), ElectricFencePanicTrigger(inst),
      WhileNode(() => inst.getTime() - inst.lastAttacked < 4, 'Recently Attacked',
        new RunAway(inst, 'scarytoprey', 8 * unit, 10 * unit)),
      WhileNode(() => !inst.inFormation, 'No Formation', new PriorityNode([
        new RunAway(inst, 'scarytoprey', 3.5 * unit, 5 * unit),
        new DoAction(inst, gohome, 'Go Home', false),
        new Wander(inst, () => inst.home?.getPosition() ?? inst.components.knownlocations?.GetLocation('home'), 10 * unit),
      ], .25)),
      new ActionNode(() => inst.formationActive(true), 'Follow Formation'),
    ], .25));
  }
}

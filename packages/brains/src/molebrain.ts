import { Vector3 } from 'three';
import { BT, EventNode, PriorityNode, WhileNode } from './behaviourtree';
import { Brain } from './brain';
import { PanicTrigger, ElectricFencePanicTrigger } from './braincommon';
import { DoAction } from './behaviours/doaction';
import { RunAway } from './behaviours/runaway';
import { Wander } from './behaviours/wander';
import type { BrainEntity, BrainInst } from './types';
import { createMoleAction, type MoleBaitTarget } from '../../stategraphs/src/moleactions';

export interface MoleBrainInst extends BrainInst {
  PushEvent(name: string, data?: unknown): void;
  makeHome(): boolean;
  wentHome(target: BrainEntity): boolean;
  readonly sg: { hasStateTag(tag: string): boolean };
  readonly home: BrainEntity | undefined;
  readonly needs_home_time: number | undefined;
  readonly make_home_delay: number;
  readonly last_above_time: number;
  readonly peek_interval: number;
  readonly flee: boolean;
  readonly bornAt: number;
  inventoryFull(): boolean;
  findHomePosition(): Vector3 | undefined;
  readonly world: BrainInst['world'] & { readonly isAcidRaining?: boolean };
}
export function shouldMakeMoleHome(inst: MoleBrainInst): boolean {
  return !inst.home?.isValid() && inst.needs_home_time !== undefined && inst.getTime() - inst.needs_home_time > inst.make_home_delay;
}
export class MoleBrain extends Brain {
  private readonly mole: MoleBrainInst;
  private readonly unit: number;
  constructor(mole: MoleBrainInst, unit = 1) { super(mole); this.mole = mole; this.unit = unit; }
  protected override OnStart(): void {
    const inst = this.mole, unit = this.unit;
    const gohome = () => inst.home?.isValid() && !inst.sg.hasStateTag('trapped')
      ? createMoleAction(inst, 'GOHOME', inst.home, undefined, unit) : undefined;
    const makehome = () => {
      const pos = inst.findHomePosition();
      return pos ? createMoleAction(inst, 'MAKEMOLEHILL', undefined, pos, unit) : undefined;
    };
    const takebait = () => {
      if (inst.getTime() - inst.bornAt < 3 || inst.sg.hasStateTag('busy') || shouldMakeMoleHome(inst) || inst.inventoryFull()) return;
      const target = inst.world.findEntity(inst, 20 * unit, guy => 'canSteal' in guy,
        ['molebait'], ['outofreach', 'INLIMBO', 'fire']) as MoleBaitTarget | undefined;
      // Source checks reservation after FindEntity, rather than searching for the next bait.
      if (target?.isOnValidGround() && target.reserve()) return createMoleAction(inst, 'STEALMOLEBAIT', target, undefined, unit);
      return;
    };
    this.bt = new BT(inst, new PriorityNode([
      PanicTrigger(inst), ElectricFencePanicTrigger(inst),
      WhileNode(() => shouldMakeMoleHome(inst), 'Home Dug Up', new DoAction(inst, makehome, 'Make Home', false)),
      WhileNode(() => inst.flee, 'Flee', new RunAway(inst, 'scarytoprey', 0, 6 * unit)),
      WhileNode(() => !!inst.world.isAcidRaining, 'Acid Raining', new DoAction(inst, gohome, 'Go Home', false)),
      WhileNode(() => !inst.sg.hasStateTag('busy') && inst.getTime() > inst.last_above_time + inst.peek_interval,
        'Should Peek', new DoAction(inst, () => createMoleAction(inst, 'MOLEPEEK'), 'Do Peek', false)),
      WhileNode(() => inst.inventoryFull(), 'Deposit Inventory', new DoAction(inst, gohome, 'Go Home', false)),
      new EventNode(inst, 'gohome', new DoAction(inst, gohome, 'Go Home', false)),
      new DoAction(inst, takebait, 'Take Bait', false),
      WhileNode(() => inst.world.isDay, 'Is Day', new DoAction(inst, gohome, 'Go Home', false)),
      new Wander(inst, () => inst.components.knownlocations?.GetLocation('home'), 20 * unit),
    ], .25));
  }
}

import { Vector3 } from 'three';
import { BT, EventNode, PriorityNode, WhileNode } from './behaviourtree';
import { Brain } from './brain';
import { PanicTrigger, ElectricFencePanicTrigger } from './braincommon';
import { DoAction } from './behaviours/doaction';
import { RunAway } from './behaviours/runaway';
import { Wander } from './behaviours/wander';
import type { BrainComponents, BrainEntity, BrainInst } from './types';
import { CreateBufferedAction } from './bufferedaction';
import { IsMoleBait, MakeMoleHillAction, MolePeekAction, StealMoleBaitAction, type MoleBaitTarget } from '../../stategraphs/src/moleactions';

export interface MoleBrainInst extends BrainInst {
  /** ACTIONS.MAKEMOLEHILL's SpawnPrefab("molehill"), through the moles' world. */
  makeHome(): boolean;
  readonly sg?: { hasStateTag(tag: string): boolean };
  /** inst.components.inventory, whose IsFull the brain tests. */
  readonly components: BrainComponents & { inventory?: { IsFull(): boolean } };
  /** homeseeker.home: the molehill. */
  readonly home: BrainEntity | undefined;
  readonly needs_home_time: number | undefined;
  readonly make_home_delay: number;
  readonly last_above_time: number;
  readonly peek_interval: number;
  readonly flee: boolean;
  readonly bornAt: number;
  readonly world: BrainInst['world'] & { readonly isAcidRaining?: boolean };
}
/** SelectedTargetTimeout */
function SelectedTargetTimeout(target: MoleBaitTarget): void { target.selectedasmoletarget = undefined; }
/** target:IsOnValidGround(), as the moles' map answers it. */
function IsOnValidGround(inst: MoleBrainInst, target: BrainEntity): boolean {
  const { x, y, z } = target.getPosition();
  return inst.world.isAboveGroundAtPoint(x, y, z);
}

const isFull = (inst: MoleBrainInst) => inst.components.inventory?.IsFull() ?? false;

/** MakeNewHomeAction's FindWalkableOffset(pos, random angle, math.random(5, 15), 120): the first walkable point around. */
function FindWalkableOffset(inst: MoleBrainInst, unit: number): Vector3 | undefined {
  const position = inst.getPosition(), start = inst.random() * Math.PI * 2, radius = (5 + Math.floor(inst.random() * 11)) * unit;
  for (let i = 0; i < 120; i++) {
    const angle = start + i * Math.PI * 2 / 120;
    const x = position.x + Math.cos(angle) * radius, z = position.z - Math.sin(angle) * radius;
    if (inst.world.isAboveGroundAtPoint(x, position.y, z)) return new Vector3(x, position.y, z);
  }
  return undefined;
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
    const gohome = () => inst.home?.isValid() && !inst.sg?.hasStateTag('trapped')
      ? CreateBufferedAction(inst, inst.home, 'GOHOME', undefined, unit) : undefined;
    const makehome = () => {
      const pos = FindWalkableOffset(inst, unit);
      return pos ? MakeMoleHillAction(inst, pos, unit) : undefined;
    };
    const takebait = () => {
      if (inst.getTime() - inst.bornAt < 3 || inst.sg?.hasStateTag('busy') || shouldMakeMoleHome(inst) || isFull(inst)) return;
      const target = inst.world.findEntity(inst, 20 * unit, IsMoleBait, ['molebait'], ['outofreach', 'INLIMBO', 'fire']);
      // Source checks the mark after FindEntity, rather than searching for the next bait.
      if (target && IsMoleBait(target) && !target.selectedasmoletarget && IsOnValidGround(inst, target)) {
        target.selectedasmoletarget = true;
        target.DoTaskInTime(5, () => SelectedTargetTimeout(target));
        return StealMoleBaitAction(inst, target, unit);
      }
      return;
    };
    this.bt = new BT(inst, new PriorityNode([
      PanicTrigger(inst), ElectricFencePanicTrigger(inst),
      WhileNode(() => shouldMakeMoleHome(inst), 'Home Dug Up', new DoAction(inst, makehome, 'Make Home', false)),
      WhileNode(() => inst.flee, 'Flee', new RunAway(inst, 'scarytoprey', 0, 6 * unit)),
      WhileNode(() => !!inst.world.isAcidRaining, 'Acid Raining', new DoAction(inst, gohome, 'Go Home', false)),
      WhileNode(() => !inst.sg?.hasStateTag('busy') && inst.getTime() > inst.last_above_time + inst.peek_interval,
        'Should Peek', new DoAction(inst, () => MolePeekAction(inst), 'Do Peek', false)),
      WhileNode(() => isFull(inst), 'Deposit Inventory', new DoAction(inst, gohome, 'Go Home', false)),
      new EventNode(inst, 'gohome', new DoAction(inst, gohome, 'Go Home', false)),
      new DoAction(inst, takebait, 'Take Bait', false),
      WhileNode(() => inst.world.isDay, 'Is Day', new DoAction(inst, gohome, 'Go Home', false)),
      new Wander(inst, () => inst.components.knownlocations?.GetLocation('home'), 20 * unit),
    ], .25));
  }
}

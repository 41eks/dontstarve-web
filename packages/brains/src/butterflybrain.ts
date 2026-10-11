import { BT, IfNode, PriorityNode } from './behaviourtree';
import { Brain } from './brain';
import { ElectricFencePanicTrigger, PanicTrigger } from './braincommon';
import { CreateBufferedAction } from './bufferedaction';
import { DoAction } from './behaviours/doaction';
import { FindFlower } from './behaviours/findflower';
import { RunAway } from './behaviours/runaway';
import { Wander } from './behaviours/wander';
import type { BrainEntity, BrainInst, Vec3 } from './types';

const RUN_AWAY_DIST = 5;
const STOP_RUN_AWAY_DIST = 10;
const SEE_FLOWER_DIST = 30;
const MAX_WANDER_DIST = 20;

const FLOWER_TAGS = ['flower'];

function NearestFlowerPos(inst: BrainInst): Vec3 | undefined {
  const flower = inst.world.getClosestInstWithTag(FLOWER_TAGS, inst, SEE_FLOWER_DIST);
  if (flower?.isValid()) return { ...flower.getPosition() };
  return undefined;
}

function GoHomeAction(inst: BrainInst) {
  const flower = inst.world.getClosestInstWithTag(FLOWER_TAGS, inst, SEE_FLOWER_DIST);
  if (flower?.isValid()) return CreateBufferedAction(inst, flower, 'GOHOME', { ...flower.getPosition() });
  return undefined;
}

export const RUN_AWAY_PARAMS = {
  tags: ['scarytoprey'],
  fn: (guy: BrainEntity) => !guy.components.skilltreeupdater?.IsActivated('wormwood_bugs'),
};

/** brains/butterflybrain.lua */
export class ButterflyBrain extends Brain {
  protected override OnStart(): void {
    const inst = this.inst;
    const root = new PriorityNode([
      PanicTrigger(inst),
      ElectricFencePanicTrigger(inst),
      new RunAway(inst, RUN_AWAY_PARAMS, RUN_AWAY_DIST, STOP_RUN_AWAY_DIST),
      IfNode(() => !inst.world.isDay, 'IsNight', new DoAction(inst, GoHomeAction, 'go home', true)),
      IfNode(() => !!inst.components.pollinator?.HasCollectedEnough(), 'IsFullOfPollen',
        new DoAction(inst, GoHomeAction, 'go home', true)),
      new FindFlower(inst),
      new Wander(inst, NearestFlowerPos, MAX_WANDER_DIST),
    ], 1);
    this.bt = new BT(inst, root);
  }
}

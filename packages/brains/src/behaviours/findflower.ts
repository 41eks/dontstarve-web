import { BehaviourNode, FAILED, READY, RUNNING } from '../behaviourtree';
import { CreateBufferedAction } from '../bufferedaction';
import type { BrainEntity, BrainInst } from '../types';

const SEE_DIST = 30;
const FINDFLOWER_MUST_TAGS = ['pollinator'];
const FLOWER_TAGS = ['flower'];

/** behaviours/findflower.lua: pick the closest flower nobody else is heading to and go pollinate it. */
export class FindFlower extends BehaviourNode {
  private readonly inst: BrainInst;
  private readonly shouldrun?: boolean;

  constructor(inst: BrainInst) {
    super('FindFlower');
    this.inst = inst;
  }

  override DBString(): string { return `Go to flower ${this.inst.components.pollinator?.target?.prefab}`; }

  private isTargetedByOther(flower: BrainEntity): boolean {
    return this.inst.world.findEntity(flower, 2,
      guy => guy !== this.inst && guy.components.pollinator?.target === flower, FINDFLOWER_MUST_TAGS) !== undefined;
  }

  override Visit(): void {
    const pollinator = this.inst.components.pollinator!;
    if (this.status === READY) {
      this.PickTarget();
      if (pollinator.target) {
        // BufferedAction(inst, target, POLLINATE, nil, nil, nil, 0.1)
        const action = CreateBufferedAction(this.inst, pollinator.target, 'POLLINATE', undefined, 0.1);
        this.inst.components.locomotor!.PushAction(action, this.shouldrun);
        this.status = RUNNING;
      } else this.status = FAILED;
    }
    if (this.status === RUNNING) {
      const target = pollinator.target;
      if (!target || !pollinator.CanPollinate(target) || this.isTargetedByOther(target)) this.status = FAILED;
    }
  }

  PickTarget(): void {
    const pollinator = this.inst.components.pollinator;
    const closestFlower = this.inst.world.getClosestInstWithTag(FLOWER_TAGS, this.inst, SEE_DIST);
    if (pollinator) {
      pollinator.target = closestFlower && pollinator.CanPollinate(closestFlower) && !this.isTargetedByOther(closestFlower)
        ? closestFlower : undefined;
    }
  }
}

import type { Vector3 } from 'three';
import type { LocoMotor } from '../../../componets/src/locomotor';
import { BehaviourNode, FAILED, READY, RUNNING, SUCCESS } from '../behaviourtree';

interface Target {
  isValid(): boolean;
  hasTag(tag: string): boolean;
  getPosition(): Vector3;
}

/** behaviours/findclosest.lua: keep the nearest matching target until its tags change or the search is due. */
export class FindClosest<T extends Target> extends BehaviourNode {
  private readonly inst: Target & { readonly components: { locomotor: LocoMotor } };
  private readonly find: () => readonly T[];
  private readonly safeDistance: (target: T) => number;
  private readonly tags: readonly string[];
  private readonly oneOf: readonly string[];
  private target?: T;
  private lastCheckTime = 0;

  constructor(
    inst: Target & { readonly components: { locomotor: LocoMotor } },
    find: () => readonly T[],
    safeDistance: (target: T) => number,
    tags: readonly string[],
    oneOf: readonly string[],
  ) {
    super('FindClosest');
    this.oneOf = oneOf;
    this.tags = tags;
    this.safeDistance = safeDistance;
    this.find = find;
    this.inst = inst;
  }

  override Visit(): void {
    if (this.status === READY || this.now - this.lastCheckTime > 5) {
      this.target = this.find().find(target => this.inst !== (target as Target));
      this.lastCheckTime = this.now;
    } else {
      const target = this.target;
      if (target && !(this.tags.every(tag => target.hasTag(tag)) && this.oneOf.some(tag => target.hasTag(tag)))) {
        this.target = undefined;
      }
    }

    const target = this.target;
    if (!target?.isValid()) {
      this.status = FAILED;
      return;
    }
    const safeDistance = this.safeDistance(target);
    const from = this.inst.getPosition();
    const to = target.getPosition();
    if (from.distanceToSquared(to) < safeDistance * safeDistance) {
      this.status = SUCCESS;
      this.inst.components.locomotor.Stop();
    } else {
      this.status = RUNNING;
      const destination = from
        .clone()
        .sub(to)
        .setLength(safeDistance * 0.98)
        .add(to);
      this.inst.components.locomotor.GoToPoint(destination, undefined, true);
    }
  }
}

import { BehaviourNode, FAILED, READY, RUNNING, SUCCESS } from '../behaviourtree';
import { DEGREES, FindWalkableOffset, distsq } from '../simutil';
import type { BrainEntity, BrainInst } from '../types';

export interface RunAwayHunterParams {
  /** Returns the hunter directly. */
  getfn?: (inst: BrainInst) => BrainEntity | undefined;
  fn?: (guy: BrainEntity, inst: BrainInst) => boolean;
  tags?: readonly string[];
  notags?: readonly string[];
  oneoftags?: readonly string[];
  seeequipped?: boolean;
}

/**
 * behaviours/runaway.lua. Not ported: safe_point_fn, runhome/homeseeker, aquatic movement and
 * fix_overhang, none of which the butterfly brains use.
 */
export class RunAway extends BehaviourNode {
  private readonly inst: BrainInst;
  private readonly safe_dist: number;
  private readonly see_dist: number;
  private readonly gethunterfn?: RunAwayHunterParams['getfn'];
  private readonly hunterfn?: RunAwayHunterParams['fn'];
  private readonly huntertags?: readonly string[];
  private readonly hunternotags?: readonly string[];
  private readonly hunteroneoftags?: readonly string[];
  private readonly shouldrunfn?: (hunter: BrainEntity, inst: BrainInst) => boolean;
  private readonly walk_instead?: boolean;
  private hunter?: BrainEntity;
  private avoid_time?: number;
  private avoid_angle?: number;

  constructor(inst: BrainInst, hunterparams: string | RunAwayHunterParams | RunAwayHunterParams['fn'], see_dist: number,
    safe_dist: number, fn?: RunAway['shouldrunfn'], walk_instead?: boolean) {
    super('RunAway');
    this.safe_dist = safe_dist;
    this.see_dist = see_dist;
    if (typeof hunterparams === 'string') {
      this.huntertags = [hunterparams];
      this.hunternotags = ['NOCLICK'];
    } else if (typeof hunterparams === 'object') {
      this.gethunterfn = hunterparams.getfn;
      this.hunterfn = hunterparams.fn;
      this.huntertags = hunterparams.tags;
      this.hunternotags = hunterparams.notags;
      this.hunteroneoftags = hunterparams.oneoftags;
    } else this.hunterfn = hunterparams;
    this.inst = inst;
    this.shouldrunfn = fn;
    this.walk_instead = walk_instead;
  }

  override DBString(): string { return `RUNAWAY ${this.safe_dist} from: ${this.hunter?.prefab}`; }

  /** Degrees; falls back to the straight away-direction when every deflected fan angle is blocked. */
  GetRunAngle(pt: { x: number; y: number; z: number }, hp: { x: number; y: number; z: number }): number {
    if (this.avoid_angle !== undefined) {
      if (this.now - this.avoid_time! < 1) return this.avoid_angle;
      this.avoid_time = undefined;
      this.avoid_angle = undefined;
    }
    let angle = this.inst.getAngleToPoint(hp.x, hp.y, hp.z) + 180;
    if (angle > 360) angle -= 360;
    const result = FindWalkableOffset(this.inst.world, pt, angle * DEGREES, 6, 8);
    if (!result) return angle; // ok whatever, just run
    const resultAngle = result.angle / DEGREES;
    if (result.deflected) {
      this.avoid_time = this.now;
      this.avoid_angle = resultAngle;
    }
    return resultAngle;
  }

  override Visit(): void {
    const locomotor = this.inst.components.locomotor!;
    if (this.status === READY) {
      this.hunter = this.gethunterfn
        ? this.gethunterfn(this.inst)
        : this.inst.world.findEntity(this.inst, this.see_dist, this.hunterfn && ((guy, from) => this.hunterfn!(guy, from as BrainInst)), this.huntertags, this.hunternotags, this.hunteroneoftags);
      if (this.gethunterfn && this.hunter && !(this.hunter.isValid() && this.inst.isNear(this.hunter, this.see_dist))) this.hunter = undefined;
      if (this.hunter && this.shouldrunfn && !this.shouldrunfn(this.hunter, this.inst)) this.hunter = undefined;
      this.status = this.hunter ? RUNNING : FAILED;
    }
    if (this.status === RUNNING) {
      if (!this.hunter || !this.hunter.isValid()) {
        this.status = FAILED;
        locomotor.Stop();
      } else {
        const pt = this.inst.getPosition(), hp = this.hunter.getPosition();
        const angle = this.GetRunAngle(pt, hp);
        if (this.walk_instead) {
          locomotor.dest = undefined;
          locomotor.WalkInDirection(angle);
        } else locomotor.RunInDirection(angle);
        if (distsq(hp, pt) > this.safe_dist * this.safe_dist) {
          this.status = SUCCESS;
          locomotor.Stop();
        }
        this.Sleep(.25);
      }
    }
  }
}

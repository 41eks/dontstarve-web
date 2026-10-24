import { BehaviourNode, READY, RUNNING } from '../behaviourtree';
import { DEGREES, FindWalkableOffset, FunctionOrValue, PI2, distsq } from '../simutil';
import type { BrainInst, Vec3 } from '../types';

export interface WanderTimes { minwalktime?: number; randwalktime?: number; minwaittime?: number; randwaittime?: number }
export interface WanderData { wander_dist?: number | ((inst: BrainInst) => number); offest_attempts?: number; should_run?: boolean | ((inst: BrainInst) => boolean); leashwhengoinghome?: boolean }

/**
 * behaviours/wander.lua. `homelocation` is a position or a function returning one (undefined = no leash),
 * `max_dist` the leash length. Not ported: ignore_walls (no wall line of sight), checkpointFn,
 * aquatic movement and skipHoldWhenFarFromHome.
 */
export class Wander extends BehaviourNode {
  private readonly inst: BrainInst;
  private readonly homepos?: Vec3 | ((inst: BrainInst) => Vec3 | undefined);
  private readonly maxdist: number | ((inst: BrainInst) => number);
  private readonly getdirectionFn?: (inst: BrainInst) => number | undefined;
  private readonly setdirectionFn?: (inst: BrainInst, angle: number) => void;
  private readonly wander_dist: number | ((inst: BrainInst) => number);
  private readonly offest_attempts: number;
  private readonly should_run?: boolean | ((inst: BrainInst) => boolean);
  private readonly leashwhengoinghome?: boolean;
  private readonly times: Required<WanderTimes> & { no_wait_time?: boolean };
  private far_from_home = false;
  private walking = false;
  private waittime = 0;

  constructor(inst: BrainInst, homelocation: Wander['homepos'], max_dist: Wander['maxdist'], times?: WanderTimes,
    getdirectionFn?: Wander['getdirectionFn'], setdirectionFn?: Wander['setdirectionFn'], data?: WanderData) {
    super('Wander');
    this.homepos = homelocation;
    this.maxdist = max_dist;
    this.inst = inst;
    this.getdirectionFn = getdirectionFn;
    this.setdirectionFn = setdirectionFn;
    this.wander_dist = data?.wander_dist ?? 12;
    this.offest_attempts = data?.offest_attempts ?? 8;
    this.should_run = data?.should_run;
    this.leashwhengoinghome = data?.leashwhengoinghome;
    this.times = {
      minwalktime: times?.minwalktime ?? 2,
      randwalktime: times?.randwalktime ?? 3,
      minwaittime: times?.minwaittime ?? 1,
      randwaittime: times?.randwaittime ?? 3,
    };
    if (this.times.minwaittime <= 0 && this.times.randwaittime <= 0) this.times.no_wait_time = true;
  }

  override Visit(): void {
    const locomotor = this.inst.components.locomotor!;
    if (this.status === READY) {
      locomotor.Stop();
      this.Wait(this.times.minwaittime + this.context.random() * this.times.randwaittime);
      this.walking = false;
      this.status = RUNNING;
    } else if (this.status === RUNNING) {
      if (!this.walking && this.IsFarFromHome()) this.PickNewDirection();
      if (this.now > this.waittime) {
        if (!this.walking || this.times.no_wait_time) this.PickNewDirection();
        else this.HoldPosition();
      } else if (!this.walking) this.Sleep(this.waittime - this.now);
      else if (!locomotor.WantsToMoveForward()) this.HoldPosition();
    }
  }

  override DBString(): string {
    const home = this.GetHomePos();
    return `${this.walking ? 'walk' : 'wait'} for ${(this.waittime - this.now).toFixed(2)}, ${home ? `${home.x},${home.z}` : 'false'}, ${
      Math.sqrt(this.GetDistFromHomeSq() ?? 0).toFixed(2)}, ${this.far_from_home ? 'Go Home' : 'Go Wherever'}`;
  }

  GetHomePos(): Vec3 | undefined { return FunctionOrValue(this.homepos, this.inst); }

  GetDistFromHomeSq(): number | undefined {
    const home = this.GetHomePos();
    return home ? distsq(home, this.inst.getPosition()) : undefined;
  }

  IsFarFromHome(): boolean {
    const homedistsq = this.GetDistFromHomeSq();
    return homedistsq !== undefined && homedistsq > this.GetMaxDistSq();
  }

  GetMaxDistSq(): number {
    const dist = FunctionOrValue(this.maxdist, this.inst);
    return dist * dist;
  }

  Wait(t: number): void {
    this.waittime = t + this.now;
    this.Sleep(t);
  }

  PickNewDirection(): void {
    const locomotor = this.inst.components.locomotor!;
    this.far_from_home = this.IsFarFromHome();
    this.walking = true;
    if (this.far_from_home) locomotor.GoToPoint(this.GetHomePos()!);
    else {
      const pt = this.inst.getPosition();
      let angle = this.getdirectionFn?.(this.inst);
      if (angle === undefined) {
        angle = this.context.random() * PI2;
        this.setdirectionFn?.(this.inst, angle);
      }
      const radius = FunctionOrValue(this.wander_dist, this.inst);
      const found = FindWalkableOffset(this.inst.world, pt, angle, radius, this.offest_attempts);
      if (found) {
        angle = found.angle;
        this.setdirectionFn?.(this.inst, angle);
      }
      const run = FunctionOrValue(this.should_run ?? false, this.inst);
      if (found) locomotor.GoToPoint({ x: pt.x + found.offset.x, y: pt.y + found.offset.y, z: pt.z + found.offset.z }, undefined, run);
      else locomotor.WalkInDirection(angle / DEGREES, run);
    }
    if (!this.leashwhengoinghome || !this.far_from_home) {
      this.Wait(this.times.minwalktime + this.context.random() * this.times.randwalktime);
    }
  }

  HoldPosition(): void {
    this.walking = false;
    this.inst.components.locomotor!.Stop();
    this.Wait(this.times.minwaittime + this.context.random() * this.times.randwaittime);
  }
}

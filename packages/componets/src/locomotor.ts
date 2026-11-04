import type { BufferedAction, BufferedActionObject } from '../../stategraphs/src/bufferedaction';

export interface LocoMotorPoint { x: number; y: number; z: number }

/** An entity a buffered action can walk to. */
export interface LocoMotorTarget extends BufferedActionObject {
  isValid(): boolean;
  getPosition(): LocoMotorPoint;
  getPhysicsRadius(fallback: number): number;
}

/** What components/locomotor.lua reads from and writes to its entity, its stategraph and its physics. */
export interface LocoMotorInst {
  isValid(): boolean;
  getPosition(): LocoMotorPoint;
  getPhysicsRadius(fallback: number): number;
  /** Transform:GetRotation in degrees; forward is (cos, -sin). */
  setRotation(degrees: number): void;
  getAngleToPoint(x: number, y: number, z: number): number;
  /** Physics:SetMotorVel / Physics:Stop: the entity moves forward at this speed. */
  setMotorSpeed(speed: number): void;
  readonly sg?: { hasStateTag(tag: string): boolean };
  readonly bufferedaction?: BufferedAction;
  readonly components: { health?: { IsDead?(): boolean } };
  PushEvent(name: string, data?: unknown): void;
  PushBufferedAction(action: BufferedAction): void;
}

// components/locomotor.lua constants and defaults (TUNING.WILSON_WALK_SPEED / WILSON_RUN_SPEED).
export const ARRIVE_STEP = .15;
export const DEFAULT_WALK_SPEED = 4;
export const DEFAULT_RUN_SPEED = 6;

class Dest {
  private readonly target?: LocoMotorTarget;
  private readonly point?: LocoMotorPoint;
  constructor(target?: LocoMotorTarget, point?: LocoMotorPoint) {
    this.target = target;
    this.point = point;
  }
  isValid(): boolean { return this.target ? this.target.isValid() : this.point !== undefined; }
  getPoint(): LocoMotorPoint { return this.target ? this.target.getPosition() : this.point!; }
}

const distanceSquared = (a: LocoMotorPoint, b: LocoMotorPoint) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

/** locomotor.pathcaps. `ignorecreep`, `ignorebridges` and `player` have nothing to change here yet. */
export interface PathCaps {
  readonly ignorewalls?: boolean;
  readonly ignorecreep?: boolean;
  readonly ignorebridges?: boolean;
  readonly allowocean?: boolean;
  readonly ignoreLand?: boolean;
  readonly player?: boolean;
}

/** What locomotor.lua calls on TheWorld.Pathfinder. */
export interface LocoMotorPathfinder {
  GetPathTileIndexFromPoint(point: LocoMotorPoint): [x: number, z: number];
  IsClear(from: LocoMotorPoint, to: LocoMotorPoint, caps?: PathCaps): boolean;
  SubmitSearch(from: LocoMotorPoint, to: LocoMotorPoint, caps?: PathCaps): number;
  GetSearchStatus(handle: number): number | undefined;
  GetSearchResult(handle: number): { readonly steps: readonly LocoMotorPoint[] } | undefined;
  KillSearch(handle: number): void;
}

export interface LocoMotorOptions {
  arriveDistance?: number;
  /** TheWorld.Pathfinder and locomotor.pathcaps; without one a creature approaches directly. */
  pathfinder?: LocoMotorPathfinder;
  pathcaps?: PathCaps;
}

const STATUS_CALCULATING = 0;
const STATUS_FOUNDPATH = 1;

/** locomotor.lua's self.path and lastdesttile, with FindPath and the parts of OnUpdate that read them. */
export class LocoMotorPath {
  private readonly pathfinder: LocoMotorPathfinder;
  private readonly pathcaps?: PathCaps;
  private handle?: number;
  private steps?: readonly LocoMotorPoint[];
  private currentstep = 0;
  private lastdesttile?: [x: number, z: number];
  private readonly arriveStep: number;

  /** `arriveStep` is arrive_step_dist in the caller's units. */
  constructor(pathfinder: LocoMotorPathfinder, pathcaps: PathCaps | undefined, arriveStep: number) {
    this.pathfinder = pathfinder; this.pathcaps = pathcaps; this.arriveStep = arriveStep;
  }

  WaitingForPathSearch(): boolean { return this.handle !== undefined; }

  ResetPath(): void {
    if (this.handle !== undefined) this.pathfinder.KillSearch(this.handle);
    this.handle = undefined;
    this.steps = undefined;
  }

  /** LocoMotor:Stop's part: the next destination searches even within the same path tile. */
  Stop(): void {
    this.ResetPath();
    this.lastdesttile = undefined;
  }

  FindPath(from: LocoMotorPoint, to: LocoMotorPoint): void {
    const desttile = this.pathfinder.GetPathTileIndexFromPoint(to);
    if (this.lastdesttile && desttile[0] === this.lastdesttile[0] && desttile[1] === this.lastdesttile[1]) return;
    this.lastdesttile = desttile;
    if (this.pathfinder.IsClear(from, to, this.pathcaps)) { this.ResetPath(); return; }
    // While chasing, keep any path until the new one arrives, and let a first search finish.
    if (this.steps || !this.WaitingForPathSearch()) {
      if (this.handle !== undefined) this.pathfinder.KillSearch(this.handle);
      this.handle = this.pathfinder.SubmitSearch(from, to, this.pathcaps);
    }
  }

  /** OnUpdate: take a finished search's path. A straight line of two steps is discarded, and with no path the old one stands. */
  UpdateSearch(): void {
    if (this.handle === undefined) return;
    const status = this.pathfinder.GetSearchStatus(this.handle);
    if (status === STATUS_CALCULATING) return;
    if (status === STATUS_FOUNDPATH) {
      const steps = this.pathfinder.GetSearchResult(this.handle)?.steps;
      if (steps) {
        this.steps = steps.length > 2 ? steps : undefined;
        this.currentstep = 1;
      }
    }
    this.pathfinder.KillSearch(this.handle);
    this.handle = undefined;
  }

  /** OnUpdate's FOLLOW PATH: where to head now. The last step is the destination itself, wherever it has moved. */
  GetMoveStep(position: LocoMotorPoint, destination: LocoMotorPoint, physicsRadius: number): LocoMotorPoint {
    const { steps } = this;
    if (!steps || this.currentstep >= steps.length - 1) return destination;
    const step = steps[this.currentstep];
    // Add tolerance to step points that aren't the final destination.
    if (distanceSquared(position, step) - (physicsRadius * 2) ** 2 > this.arriveStep ** 2) return step;
    this.currentstep += 1;
    return this.currentstep < steps.length - 1 ? steps[this.currentstep] : destination;
  }

  /** The engine's physics keeps a creature on the ground; here its next stretch has to stay on ground it can path on. */
  IsGroundAhead(position: LocoMotorPoint, ahead: LocoMotorPoint): boolean {
    return this.pathfinder.IsClear(position, ahead, { ...this.pathcaps, ignorewalls: true });
  }
}

/**
 * components/locomotor.lua: the stategraph starts the motor, while destinations retain movement
 * intent across StopMoving. Hosts may inject ground paths; flying creatures approach directly.
 */
export class LocoMotor {
  /** locomotor.lua: formation followers drive the motor directly instead of finding paths. */
  directdrive = false;
  walkspeed = DEFAULT_WALK_SPEED;
  runspeed = DEFAULT_RUN_SPEED;
  dest?: Dest;
  bufferedaction?: BufferedAction;
  private atdestfn?: (inst: LocoMotorInst) => void;
  private wantstomoveforward = false;
  private wantstorun = false;
  private isrunning = false;
  private arrive_dist = ARRIVE_STEP;
  private updating = false;
  private readonly inst: LocoMotorInst;
  private readonly options: LocoMotorOptions;
  private readonly pathing?: LocoMotorPath;
  /** Where the motor is heading this update. */
  private movePoint?: LocoMotorPoint;

  constructor(inst: LocoMotorInst, options: LocoMotorOptions = {}) {
    this.inst = inst; this.options = options;
    this.arrive_dist = options.arriveDistance ?? ARRIVE_STEP;
    this.pathing = options.pathfinder && new LocoMotorPath(options.pathfinder, options.pathcaps, this.arrive_dist);
  }

  get isUpdating(): boolean { return this.updating; }
  GetWalkSpeed(): number { return this.walkspeed; }
  GetRunSpeed(): number { return this.runspeed; }
  /** Creatures here are terrestrial or flying and never pathfind on water. */
  IsAquatic(): boolean { return false; }
  CanPathfindOnWater(): boolean { return false; }
  SetReachDestinationCallback(fn: ((inst: LocoMotorInst) => void) | undefined): void { this.atdestfn = fn; }
  WantsToRun(): boolean { return this.wantstorun; }
  WantsToMoveForward(): boolean { return this.wantstomoveforward; }
  HasDestination(): boolean { return this.dest !== undefined; }

  WalkForward(direct = false): void {
    this.isrunning = false;
    if (direct) this.wantstomoveforward = true;
    this.inst.setMotorSpeed(this.GetWalkSpeed());
    this.updating = true;
  }

  /** LocoMotor:StopMoving only stops the motor; the brain's destination and movement intent survive. */
  StopMoving(): void {
    this.isrunning = false;
    this.inst.setMotorSpeed(0);
  }

  RunForward(direct = false): void {
    this.isrunning = true;
    if (direct) this.wantstomoveforward = true;
    this.inst.setMotorSpeed(this.GetRunSpeed());
    this.updating = true;
  }

  Clear(): void {
    this.dest = undefined;
    this.pathing?.ResetPath();
    this.atdestfn = undefined;
    this.wantstomoveforward = false;
    this.wantstorun = false;
    this.SetBufferedAction(undefined);
  }

  SetBufferedAction(action: BufferedAction | undefined): void {
    this.bufferedaction?.fail();
    this.bufferedaction = action;
  }

  FaceMovePoint(x: number, y: number, z: number): void {
    this.inst.setRotation(this.inst.getAngleToPoint(x, y, z));
  }

  SetMoveDir(direction: number): void { this.inst.setRotation(direction); }

  PushAction(action: BufferedAction | undefined, run = false): void {
    if (!action) return;
    if (!action.isValid()) {
      this.inst.PushEvent('actionfailed', { action, reason: undefined });
      return;
    }
    this.Clear();
    const target = action.target as LocoMotorTarget | undefined;
    if (target) {
      if (action.distance !== undefined && action.distance >= Infinity) {
        // essentially instant
        const { x, y, z } = target.getPosition();
        this.FaceMovePoint(x, y, z);
        this.inst.PushBufferedAction(action);
      } else this.GoToEntity(target, action, run);
    } else if (!action.pos) this.inst.PushBufferedAction(action);
    else if (action.distance !== undefined && action.distance >= Infinity) {
      this.FaceMovePoint(action.pos.x, action.pos.y, action.pos.z);
      this.inst.PushBufferedAction(action);
    } else this.GoToPoint(undefined, action, run);
  }

  GoToEntity(target: LocoMotorTarget, action?: BufferedAction, run = false): void {
    this.dest = new Dest(target);
    this.SetBufferedAction(action);
    this.wantstomoveforward = true;
    if (action?.arrivedist !== undefined) this.arrive_dist = action.arrivedist;
    else if (action?.distance !== undefined) {
      // NOTE: the physical radii are the fallback if the action's distance is too small.
      this.arrive_dist = Math.max(ARRIVE_STEP + target.getPhysicsRadius(0) + this.inst.getPhysicsRadius(0), action.distance);
    } else this.arrive_dist = ARRIVE_STEP + target.getPhysicsRadius(0) + this.inst.getPhysicsRadius(0);
    this.wantstorun = run;
    this.updating = true;
    if (this.directdrive) { if (run) this.RunForward(); else this.WalkForward(); }
    else this.pathing?.FindPath(this.inst.getPosition(), target.getPosition());
    // Try an instant arrive check if we're not moving.
    if (!this.inst.sg?.hasStateTag('moving')) this.update(0, true);
  }

  GoToPoint(point?: LocoMotorPoint, action?: BufferedAction, run = false): void {
    const destination = point ?? action?.pos;
    if (!destination) throw new Error('GoToPoint requires a point or an action position');
    this.dest = new Dest(undefined, { ...destination });
    const arriveDistance = this.options.arriveDistance ?? ARRIVE_STEP;
    this.arrive_dist = action ? action.arrivedist ?? action.distance ?? arriveDistance : arriveDistance;
    this.wantstorun = run;
    this.wantstomoveforward = true;
    this.SetBufferedAction(action);
    this.updating = true;
    if (this.directdrive) { if (run) this.RunForward(); else this.WalkForward(); }
    else this.pathing?.FindPath(this.inst.getPosition(), destination);
    if (!this.inst.sg?.hasStateTag('moving')) this.update(0, true);
  }

  Stop(): void {
    this.isrunning = false;
    this.dest = undefined;
    this.pathing?.Stop();
    this.wantstomoveforward = false;
    this.wantstorun = false;
    this.inst.setMotorSpeed(0);
    this.inst.PushEvent('locomote');
    this.updating = false;
  }

  WalkInDirection(direction: number, shouldRun = false): void {
    this.SetBufferedAction(undefined);
    this.dest = undefined;
    this.pathing?.Stop();
    if (!this.inst.sg || this.inst.sg.hasStateTag('canrotate')) this.SetMoveDir(direction);
    this.wantstomoveforward = true;
    this.wantstorun = shouldRun;
    if (this.directdrive) { if (shouldRun) this.RunForward(); else this.WalkForward(); }
    this.inst.PushEvent('locomote');
    this.updating = true;
  }

  RunInDirection(direction: number): void { this.WalkInDirection(direction, true); }

  /** LocoMotor:OnUpdate; `arriveCheckOnly` is the instant check made when a destination is set. */
  update(dt: number, arriveCheckOnly = false): void {
    if (!this.inst.isValid()) {
      this.pathing?.ResetPath();
      this.updating = false;
      return;
    }
    const sg = this.inst.sg;
    if (this.dest) {
      if (!this.dest.isValid() || (this.bufferedaction && !this.bufferedaction.isValid())) {
        this.Clear();
        return;
      }
      if (this.inst.components.health?.IsDead?.()) {
        this.Clear();
        return;
      }
      const destination = this.dest.getPoint(), position = this.inst.getPosition();
      let arriveDistanceSquared = this.arrive_dist * this.arrive_dist;
      if (dt > 0) {
        const runDistance = this.GetRunSpeed() * dt * .5;
        arriveDistanceSquared = Math.max(arriveDistanceSquared, runDistance * runDistance);
      }
      if (distanceSquared(destination, position) <= arriveDistanceSquared) {
        this.inst.PushEvent('onreachdestination', { pos: { ...destination } });
        this.atdestfn?.(this.inst);
        if (this.bufferedaction && this.bufferedaction !== this.inst.bufferedaction) {
          const target = this.bufferedaction.target as LocoMotorTarget | undefined;
          if (target) {
            const { x, y, z } = target.getPosition();
            this.FaceMovePoint(x, y, z);
          }
          const action = this.bufferedaction;
          this.bufferedaction = undefined; // so it doesn't get failed at Clear()
          this.inst.PushBufferedAction(action);
        }
        this.Stop();
        this.Clear();
        return;
      }
      if (!arriveCheckOnly) {
        this.pathing?.UpdateSearch();
        const canrotate = !sg || sg.hasStateTag('canrotate');
        if (canrotate && !(sg?.hasStateTag('busy'))) {
          const point = this.pathing?.GetMoveStep(position, destination, this.inst.getPhysicsRadius(0)) ?? destination;
          this.movePoint = point;
          this.SetMoveDir(this.inst.getAngleToPoint(point.x, point.y, point.z));
        }
        this.wantstomoveforward = true;
      }
    }
    if (arriveCheckOnly) return;

    const isMoving = sg?.hasStateTag('moving') ?? false;
    const isRunning = sg?.hasStateTag('running') ?? false;
    const shouldLocomote = isMoving !== this.wantstomoveforward || (isMoving && isRunning !== this.wantstorun);
    if (shouldLocomote) this.inst.PushEvent('locomote');
    else if (!this.wantstomoveforward) this.updating = false;

    // locomote may have just entered walk_stop; never restart its stopped motor.
    if (sg?.hasStateTag('moving')) {
      let speed = this.isrunning ? this.GetRunSpeed() : this.GetWalkSpeed();
      if (this.dest?.isValid()) {
        const distanceToDestination = distanceSquared(this.dest.getPoint(), this.inst.getPosition());
        if (distanceToDestination <= .25) speed *= Math.max(.33, Math.sqrt(distanceToDestination));
        if (!this.isGroundAhead(speed * dt)) speed = 0;
      }
      this.inst.setMotorSpeed(speed);
    }
  }

  private isGroundAhead(distance: number): boolean {
    const point = this.movePoint;
    if (!this.pathing || !point) return true;
    const position = this.inst.getPosition();
    const length = Math.hypot(point.x - position.x, point.z - position.z);
    if (length === 0) return true;
    const reach = (distance + this.inst.getPhysicsRadius(0)) / length;
    return this.pathing.IsGroundAhead(position, { x: position.x + (point.x - position.x) * reach, y: position.y, z: position.z + (point.z - position.z) * reach });
  }
}

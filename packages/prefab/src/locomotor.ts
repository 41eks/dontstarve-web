import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import type { LocomotorAction } from '@dontstarve-web/stategraphs/actionContext';
import { LocoMotorPath, type LocoMotorPathfinder, type PathCaps } from '../../componets/src/locomotor';
import type { GroundCreep, GroundCreepEntityInst } from '../../componets/src/groundcreep';
import { TILE_SIZE, WORLD_SCALE } from './tile';

const OBSTACLE_CELL = 4;
const obstacleCell = (x: number, z: number) => Math.floor(x / OBSTACLE_CELL) * 0x10000 + Math.floor(z / OBSTACLE_CELL);

// A point check or a short clear segment scans the boxes; a path search buckets them after this many tests.
const LINEAR_TESTS = 16;

/**
 * Whether an XZ point lies within `margin` of a static collider. Cached AABBs are reused: Cannon and the
 * physics binding flag `aabbNeedsUpdate` whenever a body moves or changes shape.
 */
export function staticObstacleTest(bodies: Iterable<CANNON.Body>, margin: number): (point: THREE.Vector3) => boolean {
  const boxes: CANNON.AABB[] = [];
  for (const body of bodies) {
    if (
      body.type !== CANNON.Body.STATIC ||
      !body.collisionResponse ||
      !body.shapes.some(
        shape => shape instanceof CANNON.Box || shape instanceof CANNON.Sphere || shape instanceof CANNON.Trimesh,
      )
    ) {
      continue;
    }
    if (body.aabbNeedsUpdate) {
      body.updateAABB();
    }
    boxes.push(body.aabb);
  }
  const inside = (box: CANNON.AABB, point: THREE.Vector3) =>
    point.x >= box.lowerBound.x - margin &&
    point.x <= box.upperBound.x + margin &&
    point.z >= box.lowerBound.z - margin &&
    point.z <= box.upperBound.z + margin;
  let tests = 0;
  let cells: Map<number, CANNON.AABB[]> | undefined;
  const bucket = () => {
    const result = new Map<number, CANNON.AABB[]>();
    for (const box of boxes) {
      const x0 = Math.floor((box.lowerBound.x - margin) / OBSTACLE_CELL),
        x1 = Math.floor((box.upperBound.x + margin) / OBSTACLE_CELL);
      const z0 = Math.floor((box.lowerBound.z - margin) / OBSTACLE_CELL),
        z1 = Math.floor((box.upperBound.z + margin) / OBSTACLE_CELL);
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const key = x * 0x10000 + z;
          const cell = result.get(key);
          if (cell) {
            cell.push(box);
          } else {
            result.set(key, [box]);
          }
        }
      }
    }
    return result;
  };
  return point => {
    if (!cells && ++tests <= LINEAR_TESTS) {
      return boxes.some(box => inside(box, point));
    }
    cells ??= bucket();
    return cells.get(obstacleCell(point.x, point.z))?.some(box => inside(box, point)) ?? false;
  };
}

export interface LocomotorOptions {
  arriveDistance?: number;
  /** TheWorld.Pathfinder and locomotor.pathcaps; without one the body heads straight for its destination. */
  pathfinder?: LocoMotorPathfinder;
  pathcaps?: PathCaps;
  /** Ground-contact passability (land vs. ocean); blocked motion slides along the shore. */
  isPassable?: (x: number, z: number) => boolean;
  /** Leading-edge distance ahead of the body centre that must stay passable. */
  footprintRadius?: number;
  /** inst:GetPhysicsRadius(0) for GoToEntity's arrive distance; defaults to the footprint radius. */
  physicsRadius?: number;
}

/** locomotor.lua ARRIVE_STEP (0.15), in world units. */
export const ARRIVE_STEP = 0.15 * WORLD_SCALE;

interface PendingAction {
  readonly action: LocomotorAction;
  readonly arriveDistance: number;
  readonly arrive: () => void;
  readonly fail: () => void;
}

/** What the locomotor reads and drives of the entity's physics body: its position, and its horizontal velocity. */
export interface LocomotorBody {
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly velocity: { x: number; z: number };
}

/** What locomotor.lua reads and pushes on its inst while it walks on creep. */
export interface LocomotorCreepInst {
  hasTag(tag: string): boolean;
  PushEvent(name: string, data?: unknown): void;
}

/** The event data UpdateGroundSpeedMultiplier pushes as creepactivate and walkoncreep. */
export interface CreepActivateData {
  readonly target: LocomotorCreepInst;
  readonly spawners: readonly GroundCreepEntityInst[];
}

/** locomotor.lua's default slowmultiplier, the ground speed on creep. */
const CREEP_SLOW_MULTIPLIER = 0.6;

/** Owns movement destinations and horizontal physics velocity, like DST's locomotor. */
export class Locomotor {
  /** locomotor.lua triggerscreep: walking onto creep alerts its spawners and slows the walker. */
  triggerscreep = true;
  slowmultiplier = CREEP_SLOW_MULTIPLIER;
  /** locomotor.lua groundspeedmultiplier, part of GetSpeedMultiplier; UpdateGroundSpeedMultiplier sets it. */
  groundspeedmultiplier = 1;
  enablegroundspeedmultiplier = true;
  private wasoncreep = false;
  /** OnUpdate's lastpos: the tile the ground speed was last updated on. */
  private lastTile?: { readonly col: number; readonly row: number };
  private creep?: {
    readonly world: Pick<GroundCreep, 'OnCreep' | 'GetTriggeredCreepSpawners'>;
    readonly inst: LocomotorCreepInst;
  };
  private readonly body: LocomotorBody;
  private readonly arriveDistance: number;
  private readonly pathing?: LocoMotorPath;
  private readonly isPassable?: LocomotorOptions['isPassable'];
  private readonly footprintRadius: number;
  private readonly physicsRadius: number;
  private pending?: PendingAction;
  /** Dest(pt); a walked-to action's Dest(target) follows its target instead. */
  private point?: THREE.Vector3;
  private runningInDirection = false;
  private readonly runDirection = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();

  constructor(body: LocomotorBody, options: LocomotorOptions = {}) {
    this.body = body;
    this.arriveDistance = options.arriveDistance ?? 0.25;
    if (!Number.isFinite(this.arriveDistance) || this.arriveDistance <= 0) {
      throw new RangeError('Invalid arrival distance');
    }
    this.pathing = options.pathfinder && new LocoMotorPath(options.pathfinder, options.pathcaps, ARRIVE_STEP);
    this.isPassable = options.isPassable;
    this.footprintRadius = options.footprintRadius ?? 0;
    this.physicsRadius = options.physicsRadius ?? this.footprintRadius;
  }

  /** The BufferedAction the locomotor is walking towards, before the inst buffers it. */
  get bufferedAction(): LocomotorAction | undefined {
    return this.pending?.action;
  }

  /**
   * locomotor:PushAction for an entity target: GoToEntity with ARRIVE_STEP plus both physics radii (at least the
   * action's distance) as the arrive distance. On arrival `arrive` runs, the inst's PushBufferedAction; an
   * invalid action, a new destination, manual movement or Stop fails it instead.
   */
  PushAction(action: LocomotorAction, arrive: () => void, fail: () => void): void {
    this.stop();
    // distance raises the physical arrive distance; without one, mindistance does.
    const physical = ARRIVE_STEP + (action.target.getPhysicsRadius?.() ?? 0) + this.physicsRadius;
    const arriveDistance =
      action.distance !== undefined ? Math.max(physical, action.distance) : Math.max(physical, action.minDistance ?? 0);
    const pending: PendingAction = { action, arriveDistance, arrive, fail };
    this.pending = pending;
    if (!action.isValid()) {
      this.stop();
      return;
    }
    if (this.hasArrived(pending)) {
      this.arrive(pending);
      return;
    }
    this.pathing?.FindPath(this.body.position, action.target.getPosition());
  }

  /** locomotor:Clear: drop the destination and fail the walked-to action. */
  Clear(): void {
    this.stop();
  }

  /** OnUpdate's reached_dest: within the arrive distance, or half this frame's run distance when that is longer. */
  private hasArrived(pending: PendingAction, runDistance = 0): boolean {
    if (pending.action.arrived) {
      return pending.action.arrived();
    }
    const target = pending.action.target.getPosition();
    return (
      (target.x - this.body.position.x) ** 2 + (target.z - this.body.position.z) ** 2 <=
      Math.max(pending.arriveDistance, runDistance * 0.5) ** 2
    );
  }

  private arrive(pending: PendingAction): void {
    this.pending = undefined;
    this.stop();
    pending.arrive();
  }

  get destination(): THREE.Vector3 | undefined {
    return this.point?.clone() ?? this.pending?.action.target.getPosition().clone();
  }

  WantsToMoveForward(): boolean {
    return this.runningInDirection ? this.runDirection.lengthSq() > 0 : !!(this.point || this.pending);
  }

  get hasRunDirection(): boolean {
    return this.runningInDirection;
  }

  /** Directional input replaces the path once and can turn every frame without starting another search. */
  RunInDirection(direction: THREE.Vector3): void {
    if (!this.runningInDirection) {
      this.stop();
      this.runningInDirection = true;
    }
    this.runDirection.copy(direction);
  }

  /** Releasing a directional input leaves a later destination or buffered action intact. */
  StopRunningInDirection(): void {
    if (this.runningInDirection) {
      this.halt();
    }
  }

  /**
   * GoToPoint replaces any walked-to action. A point off the ground is refused: walking towards it would only
   * stop at the shore. FindPath's result arrives on a later update, and the body heads for the point until then.
   */
  goToPoint(target: THREE.Vector3): boolean {
    this.StopRunningInDirection();
    this.failPending();
    if (![target.x, target.y, target.z].every(Number.isFinite) || this.isPassable?.(target.x, target.z) === false) {
      this.halt();
      return false;
    }
    this.point = target.clone();
    this.pathing?.FindPath(this.body.position, target);
    return true;
  }

  stop(): void {
    this.failPending();
    this.halt();
  }

  /** LocoMotor:Stop keeps any walked-to action here for the caller to fail. */
  private halt(): void {
    this.runningInDirection = false;
    this.point = undefined;
    this.pathing?.Stop();
    this.body.velocity.x = 0;
    this.body.velocity.z = 0;
  }

  private failPending(): void {
    const pending = this.pending;
    this.pending = undefined;
    pending?.fail();
  }

  /** A supplied manual direction cancels automatic travel, even when opposite keys cancel out. */
  /** TheWorld.GroundCreep and the inst it walks, which UpdateGroundSpeedMultiplier reads; returns the unbind. */
  BindGroundCreep(
    world: Pick<GroundCreep, 'OnCreep' | 'GetTriggeredCreepSpawners'>,
    inst: LocomotorCreepInst,
  ): () => void {
    const creep = { world, inst };
    this.creep = creep;
    this.lastTile = undefined;
    return () => {
      if (this.creep === creep) {
        this.creep = undefined;
        this.wasoncreep = false;
        this.groundspeedmultiplier = 1;
      }
    };
  }

  /**
   * LocoMotor:UpdateGroundSpeedMultiplier. Stepping onto creep pushes creepactivate to the spawners it triggers and
   * walkoncreep to the walker once, then slows it unless it has vigorbuff; stepping off pushes walkoffcreep. Faster
   * tiles, roads and fasteroncreep are not ported, so off creep the multiplier is 1.
   */
  UpdateGroundSpeedMultiplier(): void {
    const creep = this.creep;
    if (!creep) {
      return;
    }
    const position = this.body.position;
    const point = new THREE.Vector3(position.x, 0, position.z);
    const oncreep = creep.world.OnCreep(point);
    if (oncreep && this.triggerscreep) {
      if (!this.wasoncreep) {
        const spawners = creep.world.GetTriggeredCreepSpawners(point);
        const eventdata: CreepActivateData = { target: creep.inst, spawners };
        for (const spawner of spawners) {
          spawner.PushEvent('creepactivate', eventdata);
        }
        creep.inst.PushEvent('walkoncreep', eventdata);
        this.wasoncreep = true;
      }
      if (!creep.inst.hasTag('vigorbuff')) {
        this.groundspeedmultiplier = this.slowmultiplier;
      }
    } else {
      if (this.wasoncreep && this.triggerscreep) {
        creep.inst.PushEvent('walkoffcreep');
      }
      this.wasoncreep = false;
      this.groundspeedmultiplier = 1;
    }
  }

  /** OnUpdate: the ground speed follows the walker's tile, updated only when it changes tiles. */
  private updateGroundSpeed(): void {
    if (!this.enablegroundspeedmultiplier) {
      return;
    }
    const col = Math.floor(this.body.position.x / TILE_SIZE),
      row = Math.floor(this.body.position.z / TILE_SIZE);
    if (col !== this.lastTile?.col || row !== this.lastTile?.row) {
      this.UpdateGroundSpeedMultiplier();
      this.lastTile = { col, row };
    }
  }

  update(speed: number, dt: number, manualDirection?: THREE.Vector3): void {
    this.updateGroundSpeed();
    if (!Number.isFinite(speed) || speed <= 0 || !Number.isFinite(dt) || dt < 0) {
      this.stop();
      return;
    }
    const direction = this.runningInDirection ? this.runDirection : manualDirection;
    const pending = this.pending;
    if (pending && !direction) {
      if (!pending.action.isValid()) {
        this.stop();
        return;
      }
      if (this.hasArrived(pending, speed * dt)) {
        this.arrive(pending);
        return;
      }
    }
    this.direction.set(0, 0, 0);
    if (direction) {
      if (!this.runningInDirection) {
        this.failPending();
        this.point = undefined;
        this.pathing?.Stop();
      }
      this.direction.set(direction.x, 0, direction.z).normalize();
    } else {
      const destination = this.destination;
      if (!destination) {
        this.stop();
        return;
      }
      const position = this.body.position;
      if (
        !pending &&
        (destination.x - position.x) ** 2 + (destination.z - position.z) ** 2 <= this.arriveDistance ** 2
      ) {
        this.stop();
        return;
      }
      this.pathing?.UpdateSearch();
      const step = this.pathing?.GetMoveStep(position, destination, this.physicsRadius) ?? destination;
      this.direction.set(step.x - position.x, 0, step.z - position.z);
      const distance = this.direction.length();
      if (distance === 0) {
        this.body.velocity.x = 0;
        this.body.velocity.z = 0;
        return;
      }
      // Slow the last step so it cannot overshoot the point.
      speed = Math.min(speed, distance / Math.max(dt, 1 / 60));
      this.direction.divideScalar(distance);
    }
    let vx = this.direction.x * speed;
    let vz = this.direction.z * speed;
    if (this.isPassable && (vx !== 0 || vz !== 0)) {
      // Probe the leading edge one step ahead; drop the blocked axis so the body slides along the shore.
      const length = Math.hypot(vx, vz);
      const reach = this.footprintRadius / length;
      const px = this.body.position.x;
      const pz = this.body.position.z;
      const free = (mx: number, mz: number) => this.isPassable!(px + mx * (dt + reach), pz + mz * (dt + reach));
      if (!free(vx, vz)) {
        const slideX = vx !== 0 && free(vx, 0);
        const slideZ = vz !== 0 && free(0, vz);
        if (slideX && !slideZ) {
          vz = 0;
        } else if (slideZ && !slideX) {
          vx = 0;
        } else {
          vx = 0;
          vz = 0;
        }
        if (vx === 0 && vz === 0 && !direction) {
          this.stop();
          return;
        }
      }
    }
    this.body.velocity.x = vx;
    this.body.velocity.z = vz;
    // Keep vertical velocity for gravity and jumping.
  }
}

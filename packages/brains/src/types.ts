import type { LocoMotor, LocoMotorPoint, LocoMotorTarget } from '../../componets/src/locomotor';
import type { KnownLocations } from '../../componets/src/knownlocations';
import type { Pollinator } from '../../componets/src/pollinator';

export type Vec3 = LocoMotorPoint;

/** An entity as the brains see it: tags, a position and a component bag. */
export interface BrainEntity extends LocoMotorTarget {
  readonly prefab: string;
  readonly components: BrainComponents;
}

/** Component surface read by the ported brains and behaviours. */
export interface BrainComponents {
  inventory?: import('../../componets/src/inventory').Inventory;
  bait?: import('../../componets/src/bait').Bait;
  locomotor?: LocoMotor;
  pollinator?: Pollinator<BrainEntity>;
  knownlocations?: KnownLocations;
  health?: { takingfiredamage?: boolean; GetLunarBurnFlags?(): number; IsDead?(): boolean };
  hauntable?: { panic?: boolean };
  combat?: { DropTarget(): void };
  skilltreeupdater?: { IsActivated(skill: string): boolean };
}

/** simutil.lua queries (TheSim:FindEntities, TheWorld.Map) used by the ported brains. */
export interface BrainWorld {
  readonly isDay: boolean;
  /** simutil.lua FindEntity: nearest visible entity other than `from` that passes the filters. */
  findEntity(from: BrainEntity, radius: number, fn?: (guy: BrainEntity, from: BrainEntity) => boolean,
    mustTags?: readonly string[], cantTags?: readonly string[], oneOfTags?: readonly string[]): BrainEntity | undefined;
  /** simutil.lua GetClosestInstWithTag. */
  getClosestInstWithTag(tags: readonly string[], from: BrainEntity, radius: number): BrainEntity | undefined;
  /** Map:IsAboveGroundAtPoint: the world has no ocean/void here. */
  isAboveGroundAtPoint(x: number, y: number, z: number): boolean;
}

/** The entity script a brain drives. */
export interface BrainInst extends BrainEntity {
  readonly world: BrainWorld;
  /** GetTime(): simulation seconds. */
  getTime(): number;
  /** math.random() */
  random(): number;
  getAngleToPoint(x: number, y: number, z: number): number;
  isNear(other: BrainEntity, distance: number): boolean;
  ListenForEvent(name: string, fn: (data?: unknown) => void): void;
  RemoveEventCallback(name: string, fn: (data?: unknown) => void): void;
  /** AvoidElectricFence: set by electric fields, read by BrainCommon. */
  panic_electric_field?: unknown;
  _has_electric_fence_panic_trigger?: boolean;
  brain?: { ForceUpdate(): void };
}

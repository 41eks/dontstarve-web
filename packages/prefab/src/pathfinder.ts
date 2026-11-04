import * as THREE from 'three';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { GroundPathSearch, isClearSegment } from './locomotor';
import { WORLD_SCALE } from './tile';
import type { TurfMap } from './turfMap';

/** locomotor.lua's search statuses. */
export const STATUS_CALCULATING = 0;
export const STATUS_FOUNDPATH = 1;
export const STATUS_NOPATH = 2;
export type SearchStatus = typeof STATUS_CALCULATING | typeof STATUS_FOUNDPATH | typeof STATUS_NOPATH;

/**
 * locomotor.pathcaps. `ignorecreep` and `player` are accepted as the source passes them, and change nothing here:
 * this project has no ground creep, and the engine's use of `player` is not visible from Lua.
 */
export interface PathCaps {
  readonly ignorewalls?: boolean;
  readonly ignorecreep?: boolean;
  readonly allowocean?: boolean;
  readonly ignoreLand?: boolean;
  readonly player?: boolean;
}

/** GetSearchResult: `steps[0]` is the start, so locomotor.lua follows from its second step and discards a straight line of two. */
export interface FoundPath { readonly steps: readonly THREE.Vector3[] }

export type PathfinderMap = Pick<TurfMap, 'isPassableAtPoint' | 'isOceanAtWorld'>;

/**
 * walls.lua and fence.lua stand at x.5, and atrium_gate.lua walls off 2×2 from its centre at ±0.5,
 * so a path tile is one DST unit. The engine's grid itself is not visible from Lua.
 */
const PATH_TILE_SIZE = WORLD_SCALE;
/** The engine searches on its own thread; here each update spends this many visited nodes, oldest search first. */
const NODES_PER_UPDATE = 256;

/** Path tile indices stay far inside the key's 2^20 stride. */
const wallKey = (point: ReadonlyVector3) => Math.floor(point.x / PATH_TILE_SIZE) * 0x100000 + Math.floor(point.z / PATH_TILE_SIZE);

interface Search { readonly start: THREE.Vector3; readonly work: GroundPathSearch }

/**
 * TheWorld.Pathfinder as Lua calls it, with positions as vectors in world units. It knows what Lua tells it about:
 * the ground and the walls registered with AddWall. Other obstacles are left to physics. The engine's algorithm
 * is not available, so its paths may differ; AddStaticHoppablePlatform waits for abysspillar to be ported.
 */
export class Pathfinder {
  private readonly map: PathfinderMap;
  private readonly walls = new Map<number, number>();
  private readonly searches = new Map<number, Search>();
  private nextHandle = 1;

  constructor(map: PathfinderMap) { this.map = map; }

  /** A multiple-return in Lua; only ever compared with an earlier index. */
  GetPathTileIndexFromPoint(point: ReadonlyVector3): [x: number, z: number] {
    return [Math.floor(point.x / PATH_TILE_SIZE), Math.floor(point.z / PATH_TILE_SIZE)];
  }

  AddWall(point: ReadonlyVector3): void {
    const key = wallKey(point);
    this.walls.set(key, (this.walls.get(key) ?? 0) + 1);
  }

  /** Walls sharing a path tile keep it blocked until the last one leaves. */
  RemoveWall(point: ReadonlyVector3): void {
    const key = wallKey(point), count = this.walls.get(key);
    if (count === undefined) return;
    if (count > 1) this.walls.set(key, count - 1);
    else this.walls.delete(key);
  }

  IsClear(from: ReadonlyVector3, to: ReadonlyVector3, caps?: PathCaps): boolean {
    return isClearSegment(new THREE.Vector3(from.x, from.y, from.z), new THREE.Vector3(to.x, to.y, to.z), PATH_TILE_SIZE / 4, this.walkable(caps));
  }

  /** The search starts on a later update; its handle stays valid until KillSearch. */
  SubmitSearch(from: ReadonlyVector3, to: ReadonlyVector3, caps?: PathCaps): number {
    const start = new THREE.Vector3(from.x, from.y, from.z);
    const handle = this.nextHandle++;
    this.searches.set(handle, { start, work: new GroundPathSearch(start, new THREE.Vector3(to.x, to.y, to.z), {
      cellSize: PATH_TILE_SIZE, isWalkable: this.walkable(caps) }) });
    return handle;
  }

  /** Undefined for a handle with no search, as locomotor.lua's "LOST PATH SEARCH" expects. */
  GetSearchStatus(handle: number): SearchStatus | undefined {
    const search = this.searches.get(handle);
    if (!search) return undefined;
    const { result } = search.work;
    return result === undefined ? STATUS_CALCULATING : result === null ? STATUS_NOPATH : STATUS_FOUNDPATH;
  }

  GetSearchResult(handle: number): FoundPath | undefined {
    const search = this.searches.get(handle);
    const steps = search?.work.result;
    return steps ? { steps: [search!.start.clone(), ...steps] } : undefined;
  }

  KillSearch(handle: number): void { this.searches.delete(handle); }

  /** Runs the waiting searches for this frame. */
  update(budget = NODES_PER_UPDATE): void {
    let left = budget;
    for (const { work } of this.searches.values()) {
      if (work.result !== undefined) continue;
      if (left <= 0) break;
      left -= work.advance(left);
    }
  }

  /** Land unless ignoreLand, ocean only with allowocean, as CanPathfindOnLand and CanPathfindOnWater read the caps. */
  private walkable(caps: PathCaps | undefined): (point: THREE.Vector3) => boolean {
    const land = !caps?.ignoreLand, ocean = caps?.allowocean === true, walls = !caps?.ignorewalls;
    return point => {
      if (!(land && this.map.isPassableAtPoint(point)) && !(ocean && this.map.isOceanAtWorld(point))) return false;
      return !walls || !this.walls.has(wallKey(point));
    };
  }
}

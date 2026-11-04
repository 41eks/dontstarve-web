import * as THREE from 'three';
import type { LocoMotorPathfinder, LocoMotorPoint, PathCaps } from '../../componets/src/locomotor';
import { WORLD_SCALE } from './tile';
import type { TurfMap } from './turfMap';

/** locomotor.lua's search statuses. */
export const STATUS_CALCULATING = 0;
export const STATUS_FOUNDPATH = 1;
export const STATUS_NOPATH = 2;
export type SearchStatus = typeof STATUS_CALCULATING | typeof STATUS_FOUNDPATH | typeof STATUS_NOPATH;

export type { PathCaps };

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
const wallKey = (point: LocoMotorPoint) => Math.floor(point.x / PATH_TILE_SIZE) * 0x100000 + Math.floor(point.z / PATH_TILE_SIZE);

export interface GroundPathOptions {
  isWalkable: (point: THREE.Vector3) => boolean;
  cellSize?: number;
  maxVisited?: number;
}

interface PathNode {
  x: number;
  z: number;
  cost: number;
  score: number;
  order: number;
  parent?: PathNode;
}

/** Open-set order: lowest score first, earlier insertion among equal scores. */
const before = (a: PathNode, b: PathNode) => a.score < b.score || (a.score === b.score && a.order < b.order);

function pushNode(heap: PathNode[], node: PathNode): void {
    let index = heap.push(node) - 1;
    while (index > 0) {
        const parent = (index - 1) >> 1;
        if (!before(heap[index], heap[parent])) break;
        [heap[index], heap[parent]] = [heap[parent], heap[index]];
        index = parent;
    }
}

function popNode(heap: PathNode[]): PathNode {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
        heap[0] = last;
        for (let index = 0; ;) {
            const left = index * 2 + 1, right = left + 1;
            let next = index;
            if (left < heap.length && before(heap[left], heap[next])) next = left;
            if (right < heap.length && before(heap[right], heap[next])) next = right;
            if (next === index) break;
            [heap[index], heap[next]] = [heap[next], heap[index]];
            index = next;
        }
    }
    return top;
}

/** A search over the XZ plane that runs a few nodes at a time; the host supplies map boundaries and obstacles. */
export class GroundPathSearch {
    /** Undefined while calculating; null when the destination cannot be reached within the search's limit. */
    result: readonly THREE.Vector3[] | null | undefined;
    private readonly start: THREE.Vector3;
    private readonly target: THREE.Vector3;
    private readonly isWalkable: GroundPathOptions['isWalkable'];
    private readonly cellSize: number;
    private readonly maxVisited: number;
    private readonly sample = new THREE.Vector3();
    private readonly open: PathNode[] = [];
    private readonly costs = new Map<number, number>();
    private visited = 0;
    private order = 0;
    private started = false;

    constructor(start: THREE.Vector3, target: THREE.Vector3, { isWalkable, cellSize = 2, maxVisited = 4096 }: GroundPathOptions) {
        if (!Number.isFinite(cellSize) || cellSize <= 0 || !Number.isSafeInteger(maxVisited) || maxVisited <= 0) {
            throw new RangeError('Invalid ground path search limits');
        }
        this.start = start.clone(); this.target = target.clone();
        this.isWalkable = isWalkable; this.cellSize = cellSize; this.maxVisited = maxVisited;
    }

    /** Visits up to `budget` nodes and returns how many it used; the search has finished once `result` is set. */
    advance(budget: number): number {
        if (this.result !== undefined) return 0;
        if (!this.started && !this.begin()) return 0;
        const { open, costs, cellSize, target } = this;
        let used = 0;
        while (used < budget) {
            if (open.length === 0 || this.visited >= this.maxVisited) { this.result = null; break; }
            const current = popNode(open);
            if (current.cost !== costs.get(nodeKey(current.x, current.z))) continue;
            this.visited += 1;
            used += 1;
            const currentPoint = this.point(current);
            if (this.heuristic(current.x, current.z) <= cellSize * 1.5 && this.clearSegment(currentPoint, target)) {
                const path = [target.clone()];
                for (let node: PathNode | undefined = current; node?.parent; node = node.parent) path.push(this.point(node));
                this.result = path.reverse();
                break;
            }
            this.expand(current, currentPoint);
        }
        return used;
    }

    /** The checks that need no search. */
    private begin(): boolean {
        this.started = true;
        if (!this.isWalkable(this.target)) { this.result = null; return false; }
        if (this.clearSegment(this.start, this.target)) { this.result = [this.target.clone()]; return false; }
        this.open.push({ x: 0, z: 0, cost: 0, score: this.heuristic(0, 0), order: this.order++ });
        this.costs.set(nodeKey(0, 0), 0);
        return true;
    }

    private expand(current: PathNode, currentPoint: THREE.Vector3): void {
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                if (dx === 0 && dz === 0) continue;
                const x = current.x + dx;
                const z = current.z + dz;
                const cost = current.cost + Math.hypot(dx, dz) * this.cellSize;
                const key = nodeKey(x, z);
                if (cost >= (this.costs.get(key) ?? Infinity)) continue;
                const next = { x, z, cost, score: cost + this.heuristic(x, z), order: this.order++, parent: current };
                const nextPoint = this.point(next);
                if (!this.isWalkable(nextPoint) || !this.clearSegment(currentPoint, nextPoint)) continue;
                // Do not cut diagonally through blocked corners.
                if (dx !== 0 && dz !== 0 && (
                    !this.isWalkable(this.point({ ...current, x })) || !this.isWalkable(this.point({ ...current, z }))
                )) continue;
                this.costs.set(key, cost);
                pushNode(this.open, next);
            }
        }
    }

    private point(node: PathNode): THREE.Vector3 {
        return new THREE.Vector3(this.start.x + node.x * this.cellSize, this.target.y, this.start.z + node.z * this.cellSize);
    }

    private heuristic(x: number, z: number): number {
        return Math.hypot(this.start.x + x * this.cellSize - this.target.x, this.start.z + z * this.cellSize - this.target.z);
    }

    private clearSegment(from: THREE.Vector3, to: THREE.Vector3): boolean {
        return isClearSegment(from, to, this.cellSize / 2, this.isWalkable, this.sample);
    }
}

// Grid offsets stay within ±maxVisited of the start, far inside the key's 2^20 stride.
const nodeKey = (x: number, z: number) => x * 0x100000 + z;

/** Whether every point sampled along a segment, each `spacing` apart at most, is walkable. */
export function isClearSegment(from: THREE.Vector3, to: THREE.Vector3, spacing: number, isWalkable: GroundPathOptions['isWalkable'], sample = new THREE.Vector3()): boolean {
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / spacing));
    for (let i = 1; i <= steps; i++) {
        sample.lerpVectors(from, to, i / steps);
        if (!isWalkable(sample)) return false;
    }
    return true;
}

interface Search { readonly start: THREE.Vector3; readonly work: GroundPathSearch }

/**
 * TheWorld.Pathfinder as Lua calls it, with positions as vectors in world units. It knows what Lua tells it about:
 * the ground and the walls registered with AddWall. Other obstacles are left to physics. The engine's algorithm
 * is not available, so its paths may differ; AddStaticHoppablePlatform waits for abysspillar to be ported.
 */
export class Pathfinder implements LocoMotorPathfinder {
  private readonly map: PathfinderMap;
  private readonly walls = new Map<number, number>();
  private readonly searches = new Map<number, Search>();
  private nextHandle = 1;

  constructor(map: PathfinderMap) { this.map = map; }

  /** A multiple-return in Lua; only ever compared with an earlier index. */
  GetPathTileIndexFromPoint(point: LocoMotorPoint): [x: number, z: number] {
    return [Math.floor(point.x / PATH_TILE_SIZE), Math.floor(point.z / PATH_TILE_SIZE)];
  }

  AddWall(point: LocoMotorPoint): void {
    const key = wallKey(point);
    this.walls.set(key, (this.walls.get(key) ?? 0) + 1);
  }

  /** Walls sharing a path tile keep it blocked until the last one leaves. */
  RemoveWall(point: LocoMotorPoint): void {
    const key = wallKey(point), count = this.walls.get(key);
    if (count === undefined) return;
    if (count > 1) this.walls.set(key, count - 1);
    else this.walls.delete(key);
  }

  IsClear(from: LocoMotorPoint, to: LocoMotorPoint, caps?: PathCaps): boolean {
    return isClearSegment(new THREE.Vector3(from.x, from.y, from.z), new THREE.Vector3(to.x, to.y, to.z), PATH_TILE_SIZE / 4, this.walkable(caps));
  }

  /** The search starts on a later update; its handle stays valid until KillSearch. */
  SubmitSearch(from: LocoMotorPoint, to: LocoMotorPoint, caps?: PathCaps): number {
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

/** walls.lua and fence.lua's OnIsPathFindingDirty: the position it registered at, until it stops being an obstacle. */
export class PathfindingWall {
  private readonly pathfinder?: Pick<Pathfinder, 'AddWall' | 'RemoveWall'>;
  private readonly position: () => LocoMotorPoint;
  private registered?: LocoMotorPoint;

  constructor(pathfinder: Pick<Pathfinder, 'AddWall' | 'RemoveWall'> | undefined, position: () => LocoMotorPoint) {
    this.pathfinder = pathfinder; this.position = position;
  }

  /** inst._ispathfinding:set. */
  set(active: boolean): void {
    if (active && !this.registered) {
      const { x, y, z } = this.position();
      this.registered = { x, y, z };
      this.pathfinder?.AddWall(this.registered);
    } else if (!active && this.registered) {
      this.pathfinder?.RemoveWall(this.registered);
      this.registered = undefined;
    }
  }
}

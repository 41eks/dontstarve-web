import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { PointerRaycaster } from '@dontstarve-web/stategraphs/pointerRaycaster';
import type { LocomotorAction } from '@dontstarve-web/stategraphs/actionContext';
import type { WorldContext } from './worldContext';
import { WORLD_SCALE } from './tile';

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
        if (body.type !== CANNON.Body.STATIC || !body.collisionResponse
            || !body.shapes.some((shape) => shape instanceof CANNON.Box || shape instanceof CANNON.Sphere)) continue;
        if (body.aabbNeedsUpdate) body.updateAABB();
        boxes.push(body.aabb);
    }
    const inside = (box: CANNON.AABB, point: THREE.Vector3) =>
        point.x >= box.lowerBound.x - margin && point.x <= box.upperBound.x + margin
        && point.z >= box.lowerBound.z - margin && point.z <= box.upperBound.z + margin;
    let tests = 0;
    let cells: Map<number, CANNON.AABB[]> | undefined;
    const bucket = () => {
        const result = new Map<number, CANNON.AABB[]>();
        for (const box of boxes) {
            const x0 = Math.floor((box.lowerBound.x - margin) / OBSTACLE_CELL), x1 = Math.floor((box.upperBound.x + margin) / OBSTACLE_CELL);
            const z0 = Math.floor((box.lowerBound.z - margin) / OBSTACLE_CELL), z1 = Math.floor((box.upperBound.z + margin) / OBSTACLE_CELL);
            for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
                const key = x * 0x10000 + z;
                const cell = result.get(key);
                if (cell) cell.push(box); else result.set(key, [box]);
            }
        }
        return result;
    };
    return (point) => {
        if (!cells && ++tests <= LINEAR_TESTS) return boxes.some((box) => inside(box, point));
        cells ??= bucket();
        return cells.get(obstacleCell(point.x, point.z))?.some((box) => inside(box, point)) ?? false;
    };
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

/** Searches the XZ plane; the host supplies map boundaries and physical obstacles. */
export function findGroundPath(
    start: THREE.Vector3,
    target: THREE.Vector3,
    { isWalkable, cellSize = 2, maxVisited = 4096 }: GroundPathOptions,
): readonly THREE.Vector3[] | null {
    if (!Number.isFinite(cellSize) || cellSize <= 0 || !Number.isSafeInteger(maxVisited) || maxVisited <= 0) {
        throw new RangeError('Invalid ground path search limits');
    }
    const sample = new THREE.Vector3();
    const clearSegment = (from: THREE.Vector3, to: THREE.Vector3) => {
        const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / (cellSize / 2)));
        for (let i = 1; i <= steps; i++) {
            sample.lerpVectors(from, to, i / steps);
            if (!isWalkable(sample)) return false;
        }
        return true;
    };
    if (!isWalkable(target)) return null;
    if (clearSegment(start, target)) return [target.clone()];

    const point = (node: PathNode) => new THREE.Vector3(start.x + node.x * cellSize, target.y, start.z + node.z * cellSize);
    const heuristic = (x: number, z: number) => Math.hypot(start.x + x * cellSize - target.x, start.z + z * cellSize - target.z);
    // Grid offsets stay within ±maxVisited of the start, far inside the key's 2^20 stride.
    const nodeKey = (x: number, z: number) => x * 0x100000 + z;
    let order = 0;
    const open: PathNode[] = [{ x: 0, z: 0, cost: 0, score: heuristic(0, 0), order: order++ }];
    const costs = new Map<number, number>([[nodeKey(0, 0), 0]]);
    let visited = 0;
    while (open.length > 0 && visited < maxVisited) {
        const current = popNode(open);
        if (current.cost !== costs.get(nodeKey(current.x, current.z))) continue;
        visited += 1;
        const currentPoint = point(current);
        if (heuristic(current.x, current.z) <= cellSize * 1.5 && clearSegment(currentPoint, target)) {
            const path = [target.clone()];
            for (let node: PathNode | undefined = current; node?.parent; node = node.parent) path.push(point(node));
            return path.reverse();
        }
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                if (dx === 0 && dz === 0) continue;
                const x = current.x + dx;
                const z = current.z + dz;
                const cost = current.cost + Math.hypot(dx, dz) * cellSize;
                const key = nodeKey(x, z);
                if (cost >= (costs.get(key) ?? Infinity)) continue;
                const next = { x, z, cost, score: cost + heuristic(x, z), order: order++, parent: current };
                const nextPoint = point(next);
                if (!isWalkable(nextPoint) || !clearSegment(currentPoint, nextPoint)) continue;
                // Do not cut diagonally through blocked corners.
                if (dx !== 0 && dz !== 0 && (
                    !isWalkable(point({ ...current, x })) || !isWalkable(point({ ...current, z }))
                )) continue;
                costs.set(key, cost);
                pushNode(open, next);
            }
        }
    }
    return null;
}

export interface LocomotorOptions {
    arriveDistance?: number;
    findPath?: (start: THREE.Vector3, target: THREE.Vector3) => readonly THREE.Vector3[] | null;
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
    readonly pathTarget: THREE.Vector3;
}

/** A target moving farther than this from where the path led re-paths, as Dest(target) follows the entity. */
const REPATH_DISTANCE = 0.5;

/** Owns movement destinations and horizontal physics velocity, like DST's locomotor. */
export class Locomotor {
    private readonly body: CANNON.Body;
    private readonly arriveDistance: number;
    private readonly findPath?: LocomotorOptions['findPath'];
    private readonly isPassable?: LocomotorOptions['isPassable'];
    private readonly footprintRadius: number;
    private readonly physicsRadius: number;
    private pending?: PendingAction;
    private path: readonly THREE.Vector3[] = [];
    private pathIndex = 0;
    private readonly direction = new THREE.Vector3();

    constructor(body: CANNON.Body, options: LocomotorOptions = {}) {
        this.body = body;
        this.arriveDistance = options.arriveDistance ?? 0.25;
        if (!Number.isFinite(this.arriveDistance) || this.arriveDistance <= 0) throw new RangeError('Invalid arrival distance');
        this.findPath = options.findPath;
        this.isPassable = options.isPassable;
        this.footprintRadius = options.footprintRadius ?? 0;
        this.physicsRadius = options.physicsRadius ?? this.footprintRadius;
    }

    /** The BufferedAction the locomotor is walking towards, before the inst buffers it. */
    get bufferedAction(): LocomotorAction | undefined { return this.pending?.action; }

    /**
     * locomotor:PushAction for an entity target: GoToEntity with ARRIVE_STEP plus both physics radii (at least the
     * action's distance) as the arrive distance. On arrival `arrive` runs, the inst's PushBufferedAction; an
     * invalid action, a new destination, manual movement or Stop fails it instead.
     */
    PushAction(action: LocomotorAction, arrive: () => void, fail: () => void): void {
        this.stop();
        const arriveDistance = Math.max(ARRIVE_STEP + (action.target.getPhysicsRadius?.() ?? 0) + this.physicsRadius,
            action.distance ?? 0);
        const pending: PendingAction = { action, arriveDistance, arrive, fail, pathTarget: action.target.getPosition().clone() };
        this.pending = pending;
        if (!action.isValid()) { this.stop(); return; }
        if (this.hasArrived(pending)) { this.arrive(pending); return; }
        this.pathTowards(pending);
    }

    /** locomotor:Clear: drop the destination and fail the walked-to action. */
    Clear(): void { this.stop(); }

    /** OnUpdate's reached_dest: within the arrive distance, or half this frame's run distance when that is longer. */
    private hasArrived(pending: PendingAction, runDistance = 0): boolean {
        const target = pending.action.target.getPosition();
        return (target.x - this.body.position.x) ** 2 + (target.z - this.body.position.z) ** 2
            <= Math.max(pending.arriveDistance, runDistance * .5) ** 2;
    }

    private arrive(pending: PendingAction): void {
        this.pending = undefined;
        this.stop();
        pending.arrive();
    }

    /**
     * Path to the target itself, as Dest(target) does; an obstacle's centre is not walkable, so its path ends short of
     * the centre, inside the arrive distance.
     */
    private pathTowards(pending: PendingAction): void {
        const target = pending.action.target.getPosition();
        pending.pathTarget.copy(target);
        if (this.setPath(target)) return;
        this.direction.set(this.body.position.x - target.x, 0, this.body.position.z - target.z).normalize();
        const destination = new THREE.Vector3(target.x, target.y, target.z).addScaledVector(this.direction, pending.arriveDistance * 0.8);
        if (!this.setPath(destination)) this.stop();
    }

    get destination(): THREE.Vector3 | undefined {
        return this.path[this.path.length - 1]?.clone();
    }

    /** GoToPoint replaces any walked-to action. */
    goToPoint(target: THREE.Vector3): boolean {
        this.failPending();
        return this.setPath(target);
    }

    private setPath(target: THREE.Vector3): boolean {
        if (![target.x, target.y, target.z].every(Number.isFinite)) return false;
        const start = new THREE.Vector3(this.body.position.x, target.y, this.body.position.z);
        const path = this.findPath ? this.findPath(start, target.clone()) : [target];
        if (!path?.length) {
            this.halt();
            return false;
        }
        this.path = path.map((point) => point.clone());
        this.pathIndex = 0;
        return true;
    }

    stop(): void {
        this.failPending();
        this.halt();
    }

    /** Drop the path and horizontal velocity, keeping any walked-to action. */
    private halt(): void {
        this.path = [];
        this.pathIndex = 0;
        this.body.velocity.x = 0;
        this.body.velocity.z = 0;
    }

    private failPending(): void {
        const pending = this.pending;
        this.pending = undefined;
        pending?.fail();
    }

    /** A supplied manual direction cancels automatic travel, even when opposite keys cancel out. */
    update(speed: number, dt: number, manualDirection?: THREE.Vector3): void {
        if (!Number.isFinite(speed) || speed <= 0 || !Number.isFinite(dt) || dt < 0) {
            this.stop();
            return;
        }
        const pending = this.pending;
        if (pending && !manualDirection) {
            if (!pending.action.isValid()) { this.stop(); return; }
            if (this.hasArrived(pending, speed * dt)) { this.arrive(pending); return; }
            if (pending.pathTarget.distanceToSquared(pending.action.target.getPosition()) > REPATH_DISTANCE ** 2) {
                this.pathTowards(pending);
                if (this.pending !== pending) return;
            }
        }
        this.direction.set(0, 0, 0);
        if (manualDirection) {
            this.failPending();
            this.path = [];
            this.pathIndex = 0;
            this.direction.set(manualDirection.x, 0, manualDirection.z).normalize();
        } else {
            // Dest(target) follows the entity: a path ending short of a moving target leads on towards it once.
            for (let attempt = 0; ; attempt++) {
                while (this.pathIndex < this.path.length) {
                    const point = this.path[this.pathIndex];
                    this.direction.set(point.x - this.body.position.x, 0, point.z - this.body.position.z);
                    const distance = this.direction.length();
                    if (distance <= this.arriveDistance) {
                        this.pathIndex += 1;
                        continue;
                    }
                    // Slow the last step so it cannot overshoot the waypoint.
                    speed = Math.min(speed, distance / Math.max(dt, 1 / 60));
                    this.direction.divideScalar(distance);
                    break;
                }
                if (this.pathIndex < this.path.length) break;
                const pending = this.pending;
                if (!pending) { this.stop(); return; }
                if (this.hasArrived(pending, speed * dt)) { this.arrive(pending); return; }
                if (attempt > 0) { this.body.velocity.x = 0; this.body.velocity.z = 0; return; }
                this.pathTowards(pending);
                if (this.pending !== pending) return;
            }
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
                if (slideX && !slideZ) vz = 0;
                else if (slideZ && !slideX) vx = 0;
                else { vx = 0; vz = 0; }
                if (vx === 0 && vz === 0) { this.path = []; this.pathIndex = 0; }
            }
        }
        this.body.velocity.x = vx;
        this.body.velocity.z = vz;
        // Keep vertical velocity for gravity and jumping.
    }
}

/** Register after interaction handlers; consumed clicks never become WALKTO actions. */
export function setupLocomotorInput(
    world: Pick<WorldContext, 'camera' | 'renderer' | 'ground'>,
    locomotor: Locomotor,
): () => void {
    const pointer = new PointerRaycaster(world);
    const handlePointerDown = (event: PointerEvent) => {
        if (event.button !== 0) return;
        if (event.defaultPrevented) {
            locomotor.stop();
            return;
        }
        pointer.trackPointer(event);
        const point = pointer.groundPoint();
        if (point) locomotor.goToPoint(point);
    };
    world.renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    return () => {
        world.renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
        pointer.dispose();
    };
}

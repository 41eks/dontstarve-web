import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { PointerRaycaster } from './pointerRaycaster';
import type { WorldContext } from './worldContext';

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
    parent?: PathNode;
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
    const open: PathNode[] = [{ x: 0, z: 0, cost: 0, score: heuristic(0, 0) }];
    const costs = new Map<string, number>([['0,0', 0]]);
    let visited = 0;
    while (open.length > 0 && visited < maxVisited) {
        let best = 0;
        for (let i = 1; i < open.length; i++) if (open[i].score < open[best].score) best = i;
        const current = open.splice(best, 1)[0];
        if (current.cost !== costs.get(`${current.x},${current.z}`)) continue;
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
                const key = `${x},${z}`;
                if (cost >= (costs.get(key) ?? Infinity)) continue;
                const next = { x, z, cost, score: cost + heuristic(x, z), parent: current };
                const nextPoint = point(next);
                if (!isWalkable(nextPoint) || !clearSegment(currentPoint, nextPoint)) continue;
                // Do not cut diagonally through blocked corners.
                if (dx !== 0 && dz !== 0 && (
                    !isWalkable(point({ ...current, x })) || !isWalkable(point({ ...current, z }))
                )) continue;
                costs.set(key, cost);
                open.push(next);
            }
        }
    }
    return null;
}

export interface LocomotorOptions {
    arriveDistance?: number;
    findPath?: (start: THREE.Vector3, target: THREE.Vector3) => readonly THREE.Vector3[] | null;
}

/** Owns movement destinations and horizontal physics velocity, like DST's locomotor. */
export class Locomotor {
    private readonly body: CANNON.Body;
    private readonly arriveDistance: number;
    private readonly findPath?: LocomotorOptions['findPath'];
    private path: readonly THREE.Vector3[] = [];
    private pathIndex = 0;
    private readonly direction = new THREE.Vector3();

    constructor(body: CANNON.Body, options: LocomotorOptions = {}) {
        this.body = body;
        this.arriveDistance = options.arriveDistance ?? 0.25;
        if (!Number.isFinite(this.arriveDistance) || this.arriveDistance <= 0) throw new RangeError('Invalid arrival distance');
        this.findPath = options.findPath;
    }

    get destination(): THREE.Vector3 | undefined {
        return this.path[this.path.length - 1]?.clone();
    }

    goToPoint(target: THREE.Vector3): boolean {
        if (![target.x, target.y, target.z].every(Number.isFinite)) return false;
        const start = new THREE.Vector3(this.body.position.x, target.y, this.body.position.z);
        const path = this.findPath ? this.findPath(start, target.clone()) : [target];
        if (!path?.length) {
            this.stop();
            return false;
        }
        this.path = path.map((point) => point.clone());
        this.pathIndex = 0;
        return true;
    }

    stop(): void {
        this.path = [];
        this.pathIndex = 0;
        this.body.velocity.x = 0;
        this.body.velocity.z = 0;
    }

    /** A supplied manual direction cancels automatic travel, even when opposite keys cancel out. */
    update(speed: number, dt: number, manualDirection?: THREE.Vector3): void {
        if (!Number.isFinite(speed) || speed <= 0 || !Number.isFinite(dt) || dt < 0) {
            this.stop();
            return;
        }
        this.direction.set(0, 0, 0);
        if (manualDirection) {
            this.path = [];
            this.pathIndex = 0;
            this.direction.set(manualDirection.x, 0, manualDirection.z).normalize();
        } else {
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
            if (this.pathIndex === this.path.length) {
                this.stop();
                return;
            }
        }
        this.body.velocity.x = this.direction.x * speed;
        this.body.velocity.z = this.direction.z * speed;
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

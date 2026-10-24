import * as THREE from 'three';
import type { ActionWorldContext as WorldContext } from './actionContext.ts';

function mouseVisible(object: THREE.Object3D): boolean {
    if (!object.visible) return false;
    const inst = object.userData.actionEntity as { hasTag?(tag: string): boolean } | undefined;
    return !(inst?.hasTag?.('NOCLICK') ?? object.userData.tags?.includes('NOCLICK'));
}

/** Input:GetWorldEntityUnderMouse excludes invisible/NOCLICK entities before action selection. */
export function intersectSpriteEntities(raycaster: THREE.Raycaster, objects: THREE.Object3D[], recursive = true): THREE.Intersection[] {
    const hits: THREE.Intersection[] = [];
    const box = new THREE.Box3(), partBox = new THREE.Box3();
    const expandVisibleBounds = (object: THREE.Object3D) => {
        if (!mouseVisible(object)) return;
        if (object instanceof THREE.Mesh) {
            if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
            if (object.geometry.boundingBox) box.union(partBox.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld));
        }
        for (const child of object.children) expandVisibleBounds(child);
    };
    const intersect = (object: THREE.Object3D) => {
        if (!mouseVisible(object)) return;
        let propagate = true;
        if (object.layers.test(raycaster.layers)) {
            if (object.userData.rayTestOnBB) {
                // AnimState:SetRayTestOnBB includes visible particle gaps, never hidden parts.
                object.updateWorldMatrix(true, true);
                box.makeEmpty();
                expandVisibleBounds(object);
                const point = box.isEmpty() ? null : raycaster.ray.intersectBox(box, new THREE.Vector3());
                if (point) {
                    const distance = point.distanceTo(raycaster.ray.origin);
                    if (distance >= raycaster.near && distance <= raycaster.far) hits.push({ distance, point, object });
                }
                return;
            }
            // Match Three's layer and custom raycast propagation rules while pruning hidden subtrees.
            propagate = (object.raycast(raycaster, hits) as unknown) !== false;
        }
        if (recursive && propagate) for (const child of object.children) intersect(child);
    };
    for (const object of objects) {
        let parent = object.parent;
        while (parent && mouseVisible(parent)) parent = parent.parent;
        if (!parent) intersect(object);
    }
    return hits.sort((a, b) => a.distance - b.distance);
}

export class PointerRaycaster {
    private readonly camera: THREE.Camera;
    private readonly renderer: THREE.WebGLRenderer;
    private readonly ground?: THREE.Object3D;
    private readonly pointerEvents?: EventTarget;
    private readonly raycaster = new THREE.Raycaster();
    private readonly ndc = new THREE.Vector2();
    private clientX = 0;
    private clientY = 0;
    private hasPointerPosition = false;
    private cacheGround = false;
    private groundCached = false;
    private cachedGround?: THREE.Intersection;

    /** Object-only picking can omit ground; ground queries then return no hit. */
    constructor(world: Pick<WorldContext, 'camera' | 'renderer'> & Partial<Pick<WorldContext, 'ground'>>) {
        this.camera = world.camera;
        this.renderer = world.renderer;
        this.ground = world.ground;
        this.pointerEvents = typeof window === 'undefined' ? undefined : window;
        this.pointerEvents?.addEventListener('pointermove', this.handlePointerMove as EventListener);
    }

    get pointerClientX(): number {
        return this.clientX;
    }

    get pointerClientY(): number {
        return this.clientY;
    }

    get hasPointer(): boolean {
        return this.hasPointerPosition;
    }

    get isOverGround(): boolean {
        return this.groundHit() !== undefined;
    }

    trackPointer(event: PointerEvent): void {
        this.groundCached = false;
        this.clientX = event.clientX;
        this.clientY = event.clientY;
        this.hasPointerPosition = true;
    }

    beginFrame(): void { this.cacheGround = true; this.groundCached = false; }
    endFrame(): void { this.cacheGround = false; this.groundCached = false; }

    groundPoint(): THREE.Vector3 | undefined {
        return this.groundHit()?.point.clone().setY(0);
    }

    raycastPointer(
        objects: THREE.Object3D[],
        recursive = true,
    ): THREE.Intersection | undefined {
        if (!this.hasPointerPosition) return undefined;
        const bounds = this.renderer.domElement.getBoundingClientRect();
        this.ndc.x = ((this.clientX - bounds.left) / bounds.width) * 2 - 1;
        this.ndc.y = -((this.clientY - bounds.top) / bounds.height) * 2 + 1;
        this.raycaster.setFromCamera(this.ndc, this.camera);
        return intersectSpriteEntities(this.raycaster, objects, recursive)[0];
    }

    raycast(
        origin: THREE.Vector3,
        direction: THREE.Vector3,
        object: THREE.Object3D,
        recursive = false,
    ): THREE.Intersection | undefined {
        object.updateWorldMatrix(true, false);
        this.raycaster.set(origin, direction);
        return this.raycaster.intersectObject(object, recursive)[0];
    }

    dispose(): void {
        this.pointerEvents?.removeEventListener('pointermove', this.handlePointerMove as EventListener);
    }

    private readonly handlePointerMove = (event: PointerEvent) => {
        this.trackPointer(event);
    };

    private groundHit(): THREE.Intersection | undefined {
        if (!this.ground) return undefined;
        if (this.cacheGround && this.groundCached) return this.cachedGround;
        this.ground.updateWorldMatrix(true, false);
        this.cachedGround = this.raycastPointer([this.ground], false);
        this.groundCached = true;
        return this.cachedGround;
    }
}

import * as THREE from 'three';
import type { ActionWorldContext as WorldContext } from './actionContext.ts';

/** AnimState:SetRayTestOnBB swarms use their full bounds, including particle gaps. */
export function intersectSpriteEntities(raycaster: THREE.Raycaster, objects: THREE.Object3D[], recursive = true): THREE.Intersection[] {
    const hits = raycaster.intersectObjects(objects.filter(object => !object.userData.rayTestOnBB), recursive);
    for (const object of objects) {
        if (!object.userData.rayTestOnBB) continue;
        object.updateWorldMatrix(true, true);
        const box = new THREE.Box3().setFromObject(object);
        if (box.isEmpty()) continue;
        const point = raycaster.ray.intersectBox(box, new THREE.Vector3());
        if (!point) continue;
        const distance = point.distanceTo(raycaster.ray.origin);
        if (distance >= raycaster.near && distance <= raycaster.far) hits.push({ distance, point, object });
    }
    return hits.sort((a, b) => a.distance - b.distance);
}

export class PointerRaycaster {
    private readonly camera: THREE.Camera;
    private readonly renderer: THREE.WebGLRenderer;
    private readonly ground: THREE.Object3D;
    private readonly raycaster = new THREE.Raycaster();
    private readonly ndc = new THREE.Vector2();
    private clientX = 0;
    private clientY = 0;
    private hasPointerPosition = false;
    private cacheGround = false;
    private groundCached = false;
    private cachedGround?: THREE.Intersection;

    constructor(world: Pick<WorldContext, 'camera' | 'renderer' | 'ground'>) {
        this.camera = world.camera;
        this.renderer = world.renderer;
        this.ground = world.ground;
        window.addEventListener('pointermove', this.handlePointerMove);
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
        return this.groundHit()?.point.clone();
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
        window.removeEventListener('pointermove', this.handlePointerMove);
    }

    private readonly handlePointerMove = (event: PointerEvent) => {
        this.trackPointer(event);
    };

    private groundHit(): THREE.Intersection | undefined {
        if (this.cacheGround && this.groundCached) return this.cachedGround;
        this.ground.updateWorldMatrix(true, false);
        this.cachedGround = this.raycastPointer([this.ground], false);
        this.groundCached = true;
        return this.cachedGround;
    }
}

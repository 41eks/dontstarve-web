import * as THREE from 'three';
import type { ActionWorldContext as WorldContext } from './actionContext.ts';
import { mouseTargets } from '../../prefab/src/mouseTargets';
import { prepareSpatialGeometryBounds, spatialAttributeVersion } from '../../animation/src/spatialBounds.ts';
import { isInstancedSpriteProxy } from '../../animation/src/spriteRaycast.ts';
import { modelHasTag } from '../../prefab/src/prefabInstance';

/** Ten percent of the sprite's size on each outer edge, used only after exact picking misses. */
const SPRITE_PICK_SCALE = 1.2;

function mouseVisible(object: THREE.Object3D): boolean {
    if (!object.visible && !isInstancedSpriteProxy(object)) return false;
    const inst = object.userData.actionEntity as { hasTag?(tag: string): boolean } | undefined;
    return !(inst?.hasTag?.('NOCLICK') ?? modelHasTag(object, 'NOCLICK'));
}

interface BoundsPart {
    object: THREE.Object3D;
    visible: boolean;
    matrix: THREE.Matrix4;
    geometry?: THREE.BufferGeometry;
    attribute?: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
    version?: number;
}
const visibleBounds = new WeakMap<THREE.Object3D, { box: THREE.Box3; parts: BoundsPart[] }>();

/** Only candidates need this check. Unchanged geometry, transforms and visibility reuse their world box. */
function spriteBounds(object: THREE.Object3D): THREE.Box3 {
    let cache = visibleBounds.get(object);
    let changed = !cache;
    if (!cache) { cache = { box: new THREE.Box3(), parts: [] }; visibleBounds.set(object, cache); }
    let count = 0;
    const inspect = (node: THREE.Object3D) => {
        const visible = mouseVisible(node), geometry = node instanceof THREE.Mesh ? node.geometry : undefined;
        const attribute = geometry?.getAttribute('position');
        const version = attribute ? spatialAttributeVersion(attribute) : undefined;
        let part = cache.parts[count++];
        if (!part || part.object !== node) {
            part = { object: node, visible, matrix: node.matrixWorld.clone(), geometry, attribute, version };
            cache.parts[count - 1] = part; changed = true;
        } else if (part.visible !== visible || part.geometry !== geometry || part.attribute !== attribute
            || part.version !== version || !part.matrix.equals(node.matrixWorld)) {
            Object.assign(part, { visible, geometry, attribute, version }); part.matrix.copy(node.matrixWorld); changed = true;
        }
        if (visible) for (const child of node.children) inspect(child);
    };
    inspect(object);
    if (count !== cache.parts.length) { cache.parts.length = count; changed = true; }
    if (changed) {
        cache.box.makeEmpty();
        const partBox = new THREE.Box3();
        for (const part of cache.parts) {
            if (!part.visible || !part.geometry) continue;
            prepareSpatialGeometryBounds(part.geometry);
            if (part.geometry.boundingBox) cache.box.union(partBox.copy(part.geometry.boundingBox).applyMatrix4(part.matrix));
        }
    }
    return cache.box;
}

/** Input:GetWorldEntityUnderMouse excludes invisible/NOCLICK entities before action selection. */
export function intersectSpriteEntities(raycaster: THREE.Raycaster, objects: THREE.Object3D[], recursive = true): THREE.Intersection[] {
    const hits: THREE.Intersection[] = [];
    const point = new THREE.Vector3();
    const intersect = (object: THREE.Object3D) => {
        if (!mouseVisible(object)) return;
        let propagate = true;
        if (object.layers.test(raycaster.layers)) {
            if (object.userData.rayTestOnBB) {
                // AnimState:SetRayTestOnBB includes visible particle gaps, never hidden parts.
                const box = spriteBounds(object);
                if (!box.isEmpty() && raycaster.ray.intersectBox(box, point)) {
                    const distance = point.distanceTo(raycaster.ray.origin);
                    if (distance >= raycaster.near && distance <= raycaster.far) hits.push({ distance, point: point.clone(), object });
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
        if (!parent) {
            object.updateWorldMatrix(true, true);
            intersect(object);
        }
    }
    return hits.sort((a, b) => a.distance - b.distance);
}

export class PointerRaycaster {
    private readonly camera: THREE.Camera;
    private readonly renderer: THREE.WebGLRenderer;
    private readonly ground?: THREE.Object3D;
    private readonly pointerEvents?: EventTarget;
    private readonly raycaster = new THREE.Raycaster();
    private readonly paddedRaycaster = new THREE.Raycaster();
    private readonly paddedBounds = new THREE.Box3();
    private readonly paddingCenter = new THREE.Vector3();
    private readonly ndc = new THREE.Vector2();
    private clientX = 0;
    private clientY = 0;
    private hasPointerPosition = false;
    private cacheGround = false;
    private groundCached = false;
    private cachedGround?: THREE.Intersection;

    /** Object-only picking can omit ground; ground queries then return no hit. */
    constructor(world: Pick<WorldContext, 'camera' | 'renderer'> & Partial<Pick<WorldContext, 'ground' | 'scene'>>) {
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
        if (!this.updatePointerRay()) return undefined;
        return intersectSpriteEntities(this.raycaster, objects, recursive)[0];
    }

    pickMouseTarget(): THREE.Intersection | undefined {
        if (!this.updatePointerRay()) return undefined;
        const candidates: THREE.Object3D[] = [];
        // The registry already excludes removed, detached, inactive, disabled and NOCLICK roots.
        for (const entity of mouseTargets) if (mouseVisible(entity.model)) candidates.push(entity.model);
        return intersectSpriteEntities(this.raycaster, candidates)[0] ?? this.pickPaddedTarget(candidates);
    }

    /** Enlarge only the input shape: shared geometry and the drawn model remain untouched. */
    private pickPaddedTarget(candidates: THREE.Object3D[]): THREE.Intersection | undefined {
        const { raycaster, paddedRaycaster, paddedBounds, paddingCenter } = this;
        paddedRaycaster.near = raycaster.near / SPRITE_PICK_SCALE;
        paddedRaycaster.far = raycaster.far / SPRITE_PICK_SCALE;
        paddedRaycaster.layers.mask = raycaster.layers.mask;
        paddedRaycaster.camera = raycaster.camera;
        let nearest: THREE.Intersection | undefined;
        for (const model of candidates) {
            const bounds = spriteBounds(model);
            // Preserve transparent holes inside the original silhouette's enclosing box.
            if (bounds.isEmpty() || raycaster.ray.intersectsBox(bounds)) continue;
            bounds.getCenter(paddingCenter);
            paddedBounds.copy(bounds);
            paddedBounds.min.sub(paddingCenter).multiplyScalar(SPRITE_PICK_SCALE).add(paddingCenter);
            paddedBounds.max.sub(paddingCenter).multiplyScalar(SPRITE_PICK_SCALE).add(paddingCenter);
            if (!raycaster.ray.intersectsBox(paddedBounds)) continue;
            // Contract the ray around the sprite centre, then reuse its exact alpha-aware picking.
            paddedRaycaster.ray.origin.copy(raycaster.ray.origin).sub(paddingCenter)
                .multiplyScalar(1 / SPRITE_PICK_SCALE).add(paddingCenter);
            paddedRaycaster.ray.direction.copy(raycaster.ray.direction);
            const hit = intersectSpriteEntities(paddedRaycaster, [model])[0];
            if (!hit) continue;
            hit.point.sub(paddingCenter).multiplyScalar(SPRITE_PICK_SCALE).add(paddingCenter);
            hit.distance = hit.point.distanceTo(raycaster.ray.origin);
            if (!nearest || hit.distance < nearest.distance) nearest = hit;
        }
        return nearest;
    }

    private updatePointerRay(): boolean {
        if (!this.hasPointerPosition) return false;
        const bounds = this.renderer.domElement.getBoundingClientRect();
        this.ndc.x = ((this.clientX - bounds.left) / bounds.width) * 2 - 1;
        this.ndc.y = -((this.clientY - bounds.top) / bounds.height) * 2 + 1;
        this.raycaster.setFromCamera(this.ndc, this.camera);
        return true;
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

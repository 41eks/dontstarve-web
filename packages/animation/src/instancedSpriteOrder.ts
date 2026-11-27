import * as THREE from 'three';
import { spriteRenderOrderKey } from './renderOrder';
import type { SpritePlacement } from './instancedSpritePlacement';

/** A drawn frame's local rectangle: a composed atlas frame's or a part table frame's clip-wide bounds. */
export interface SpriteFrameBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly width: number;
  readonly height: number;
}

/** An entity's world bounds for its current frame, and whether they were in view at camera `camera`. */
export interface SpriteSpatial {
  frame: SpriteFrameBounds;
  transformVersion: number;
  sphere: THREE.Sphere;
  camera: number;
  visible: boolean;
  /** Bumped whenever the bounds change, so uploads rewrite the instance matrix. */
  version: number;
}

export function createSpriteSpatial(frame: SpriteFrameBounds): SpriteSpatial {
  return { frame, transformVersion: -1, sphere: new THREE.Sphere(), camera: -1, visible: false, version: 0 };
}

/** A drawn sprite's foot point and the order keys derived from it at camera `camera`. */
export interface FootOrder {
  /** The foot's world position, which `spriteRenderOrderKey` reads. */
  x: number;
  y: number;
  z: number;
  /** The foot-point sort layer the key was made with. */
  sortLayer: number;
  /** `spriteRenderOrderKey` of the foot. */
  key: number;
  camera: number;
}

/** The camera's frustum, versioned so per-entity culling and order keys are only recomputed when it moves. */
export class SpriteCameraView {
  /** Bumped whenever the view or projection changes. */
  version = 0;
  private readonly frustum = new THREE.Frustum();
  private readonly frustumMatrix = new THREE.Matrix4();
  private readonly previousFrustumMatrix = new THREE.Matrix4();
  private readonly previousViewMatrix = new THREE.Matrix4();
  private coordinateSystem?: THREE.Camera['coordinateSystem'];
  private viewMatrix = this.previousViewMatrix;

  update(camera: THREE.Camera): void {
    this.viewMatrix = camera.matrixWorldInverse;
    this.frustumMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    if (
      this.coordinateSystem !== camera.coordinateSystem ||
      !this.frustumMatrix.equals(this.previousFrustumMatrix) ||
      !camera.matrixWorldInverse.equals(this.previousViewMatrix)
    ) {
      this.previousFrustumMatrix.copy(this.frustumMatrix);
      this.coordinateSystem = camera.coordinateSystem;
      this.previousViewMatrix.copy(camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.frustumMatrix, camera.coordinateSystem);
      this.version++;
    }
  }

  /**
   * A single InstancedMesh has no per-entity frustum culling: whether the whole assembled frame, placed by
   * `placement`, is in view. Bounds are rebuilt only when the placement or frame rectangle changes; a billboard's
   * enclose the frame turned any way about its origin, so they hold whatever the camera's rotation.
   */
  isVisible(spatial: SpriteSpatial, frame: SpriteFrameBounds, placement: SpritePlacement): boolean {
    const transformVersion = placement.version;
    if (
      spatial.transformVersion !== transformVersion ||
      spatial.frame.width !== frame.width ||
      spatial.frame.height !== frame.height ||
      spatial.frame.minX !== frame.minX ||
      spatial.frame.minY !== frame.minY
    ) {
      spatial.transformVersion = transformVersion;
      spatial.frame = frame;
      spatial.version++;
      const { sphere } = spatial;
      if (placement.facesCamera) {
        const { scale } = placement;
        sphere.center.set(0, 0, 0);
        // The frame's farthest corner from the origin, in the visual's scale.
        const x = Math.max(Math.abs(frame.minX), Math.abs(frame.maxX)),
          y = Math.max(Math.abs(frame.minY), Math.abs(frame.maxY));
        sphere.radius = Math.hypot(x, y) * Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
      } else {
        sphere.center.set((frame.minX + frame.maxX) / 2, (frame.minY + frame.maxY) / 2, 0);
        sphere.radius = Math.hypot(frame.width, frame.height) / 2;
      }
      sphere.applyMatrix4(placement.matrix);
      spatial.camera = -1;
    }
    if (spatial.camera !== this.version) {
      spatial.visible = this.frustum.intersectsSphere(spatial.sphere);
      spatial.camera = this.version;
    }
    return spatial.visible;
  }

  /**
   * Moves `order` to the foot at `matrixWorld` and `sortLayer`, recomputing its key with the ordinary sprites' foot
   * rule only when the foot, layer or camera moved. Returns whether the order key changed.
   */
  placeFoot(order: FootOrder, matrixWorld: THREE.Matrix4, sortLayer: number): boolean {
    const world = matrixWorld.elements;
    const x = world[12],
      y = world[13],
      z = world[14];
    if (
      order.camera === this.version &&
      order.x === x &&
      order.y === y &&
      order.z === z &&
      order.sortLayer === sortLayer
    ) {
      return false;
    }
    order.x = x;
    order.y = y;
    order.z = z;
    order.sortLayer = sortLayer;
    const key = spriteRenderOrderKey(order, this.viewMatrix, 0, sortLayer);
    const changed = order.key !== key;
    order.key = key;
    order.camera = this.version;
    return changed;
  }
}

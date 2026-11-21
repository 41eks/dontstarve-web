import * as THREE from 'three';
import { DEPTH_OFFSET_UNITS } from './animationAssets';
import type { RgbaSpriteAtlasFrame } from './rgbaSpriteAtlas';
import { spriteRenderDepthGroup, spriteRenderLateral, spriteRenderOrderKey } from './renderOrder';

/**
 * `DEPTH_OFFSET_UNITS` depth-buffer steps of a 24-bit buffer, in clip-space depth (a step is 2^-24 of the [0, 1]
 * window range, 2^-23 of NDC): past float rounding between coplanar billboards, far below any real gap.
 */
export const DEPTH_RANK_STEP = -DEPTH_OFFSET_UNITS * 2 ** -23;

/** An entity's world bounds for its current frame, and whether they were in view at camera `camera`. */
export interface SpriteSpatial {
  frame: RgbaSpriteAtlasFrame;
  transformVersion: number;
  sphere: THREE.Sphere;
  camera: number;
  visible: boolean;
  /** Bumped whenever the bounds change, so uploads rewrite the instance matrix. */
  version: number;
}

export function createSpriteSpatial(frame: RgbaSpriteAtlasFrame): SpriteSpatial {
  return { frame, transformVersion: -1, sphere: new THREE.Sphere(), camera: -1, visible: false, version: 0 };
}

/** A drawn sprite's foot point and the order keys derived from it at camera `camera`. */
export interface FootOrder {
  /** The foot's world position, which `spriteRenderOrderKey` reads. */
  x: number;
  y: number;
  z: number;
  /** `spriteRenderOrderKey` of the foot. */
  key: number;
  /** `spriteRenderLateral` of the foot. */
  lateral: number;
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
   * `matrixWorld`, is in view. Bounds are rebuilt only when the transform or frame rectangle changes.
   */
  isVisible(
    spatial: SpriteSpatial,
    frame: RgbaSpriteAtlasFrame,
    matrixWorld: THREE.Matrix4,
    transformVersion: number,
  ): boolean {
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
      spatial.sphere.center.set((frame.minX + frame.maxX) / 2, (frame.minY + frame.maxY) / 2, 0);
      spatial.sphere.radius = Math.hypot(frame.width, frame.height) / 2;
      spatial.sphere.applyMatrix4(matrixWorld);
      spatial.camera = -1;
    }
    if (spatial.camera !== this.version) {
      spatial.visible = this.frustum.intersectsSphere(spatial.sphere);
      spatial.camera = this.version;
    }
    return spatial.visible;
  }

  /**
   * Moves `order` to the foot at `matrixWorld`, recomputing its keys with the ordinary sprites' foot rule only when
   * the foot or camera moved. Returns whether the order key changed.
   */
  placeFoot(order: FootOrder, matrixWorld: THREE.Matrix4): boolean {
    const world = matrixWorld.elements;
    const x = world[12],
      y = world[13],
      z = world[14];
    if (order.camera === this.version && order.x === x && order.y === y && order.z === z) {
      return false;
    }
    order.x = x;
    order.y = y;
    order.z = z;
    const key = spriteRenderOrderKey(order, this.viewMatrix);
    const changed = order.key !== key;
    order.key = key;
    order.lateral = spriteRenderLateral(order, this.viewMatrix);
    order.camera = this.version;
    return changed;
  }
}

export interface RankedPage<D> {
  /** The page's drawn sprites this frame, in collection order; only the first `count` are current. */
  readonly members: readonly D[];
  readonly count: number;
  /** Filled by `rankSprites` in draw order. */
  readonly entries: D[];
}

export interface RankedSprite<D> {
  readonly entry: {
    /** Drawn towards the camera after the others on its foot. */
    readonly depthOffset: boolean;
    /** The stable tie-break. */
    readonly foot: { readonly id: number };
    /** Its radius is the on-screen half extent around `lateral`. */
    readonly spatial?: { readonly sphere: { readonly radius: number } };
  };
  readonly key: number;
  readonly lateral: number;
  readonly page: RankedPage<D>;
  bias: number;
}

/**
 * Orders one scene's drawn sprites by their foot key, an offset sprite after the others on its foot, then the
 * entity's id. Each page draws its sprites in this order. The depth batches write every page's depth before any
 * colour, so overlapping sprites on one camera plane would otherwise be decided by float noise in their depths and
 * flicker as the camera moves: each later one of an overlapping coplanar run is drawn `DEPTH_RANK_STEP` nearer.
 * A run restarts where the next sprite clears the run on screen, so the nudge stays a few depth steps.
 *
 * `scratch` is reused between calls and left empty.
 */
export function rankSprites<D extends RankedSprite<D>>(pages: Iterable<RankedPage<D>>, scratch: D[]): void {
  scratch.length = 0;
  for (const page of pages) {
    for (let index = 0; index < page.count; index++) {
      scratch.push(page.members[index]);
    }
    page.entries.length = 0;
  }
  scratch.sort(
    (a, b) =>
      a.key - b.key || Number(a.entry.depthOffset) - Number(b.entry.depthOffset) || a.entry.foot.id - b.entry.foot.id,
  );
  let group = NaN,
    rank = 0,
    right = -Infinity;
  for (const draw of scratch) {
    const radius = draw.entry.spatial!.sphere.radius;
    const depthGroup = spriteRenderDepthGroup(draw.key);
    if (depthGroup !== group || draw.lateral - radius > right) {
      group = depthGroup;
      rank = 0;
      right = -Infinity;
    } else {
      rank++;
    }
    right = Math.max(right, draw.lateral + radius);
    draw.bias = rank * DEPTH_RANK_STEP;
    draw.page.entries.push(draw);
  }
  scratch.length = 0;
}

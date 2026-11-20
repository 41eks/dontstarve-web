import * as THREE from 'three';
import { backTasks } from './animate';
import { playerInstance } from './player';
import type { ReadonlyVector3 } from '../packages/animation/src/transformRoot';
import { WORLD_SCALE } from '../packages/prefab/src/standardcomponents';
import { renderer } from './universal';
import { createSignal, readonlySignal } from '@dontstarve-web/signals';
import { facingFromHeading } from '@dontstarve-web/animation/facing';
import { initialSave } from './save/initialSave';
import { DownVecForHeading, RightVecForHeading, type TheCamera } from '../packages/prefab/src/followcamera';

const DEFAULT_HEADING = 45;

/** followcamera.lua SetDefault's distances (DST units) and the pitches lerped across them. */
interface FollowCameraDefaults {
  distanceTarget: number;
  minDist: number;
  maxDist: number;
  minDistPitch: number;
  maxDistPitch: number;
}

const FOREST_CAMERA: FollowCameraDefaults = {
  distanceTarget: 30,
  minDist: 15,
  maxDist: 50,
  minDistPitch: 30,
  maxDistPitch: 60,
};
/** SetDefault's TheWorld:HasTag("cave") branch: a closer, flatter camera. */
const CAVE_CAMERA: FollowCameraDefaults = {
  distanceTarget: 25,
  minDist: 15,
  maxDist: 35,
  minDistPitch: 25,
  maxDistPitch: 40,
};
const ROTATION_STEP = 45;
const EPSILON = 0.01;
const ORIGIN = new THREE.Vector3();

/**
 * What the camera follows: an entity's logical transform (Transform:GetWorldPosition), not its display object. The
 * player is not parented, so its position is its world position.
 */
export interface FollowCameraTarget {
  readonly position: ReadonlyVector3;
}

function normalizeDegrees(angle: number): number {
  return THREE.MathUtils.euclideanModulo(angle, 360);
}

function clampedLerp(from: number, to: number, amount: number): number {
  return THREE.MathUtils.lerp(from, to, THREE.MathUtils.clamp(amount, 0, 1));
}

function shortestAngleDelta(from: number, to: number): number {
  return THREE.MathUtils.euclideanModulo(to - from + 180, 360) - 180;
}

/**
 * Three.js adaptation of DST's cameras/followcamera.lua.
 *
 * The controller deliberately keeps the followed point, heading and distance as
 * separate current/target values. This gives player movement, 45-degree turns,
 * and wheel zoom the same independently smoothed behaviour as the game camera.
 */
export class FollowCameraController implements TheCamera {
  readonly camera: THREE.PerspectiveCamera;

  private target: FollowCameraTarget | null;
  private readonly targetOffset = new THREE.Vector3(0, 1.5, 0);
  private readonly targetPosition = new THREE.Vector3();
  private readonly currentPosition = new THREE.Vector3();
  private readonly cameraDirection = new THREE.Vector3();
  private readonly cameraRight = new THREE.Vector3();
  private readonly cameraUp = new THREE.Vector3();
  private readonly orientationMatrix = new THREE.Matrix4();
  private readonly orientation = new THREE.Quaternion();
  private orientedHeading = Number.NaN;
  private orientedPitch = Number.NaN;

  private heading = DEFAULT_HEADING;
  /** Eight-faced FACING_* bit of the current heading; written only when the heading crosses a 45-degree sector. */
  private readonly facingState = createSignal(facingFromHeading(DEFAULT_HEADING));
  readonly facing = readonlySignal(this.facingState);
  /** TheCamera:GetHeading(), in degrees; placers rotate against it. */
  private readonly headingState = createSignal(DEFAULT_HEADING);
  readonly headingAngle = readonlySignal(this.headingState);
  private headingTarget = DEFAULT_HEADING;
  private distance: number;
  private distanceTarget: number;
  private paused = false;

  // Distances in DST units, scaled by TILE_SIZE / TILE_SCALE.
  readonly minDistance: number;
  readonly maxDistance: number;
  readonly minDistancePitch: number;
  readonly maxDistancePitch: number;
  readonly panGain = 4;
  readonly headingGain = 20;
  readonly distanceGain = 1;
  readonly zoomStep = 4 * WORLD_SCALE;

  constructor(target: FollowCameraTarget, defaults: FollowCameraDefaults = FOREST_CAMERA) {
    this.target = target;
    this.distance = this.distanceTarget = defaults.distanceTarget * WORLD_SCALE;
    this.minDistance = defaults.minDist * WORLD_SCALE;
    this.maxDistance = defaults.maxDist * WORLD_SCALE;
    this.minDistancePitch = defaults.minDistPitch;
    this.maxDistancePitch = defaults.maxDistPitch;
    this.camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 5000);
    this.snap();
  }

  setTarget(target: FollowCameraTarget | null): void {
    this.target = target;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  getHeading(): number {
    return this.heading;
  }

  getHeadingTarget(): number {
    return this.headingTarget;
  }

  setHeadingTarget(heading: number): void {
    this.headingTarget = normalizeDegrees(heading);
  }

  /** followcamera.lua GetDownVec: from headingtarget, not the heading still turning toward it. */
  GetDownVec(out?: THREE.Vector3): THREE.Vector3 {
    return DownVecForHeading(this.headingTarget, out);
  }

  /** followcamera.lua GetRightVec, in this scene's right-handed axes. */
  GetRightVec(out?: THREE.Vector3): THREE.Vector3 {
    return RightVecForHeading(this.headingTarget, out);
  }

  rotateLeft(): void {
    this.setHeadingTarget(this.headingTarget - ROTATION_STEP);
  }

  rotateRight(): void {
    this.setHeadingTarget(this.headingTarget + ROTATION_STEP);
  }

  getDistance(): number {
    return this.distanceTarget;
  }

  setDistance(distance: number): void {
    this.distanceTarget = THREE.MathUtils.clamp(distance, this.minDistance, this.maxDistance);
  }

  zoomIn(step = this.zoomStep): void {
    this.setDistance(this.distanceTarget - step);
  }

  zoomOut(step = this.zoomStep): void {
    this.setDistance(this.distanceTarget + step);
  }

  maximizeDistance(): void {
    this.setDistance((this.maxDistance - this.minDistance) * 0.7 + this.minDistance);
  }

  snap(): void {
    this.updateTargetPosition();
    this.currentPosition.copy(this.targetPosition);
    this.heading = this.headingTarget;
    this.distance = this.distanceTarget;
    this.apply();
  }

  update(dt: number): void {
    if (this.paused) {
      return;
    }

    this.updateTargetPosition();
    const panAmount = dt * this.panGain;
    this.currentPosition.set(
      clampedLerp(this.currentPosition.x, this.targetPosition.x, panAmount),
      clampedLerp(this.currentPosition.y, this.targetPosition.y, panAmount),
      clampedLerp(this.currentPosition.z, this.targetPosition.z, panAmount),
    );

    const headingDelta = shortestAngleDelta(this.heading, this.headingTarget);
    if (Math.abs(headingDelta) <= EPSILON) {
      this.heading = this.headingTarget;
    } else {
      this.heading = normalizeDegrees(this.heading + headingDelta * THREE.MathUtils.clamp(dt * this.headingGain, 0, 1));
    }

    if (Math.abs(this.distance - this.distanceTarget) <= EPSILON) {
      this.distance = this.distanceTarget;
    } else {
      this.distance = clampedLerp(this.distance, this.distanceTarget, dt * this.distanceGain);
    }

    this.apply();
  }

  private updateTargetPosition(): void {
    if (this.target) {
      const { x, y, z } = this.target.position;
      this.targetPosition.set(x, y, z);
    } else {
      this.targetPosition.set(0, 0, 0);
    }
    this.targetPosition.add(this.targetOffset);
  }

  private apply(): void {
    const pitch = THREE.MathUtils.lerp(
      this.minDistancePitch,
      this.maxDistancePitch,
      (this.distance - this.minDistance) / (this.maxDistance - this.minDistance),
    );
    const pitchRadians = THREE.MathUtils.degToRad(pitch);
    this.headingState.set(this.heading);
    this.facingState.set(facingFromHeading(this.heading));
    const headingRadians = THREE.MathUtils.degToRad(this.heading);
    const cosPitch = Math.cos(pitchRadians);

    // Same direction convention used by followcamera.lua's Apply().
    this.cameraDirection.set(
      -cosPitch * Math.cos(headingRadians),
      -Math.sin(pitchRadians),
      -cosPitch * Math.sin(headingRadians),
    );
    this.camera.position.copy(this.currentPosition).addScaledVector(this.cameraDirection, -this.distance);

    const rightRadians = THREE.MathUtils.degToRad(this.heading + 90);
    this.cameraRight.set(Math.cos(rightRadians), 0, Math.sin(rightRadians));
    this.cameraUp.crossVectors(this.cameraDirection, this.cameraRight).normalize();
    this.camera.up.copy(this.cameraUp);
    // The orientation depends only on heading and pitch. Recomputing it from the
    // eye/target difference (camera.lookAt) adds position-dependent rounding, which
    // makes every camera-facing billboard look rotated while the player walks.
    if (this.heading !== this.orientedHeading || pitch !== this.orientedPitch) {
      this.orientationMatrix.lookAt(ORIGIN, this.cameraDirection, this.cameraUp);
      this.orientation.setFromRotationMatrix(this.orientationMatrix);
      this.orientedHeading = this.heading;
      this.orientedPitch = pitch;
    }
    this.camera.quaternion.copy(this.orientation);
    this.camera.updateMatrixWorld();
  }
}

export const followCamera = new FollowCameraController(
  playerInstance,
  initialSave.world.prefab === 'cave' ? CAVE_CAMERA : FOREST_CAMERA,
);
export const camera = followCamera.camera;

// followcamera.lua keeps updating under SetAutopaused (e.g. the open map), so use the unpaused frame time.
backTasks.push((dt, unpausedDt = dt) => followCamera.update(unpausedDt));

window.addEventListener('game:camera-turn', event => {
  const direction = event.detail.direction;
  if (direction === 'left') {
    followCamera.rotateRight();
  } else if (direction === 'right') {
    followCamera.rotateLeft();
  }
});

window.addEventListener('keydown', event => {
  const target = event.target;
  const isTextInput =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable);
  if (isTextInput || event.repeat || event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }

  if (event.code === 'KeyQ') {
    followCamera.rotateRight();
  } else if (event.code === 'KeyE') {
    followCamera.rotateLeft();
  }
});

renderer.domElement.addEventListener(
  'wheel',
  event => {
    if (event.deltaY === 0) {
      return;
    }
    event.preventDefault();
    if (event.deltaY < 0) {
      followCamera.zoomIn();
    } else {
      followCamera.zoomOut();
    }
  },
  { passive: false },
);

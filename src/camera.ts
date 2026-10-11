import * as THREE from 'three';
import { backTasks } from './animate';
import { player } from './player';
import { renderer } from './universal';

const DEFAULT_HEADING = 45;
const DEFAULT_DISTANCE = 70;
const ROTATION_STEP = 45;
const EPSILON = 0.01;

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
export class FollowCameraController {
  readonly camera: THREE.PerspectiveCamera;

  private target: THREE.Object3D | null;
  private readonly targetOffset = new THREE.Vector3(0, 1.5, 0);
  private readonly targetPosition = new THREE.Vector3();
  private readonly currentPosition = new THREE.Vector3();
  private readonly cameraDirection = new THREE.Vector3();
  private readonly cameraRight = new THREE.Vector3();
  private readonly cameraUp = new THREE.Vector3();

  private heading = DEFAULT_HEADING;
  private headingTarget = DEFAULT_HEADING;
  private distance = DEFAULT_DISTANCE;
  private distanceTarget = DEFAULT_DISTANCE;
  private paused = false;

  readonly minDistance = 15;
  readonly maxDistance = 70;
  readonly minDistancePitch = 30;
  readonly maxDistancePitch = 60;
  readonly panGain = 4;
  readonly headingGain = 20;
  readonly distanceGain = 1;
  readonly zoomStep = 4;

  constructor(target: THREE.Object3D) {
    this.target = target;
    this.camera = new THREE.PerspectiveCamera(
      35,
      window.innerWidth / window.innerHeight,
      0.1,
      5000,
    );
    this.snap();
  }

  setTarget(target: THREE.Object3D | null): void {
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
    this.distanceTarget = THREE.MathUtils.clamp(
      distance,
      this.minDistance,
      this.maxDistance,
    );
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
    if (this.paused) return;

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
      this.heading = normalizeDegrees(
        this.heading + headingDelta * THREE.MathUtils.clamp(dt * this.headingGain, 0, 1),
      );
    }

    if (Math.abs(this.distance - this.distanceTarget) <= EPSILON) {
      this.distance = this.distanceTarget;
    } else {
      this.distance = clampedLerp(
        this.distance,
        this.distanceTarget,
        dt * this.distanceGain,
      );
    }

    this.apply();
  }

  private updateTargetPosition(): void {
    if (this.target) {
      this.target.getWorldPosition(this.targetPosition);
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
    const headingRadians = THREE.MathUtils.degToRad(this.heading);
    const cosPitch = Math.cos(pitchRadians);

    // Same direction convention used by followcamera.lua's Apply().
    this.cameraDirection.set(
      -cosPitch * Math.cos(headingRadians),
      -Math.sin(pitchRadians),
      -cosPitch * Math.sin(headingRadians),
    );
    this.camera.position
      .copy(this.currentPosition)
      .addScaledVector(this.cameraDirection, -this.distance);

    const rightRadians = THREE.MathUtils.degToRad(this.heading + 90);
    this.cameraRight.set(Math.cos(rightRadians), 0, Math.sin(rightRadians));
    this.cameraUp.crossVectors(this.cameraDirection, this.cameraRight).normalize();
    this.camera.up.copy(this.cameraUp);
    this.camera.lookAt(this.currentPosition);
    this.camera.updateMatrixWorld();
  }
}

export const followCamera = new FollowCameraController(player);
export const camera = followCamera.camera;

backTasks.push((dt) => followCamera.update(dt));

window.addEventListener('game:camera-turn', (event) => {
  const direction = (event as CustomEvent<{ direction?: unknown }>).detail?.direction;
  if (direction === 'left') followCamera.rotateRight();
  else if (direction === 'right') followCamera.rotateLeft();
});

window.addEventListener('keydown', (event) => {
  const target = event.target;
  const isTextInput = target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || (target instanceof HTMLElement && target.isContentEditable);
  if (isTextInput || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;

  if (event.code === 'KeyQ') followCamera.rotateRight();
  else if (event.code === 'KeyE') followCamera.rotateLeft();
});

renderer.domElement.addEventListener('wheel', (event) => {
  if (event.deltaY === 0) return;
  event.preventDefault();
  if (event.deltaY < 0) followCamera.zoomIn();
  else followCamera.zoomOut();
}, { passive: false });

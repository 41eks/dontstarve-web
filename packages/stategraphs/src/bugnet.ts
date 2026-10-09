import { WILSON_ACTION_TIMES } from './SGwilson.ts';
import * as THREE from 'three';
import { PointerRaycaster } from './pointerRaycaster.ts';
import type { ActionWorldContext as WorldContext, ActionAnimationController as WilsonAnimationController, ActionLocomotor as Locomotor } from './actionContext.ts';

export const BUGNET_HIT_TIME = WILSON_ACTION_TIMES.net;
export const BUGNET_CAPTURE_RANGE = 4;
const APPROACH_DISTANCE = 1;

export interface NetCaptureTarget {
  readonly id: string;
  readonly model: THREE.Group;
  readonly position: THREE.Vector3;
  isValid(): boolean;
  isClickable?(): boolean;
  /** Transfers one live creature to inventory; failure leaves it in the world. */
  capture(): boolean;
}
export type ButterflyCaptureTarget = NetCaptureTarget;

/** Queues the NET action, follows a moving target, then validates the swing hit. */
export class BugNetCaptureController {
  private readonly world: WorldContext;
  private readonly animation: WilsonAnimationController;
  private readonly locomotor: Pick<Locomotor, 'goToPoint' | 'stop' | 'destination'>;
  private readonly isEquipped: () => boolean;
  private readonly getTargets: () => readonly NetCaptureTarget[];
  private readonly isManualMovement: () => boolean;
  private readonly pointer: PointerRaycaster;
  private readonly unregisterHover: () => void;
  private target?: NetCaptureTarget;
  private actionVersion = 0;
  private repathRemaining = 0;
  private readonly direction = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();

  constructor(
    world: WorldContext,
    animation: WilsonAnimationController,
    locomotor: Pick<Locomotor, 'goToPoint' | 'stop' | 'destination'>,
    isEquipped: () => boolean,
    getTargets: () => readonly NetCaptureTarget[],
    isManualMovement = () => false,
  ) {
    this.world = world;
    this.animation = animation;
    this.locomotor = locomotor;
    this.isEquipped = isEquipped;
    this.getTargets = getTargets;
    this.isManualMovement = isManualMovement;
    this.pointer = world.mouseActions?.pointer ?? new PointerRaycaster(world);
    this.unregisterHover = world.mouseActions?.register(() =>
      this.getTargets().filter(target => target.isValid() && target.isClickable?.() !== false).map(target => ({
        action: { action: 'NET' }, button: 'left', model: target.model, available: this.isEquipped(),
      }))) ?? (() => {});
    world.renderer.domElement.addEventListener('pointerdown', this.handleGroundClick);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  request(target: NetCaptureTarget): boolean {
    if (!this.isEquipped() || !target.isValid() || target.isClickable?.() === false
      || this.animation.isNetting || this.animation.isCasting) return false;
    this.cancel();
    this.target = target;
    this.repathRemaining = 0;
    return true;
  }

  cancel(): void {
    this.actionVersion++;
    if (this.target) this.locomotor.stop();
    this.target = undefined;
  }

  update(dt: number): void {
    if (!this.target) return;
    const target = this.target;
    if (!this.isEquipped() || !target.isValid() || this.isManualMovement()) {
      this.cancel();
      return;
    }
    const distanceSquared = this.distanceSquared(target);
    if (distanceSquared <= APPROACH_DISTANCE ** 2) {
      this.locomotor.stop();
      this.faceTarget(target);
      const version = this.actionVersion;
      const started = this.animation.playBugNet(() => {
        if (version === this.actionVersion && this.isEquipped() && target.isValid()
          && this.distanceSquared(target) <= BUGNET_CAPTURE_RANGE ** 2) target.capture();
      });
      if (started) this.target = undefined;
      return;
    }
    this.repathRemaining -= Math.max(0, dt);
    // Close pursuit needs a fresh point every frame: the butterfly keeps flying
    // while the previous destination becomes stale and the locomotor slows down.
    if (this.repathRemaining <= 0 || distanceSquared <= BUGNET_CAPTURE_RANGE ** 2) {
      this.repathRemaining = 0.2;
      if (!this.locomotor.goToPoint(target.position)) this.cancel();
    }
  }

  dispose(): void {
    this.cancel();
    this.unregisterHover();
    if (this.pointer !== this.world.mouseActions?.pointer) this.pointer.dispose();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handleGroundClick);
    window.removeEventListener('keydown', this.handleKeyDown);
  }

  private distanceSquared(target: ButterflyCaptureTarget): number {
    return (this.world.player.position.x - target.position.x) ** 2
      + (this.world.player.position.z - target.position.z) ** 2;
  }

  private faceTarget(target: ButterflyCaptureTarget): void {
    this.direction.subVectors(target.position, this.world.player.position).setY(0);
    if (this.direction.lengthSq() < 1e-8) return;
    this.world.camera.getWorldDirection(this.forward);
    this.forward.setY(0).normalize();
    this.right.crossVectors(this.forward, new THREE.Vector3(0, 1, 0)).normalize();
    const forward = this.direction.dot(this.forward);
    const side = this.direction.dot(this.right);
    this.animation.setFacing(Math.abs(forward) >= Math.abs(side) ? (forward > 0 ? 'up' : 'down') : 'side',
      Math.abs(side) > Math.abs(forward) && side < 0);
  }

  private readonly handleGroundClick = (event: PointerEvent) => {
    // GroundItemManager consumes target clicks before this listener runs.
    if (event.button === 0 && !event.defaultPrevented) this.cancel();
  };
  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') this.cancel();
  };
}

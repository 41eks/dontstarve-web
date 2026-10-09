import { bindActionCancellation } from './actionEvents.ts';
import { bindHandEquipmentUpdate, type HandEquipmentSignal } from './handEquipment.ts';
import { WILSON_ACTION_TIMES } from './SGwilson.ts';
import * as THREE from 'three';
import { PointerRaycaster } from './pointerRaycaster.ts';
import type { ActionWorldContext as WorldContext, ActionAnimationController as WilsonAnimationController, ActionLocomotor as Locomotor } from './actionContext.ts';
import type { TerraformMap as TurfMap } from './farmActions.ts';

export const PITCHFORK_DIG_TIME = WILSON_ACTION_TIMES.terraform;
export const PITCHFORK_REACH = 4;

/** TERRAFORM is a right-click point action, snapped to the source map tile. */
export class PitchforkActionController {
  private readonly pointer: PointerRaycaster;
  private readonly unregisterHover: () => void;
  private target?: THREE.Vector3;
  private actionVersion = 0;
  private readonly direction = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly world: WorldContext;
  private readonly animation: WilsonAnimationController;
  private readonly locomotor: Pick<Locomotor, 'goToPoint' | 'stop' | 'destination'>;
  private readonly handEquipment: HandEquipmentSignal;
  private readonly stopEquipment: () => void;
  private readonly stopActionEvents: () => void;
  private readonly turf: TurfMap;
  private readonly isManualMovement: () => boolean;

  constructor(
    world: WorldContext,
    animation: WilsonAnimationController,
    locomotor: Pick<Locomotor, 'goToPoint' | 'stop' | 'destination'>,
    handEquipment: HandEquipmentSignal,
    turf: TurfMap,
    isManualMovement = () => false,
  ) {
    this.world = world;
    this.animation = animation;
    this.locomotor = locomotor;
    this.handEquipment = handEquipment;
    this.stopEquipment = bindHandEquipmentUpdate(handEquipment, {
      isEquipped: equipment => this.isEquipped(equipment),
      cancel: () => this.cancel(true),
      update: dt => this.update(dt),
      registerFrameTask: world.registerFrameTask,
    });
    this.turf = turf;
    this.isManualMovement = isManualMovement;
    this.stopActionEvents = bindActionCancellation(world, this, 'hand', () => this.cancel());
    this.pointer = world.mouseActions?.pointer ?? new PointerRaycaster(world);
    this.unregisterHover = world.mouseActions?.register(() => this.hitTarget()
      ? [{ action: { action: 'TERRAFORM' }, button: 'right' }] : []) ?? (() => {});
    // Consume a terraform click before container and placement handlers.
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  private isEquipped(equipment = this.handEquipment.peek()): boolean {
    const itemId = equipment?.itemId;
    return itemId === 'pitchfork' || itemId === 'goldenpitchfork';
  }

  request(point: THREE.Vector3): boolean {
    if (!this.isEquipped() || !this.turf.canTerraform(point) || this.animation.isDigging
      || this.animation.isCasting || this.animation.isNetting) return false;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: 'TERRAFORM' });
    this.animation.cancelEmote();
    const center = this.turf.tileCenter(point);
    const edge = this.turf.size / 2 - 1e-6;
    this.target = new THREE.Vector3(THREE.MathUtils.clamp(center.x, -edge, edge), 0,
      THREE.MathUtils.clamp(center.z, -edge, edge));
    return true;
  }

  cancel(owned = this.isEquipped()): void {
    this.actionVersion++;
    // Cancel only this controller's active action.
    if (this.target || (owned && this.animation.isDigging)) this.locomotor.stop();
    this.target = undefined;
    if (owned) this.animation.cancelDig();
  }

  update(_dt: number): void {
    if (!this.isEquipped() || this.isManualMovement()) { this.cancel(); return; }
    if (!this.target) return;
    const target = this.target;
    if (!this.turf.canTerraform(target)) { this.cancel(); return; }
    const distance = this.distanceSquared(target);
    if (distance > PITCHFORK_REACH ** 2) {
      // Walk into tool reach of the selected tile's centre.
      const destination = target.clone();
      this.direction.subVectors(this.world.player.position, target).setY(0).normalize();
      destination.addScaledVector(this.direction, PITCHFORK_REACH * 0.8);
      if (!this.locomotor.destination || this.locomotor.destination.distanceToSquared(destination) > 0.01) {
        if (!this.locomotor.goToPoint(destination)) this.cancel();
      }
      return;
    }
    this.locomotor.stop();
    this.faceTarget(target);
    const version = this.actionVersion;
    if (this.animation.playDig(() => {
      if (version === this.actionVersion && this.isEquipped() && this.turf.canTerraform(target)
        && this.distanceSquared(target) <= PITCHFORK_REACH ** 2) this.turf.dig(target);
    })) this.target = undefined;
  }

  dispose(): void {
    this.stopActionEvents();
    this.stopEquipment();
    this.cancel();
    this.unregisterHover();
    if (this.pointer !== this.world.mouseActions?.pointer) this.pointer.dispose();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown, true);
    window.removeEventListener('keydown', this.handleKeyDown);
  }

  private distanceSquared(target: THREE.Vector3): number {
    return (this.world.player.position.x - target.x) ** 2
      + (this.world.player.position.z - target.z) ** 2;
  }

  private faceTarget(target: THREE.Vector3): void {
    this.direction.subVectors(target, this.world.player.position).setY(0);
    if (this.direction.lengthSq() < 1e-8) return;
    this.world.camera.getWorldDirection(this.forward);
    this.forward.setY(0).normalize();
    this.right.crossVectors(this.forward, this.up).normalize();
    const forward = this.direction.dot(this.forward);
    const side = this.direction.dot(this.right);
    this.animation.setFacing(Math.abs(forward) >= Math.abs(side) ? (forward > 0 ? 'up' : 'down') : 'side',
      Math.abs(side) > Math.abs(forward) && side < 0);
  }

  private hitTarget(): THREE.Vector3 | undefined {
    if (!this.isEquipped()) return undefined;
    const point = this.pointer.groundPoint();
    return point && this.turf.canTerraform(point) ? point : undefined;
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.defaultPrevented) return;
    if (event.button === 0) { this.cancel(); return; }
    if (event.button !== 2 || !this.isEquipped()) return;
    this.pointer.trackPointer(event);
    const target = this.hitTarget();
    if (!target) { this.cancel(); return; }
    event.preventDefault();
    event.stopImmediatePropagation();
    this.request(target);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape') this.cancel();
  };
}

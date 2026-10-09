import * as THREE from 'three';
import { PointerRaycaster } from './pointerRaycaster.ts';
import type { ActionWorldContext as WorldContext, ActionAnimationController as WilsonAnimationController, ActionLocomotor as Locomotor } from './actionContext.ts';


export interface ShovelTarget {
  readonly id: string;
  readonly model: THREE.Group;
  readonly position: THREE.Vector3;
  isValid(): boolean;
  dig(): boolean;
}
const SHOVEL_REACH = 4;

/** componentactions: DIG_tool + DIG_workable, on the right mouse button. */
export class ShovelActionController {
  private readonly pointer: PointerRaycaster;
  private readonly unregisterHover: () => void;
  private target?: ShovelTarget;
  private actionVersion = 0;
  private readonly direction = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly world: WorldContext;
  private readonly animation: WilsonAnimationController;
  private readonly locomotor: Pick<Locomotor, 'goToPoint' | 'stop' | 'destination'>;
  private readonly isEquipped: () => boolean;
  private readonly getTargets: () => readonly ShovelTarget[];
  private readonly isManualMovement: () => boolean;
  private readonly onRequest: () => void;

  constructor(
    world: WorldContext,
    animation: WilsonAnimationController,
    locomotor: Pick<Locomotor, 'goToPoint' | 'stop' | 'destination'>,
    isEquipped: () => boolean,
    getTargets: () => readonly ShovelTarget[],
    isManualMovement = () => false,
    onRequest = () => {},
  ) {
    this.world = world;
    this.animation = animation;
    this.locomotor = locomotor;
    this.isEquipped = isEquipped;
    this.getTargets = getTargets;
    this.isManualMovement = isManualMovement;
    this.onRequest = onRequest;
    this.pointer = world.mouseActions?.pointer ?? new PointerRaycaster(world);
    this.unregisterHover = world.mouseActions?.register(() =>
      this.getTargets().filter(target => target.isValid()).map(target => ({
        action: { action: 'DIG' }, button: 'right', model: target.model, available: this.isEquipped(),
      }))) ?? (() => {});
    // Register in capture so a work click cannot open a container or place a building.
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  request(target: ShovelTarget): boolean {
    if (!this.isEquipped() || !target.isValid() || this.animation.isShoveling
      || this.animation.isCasting || this.animation.isNetting) return false;
    this.cancel();
    this.animation.cancelEmote();
    this.target = target;
    this.onRequest();
    return true;
  }

  cancel(): void {
    this.actionVersion++;
    // Cancel only this controller's DIG state, preserving pitchfork terraform.
    const owned = this.isEquipped();
    if (this.target || (owned && this.animation.isShoveling)) this.locomotor.stop();
    this.target = undefined;
    this.animation.cancelShovelDig();
  }

  update(_dt: number): void {
    if (!this.isEquipped() || this.isManualMovement()) { this.cancel(); return; }
    if (!this.target) return;
    const target = this.target;
    if (!target.isValid()) { this.cancel(); return; }
    const distance = this.distanceSquared(target);
    if (distance > SHOVEL_REACH ** 2) {
      // Stop short of the foot point; do not walk into the billboard's centre.
      const destination = target.position.clone();
      this.direction.subVectors(this.world.player.position, target.position).setY(0).normalize();
      destination.addScaledVector(this.direction, SHOVEL_REACH * 0.8);
      if (!this.locomotor.destination || this.locomotor.destination.distanceToSquared(destination) > 0.01) {
        if (!this.locomotor.goToPoint(destination)) this.cancel();
      }
      return;
    }
    this.locomotor.stop();
    this.faceTarget(target);
    const version = this.actionVersion;
    if (this.animation.playShovelDig(() => {
      return version === this.actionVersion && this.isEquipped() && target.isValid()
        && this.distanceSquared(target) <= SHOVEL_REACH ** 2 && target.dig();
    })) this.target = undefined;
  }

  dispose(): void {
    this.cancel();
    this.unregisterHover();
    if (this.pointer !== this.world.mouseActions?.pointer) this.pointer.dispose();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown, true);
    window.removeEventListener('keydown', this.handleKeyDown);
  }

  private distanceSquared(target: ShovelTarget): number {
    return (this.world.player.position.x - target.position.x) ** 2
      + (this.world.player.position.z - target.position.z) ** 2;
  }

  private faceTarget(target: ShovelTarget): void {
    this.direction.subVectors(target.position, this.world.player.position).setY(0);
    if (this.direction.lengthSq() < 1e-8) return;
    this.world.camera.getWorldDirection(this.forward);
    this.forward.setY(0).normalize();
    this.right.crossVectors(this.forward, this.up).normalize();
    const forward = this.direction.dot(this.forward);
    const side = this.direction.dot(this.right);
    this.animation.setFacing(Math.abs(forward) >= Math.abs(side) ? (forward > 0 ? 'up' : 'down') : 'side',
      Math.abs(side) > Math.abs(forward) && side < 0);
  }

  private hitTarget(): ShovelTarget | undefined {
    const targets = this.isEquipped() ? this.getTargets().filter((target) => target.isValid()) : [];
    const hit = this.pointer.raycastPointer(targets.map(({ model }) => model));
    let root: THREE.Object3D | null = hit?.object ?? null;
    while (root && !targets.some(({ model }) => model === root)) root = root.parent;
    return targets.find(({ model }) => model === root);
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

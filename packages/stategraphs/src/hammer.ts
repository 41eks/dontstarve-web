import { WILSON_ACTION_TIMES } from './SGwilson.ts';
import * as THREE from 'three';
import { PointerRaycaster } from './pointerRaycaster.ts';
import type { ActionWorldContext as WorldContext, ActionAnimationController as WilsonAnimationController, ActionLocomotor as Locomotor, CursorLabel } from './actionContext.ts';

export const HAMMER_HIT_TIME = WILSON_ACTION_TIMES.mine;
export const HAMMER_REACH = 4;

export interface HammerTarget {
  readonly id: string;
  readonly model: THREE.Group;
  /** Ground contact, independent of the billboard's height or camera rotation. */
  readonly position: THREE.Vector3;
  isValid(): boolean;
  /** Commit one successful HAMMER hit; the prefab owns work count and destruction. */
  playHit(): void;
}

/** componentactions: HAMMER_tool + HAMMER_workable, on the right mouse button. */
export class HammerActionController {
  private readonly pointer: PointerRaycaster;
  private readonly label: CursorLabel;
  private target?: HammerTarget;
  private actionVersion = 0;
  private hoveredId?: string;
  private readonly direction = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly world: WorldContext;
  private readonly animation: WilsonAnimationController;
  private readonly locomotor: Pick<Locomotor, 'goToPoint' | 'stop' | 'destination'>;
  private readonly isEquipped: () => boolean;
  private readonly getTargets: () => readonly HammerTarget[];
  private readonly isManualMovement: () => boolean;
  private readonly onRequest: () => void;

  constructor(
    world: WorldContext,
    animation: WilsonAnimationController,
    locomotor: Pick<Locomotor, 'goToPoint' | 'stop' | 'destination'>,
    isEquipped: () => boolean,
    getTargets: () => readonly HammerTarget[],
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
    this.pointer = new PointerRaycaster(world);
    this.label = world.createCursorLabel?.(this.pointer) ?? { show() {}, hide() {}, update() {} };
    // Register in capture so a work click cannot open a container or place a building.
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  request(target: HammerTarget): boolean {
    if (!this.isEquipped() || !target.isValid() || this.animation.isHammering
      || this.animation.isCasting || this.animation.isNetting) return false;
    this.cancel();
    this.animation.cancelEmote();
    this.target = target;
    this.onRequest();
    return true;
  }

  cancel(): void {
    this.actionVersion++;
    // Only the equipped tool cancels its own action.
    const owned = this.isEquipped();
    if (this.target || (owned && this.animation.isHammering)) this.locomotor.stop();
    this.target = undefined;
    if (owned) this.animation.cancelHammer();
  }

  update(_dt: number): void {
    this.updateHover();
    if (!this.isEquipped() || this.isManualMovement()) { this.cancel(); return; }
    if (!this.target) return;
    const target = this.target;
    if (!target.isValid()) { this.cancel(); return; }
    const distance = this.distanceSquared(target);
    if (distance > HAMMER_REACH ** 2) {
      // Stop short of the foot point; do not walk into the billboard's centre.
      const destination = target.position.clone();
      this.direction.subVectors(this.world.player.position, target.position).setY(0).normalize();
      destination.addScaledVector(this.direction, HAMMER_REACH * 0.8);
      if (!this.locomotor.destination || this.locomotor.destination.distanceToSquared(destination) > 0.01) {
        if (!this.locomotor.goToPoint(destination)) this.cancel();
      }
      return;
    }
    this.locomotor.stop();
    this.faceTarget(target);
    const version = this.actionVersion;
    if (this.animation.playHammer(() => {
      if (version === this.actionVersion && this.isEquipped() && target.isValid()
        && this.distanceSquared(target) <= HAMMER_REACH ** 2) target.playHit();
    })) this.target = undefined;
  }

  dispose(): void {
    this.cancel();
    this.label.hide();
    this.pointer.dispose();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown, true);
    window.removeEventListener('keydown', this.handleKeyDown);
  }

  private distanceSquared(target: HammerTarget): number {
    return (this.world.player.position.x - target.position.x) ** 2
      + (this.world.player.position.z - target.position.z) ** 2;
  }

  private faceTarget(target: HammerTarget): void {
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

  private hitTarget(): HammerTarget | undefined {
    const targets = this.isEquipped() ? this.getTargets().filter((target) => target.isValid()) : [];
    const hit = this.pointer.raycastPointer(targets.map(({ model }) => model));
    let root: THREE.Object3D | null = hit?.object ?? null;
    while (root && !targets.some(({ model }) => model === root)) root = root.parent;
    return targets.find(({ model }) => model === root);
  }

  private updateHover(): void {
    const hovered = this.hitTarget();
    if (hovered?.id !== this.hoveredId) {
      this.hoveredId = hovered?.id;
      if (hovered) this.label.show(': 锤击', 'right');
      else this.label.hide();
    }
    this.label.update();
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

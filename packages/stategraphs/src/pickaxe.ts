import { bindActionCancellation } from './actionEvents.ts';
import { bindHandEquipmentUpdate, type HandEquipmentSignal } from './handEquipment.ts';
import * as THREE from 'three';
import { PointerRaycaster } from './pointerRaycaster.ts';
import type { ActionWorldContext as WorldContext, ActionAnimationController as WilsonAnimationController, ActionLocomotor as Locomotor } from './actionContext.ts';

export const PICKAXE_REACH = 4;

export interface PickaxeTarget {
  readonly id: string;
  readonly model: THREE.Group;
  /** Ground contact, independent of the billboard's height or camera rotation. */
  readonly position: THREE.Vector3;
  isValid(): boolean;
  /** Only visual feedback: never mutates work state, health or loot. */
  playHit(): void;
}

/** componentactions: MINE_tool + MINE_workable, on the right mouse button. */
export class PickaxeActionController {
  private readonly pointer: PointerRaycaster;
  private readonly unregisterHover: () => void;
  private target?: PickaxeTarget;
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
  private readonly getTargets: () => readonly PickaxeTarget[];
  private readonly isManualMovement: () => boolean;

  constructor(
    world: WorldContext,
    animation: WilsonAnimationController,
    locomotor: Pick<Locomotor, 'goToPoint' | 'stop' | 'destination'>,
    handEquipment: HandEquipmentSignal,
    getTargets: () => readonly PickaxeTarget[],
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
    this.getTargets = getTargets;
    this.isManualMovement = isManualMovement;
    this.stopActionEvents = bindActionCancellation(world, this, 'hand', () => this.cancel());
    this.pointer = world.mouseActions?.pointer ?? new PointerRaycaster(world);
    this.unregisterHover = world.mouseActions?.register(() =>
      this.getTargets().filter(target => target.isValid()).map(target => ({
        action: { action: 'MINE' }, button: 'right', model: target.model, available: this.isEquipped(),
      }))) ?? (() => {});
    // Register in capture so a mine click cannot open a container or place a building.
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  private isEquipped(equipment = this.handEquipment.peek()): boolean {
    const itemId = equipment?.itemId;
    return itemId === 'pickaxe' || itemId === 'goldenpickaxe';
  }

  request(target: PickaxeTarget): boolean {
    if (!this.isEquipped() || !target.isValid() || this.animation.isMining
      || this.animation.isCasting || this.animation.isNetting) return false;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: 'MINE' });
    this.animation.cancelEmote();
    this.target = target;
    return true;
  }

  cancel(owned = this.isEquipped()): void {
    this.actionVersion++;
    // Only the equipped tool cancels its own action.
    if (this.target || (owned && this.animation.isMining)) this.locomotor.stop();
    this.target = undefined;
    if (owned) this.animation.cancelMine();
  }

  update(_dt: number): void {
    if (!this.isEquipped() || this.isManualMovement()) { this.cancel(); return; }
    if (!this.target) return;
    const target = this.target;
    if (!target.isValid()) { this.cancel(); return; }
    const distance = this.distanceSquared(target);
    if (distance > PICKAXE_REACH ** 2) {
      // Stop short of the foot point; do not walk into the billboard's centre.
      const destination = target.position.clone();
      this.direction.subVectors(this.world.player.position, target.position).setY(0).normalize();
      destination.addScaledVector(this.direction, PICKAXE_REACH * 0.8);
      if (!this.locomotor.destination || this.locomotor.destination.distanceToSquared(destination) > 0.01) {
        if (!this.locomotor.goToPoint(destination)) this.cancel();
      }
      return;
    }
    this.locomotor.stop();
    this.faceTarget(target);
    const version = this.actionVersion;
    if (this.animation.playMine(() => {
      if (version === this.actionVersion && this.isEquipped() && target.isValid()
        && this.distanceSquared(target) <= PICKAXE_REACH ** 2) target.playHit();
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

  private distanceSquared(target: PickaxeTarget): number {
    return (this.world.player.position.x - target.position.x) ** 2
      + (this.world.player.position.z - target.position.z) ** 2;
  }

  private faceTarget(target: PickaxeTarget): void {
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

  private hitTarget(): PickaxeTarget | undefined {
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

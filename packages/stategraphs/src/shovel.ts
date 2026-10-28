import { PlayerActionPicker } from './playeractionpicker.ts';
import { bindActionCancellation } from './actionEvents.ts';
import { bindHandEquipmentUpdate, type HandEquipmentSignal } from './handEquipment.ts';
import * as THREE from 'three';
import { actionTargetModel, type ActionTargetView } from './actionTargetView';
import { PointerRaycaster } from './pointerRaycaster.ts';
import type { ActionWorldContext as WorldContext, ActionAnimationController as WilsonAnimationController, ActionLocomotor as Locomotor } from './actionContext.ts';
import { collectEquippedActions, equippedActionEntity, performToolWork, type ComponentActionEntity } from './componentactions.ts';


export type ShovelTarget = ActionTargetView & {
  readonly id: string;
  readonly position: THREE.Vector3;
  readonly entity?: ComponentActionEntity;
  isValid(): boolean;
  dig(): boolean;
};
const SHOVEL_REACH = 4;

/** componentactions: DIG_tool + DIG_workable, on the right mouse button. */
export class ShovelActionController {
  private readonly pointer: PointerRaycaster;
  private readonly picker: PlayerActionPicker;
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
  private readonly handEquipment: HandEquipmentSignal;
  private readonly stopEquipment: () => void;
  private readonly stopActionEvents: () => void;
  private readonly getTargets: (model?: THREE.Object3D) => readonly ShovelTarget[];
  private readonly isManualMovement: () => boolean;

  constructor(
    world: WorldContext,
    animation: WilsonAnimationController,
    locomotor: Pick<Locomotor, 'goToPoint' | 'stop' | 'destination'>,
    handEquipment: HandEquipmentSignal,
    getTargets: (model?: THREE.Object3D) => readonly ShovelTarget[],
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
    this.picker = world.mouseActions ?? new PlayerActionPicker(this.pointer);
    this.unregisterHover = this.picker.register(model => !model || !this.isEquipped() ? [] :
      this.getTargets(model).filter(target => target.isValid()).map(target => ({
        action: { action: 'DIG', invobject: equippedActionEntity(this.handEquipment.peek()), target: target.entity },
        button: 'right', model: actionTargetModel(target), available: this.canWork(target), source: 'equipped',
      }))) ?? (() => {});
    // Register in capture so a work click cannot open a container or place a building.
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  private isEquipped(equipment = this.handEquipment.peek()): boolean {
    const entity = equippedActionEntity(equipment);
    return !!entity?.components.tool && entity.hasTag('DIG_tool') && !entity.isRemoved;
  }

  private canWork(target: ShovelTarget): boolean {
    return this.isEquipped() && target.isValid() && (!target.entity
      || collectEquippedActions(equippedActionEntity(this.handEquipment.peek()), target.entity, true).includes('DIG'));
  }

  request(target: ShovelTarget): boolean {
    if (!this.canWork(target) || this.animation.isShoveling
      || this.animation.isCasting || this.animation.isNetting) return false;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: 'DIG' });
    this.animation.cancelEmote();
    this.target = target;
    return true;
  }

  cancel(owned = this.isEquipped()): void {
    this.actionVersion++;
    // Cancel only this controller's DIG state, preserving pitchfork terraform.
    if (this.target || (owned && this.animation.isShoveling)) this.locomotor.stop();
    this.target = undefined;
    this.animation.cancelShovelDig();
  }

  update(_dt: number): void {
    if (!this.isEquipped() || this.isManualMovement()) { this.cancel(); return; }
    if (!this.target) return;
    const target = this.target;
    if (!this.canWork(target)) { this.cancel(); return; }
    const distance = this.distanceSquared(target);
    if (distance > SHOVEL_REACH ** 2) {
      // Stop short of the foot point; do not walk into the billboard's centre.
      const destination = target.position.clone();
      this.direction.subVectors(this.world.player.position, target.position).normalize();
      destination.addScaledVector(this.direction, SHOVEL_REACH * 0.8);
      if (!this.locomotor.destination || this.locomotor.destination.distanceToSquared(destination) > 0.01) {
        if (!this.locomotor.goToPoint(destination)) this.cancel();
      }
      return;
    }
    this.locomotor.stop();
    this.faceTarget(target);
    const version = this.actionVersion;
    const tool = equippedActionEntity(this.handEquipment.peek());
    if (this.animation.playShovelDig(() => {
      if (version !== this.actionVersion || !this.canWork(target)
        || equippedActionEntity(this.handEquipment.peek()) !== tool
        || this.distanceSquared(target) > SHOVEL_REACH ** 2) return false;
      const worker = { PushEvent: (name: string, data: unknown) =>
        this.world.player.dispatchEvent({ type: name, data } as never) };
      if (target.entity) return performToolWork('DIG', target.entity, worker, tool);
      const success = target.dig();
      if (success) tool?.components.finiteuses?.useForAction?.('DIG');
      return success;
    })) this.target = undefined;
  }

  dispose(): void {
    this.stopActionEvents();
    this.stopEquipment();
    this.cancel();
    this.unregisterHover();
    if (this.picker !== this.world.mouseActions) this.picker.dispose();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown, true);
    window.removeEventListener('keydown', this.handleKeyDown);
  }

  private distanceSquared(target: ShovelTarget): number {
    return this.world.player.position.distanceToSquared(target.position);
  }

  private faceTarget(target: ShovelTarget): void {
    this.direction.subVectors(target.position, this.world.player.position);
    if (this.direction.lengthSq() < 1e-8) return;
    this.world.camera.getWorldDirection(this.forward);
    this.forward.setY(0).normalize();
    this.right.crossVectors(this.forward, this.up).normalize();
    const forward = this.direction.dot(this.forward);
    const side = this.direction.dot(this.right);
    this.animation.setFacing(Math.abs(forward) >= Math.abs(side) ? (forward > 0 ? 'up' : 'down') : 'side',
      Math.abs(side) > Math.abs(forward) && side < 0);
  }

  private hitTarget(event?: PointerEvent): ShovelTarget | undefined {
    const action = this.picker.getMouseActions(event).right, model = this.picker.targetModel;
    return model && action?.action === 'DIG'
      ? this.getTargets(model).find(target => actionTargetModel(target) === model && target.isValid()) : undefined;
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.defaultPrevented) return;
    if (event.button === 0) { this.cancel(); return; }
    if (event.button !== 2 || !this.isEquipped()) return;
    this.pointer.trackPointer(event);
    const target = this.hitTarget(event);
    if (!target) { this.cancel(); return; }
    event.preventDefault();
    event.stopImmediatePropagation();
    this.request(target);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape') this.cancel();
  };
}

import { PlayerActionPicker } from './playeractionpicker.ts';
import { bindActionCancellation } from './actionEvents.ts';
import { bindHandEquipmentUpdate, type HandEquipmentSignal } from './handEquipment.ts';
import * as THREE from 'three';
import { PointerRaycaster } from './pointerRaycaster.ts';
import { isHandActionBusy, type ActionWorldContext as WorldContext, type ActionPerformer, type ActionLocomotor as Locomotor } from './actionContext.ts';
import { BufferedAction } from './bufferedaction.ts';
import { collectEquippedActions, equippedActionEntity, performToolWork, type ComponentActionEntity } from './componentactions.ts';
import type { Worker } from '../../componets/src/workable';
import { actionTargetModel, type ActionTargetView } from './actionTargetView';
import { facePoint } from './facing.ts';

export const PICKAXE_REACH = 4;

export type PickaxeTarget = ActionTargetView & {
  readonly entity: ComponentActionEntity;
  readonly id: string;
  /** Ground contact, independent of the billboard's height or camera rotation. */
  readonly position: THREE.Vector3;
  isValid(): boolean;
};

export type ToolWorkAction = 'MINE' | 'CHOP';

/** componentactions: <action>_tool + <action>_workable (MINE for pickaxes, CHOP for axes), on the right mouse button. */
export class PickaxeActionController {
  private readonly pointer: PointerRaycaster;
  private readonly picker: PlayerActionPicker;
  private readonly unregisterHover: () => void;
  private target?: PickaxeTarget;
  private actionVersion = 0;
  private readonly direction = new THREE.Vector3();
  private readonly world: WorldContext;
  private readonly animation: ActionPerformer;
  private readonly locomotor: Pick<Locomotor, 'goToPoint' | 'stop' | 'destination'>;
  private readonly handEquipment: HandEquipmentSignal;
  private readonly stopEquipment: () => void;
  private readonly stopActionEvents: () => void;
  private readonly getTargets: (model?: THREE.Object3D) => readonly PickaxeTarget[];
  private readonly isManualMovement: () => boolean;
  private readonly worker: Worker;
  private readonly action: ToolWorkAction;

  constructor(
    world: WorldContext,
    animation: ActionPerformer,
    locomotor: Pick<Locomotor, 'goToPoint' | 'stop' | 'destination'>,
    handEquipment: HandEquipmentSignal,
    getTargets: (model?: THREE.Object3D) => readonly PickaxeTarget[],
    isManualMovement = () => false,
    action: ToolWorkAction = 'MINE',
  ) {
    this.action = action;
    this.world = world;
    this.animation = animation;
    this.locomotor = locomotor;
    this.handEquipment = handEquipment;
    this.worker = {
      PushEvent: (name, data) => world.player.dispatchEvent({ type: name, data } as never),
      getPosition: () => world.player.position,
      sg: { HasStateTag: tag => animation.stategraph.hasStateTag(tag) },
    };
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
    // Equipped actions are computed only for the selected entity.
    this.unregisterHover = this.picker.register(model => !model || !this.isEquipped() ? [] :
      this.getTargets(model).filter(target => target.isValid()).map(target => ({
        action: { action: this.action, invobject: equippedActionEntity(this.handEquipment.peek()), target: target.entity },
        button: 'right', model: actionTargetModel(target), available: this.canWork(target), source: 'equipped',
      }))) ?? (() => {});
    // Register in capture so a mine click cannot open a container or place a building.
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  private isEquipped(equipment = this.handEquipment.peek()): boolean {
    const entity = equippedActionEntity(equipment);
    return !!entity?.components.tool && entity.hasTag(`${this.action}_tool`) && !entity.isRemoved;
  }

  private canWork(target: PickaxeTarget): boolean {
    return target.isValid() && collectEquippedActions(equippedActionEntity(this.handEquipment.peek()), target.entity, true).includes(this.action);
  }

  request(target: PickaxeTarget): boolean {
    if (!this.canWork(target) || this.isActing
      || isHandActionBusy(this.animation.stategraph)) return false;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: this.action });
    this.animation.cancelEmote();
    this.target = target;
    return true;
  }

  cancel(owned = this.isEquipped()): void {
    this.actionVersion++;
    // Only the equipped tool cancels its own action.
    if (this.target || (owned && this.isActing)) this.locomotor.stop();
    this.target = undefined;
    if (owned) this.animation.stategraph.cancelAction(this.action);
  }

  update(_dt: number): void {
    if (!this.isEquipped() || this.isManualMovement()) { this.cancel(); return; }
    if (!this.target) return;
    const target = this.target;
    if (!this.canWork(target)) { this.cancel(); return; }
    const distance = this.distanceSquared(target);
    // Obstacle targets (cave_entrance) cannot be approached closer than their physics radius.
    const reach = PICKAXE_REACH + (target.entity.getPhysicsRadius?.() ?? 0);
    if (distance > reach ** 2) {
      // Stop short of the foot point; do not walk into the billboard's centre.
      const destination = target.position.clone();
      this.direction.subVectors(this.world.player.position, target.position).normalize();
      destination.addScaledVector(this.direction, reach * 0.8);
      if (!this.locomotor.destination || this.locomotor.destination.distanceToSquared(destination) > 0.01) {
        if (!this.locomotor.goToPoint(destination)) this.cancel();
      }
      return;
    }
    this.locomotor.stop();
    facePoint(this.animation, this.world.camera, this.world.player.position, target.position);
    const version = this.actionVersion;
    if (this.animation.stategraph.pushBufferedAction(new BufferedAction(this.action, () => {
      if (version === this.actionVersion && this.canWork(target)
        && this.distanceSquared(target) <= reach ** 2) {
        return performToolWork(this.action, target.entity, this.worker, equippedActionEntity(this.handEquipment.peek()));
      }
      return false;
    }, undefined, { invobject: equippedActionEntity(this.handEquipment.peek()) }))) this.target = undefined;
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

  private get isActing(): boolean {
    return this.animation.stategraph.isPerformingAction(this.action);
  }

  private distanceSquared(target: PickaxeTarget): number {
    return this.world.player.position.distanceToSquared(target.position);
  }

  private hitTarget(event?: PointerEvent): PickaxeTarget | undefined {
    const action = this.picker.getMouseActions(event).right, model = this.picker.targetModel;
    return model && action?.action === this.action
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

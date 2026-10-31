import { PlayerActionPicker } from './playeractionpicker.ts';
import { bindActionCancellation } from './actionEvents.ts';
import { bindHandEquipmentUpdate, type HandEquipmentSignal } from './handEquipment.ts';
import { WILSON_ACTION_TIMES } from './SGwilson.ts';
import * as THREE from 'three';
import { PointerRaycaster } from './pointerRaycaster.ts';
import { isHandActionBusy, type ActionWorldContext as WorldContext, type ActionPerformer, type ActionLocomotor as Locomotor } from './actionContext.ts';
import { BufferedAction } from './bufferedaction.ts';
import { collectEquippedActions, equippedActionEntity, performToolWork, type ComponentActionEntity } from './componentactions.ts';
import type { Worker } from '../../componets/src/workable';
import { actionTargetModel, type ActionTargetView } from './actionTargetView';
import type { SpriteState } from '@dontstarve-web/display';
import { findActionEntity } from '../../prefab/src/actionEntity';
import { faceSpritePoint } from './facing.ts';

export const HAMMER_HIT_TIME = WILSON_ACTION_TIMES.mine;
export const HAMMER_REACH = 4;

export type HammerTarget = ActionTargetView & {
  readonly entity: ComponentActionEntity;
  readonly id: string;
  /** Ground contact, independent of the billboard's height or camera rotation. */
  readonly position: THREE.Vector3;
  isValid(): boolean;
  /** Commit one successful HAMMER hit; the prefab owns work count and destruction. */
  playHit(): void;
};

/** Resolve the picked entity's owner-declared HAMMER operation, like the reskin target lookup. */
export function getHammerActionTarget(model: THREE.Object3D): HammerTarget | undefined {
  return findActionEntity(model)?.hammerTarget;
}

/** componentactions: HAMMER_tool + HAMMER_workable, on the right mouse button. */
export class HammerActionController {
  private readonly pointer: PointerRaycaster;
  private readonly picker: PlayerActionPicker;
  private readonly unregisterHover: () => void;
  private target?: HammerTarget;
  private actionVersion = 0;
  private readonly direction = new THREE.Vector3();
  private readonly world: WorldContext;
  private readonly animation: ActionPerformer;
  private readonly playerSprite: Pick<SpriteState, 'setFacing'>;
  private readonly locomotor: Pick<Locomotor, 'goToPoint' | 'stop' | 'destination'>;
  private readonly handEquipment: HandEquipmentSignal;
  private readonly stopEquipment: () => void;
  private readonly stopActionEvents: () => void;
  private readonly isManualMovement: () => boolean;
  private readonly worker: Worker;

  constructor(
    world: WorldContext,
    animation: ActionPerformer,
    locomotor: Pick<Locomotor, 'goToPoint' | 'stop' | 'destination'>,
    handEquipment: HandEquipmentSignal,
    playerSprite: Pick<SpriteState, 'setFacing'>,
    isManualMovement = () => false,
  ) {
    this.world = world;
    this.animation = animation;
    this.playerSprite = playerSprite;
    this.locomotor = locomotor;
    this.handEquipment = handEquipment;
    this.worker = { PushEvent: (name, data) => world.player.dispatchEvent({ type: name, data } as never) };
    this.stopEquipment = bindHandEquipmentUpdate(handEquipment, {
      isEquipped: equipment => this.isEquipped(equipment),
      cancel: () => this.cancel(true),
      update: dt => this.update(dt),
      registerFrameTask: world.registerFrameTask,
    });
    this.isManualMovement = isManualMovement;
    this.stopActionEvents = bindActionCancellation(world, this, 'hand', () => this.cancel());
    this.pointer = world.mouseActions?.pointer ?? new PointerRaycaster(world);
    this.picker = world.mouseActions ?? new PlayerActionPicker(this.pointer);
    // Equipped actions are computed only for the selected entity.
    this.unregisterHover = this.picker.register(model => {
      const target = model && this.isEquipped() ? getHammerActionTarget(model) : undefined;
      return !target?.isValid() ? [] : [{
        action: { action: 'HAMMER', invobject: equippedActionEntity(this.handEquipment.peek()), target: target.entity },
        button: 'right', model: actionTargetModel(target), available: this.canWork(target), source: 'equipped',
      }];
    }) ?? (() => {});
    // Register in capture so a work click cannot open a container or place a building.
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  private isEquipped(equipment = this.handEquipment.peek()): boolean {
    const entity = equippedActionEntity(equipment);
    return !!entity?.components.tool && entity.hasTag('HAMMER_tool') && !entity.isRemoved;
  }

  private canWork(target: HammerTarget): boolean {
    return target.isValid() && collectEquippedActions(equippedActionEntity(this.handEquipment.peek()), target.entity, true).includes('HAMMER');
  }

  request(target: HammerTarget): boolean {
    if (!this.canWork(target) || this.isHammering || isHandActionBusy(this.animation.stategraph)) return false;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: 'HAMMER' });
    this.animation.cancelEmote();
    this.target = target;
    return true;
  }

  cancel(owned = this.isEquipped()): void {
    this.actionVersion++;
    // Only the equipped tool cancels its own action.
    if (this.target || (owned && this.isHammering)) this.locomotor.stop();
    this.target = undefined;
    if (owned) this.animation.stategraph.cancelAction('HAMMER');
  }

  update(_dt: number): void {
    if (!this.isEquipped() || this.isManualMovement()) { this.cancel(); return; }
    if (!this.target) return;
    const target = this.target;
    if (!this.canWork(target)) { this.cancel(); return; }
    const distance = this.distanceSquared(target);
    if (distance > HAMMER_REACH ** 2) {
      // Stop short of the foot point; do not walk into the billboard's centre.
      const destination = target.position.clone();
      this.direction.subVectors(this.world.player.position, target.position).normalize();
      destination.addScaledVector(this.direction, HAMMER_REACH * 0.8);
      if (!this.locomotor.destination || this.locomotor.destination.distanceToSquared(destination) > 0.01) {
        if (!this.locomotor.goToPoint(destination)) this.cancel();
      }
      return;
    }
    this.locomotor.stop();
    faceSpritePoint(this.playerSprite, this.world.camera, this.world.player.position, target.position);
    const version = this.actionVersion;
    const tool = equippedActionEntity(this.handEquipment.peek());
    if (this.animation.stategraph.pushBufferedAction(new BufferedAction('HAMMER', () => {
      if (version === this.actionVersion && this.canWork(target)
        && this.distanceSquared(target) <= HAMMER_REACH ** 2) {
        return performToolWork('HAMMER', target.entity, this.worker, equippedActionEntity(this.handEquipment.peek()));
      }
      return false;
    }, undefined, { invobject: tool }))) this.target = undefined;
  }

  private get isHammering(): boolean { return this.animation.stategraph.isPerformingAction('HAMMER'); }

  dispose(): void {
    this.stopActionEvents();
    this.stopEquipment();
    this.cancel();
    this.unregisterHover();
    if (this.picker !== this.world.mouseActions) this.picker.dispose();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown, true);
    window.removeEventListener('keydown', this.handleKeyDown);
  }

  private distanceSquared(target: HammerTarget): number {
    return this.world.player.position.distanceToSquared(target.position);
  }

  private hitTarget(event?: PointerEvent): HammerTarget | undefined {
    const action = this.picker.getMouseActions(event).right, model = this.picker.targetModel;
    const target = model && action?.action === 'HAMMER' ? getHammerActionTarget(model) : undefined;
    return target?.isValid() ? target : undefined;
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

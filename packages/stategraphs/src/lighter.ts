import { findActionEntity } from '../../prefab/src/actionEntity';
import * as THREE from 'three';
import type { ActionAnimationController, ActionLocomotor, ActionWorldContext } from './actionContext.ts';
import { BufferedAction } from './bufferedaction.ts';
import { bindActionCancellation } from './actionEvents.ts';
import { bindHandEquipmentUpdate, type HandEquipmentSignal } from './handEquipment.ts';
import { collectEquippedActions, equippedActionEntity, performLightAction, type ComponentActionEntity } from './componentactions.ts';
import { PlayerActionPicker, type MouseActionCandidate } from './playeractionpicker.ts';
import { PointerRaycaster } from './pointerRaycaster.ts';

export const LIGHT_REACH = 4;
export interface LighterTarget extends ComponentActionEntity {
  readonly model: THREE.Object3D;
  getPosition(): THREE.Vector3;
}

/** EQUIPPED.lighter uses replicated tags for selection; LIGHT revalidates at frame 13. */
export class LighterActionController {
  private readonly picker: PlayerActionPicker;
  private readonly unregister: () => void;
  private readonly stopEquipment: () => void;
  private readonly stopEvents: () => void;
  private target?: LighterTarget;
  private action?: BufferedAction<'LIGHT'>;
  private version = 0;
  private disposed = false;
  private readonly direction = new THREE.Vector3();
  private readonly destination = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly world: ActionWorldContext;
  private readonly animation: ActionAnimationController;
  private readonly locomotor: ActionLocomotor;
  private readonly hand: HandEquipmentSignal;
  private readonly isManualMovement: () => boolean;

  constructor(world: ActionWorldContext, animation: ActionAnimationController,
    locomotor: ActionLocomotor, hand: HandEquipmentSignal, isManualMovement = () => false) {
    this.world = world; this.animation = animation; this.locomotor = locomotor; this.hand = hand;
    this.isManualMovement = isManualMovement;
    this.picker = world.mouseActions ?? new PlayerActionPicker(new PointerRaycaster(world));
    this.unregister = this.picker.register(model => this.getActions(model));
    this.stopEquipment = bindHandEquipmentUpdate(hand, {
      isEquipped: equipment => !!equippedActionEntity(equipment)?.components.lighter,
      cancel: () => this.cancel(), update: () => this.update(), registerFrameTask: world.registerFrameTask,
    });
    this.stopEvents = bindActionCancellation(world, this, 'spell', () => this.cancel());
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  private canLight(target: LighterTarget): boolean {
    return !this.disposed && !!target.model.parent && target.model.visible
      && target.components.burnable !== undefined
      && collectEquippedActions(equippedActionEntity(this.hand.peek()), target, true).includes('LIGHT');
  }
  private getActions(model?: THREE.Object3D): MouseActionCandidate[] {
    const actions: MouseActionCandidate[] = [];
    if (!model) return actions;
    const target = findActionEntity(model) as LighterTarget | undefined;
    if (!target?.components.burnable) return actions;
    actions.push({ action: { action: 'LIGHT', invobject: equippedActionEntity(this.hand.peek()), target },
      button: 'right', source: 'equipped', model, available: this.canLight(target) });

    return actions;
  }
  request(target: LighterTarget): boolean {
    if (!this.canLight(target) || this.animation.stategraph.hasStateTag('busy')) return false;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: 'LIGHT' });
    this.animation.cancelEmote();
    this.target = target;
    return true;
  }
  cancel(): void {
    this.version++;
    if (this.target || (this.action && this.animation.stategraph.isActionActive(this.action))) this.locomotor.stop();
    this.target = undefined;
    if (this.action && this.animation.stategraph.isActionActive(this.action)) this.animation.stategraph.cancelAction('LIGHT');
    this.action = undefined;
  }
  update(): void {
    if (this.disposed) return;
    if (this.isManualMovement()) { this.cancel(); return; }
    if (this.action && !this.animation.stategraph.isActionActive(this.action)) { this.cancel(); return; }
    const target = this.target;
    if (!target) return;
    if (!this.canLight(target)) { this.cancel(); return; }
    const position = target.getPosition();
    if (!this.inReach(target)) {
      this.direction.subVectors(this.world.player.position, position).setY(0).normalize();
      // getPosition() may return the target's live position; never move the target.
      const destination = this.destination.copy(position).addScaledVector(this.direction, LIGHT_REACH * .8);
      if (!this.locomotor.destination || this.locomotor.destination.distanceToSquared(destination) > .01) {
        if (!this.locomotor.goToPoint(destination)) this.cancel();
      }
      return;
    }
    this.locomotor.stop();
    this.faceTarget(position);
    const tool = equippedActionEntity(this.hand.peek())!, version = this.version;
    const doer: ComponentActionEntity = {
      prefab: 'wilson', isRemoved: false, components: {}, hasTag: () => false, addTag: () => {}, removeTag: () => {},
      PushEvent: (name, data) => this.world.player.dispatchEvent({ type: name, data } as never),
    };
    const action = new BufferedAction('LIGHT', () => performLightAction(tool, target, doer),
      () => version === this.version && equippedActionEntity(this.hand.peek()) === tool && this.canLight(target) && this.inReach(target),
      { invobject: tool, target });
    if (this.animation.stategraph.pushBufferedAction(action)) { this.action = action; this.target = undefined; }
  }
  private inReach(target: LighterTarget): boolean {
    const position = target.getPosition(), player = this.world.player.position;
    return (position.x - player.x) ** 2 + (position.z - player.z) ** 2 <= LIGHT_REACH ** 2;
  }
  private faceTarget(position: THREE.Vector3): void {
    this.direction.subVectors(position, this.world.player.position).setY(0);
    if (this.direction.lengthSq() < 1e-8) return;
    this.world.camera.getWorldDirection(this.forward); this.forward.setY(0).normalize();
    this.right.crossVectors(this.forward, new THREE.Vector3(0, 1, 0)).normalize();
    const forward = this.direction.dot(this.forward), side = this.direction.dot(this.right);
    this.animation.setFacing(Math.abs(forward) >= Math.abs(side) ? (forward > 0 ? 'up' : 'down') : 'side',
      Math.abs(side) > Math.abs(forward) && side < 0);
  }
  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (this.disposed || event.defaultPrevented || (event.button !== 0 && event.button !== 2)) return;
    this.picker.pointer.trackPointer(event);
    const action = this.picker.getMouseActions(event).right;
    if (event.button !== 2 || action?.action !== 'LIGHT' || !action.target) { this.cancel(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    this.request(action.target as LighterTarget);
  };
  private readonly handleKeyDown = (event: KeyboardEvent): void => { if (event.code === 'Escape') this.cancel(); };
  dispose(): void {
    if (this.disposed) return;
    this.cancel(); this.disposed = true;
    this.stopEquipment(); this.stopEvents(); this.unregister();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown, true);
    window.removeEventListener('keydown', this.handleKeyDown);
    if (this.picker !== this.world.mouseActions) this.picker.dispose();
  }
}

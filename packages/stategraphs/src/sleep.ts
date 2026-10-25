import * as THREE from 'three';
import type { SleepingBag, SleepingBagSleeper } from '../../componets/src/sleepingbag';
import { BufferedAction, type BufferedActionObject } from './bufferedaction.ts';
import type { ActionWorldContext, ActionAnimationController, ActionLocomotor } from './actionContext.ts';
import { bindActionCancellation } from './actionEvents.ts';
import { PlayerActionPicker, type MouseActionCandidate } from './playeractionpicker.ts';
import { PointerRaycaster } from './pointerRaycaster.ts';
import { modelHasTag, prefabInstance } from '../../prefab/src/prefabInstance';

export const SLEEPIN_REACH = 4;

export interface SleepTarget extends BufferedActionObject {
  readonly model: THREE.Object3D;
  readonly component: SleepingBag;
  getPosition(): THREE.Vector3;
}

/** The bed is free, intact and has uses left. */
function canSleep(target: SleepTarget): boolean {
  const uses = target.model.userData.components?.finiteuses as { GetUses(): number } | undefined;
  return !!target.model.parent && target.model.visible
    && target.model.userData.components?.sleepingbag === target.component
    && !target.component.InUse() && !target.hasTag('burnt') && (uses?.GetUses() ?? 1) > 0;
}

/** componentactions.lua SCENE.sleepingbag: free beds offer SLEEPIN on the left button. */
export function getSleepActions(model: THREE.Object3D | undefined): MouseActionCandidate[] {
  const actions: MouseActionCandidate[] = [];
  if (!model) return actions;
  const component = model.userData.components?.sleepingbag as SleepingBag | undefined;
  if (!component) return actions;
  const target: SleepTarget = {
    model, component, prefab: model.userData.actionEntity?.prefab ?? prefabInstance(model)?.prefab,
    hasTag: tag => modelHasTag(model, tag),
    getPosition: () => model.userData.getGroundPosition?.() ?? model.position.clone(),
  };
  actions.push({ action: { action: 'SLEEPIN', target }, button: 'left', model, available: canSleep(target) });

  return actions;
}

/** Click a tent: walk to it, then SLEEPIN; sleepingbag and sleepingbaguser own the sleeping itself. */
export class SleepActionController {
  private readonly picker: PlayerActionPicker;
  private readonly unregister: () => void;
  private readonly stopActionEvents: () => void;
  private target?: SleepTarget;
  private action?: BufferedAction<'SLEEPIN'>;
  private disposed = false;
  private readonly direction = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly world: ActionWorldContext;
  private readonly animation: ActionAnimationController;
  private readonly locomotor: ActionLocomotor;
  private readonly sleeper: SleepingBagSleeper;
  private readonly isManualMovement: () => boolean;

  constructor(world: ActionWorldContext, animation: ActionAnimationController, locomotor: ActionLocomotor,
    sleeper: SleepingBagSleeper, isManualMovement = () => false) {
    this.world = world; this.animation = animation; this.locomotor = locomotor;
    this.sleeper = sleeper; this.isManualMovement = isManualMovement;
    this.picker = world.mouseActions ?? new PlayerActionPicker(new PointerRaycaster(world));
    this.unregister = this.picker.register(model => getSleepActions(model));
    this.stopActionEvents = bindActionCancellation(world, this, 'sleep', () => this.cancel());
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  request(target: SleepTarget): boolean {
    if (this.disposed || !canSleep(target) || this.animation.stategraph.hasStateTag('busy')
      || this.animation.stategraph.isSleeping) return false;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: 'SLEEPIN' });
    this.animation.cancelEmote();
    this.target = target;
    return true;
  }

  cancel(): void {
    // Once the sleeper is in bed only waking up ends the action.
    if (this.animation.stategraph.hasStateTag('sleeping')) { this.target = undefined; this.action = undefined; return; }
    if (this.target || (this.action && this.animation.stategraph.isActionActive(this.action))) this.locomotor.stop();
    this.target = undefined;
    if (this.action && this.animation.stategraph.isActionActive(this.action)) this.animation.stategraph.cancelAction('SLEEPIN');
    this.action = undefined;
  }

  update(): void {
    if (this.disposed) return;
    if (this.isManualMovement() && !this.animation.stategraph.isSleeping) { this.cancel(); return; }
    if (this.action && !this.animation.stategraph.isActionActive(this.action)) { this.cancel(); return; }
    const target = this.target;
    if (!target) return;
    if (!canSleep(target)) { this.cancel(); return; }
    const position = target.getPosition();
    if (!this.inReach(target)) {
      this.direction.subVectors(this.world.player.position, position).setY(0).normalize();
      const destination = position.addScaledVector(this.direction, SLEEPIN_REACH * .8);
      if (!this.locomotor.destination || this.locomotor.destination.distanceToSquared(destination) > .01) {
        if (!this.locomotor.goToPoint(destination)) this.cancel();
      }
      return;
    }
    this.locomotor.stop();
    this.faceTarget(position);
    // actions.lua SLEEPIN.fn: the target's sleepingbag takes the doer.
    const action = new BufferedAction('SLEEPIN', () => { target.component.DoSleep(this.sleeper); return true; },
      () => canSleep(target) && this.inReach(target), { target });
    if (this.animation.stategraph.pushBufferedAction(action)) {
      this.action = action;
      this.target = undefined;
    }
  }

  private inReach(target: SleepTarget): boolean {
    const position = target.getPosition(), player = this.world.player.position;
    return (position.x - player.x) ** 2 + (position.z - player.z) ** 2 <= SLEEPIN_REACH ** 2;
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
    if (this.disposed || event.defaultPrevented || event.button !== 0) return;
    this.picker.pointer.trackPointer(event);
    const action = this.picker.getMouseActions(event).left;
    if (action?.action !== 'SLEEPIN' || !action.target) { this.cancel(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    this.request(action.target as SleepTarget);
  };
  private readonly handleKeyDown = (event: KeyboardEvent): void => { if (event.code === 'Escape') this.cancel(); };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.cancel();
    this.stopActionEvents(); this.unregister();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown, true);
    window.removeEventListener('keydown', this.handleKeyDown);
    if (this.picker !== this.world.mouseActions) this.picker.dispose();
  }
}

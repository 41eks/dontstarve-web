import * as THREE from 'three';
import type { Hauntable } from '../../componets/src/hauntable';
import { TILE_SIZE } from '../../prefab/src/tile.ts';
import { BufferedAction, type BufferedActionObject } from './bufferedaction.ts';
import type { ActionWorldContext, ActionAnimationController, ActionLocomotor } from './actionContext.ts';
import { bindActionCancellation } from './actionEvents.ts';
import { PlayerActionPicker, type MouseActionCandidate } from './playeractionpicker.ts';
import { PointerRaycaster } from './pointerRaycaster.ts';
import { modelHasTag, prefabInstance } from '../../prefab/src/prefabInstance';

/** actions.lua HAUNT mindistance = 2 DST units. */
export const HAUNT_REACH = 2 * TILE_SIZE / 4;

export interface HauntTarget extends BufferedActionObject {
  readonly model: THREE.Object3D;
  readonly component: Hauntable;
  getPosition(): THREE.Vector3;
}

/** ACTIONS.HAUNT.fn's target test: a valid, unheld hauntable that is not already haunted or catchable. */
function canHaunt(target: HauntTarget): boolean {
  return !!target.model.parent && target.model.userData.components?.hauntable === target.component
    && !target.component.IsHaunted() && !target.hasTag('haunted') && !target.hasTag('catchable');
}

function hauntTarget(model: THREE.Object3D): HauntTarget | undefined {
  const component = model.userData.components?.hauntable as Hauntable | undefined;
  if (!component) return undefined;
  return {
    model, component, prefab: model.userData.actionEntity?.prefab ?? prefabInstance(model)?.prefab,
    hasTag: tag => model.userData.actionEntity?.hasTag(tag) ?? modelHasTag(model, tag),
    getPosition: () => model.userData.getGroundPosition?.() ?? model.position.clone(),
  };
}

/** componentactions.lua SCENE.hauntable: ghosts (ghost_valid, ghost_exclusive) are offered HAUNT on the left button. */
export function getHauntActions(model: THREE.Object3D | undefined, isGhost: boolean): MouseActionCandidate[] {
  if (!model || !isGhost) return [];
  const target = hauntTarget(model);
  return target ? [{ action: { action: 'HAUNT', target }, button: 'left', model, available: canHaunt(target) }] : [];
}

/** Click a hauntable as a ghost: walk to it, then HAUNT through SGwilsonghost's haunt_pre state. */
export class HauntActionController {
  private readonly picker: PlayerActionPicker;
  private readonly unregister: () => void;
  private readonly stopActionEvents: () => void;
  private target?: HauntTarget;
  private action?: BufferedAction<'HAUNT'>;
  private disposed = false;
  private readonly direction = new THREE.Vector3();
  private readonly world: ActionWorldContext;
  private readonly animation: ActionAnimationController & { readonly isGhost: boolean };
  private readonly locomotor: ActionLocomotor;
  private readonly doer: { hasTag(tag: string): boolean; PushEvent(name: string, data?: unknown): void };
  private readonly isManualMovement: () => boolean;

  constructor(world: ActionWorldContext, animation: ActionAnimationController & { readonly isGhost: boolean }, locomotor: ActionLocomotor,
    doer: HauntActionController['doer'], isManualMovement = () => false) {
    this.world = world; this.animation = animation; this.locomotor = locomotor; this.doer = doer; this.isManualMovement = isManualMovement;
    this.picker = world.mouseActions ?? new PlayerActionPicker(new PointerRaycaster(world));
    this.unregister = this.picker.register(model => getHauntActions(model, this.animation.isGhost));
    this.stopActionEvents = bindActionCancellation(world, this, 'haunt', () => this.cancel());
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  request(target: HauntTarget): boolean {
    if (this.disposed || !this.animation.isGhost || !canHaunt(target) || this.animation.stategraph.hasStateTag('busy')) return false;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: 'HAUNT' });
    this.target = target;
    return true;
  }

  cancel(): void {
    if (this.target || (this.action && this.animation.stategraph.isActionActive(this.action))) this.locomotor.stop();
    this.target = undefined;
    if (this.action && this.animation.stategraph.isActionActive(this.action)) this.animation.stategraph.cancelAction('HAUNT');
    this.action = undefined;
  }

  update(): void {
    if (this.disposed) return;
    if (this.isManualMovement()) { this.cancel(); return; }
    if (this.action && !this.animation.stategraph.isActionActive(this.action)) { this.action = undefined; return; }
    const target = this.target;
    if (!target) return;
    if (!this.animation.isGhost || !canHaunt(target)) { this.cancel(); return; }
    const position = target.getPosition();
    if (!this.inReach(position)) {
      this.direction.subVectors(this.world.player.position, position).setY(0).normalize();
      const destination = position.clone().addScaledVector(this.direction, HAUNT_REACH * .8);
      if (!this.locomotor.destination || this.locomotor.destination.distanceToSquared(destination) > .01) {
        if (!this.locomotor.goToPoint(destination)) this.cancel();
      }
      return;
    }
    this.locomotor.stop();
    // actions.lua HAUNT.fn: the doer pushes "haunt", then the target's hauntable runs DoHaunt.
    const action = new BufferedAction('HAUNT', () => {
      if (!canHaunt(target)) return false;
      this.doer.PushEvent('haunt', { target });
      target.component.DoHaunt(this.doer);
      return true;
    }, () => canHaunt(target) && this.inReach(target.getPosition()), { target });
    if (this.animation.stategraph.pushBufferedAction(action)) {
      this.action = action;
      this.target = undefined;
    }
  }

  private inReach(position: THREE.Vector3): boolean {
    return this.world.player.position.distanceToSquared(position) <= HAUNT_REACH ** 2;
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (this.disposed || event.defaultPrevented || event.button !== 0 || !this.animation.isGhost) return;
    this.picker.pointer.trackPointer(event);
    const action = this.picker.getMouseActions(event).left;
    if (action?.action !== 'HAUNT' || !action.target) { this.cancel(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    this.request(action.target as HauntTarget);
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

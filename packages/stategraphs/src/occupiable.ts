import { findActionEntity } from '../../prefab/src/actionEntity';
import * as THREE from 'three';
import { BufferedAction, type BufferedActionObject } from './bufferedaction.ts';
import type { ActionWorldContext, ActionAnimationController, ActionLocomotor } from './actionContext.ts';
import { bindActionCancellation } from './actionEvents.ts';
import { PlayerActionPicker, type MouseActionCandidate } from './playeractionpicker.ts';
import { PointerRaycaster } from './pointerRaycaster.ts';

export const OCCUPIABLE_REACH = 4;
type OccupiableAction = 'HARVEST' | 'TAKEITEM';

/** What actions.lua HARVEST / TAKEITEM read from the target's occupiable and shelf components. */
export interface OccupiableComponent { IsOccupied(): boolean; Harvest(): unknown }
export interface ShelfComponent<Item = unknown> { TakeItem(taker: { GiveItem(item: Item): boolean }): boolean }

export interface OccupiableTarget extends BufferedActionObject {
  readonly model: THREE.Object3D;
  readonly isRemoved: boolean;
  readonly components: { occupiable?: OccupiableComponent; shelf?: ShelfComponent };
  getPosition(): THREE.Vector3;
}

function canAct(action: OccupiableAction, target: OccupiableTarget): boolean {
  if (target.isRemoved || target.hasTag('burnt') || !target.model.parent || !target.model.visible) return false;
  // componentactions.lua SCENE.occupiable / SCENE.shelf: the tags mirror the components' state.
  return action === 'HARVEST' ? target.hasTag('occupied') && target.components.occupiable?.IsOccupied() === true
    : target.hasTag('takeshelfitem') && target.components.shelf !== undefined;
}

/** Scene actions are discovered from component tags, never from the prefab ID. */
export function getOccupiableActions(model: THREE.Object3D | undefined): MouseActionCandidate[] {
  const actions: MouseActionCandidate[] = [];
  if (!model) return actions;
  const entity = findActionEntity(model) as OccupiableTarget | undefined;
  if (!entity?.components.occupiable && !entity?.components.shelf) return actions;
  const target: OccupiableTarget = {
    model, isRemoved: entity.isRemoved, components: entity.components, prefab: entity.prefab,
    hasTag: tag => entity.hasTag(tag), getPosition: () => entity.getPosition(),
  };
  for (const action of ['HARVEST', 'TAKEITEM'] as const) {
    if (!target.hasTag(action === 'HARVEST' ? 'occupied' : 'takeshelfitem')) continue;
    const modifier = action === 'HARVEST' ? 'FREE' : 'BIRDCAGE';
    for (const button of ['left', 'right'] as const) actions.push({
      action: { action, modifier, target }, button, model, available: canAct(action, target),
    });
  }

  return actions;
}

/** HARVEST (occupiable:Harvest → inventory) and TAKEITEM (shelf:TakeItem → inventory) on a caged inst. */
export class OccupiableActionController {
  private readonly picker: PlayerActionPicker;
  private readonly unregister: () => void;
  private readonly stopActionEvents: () => void;
  private pending?: { action: OccupiableAction; target: OccupiableTarget };
  private buffered?: BufferedAction<OccupiableAction>;
  private version = 0;
  private disposed = false;
  private readonly direction = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly world: ActionWorldContext;
  private readonly animation: ActionAnimationController;
  private readonly locomotor: ActionLocomotor;
  private readonly give: (item: unknown, source: THREE.Vector3) => boolean;
  private readonly isManualMovement: () => boolean;

  /** `give` is inventory:GiveItem(item, nil, position) for the acting player. */
  constructor(world: ActionWorldContext, animation: ActionAnimationController, locomotor: ActionLocomotor,
    give: (item: unknown, source: THREE.Vector3) => boolean, isManualMovement = () => false) {
    this.world = world; this.animation = animation; this.locomotor = locomotor;
    this.give = give; this.isManualMovement = isManualMovement;
    this.picker = world.mouseActions ?? new PlayerActionPicker(new PointerRaycaster(world));
    this.unregister = this.picker.register(model => getOccupiableActions(model));
    this.stopActionEvents = bindActionCancellation(world, this, 'harvest', () => this.cancel());
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  request(action: OccupiableAction, target: OccupiableTarget): boolean {
    if (this.disposed || !canAct(action, target) || this.animation.stategraph.hasStateTag('busy')) return false;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action });
    this.animation.cancelEmote();
    this.pending = { action, target };
    return true;
  }

  cancel(): void {
    this.version++;
    if (this.pending || (this.buffered && this.animation.stategraph.isActionActive(this.buffered))) this.locomotor.stop();
    this.pending = undefined;
    if (this.buffered && this.animation.stategraph.isActionActive(this.buffered)) this.animation.stategraph.cancelAction(this.buffered.action);
    this.buffered = undefined;
  }

  update(): void {
    if (this.disposed) return;
    if (this.isManualMovement()) { this.cancel(); return; }
    if (this.buffered && !this.animation.stategraph.isActionActive(this.buffered)) { this.cancel(); return; }
    const pending = this.pending;
    if (!pending) return;
    const { action, target } = pending;
    if (!canAct(action, target)) { this.cancel(); return; }
    const position = target.getPosition();
    if (!this.inReach(target)) {
      this.direction.subVectors(this.world.player.position, position).setY(0).normalize();
      const destination = position.clone().addScaledVector(this.direction, OCCUPIABLE_REACH * .8);
      if (!this.locomotor.destination || this.locomotor.destination.distanceToSquared(destination) > .01) {
        if (!this.locomotor.goToPoint(destination)) this.cancel();
      }
      return;
    }
    this.locomotor.stop();
    this.faceTarget(position);
    const version = this.version;
    const source = target.getPosition();
    const buffered = new BufferedAction(action, () => {
      if (action === 'HARVEST') {
        // actions.lua HARVEST: the occupant is harvested, then given to the doer.
        const item = target.components.occupiable?.Harvest();
        return item !== undefined && (this.give(item, source), true);
      }
      return target.components.shelf?.TakeItem({ GiveItem: item => this.give(item, source) }) ?? false;
    }, () => version === this.version && canAct(action, target) && this.inReach(target), { target });
    if (this.animation.stategraph.pushBufferedAction(buffered)) {
      this.buffered = buffered;
      this.pending = undefined;
    }
  }

  private inReach(target: OccupiableTarget): boolean {
    const position = target.getPosition(), player = this.world.player.position;
    return (position.x - player.x) ** 2 + (position.z - player.z) ** 2 <= OCCUPIABLE_REACH ** 2;
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
    const actions = this.picker.getMouseActions(event);
    const action = event.button === 0 ? actions.left : actions.right;
    const target = action?.target as OccupiableTarget | undefined;
    // Stewer harvests share the HARVEST action id and belong to HarvestActionController.
    if ((action?.action !== 'HARVEST' && action?.action !== 'TAKEITEM') || !target?.components) {
      if (action?.action !== 'HARVEST') this.cancel();
      return;
    }
    if (!target.components.occupiable && !target.components.shelf) return;
    event.preventDefault(); event.stopImmediatePropagation();
    this.request(action.action, target);
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

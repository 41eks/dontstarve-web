import * as THREE from 'three';
import type { ItemEntity, InventoryStore } from '../../inventory/src/index.ts';
import type { InventoryActor } from '../../componets/src/inventoryitem.ts';
import { BufferedAction } from './bufferedaction.ts';
import type { ActionWorldContext, ActionAnimationController, ActionLocomotor } from './actionContext.ts';
import { bindActionCancellation } from './actionEvents.ts';
import { PlayerActionPicker, type MouseActionCandidate } from './playeractionpicker.ts';
import { PointerRaycaster } from './pointerRaycaster.ts';
import { modelHasTag } from '../../prefab/src/prefabInstance';

export interface PickupDoer extends InventoryActor { components: { inventory: InventoryStore }; }
export function createPickupDoer(player: THREE.Object3D, inventory: InventoryStore): PickupDoer {
  const doer: PickupDoer = { components: { inventory }, GetPosition: () => player.position,
    hasTag: tag => tag === 'player' || modelHasTag(player, tag),
    PushEvent: (name, data) => player.dispatchEvent({ type: name, data } as never) };
  inventory.bindActor(doer);
  return doer;
}
export interface PickupTarget {
  readonly model: THREE.Object3D;
  readonly entity: ItemEntity;
  readonly position: THREE.Vector3;
  isValid(): boolean;
  hasTag(tag: string): boolean;
}

function available(target: PickupTarget, doer: PickupDoer, right: boolean): boolean {
  const inst = target.entity, item = inst.components.inventoryitem;
  return target.isValid() && item.CanBePickedUp(doer)
    && !doer.components.inventory.GetActiveItem()
    && (doer.components.inventory.GetNumSlots() > 0 || !!inst.components.equippable)
    && !target.hasTag('catchable') && !target.hasTag('smolder')
    && (!target.hasTag('fire') || target.hasTag('lighter'))
    && (!target.hasTag('spider') || (doer.hasTag('spiderwhisperer') && right))
    && (right || !target.hasTag('heavy') || target.hasTag('heavylift_lmb'))
    && !(right && inst.components.container && !inst.components.equippable);
}

/** actions.lua PICKUP.fn: validate, notify the doer, then equip or give the original inst. */
export function performPickupAction(target: PickupTarget, doer: PickupDoer): boolean {
  const inst = target.entity, item = inst.components.inventoryitem, inventory = doer.components.inventory;
  if (!target.isValid() || item.owner || !item.CanBePickedUp(doer)
    || (target.hasTag('fire') && !target.hasTag('lighter')) || inst.components.projectile?.IsThrown()) return false;
  if (inst.components.container?.IsOpenedByOthers(doer)) return false;
  doer.PushEvent('onpickupitem', { item: inst });
  const equippable = inst.components.equippable;
  if (equippable && !equippable.IsRestricted()) {
    const equip = inventory.GetEquippedItem(equippable.equipslot);
    if (equip && !item.cangoincontainer) {
      const previous = inventory.Unequip(equippable.equipslot);
      if (previous) {
        if (previous.components.inventoryitem.cangoincontainer) inventory.GiveItem(previous);
        else inventory.DropItem(previous);
      }
      return inventory.Equip(inst);
    }
    if (doer.hasTag('player') && (!equip || inventory.GetNumSlots() <= 0)) return inventory.Equip(inst);
  }
  inventory.GiveItem(inst, target.position);
  return true;
}

export function getPickupActions(model: THREE.Object3D | undefined, doer: PickupDoer): MouseActionCandidate[] {
  const actions: MouseActionCandidate[] = [];
  if (!model) return actions;
  const target = model.userData.pickupTarget as PickupTarget | undefined;
  if (!target) return actions;
  model.position.copy(target.position);
  for (const button of ['left', 'right'] as const) actions.push({
    action: { action: 'PICKUP', target }, model, button, available: available(target, doer, button === 'right'),
  });

  return actions;
}

/** PlayerController/Locomotor browser adapter; SGwilson chooses when PICKUP commits. */
export class PickupActionController {
  private readonly world: ActionWorldContext;
  private readonly animation: ActionAnimationController;
  private readonly locomotor: ActionLocomotor;
  private readonly doer: PickupDoer;
  private readonly isManualMovement: () => boolean;
  private readonly picker: PlayerActionPicker;
  private readonly unregister: () => void;
  private readonly stopEvents: () => void;
  private target?: PickupTarget;
  private action?: BufferedAction<'PICKUP'>;
  private disposed = false;
  private version = 0;
  private readonly direction = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();

  constructor(world: ActionWorldContext, animation: ActionAnimationController, locomotor: ActionLocomotor,
    doer: PickupDoer, isManualMovement = () => false) {
    this.world = world; this.animation = animation; this.locomotor = locomotor;
    this.doer = doer; this.isManualMovement = isManualMovement;
    this.picker = world.mouseActions ?? new PlayerActionPicker(new PointerRaycaster(world));
    this.unregister = this.picker.register(model => getPickupActions(model, doer));
    this.stopEvents = bindActionCancellation(world, this, 'pickup', () => this.cancel());
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }
  request(target: PickupTarget): boolean {
    if (this.disposed || !target.isValid() || this.animation.stategraph.hasStateTag('busy')) return false;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: 'PICKUP' });
    this.animation.cancelEmote(); this.target = target;
    return true;
  }
  cancel(): void {
    this.version++;
    if (this.target || (this.action && this.animation.stategraph.isActionActive(this.action))) this.locomotor.stop();
    this.target = undefined;
    if (this.action && this.animation.stategraph.isActionActive(this.action)) this.animation.stategraph.cancelAction('PICKUP');
    this.action = undefined;
  }
  update(): void {
    if (this.disposed) return;
    if (this.isManualMovement()) { this.cancel(); return; }
    if (this.action && !this.animation.stategraph.isActionActive(this.action)) { this.cancel(); return; }
    const target = this.target;
    if (!target) return;
    if (!target.isValid()) { this.cancel(); return; }
    const position = target.position.clone();
    if (!this.inReach(target)) {
      this.direction.subVectors(this.world.player.position, position).setY(0).normalize();
      const destination = position.addScaledVector(this.direction, 3.2);
      if (!this.locomotor.destination || this.locomotor.destination.distanceToSquared(destination) > .01) {
        if (!this.locomotor.goToPoint(destination)) this.cancel();
      }
      return;
    }
    this.locomotor.stop();
    this.direction.subVectors(position, this.world.player.position).setY(0);
    this.world.camera.getWorldDirection(this.forward); this.forward.setY(0).normalize();
    this.right.crossVectors(this.forward, new THREE.Vector3(0, 1, 0)).normalize();
    const forward = this.direction.dot(this.forward), side = this.direction.dot(this.right);
    this.animation.setFacing(Math.abs(forward) >= Math.abs(side) ? (forward > 0 ? 'up' : 'down') : 'side',
      Math.abs(side) > Math.abs(forward) && side < 0);
    const version = this.version;
    const action = new BufferedAction('PICKUP', () => performPickupAction(target, this.doer),
      () => version === this.version && target.isValid() && this.inReach(target), { target });
    if (this.animation.stategraph.pushBufferedAction(action)) { this.action = action; this.target = undefined; }
  }
  private inReach(target: PickupTarget): boolean {
    const p = target.position, player = this.world.player.position;
    return (p.x - player.x) ** 2 + (p.z - player.z) ** 2 <= 16;
  }
  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (this.disposed || event.defaultPrevented || (event.button !== 0 && event.button !== 2)) return;
    this.picker.pointer.trackPointer(event);
    const actions = this.picker.getMouseActions(event), action = event.button === 0 ? actions.left : actions.right;
    if (action?.action !== 'PICKUP' || !action.target) { this.cancel(); return; }
    event.preventDefault(); event.stopImmediatePropagation(); this.request(action.target as PickupTarget);
  };
  private readonly handleKeyDown = (event: KeyboardEvent): void => { if (event.code === 'Escape') this.cancel(); };
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.cancel(); this.stopEvents(); this.unregister();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown, true);
    window.removeEventListener('keydown', this.handleKeyDown);
    if (this.picker !== this.world.mouseActions) this.picker.dispose();
  }
}

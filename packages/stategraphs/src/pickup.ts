import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import * as THREE from 'three';
import type { ItemEntity, InventoryStore } from '../../inventory/src/index.ts';
import type { InventoryActor } from '../../componets/src/inventoryitem.ts';
import { modelHasTag, prefabInstance, setModelTag } from '../../prefab/src/prefabInstance';

/**
 * The player inst as actions.lua's fns reach it through `act.doer`: its tags, events, position, stategraph and the
 * components the application binds to it (inventory, sanity, combat, sleepingbaguser).
 */
export interface PickupDoer extends InventoryActor {
  getPosition(): THREE.Vector3;
  /** spellcaster.lua reads the caster's position. */
  readonly position: ReadonlyVector3;
  readonly sg?: { HasStateTag(tag: string): boolean };
  /** TheWorld.Map, as ACTIONS.DEPLOY reaches it. */
  Map?: import('../../componets/src/deployable').DeployMap;
  components: {
    inventory: InventoryStore;
    sanity?: { DoDelta(delta: number): void };
    combat?: import('../../componets/src/combat').Combat;
    sleepingbaguser?: import('../../componets/src/sleepingbag').SleepingBagSleeper;
    staffsanity?: { doCastingDelta(delta: number): void };
  };
}
export function createPickupDoer(player: THREE.Object3D, inventory: InventoryStore): PickupDoer {
  const doer: PickupDoer = { components: { inventory }, GetPosition: () => player.position, getPosition: () => player.position,
    position: player.position,
    // inst.sg:HasStateTag, as workable callbacks read the worker's state.
    get sg() { const sg = prefabInstance(player)?.sg; return sg && { HasStateTag: (tag: string) => sg.hasStateTag(tag) }; },
    hasTag: tag => tag === 'player' || modelHasTag(player, tag),
    addTag: tag => setModelTag(player, tag, true),
    removeTag: tag => setModelTag(player, tag, false),
    PushEvent: (name, data) => prefabInstance(player)?.PushEvent(name, data) };
  inventory.bindActor(doer);
  return doer;
}
export interface PickupTarget {
  readonly model: THREE.Object3D;
  readonly entity: ItemEntity;
  readonly position: ReadonlyVector3;
  isValid(): boolean;
  hasTag(tag: string): boolean;
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
  // GetPosition() in PICKUP.fn snapshots the source before OnPutInInventory moves the inst to (0, 0, 0).
  inventory.GiveItem(inst, target.position.clone());
  return true;
}

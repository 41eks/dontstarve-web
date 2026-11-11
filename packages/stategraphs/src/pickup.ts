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
  /** inst.prefab, whose speech GetDescription looks up. */
  readonly prefab?: string;
  /** The player inst always owns its tags, as reader.lua adds "reader". */
  addTag(tag: string): void;
  removeTag(tag: string): void;
  getPosition(): THREE.Vector3;
  /** spellcaster.lua reads the caster's position. */
  readonly position: ReadonlyVector3;
  readonly sg?: { HasStateTag(tag: string): boolean };
  /** TheWorld.Map, as ACTIONS.DEPLOY reaches it. */
  Map?: import('../../componets/src/deployable').DeployMap;
  /** inst.SoundEmitter, as components play sounds on the doer (pickable:Fertilize). */
  readonly SoundEmitter?: { PlaySound(path: import('../../prefab/src/sound').SoundEventPath): void };
  components: {
    inventory: InventoryStore;
    talker?: import('../../componets/src/talker').Talker;
    sanity?: { DoDelta(delta: number): void };
    combat?: import('../../componets/src/combat').Combat;
    sleepingbaguser?: import('../../componets/src/sleepingbag').SleepingBagSleeper;
    staffsanity?: { doCastingDelta(delta: number): void };
    /** eater.lua, which ACTIONS.EAT reaches on the doer. */
    eater?: import('../../componets/src/eater').Eater;
    /** reader.lua, which ACTIONS.READ reaches on the doer. */
    reader?: { Read(book: object): readonly [boolean, string?] | undefined; OnRemoveFromEntity(): void };
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
/** The inst a PICKUP targets: in the scene, unowned and not flying off as a projectile. */
export function canPickUp(inst: ItemEntity): boolean {
  return !inst.isRemoved && !inst.inlimbo && !inst.components.inventoryitem.owner;
}

/** actions.lua PICKUP.fn: validate, notify the doer, then equip or give the original inst. */
export function performPickupAction(inst: ItemEntity, doer: PickupDoer): boolean {
  const item = inst.components.inventoryitem, inventory = doer.components.inventory;
  if (!canPickUp(inst) || !item.CanBePickedUp(doer)
    || (inst.hasTag('fire') && !inst.hasTag('lighter')) || inst.components.projectile?.IsThrown()) return false;
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
  inventory.GiveItem(inst, inst.transform.position.clone());
  return true;
}

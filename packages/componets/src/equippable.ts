import type { EquipmentKind } from '../../inventory/src/types';
import type { EquipmentOwner } from '../../signals/src/equipment';

export interface EquippableInst {
  GetIsWet(): boolean;
  PushEvent(name: string, data?: unknown): void;
  readonly components?: { readonly burnable?: { StopSmoldering(): void } };
}
/** The wearer as a dapperfn sees it. */
export interface EquippableOwner {
  hasTag(tag: string): boolean;
  readonly components?: {
    readonly sanity?: { IsInsanityMode(): boolean; GetPercent(): number };
  };
}

/** equippable.lua: the equip slot, dapperness and the prefab's onequip/onunequip; the owner's inventory calls Equip/Unequip. */
export class Equippable<Inst extends EquippableInst = EquippableInst> {
  equipslot: EquipmentKind;
  dapperness = 0;
  is_magic_dapperness = false;
  dapperfn?: (inst: EquippableInst, owner: EquippableOwner | undefined) => number;
  isequipped = false;
  onequipfn?: (inst: Inst, owner: EquipmentOwner) => void;
  onunequipfn?: (inst: Inst, owner: EquipmentOwner) => void;
  private readonly inst: Inst;

  constructor(inst: Inst, equipslot: EquipmentKind) { this.inst = inst; this.equipslot = equipslot; }
  SetOnEquip(fn: (inst: Inst, owner: EquipmentOwner) => void): void { this.onequipfn = fn; }
  SetOnUnequip(fn: (inst: Inst, owner: EquipmentOwner) => void): void { this.onunequipfn = fn; }
  IsEquipped(): boolean { return this.isequipped; }
  Equip(owner: EquipmentOwner): void {
    this.isequipped = true;
    this.inst.components?.burnable?.StopSmoldering();
    this.onequipfn?.(this.inst, owner);
    this.inst.PushEvent('equipped', { owner });
  }
  Unequip(owner: EquipmentOwner): void {
    this.isequipped = false;
    this.onunequipfn?.(this.inst, owner);
    this.inst.PushEvent('unequipped', { owner });
  }
  IsRestricted(): boolean { return false; }
  SetDappernessFn(fn: (inst: EquippableInst, owner: EquippableOwner | undefined) => number): void { this.dapperfn = fn; }
  GetDapperness(owner?: EquippableOwner, ignoreWetness = false): number {
    let dapperness = this.dapperfn ? this.dapperfn(this.inst, owner) : this.dapperness;
    if (!ignoreWetness && this.inst.GetIsWet()) dapperness -= .1; // TUNING.WET_ITEM_DAPPERNESS
    return dapperness;
  }
}

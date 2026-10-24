import type { EquipmentKind } from '../../inventory/src/types';

export interface EquippableInst { GetIsWet(): boolean; }
export interface EquippableOwner { hasTag(tag: string): boolean; }

/** equippable.lua's supported equipment slot and dapperness data; inventory owns equip/unequip. */
export class Equippable {
  equipslot: EquipmentKind;
  dapperness = 0;
  is_magic_dapperness = false;
  private readonly inst: EquippableInst;

  constructor(inst: EquippableInst, equipslot: EquipmentKind) { this.inst = inst; this.equipslot = equipslot; }
  IsRestricted(): boolean { return false; }
  GetDapperness(_owner?: EquippableOwner, ignoreWetness = false): number {
    let dapperness = this.dapperness;
    if (!ignoreWetness && this.inst.GetIsWet()) dapperness -= .1; // TUNING.WET_ITEM_DAPPERNESS
    return dapperness;
  }
}

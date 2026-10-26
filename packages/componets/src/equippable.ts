import type { EquipmentKind } from '../../inventory/src/types';

export interface EquippableInst { GetIsWet(): boolean; }
/** The wearer as a dapperfn sees it. */
export interface EquippableOwner {
  hasTag(tag: string): boolean;
  readonly components?: {
    readonly sanity?: { IsInsanityMode(): boolean; GetPercent(): number };
  };
}

/** equippable.lua's supported equipment slot and dapperness data; inventory owns equip/unequip. */
export class Equippable {
  equipslot: EquipmentKind;
  dapperness = 0;
  is_magic_dapperness = false;
  dapperfn?: (inst: EquippableInst, owner: EquippableOwner | undefined) => number;
  private readonly inst: EquippableInst;

  constructor(inst: EquippableInst, equipslot: EquipmentKind) { this.inst = inst; this.equipslot = equipslot; }
  IsRestricted(): boolean { return false; }
  SetDappernessFn(fn: (inst: EquippableInst, owner: EquippableOwner | undefined) => number): void { this.dapperfn = fn; }
  GetDapperness(owner?: EquippableOwner, ignoreWetness = false): number {
    let dapperness = this.dapperfn ? this.dapperfn(this.inst, owner) : this.dapperness;
    if (!ignoreWetness && this.inst.GetIsWet()) dapperness -= .1; // TUNING.WET_ITEM_DAPPERNESS
    return dapperness;
  }
}

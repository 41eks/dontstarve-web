/** constants.lua EQUIPMENTSETNAMES. */
export const EQUIPMENTSETNAMES = { DREADSTONE: 'dreadstone' } as const;
export type EquipmentSetName = typeof EQUIPMENTSETNAMES[keyof typeof EQUIPMENTSETNAMES];

/**
 * setbonus.lua: a head and body item with the same set name enable each other. inventory:Equip/Unequip drive
 * UpdateSetBonus; no second dreadstone set member is ported, so the bonus stays disabled.
 */
export class SetBonus {
  setname = '';
  enabled = false;
  SetSetName(name: EquipmentSetName): void { this.setname = name; }
  IsEnabled(setname?: EquipmentSetName): boolean { return this.enabled && (setname === undefined || this.setname === setname); }
}

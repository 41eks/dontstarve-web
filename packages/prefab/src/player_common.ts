import type { EquipmentKind, InventoryStore } from '@dontstarve-web/inventory';

/**
 * player_common.lua OnItemRanOut and the SGwilson.lua toolbroke exit:
 * equip another equippable of the same prefab found in the inventory.
 */
export function equipSamePrefab(
  inventory: Pick<InventoryStore, 'GetEquippedItem' | 'FindItem' | 'EquipFromInventory'>,
  prefab: string,
  equipslot?: EquipmentKind,
): boolean {
  if (equipslot !== undefined && inventory.GetEquippedItem(equipslot)) return false;
  const same = inventory.FindItem(item => item.prefab === prefab
    && item.components.equippable !== undefined
    && (equipslot === undefined || item.components.equippable.equipslot === equipslot));
  return same !== null && inventory.EquipFromInventory(same);
}

export function OnItemRanOut(inventory: Parameters<typeof equipSamePrefab>[0], data: unknown): void {
  const { prefab, equipslot } = (data ?? {}) as { prefab?: string; equipslot?: EquipmentKind };
  if (prefab !== undefined && equipslot !== undefined) equipSamePrefab(inventory, prefab, equipslot);
}

import type { InventoryStore, ItemEntity } from '@dontstarve-web/inventory';
import type { SlotItem } from '@dontstarve-web/ui';

/**
 * widgets/itemtile.lua reads the live inst: the slot item carries the inst's tile declaration (name, image, count,
 * durability, freshness, wetness) and its equip slot. The static fields are the tile's current values, kept only
 * for the item's identity and stack limit; save records are not involved.
 */
export function createInventorySlotItem(inventory: Pick<InventoryStore, 'getItemSpec'>): (entity: ItemEntity) => SlotItem {
  return (entity) => {
    const spec = inventory.getItemSpec(entity.prefab, entity.skinId);
    const tile = entity.tile, current = tile.peek();
    const equipslot = entity.components.equippable?.equipslot;
    return {
      entityId: entity.id,
      id: entity.prefab,
      ...(entity.skinId === undefined ? {} : { skinId: entity.skinId }),
      name: current.name ?? spec.name,
      count: current.count,
      maxStack: spec.maxStack,
      icon: current.image?.icon ?? spec.icon,
      ...(current.image ? { atlas: current.image.atlas } : spec.atlas ? { atlas: spec.atlas } : {}),
      ...(equipslot ? { equippable: equipslot } : {}),
      tile,
    };
  };
}

import type { ItemEntity } from '@dontstarve-web/inventory';

export const ICE_ID = 'ice';

/**
 * inv_rocks_ice.lua: tags, and onperish. A held stack is removed whole; a world stack no longer persists or can be
 * picked up, plays `melt` and is removed on its animover.
 * Not ported: DoDeltaMoistureToEntity on the owner and the farming_manager soil moisture, which need wetness/farming systems.
 */
export function configureIceEntity(entity: ItemEntity): void {
  for (const tag of ['frozen', 'molebait', 'watersource']) { entity.addTag(tag); }
  entity.components.perishable.perishfn = () => {
    if (entity.components.inventoryitem.owner) { entity.remove(); return; }
    entity.persists = false;
    entity.components.inventoryitem.canbepickedup = false;
    entity.sprite.playOnce('melt', () => entity.remove());
  };
}

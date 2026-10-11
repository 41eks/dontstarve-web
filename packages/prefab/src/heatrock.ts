import type { ItemEntity } from '@dontstarve-web/inventory';
import catalog from './groundItems.json' with { type: 'json' };

export const HEATROCK_ID = 'heatrock';
export const HEATROCK_FUEL = 100;
/** heatrock.lua UpdateImages(inst, 3); temperature updates are deliberately deferred. */
export const HEATROCK_IMAGES = catalog.items.heatrock.inventoryImageVariants;

export function configureHeatRockEntity(entity: ItemEntity): void {
  for (const tag of ['heatrock', 'icebox_valid', 'bait', 'molebait', 'HASHEATER', 'tradable']) entity.addTag(tag);
  entity.components.fueled.setMaxFuel(HEATROCK_FUEL);
  if (entity.components.fueled.remaining === undefined) entity.components.fueled.remaining = HEATROCK_FUEL;
}

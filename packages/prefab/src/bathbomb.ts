import type { ItemEntity } from '@dontstarve-web/inventory';
import { BathBomb } from '../../componets/src/bathbomb';
import { Fuel } from '../../componets/src/fuel';

export const BATHBOMB_ID = 'bathbomb' as const;
/** tuning.lua MED_FUEL = seg_time * 1.5. */
export const BATHBOMB_FUEL = 22.5;

/** bathbomb.lua: bathbomb + fuel components; burnable and stackable come from the shared item tables. */
export function configureBathbombEntity(entity: ItemEntity): void {
  entity.components.bathbomb ??= entity.component('bathbomb', () => new BathBomb(entity));
  if (!entity.components.fuel) {
    const fuel = entity.component('fuel', () => new Fuel(entity));
    fuel.fuelvalue = BATHBOMB_FUEL;
    entity.components.fuel = fuel;
  }
}

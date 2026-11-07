import { addComponent } from './components';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { BathBomb } from '../../componets/src/bathbomb';
import { Fuel } from '../../componets/src/fuel';

export const BATHBOMB_ID = 'bathbomb' as const;
/** tuning.lua MED_FUEL = seg_time * 1.5. */
export const BATHBOMB_FUEL = 22.5;

/** bathbomb.lua: bathbomb + fuel components; burnable and stackable come from the shared item tables. */
export function configureBathbombEntity(entity: ItemEntity): void {
  addComponent(entity, 'bathbomb', BathBomb);
  if (!entity.components.fuel) {
    addComponent(entity, 'fuel', Fuel).fuelvalue = BATHBOMB_FUEL;
  }
}

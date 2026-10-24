import type { ItemEntity } from '@dontstarve-web/inventory';
import { Repairer } from '../../componets/src/repairer';

/** moonrocknugget.lua + tuning.lua: one nugget repairs two work or forty health. */
export function configureMoonrockNugget(entity: ItemEntity): void {
  entity.components.repairer = entity.component('repairer', () => new Repairer(entity, 'moonrock', 2, 40));
  entity.addTag('tradable');
}

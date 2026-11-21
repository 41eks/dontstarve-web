import { addComponent } from './components';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { Edible } from '../../componets/src/edible';
import { Bait } from '../../componets/src/bait';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';

/** The source catalog records actual molebait + bait components, including minerals and trinkets. */
export function configureMoleBaitEntity(entity: ItemEntity): void {
  const definition = GROUND_ITEM_DEFINITIONS[entity.prefab];
  if (definition?.elementalFoodHunger !== undefined && !entity.components.edible) {
    const edible = addComponent(entity, 'edible', Edible, () => entity.components.perishable.stage.peek());
    edible.hungervalue = definition.elementalFoodHunger;
    edible.foodtype = 'ELEMENTAL';
  }
  if (!definition?.moleBait) {
    return;
  }
  entity.addTag('molebait');
  addComponent(entity, 'bait', Bait);
}

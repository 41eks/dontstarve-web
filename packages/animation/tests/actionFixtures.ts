import { ItemEntity } from '../../inventory/src/entity';
import { getHandEquipmentDefinition } from '../../prefab/src/handEquipment';
import { configureButterflyEntity } from '../../prefab/src/butterfly';
import { testItem } from './testInventory';

export function actionTool(
  itemId:
    | 'hammer'
    | 'bugnet'
    | 'reskin_tool'
    | 'pickaxe'
    | 'goldenpickaxe'
    | 'shovel'
    | 'axe'
    | 'pitchfork'
    | 'golden_farm_hoe',
) {
  const entity = testItem({ itemId, count: 1 });
  getHandEquipmentDefinition(itemId)!.definition.configureEntity!(entity);
  return { itemId, EQUIPSLOTS: 'HANDS' as const, entity };
}

export function netEntity(onCapture: () => void): ItemEntity {
  const entity = testItem({ itemId: 'butterfly', count: 1 });
  configureButterflyEntity(entity);
  entity.components.workable!.SetOnFinishCallback(onCapture);
  return entity;
}

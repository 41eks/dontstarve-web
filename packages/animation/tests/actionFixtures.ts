import { ItemEntity } from '../../inventory/src/entity';
import { getHandEquipmentDefinition } from '../../prefab/src/handEquipment';
import { configureButterflyEntity } from '../../prefab/src/butterfly';

export function actionTool(itemId: 'hammer' | 'bugnet' | 'reskin_tool' | 'pickaxe' | 'goldenpickaxe') {
  const entity = new ItemEntity({ itemId, count: 1 });
  getHandEquipmentDefinition(itemId)!.definition.configureEntity!(entity);
  return { itemId, EQUIPSLOTS: 'HANDS' as const, entity };
}

export function netEntity(onCapture: () => void): ItemEntity {
  const entity = new ItemEntity({ itemId: 'butterfly', count: 1 });
  configureButterflyEntity(entity);
  entity.components.workable!.SetOnFinishCallback(onCapture);
  return entity;
}

export const reskinEntityFields = {
  skins: ['test_skin'], isRemoved: false, hasTag: () => false,
};

import type { ItemEntity } from '@dontstarve-web/inventory';
import { Tool } from '../../componets/src/tool';
import { handEquipmentVisual, skinArchive, type EquipmentVisualFactory } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';

export function configureBugNetEntity(entity: ItemEntity): void {
  entity.components.finiteuses.setMaxUses(10); // TUNING.BUGNET_USES
  entity.components.tool = entity.component('tool', () => {
    const tool = new Tool(entity);
    tool.SetAction('NET');
    return tool;
  });
}

export const BUGNET_ID = 'bugnet';

/** bugnet.lua onequip: swap_bugnet, or the skin's, named on the owner's AnimState. */
export const bugnetVisual: EquipmentVisualFactory = item => {
  const skin = skinArchive('bugnet', GROUND_ITEM_DEFINITIONS.bugnet.skinArchives, item.skinId);
  return handEquipmentVisual(item, [...skin ? [skin] : [], 'swap_bugnet'], 'swap_bugnet');
};

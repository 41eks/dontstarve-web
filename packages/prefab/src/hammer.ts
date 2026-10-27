import type { ItemEntity } from '@dontstarve-web/inventory';
import { Tool } from '../../componets/src/tool';
import { handEquipmentVisual, skinArchive, type EquipmentVisualFactory } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';

export function configureHammerEntity(entity: ItemEntity): void {
  entity.addTag('hammer'); // hammer.lua: SGmole distinguishes the weapon by this source tag.
  entity.components.finiteuses.setMaxUses(75); // TUNING.HAMMER_USES
  entity.components.tool = entity.component('tool', () => {
    const tool = new Tool(entity);
    tool.SetAction('HAMMER');
    return tool;
  });
}

/** hammer.lua onequip: swap_hammer, or the skin's, named on the owner's AnimState. */
export const hammerVisual: EquipmentVisualFactory = item => {
  const skin = skinArchive('hammer', GROUND_ITEM_DEFINITIONS.hammer.skinArchives, item.skinId);
  return handEquipmentVisual(item, [...skin ? [skin] : [], 'swap_hammer'], 'swap_hammer');
};

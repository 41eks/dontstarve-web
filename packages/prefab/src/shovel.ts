import type { ItemEntity } from '@dontstarve-web/inventory';
import { Tool } from '../../componets/src/tool';
import { handEquipmentVisual, skinArchive, type EquipmentVisualFactory } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';
import { PlaySound } from './sound';

export const SHOVEL_USES = 25; // tuning.lua; gold consumes 1 / GOLDENTOOLFACTOR = .25 per DIG.
export function configureShovelEntity(entity: ItemEntity): void {
  entity.components.finiteuses.setMaxUses(SHOVEL_USES);
  entity.components.finiteuses.setConsumption('DIG', entity.prefab === 'goldenshovel' ? .25 : 1);
  entity.components.tool = entity.component('tool', () => {
    const tool = new Tool(entity);
    tool.SetAction('DIG');
    return tool;
  });
}

export type ShovelTool = 'shovel' | 'goldenshovel';
export function isShovelTool(value: string): value is ShovelTool {
  return value === 'shovel' || value === 'goldenshovel';
}
const SWAPS = {
  shovel: { archive: 'swap_shovel.zip', symbol: 'swap_shovel' },
  goldenshovel: { archive: 'swap_goldenshovel.zip', symbol: 'swap_goldenshovel' },
} as const;

/** Source prefab onequip/onunequip: the shovel's swap build, or only the skin's, named on the owner's AnimState. */
export const shovelVisual: EquipmentVisualFactory = item => {
  const tool = item.prefab as ShovelTool, swap = SWAPS[tool];
  // OverrideItemSkinSymbol replaces this specific held symbol even when a skin
  // omits it entirely (the invisible skins). Do not recover the base tool.
  const skin = skinArchive(tool, GROUND_ITEM_DEFINITIONS[tool].skinArchives, item.skinId);
  const visual = handEquipmentVisual(item, [skin ?? swap.archive], swap.symbol);
  return { ...visual, onequip(owner) { visual.onequip(owner); if (item.prefab === 'goldenshovel') PlaySound('dontstarve/wilson/equip_item_gold'); } };
};

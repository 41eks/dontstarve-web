import type { FarmHoeTool } from '@dontstarve-web/stategraphs/till';
import { handEquipmentVisual, skinArchive, type EquipmentVisualFactory } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';

export { isFarmHoeTool, type FarmHoeTool } from '@dontstarve-web/stategraphs/till';
const SWAPS = {
  farm_hoe: { archive: 'quagmire_hoe.zip', symbol: 'swap_quagmire_hoe' },
  golden_farm_hoe: { archive: 'swap_goldenhoe.zip', symbol: 'swap_goldenhoe' },
} as const;

/** Source prefab onequip/onunequip: the hoe's swap build, or only the skin's, named on the owner's AnimState. */
export const farmHoeVisual: EquipmentVisualFactory = item => {
  const tool = item.prefab as FarmHoeTool, swap = SWAPS[tool];
  // OverrideItemSkinSymbol replaces this specific held symbol even when a skin
  // omits it entirely (the invisible skins). Do not recover the base tool.
  const skin = skinArchive(tool, GROUND_ITEM_DEFINITIONS[tool].skinArchives, item.skinId);
  return handEquipmentVisual(item, [skin ?? swap.archive], swap.symbol);
};

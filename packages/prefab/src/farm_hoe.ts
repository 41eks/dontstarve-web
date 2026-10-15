import type { FarmHoeTool } from '@dontstarve-web/stategraphs/farm_hoe';
import { handEquipmentVisual, type PrepareEquipmentVisual } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS, GroundItemAssets } from './groundItems';
import { PreloadSounds } from './sound';

export { isFarmHoeTool, type FarmHoeTool } from '@dontstarve-web/stategraphs/farm_hoe';
export interface FarmHoeEquipment {
  readonly tool: FarmHoeTool;
  readonly symbol: string;
  readonly builds: readonly Awaited<ReturnType<GroundItemAssets['loadBuild']>>[];
}
const SWAPS = {
  farm_hoe: { archive: 'quagmire_hoe.zip', symbol: 'swap_quagmire_hoe' },
  golden_farm_hoe: { archive: 'swap_goldenhoe.zip', symbol: 'swap_goldenhoe' },
} as const;

export async function loadFarmHoeEquipment(assets: GroundItemAssets, tool: FarmHoeTool, skinId?: string): Promise<FarmHoeEquipment> {
  const swap = SWAPS[tool];
  const skinArchive = skinId ? GROUND_ITEM_DEFINITIONS[tool].skinArchives[skinId] : undefined;
  if (skinId && !skinArchive) throw new Error(`Unknown ${tool} skin: ${skinId}`);
  const [base, skin] = await Promise.all([assets.loadBuild(swap.archive), skinArchive ? assets.loadBuild(skinArchive) : undefined,
    PreloadSounds('dontstarve/wilson/dig', 'dontstarve_DLC001/creatures/mole/emerge')]);
  // OverrideItemSkinSymbol replaces this specific held symbol even when a skin
  // omits it entirely (the invisible skins). Do not recover the base tool.
  return { tool, symbol: swap.symbol, builds: [skin ?? base] };
}

/** Source prefab onequip/onunequip: prepared art is applied through the owner's AnimState. */
export const prepareFarmHoeVisual: PrepareEquipmentVisual = async (assets, item) => {
  const equipment = await loadFarmHoeEquipment(assets, item.prefab as FarmHoeTool, item.skinId);
  return handEquipmentVisual(item, equipment.builds, equipment.symbol);
};

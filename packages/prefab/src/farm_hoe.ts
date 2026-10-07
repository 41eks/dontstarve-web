import { findImage, smallHash, type AnimElement, type ResolvedSprite } from '@dontstarve-web/animation/animationAssets';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from './groundItems';
import { PreloadSounds } from './sound';
import type { FarmHoeTool } from '@dontstarve-web/stategraphs/farm_hoe';

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

export function resolveFarmHoePlayerSprite(equipment: FarmHoeEquipment, element: AnimElement): ResolvedSprite[] {
  const symbol = smallHash(equipment.symbol);
  for (const source of equipment.builds) {
    const image = findImage(source.build, symbol, element.imageIndex);
    if (image) return [{ element, image, materials: source.materials }];
    // Source invisible skins override the held symbol with no visible frame.
    if (source.build.symbols.has(symbol)) return [];
  }
  return [];
}

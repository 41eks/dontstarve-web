import { findImage, smallHash, type AnimElement, type ResolvedSprite } from '@dontstarve-web/animation/animationAssets';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from './groundItems';
import { PreloadSounds } from './sound';

export type ShovelTool = 'shovel' | 'goldenshovel';
export function isShovelTool(value: string): value is ShovelTool {
  return value === 'shovel' || value === 'goldenshovel';
}
export interface ShovelEquipment {
  readonly tool: ShovelTool;
  readonly symbol: string;
  readonly builds: readonly Awaited<ReturnType<GroundItemAssets['loadBuild']>>[];
}
const SWAPS = {
  shovel: { archive: 'swap_shovel.zip', symbol: 'swap_shovel' },
  goldenshovel: { archive: 'swap_goldenshovel.zip', symbol: 'swap_goldenshovel' },
} as const;

export async function loadShovelEquipment(assets: GroundItemAssets, tool: ShovelTool, skinId?: string): Promise<ShovelEquipment> {
  const swap = SWAPS[tool];
  const skinArchive = skinId ? GROUND_ITEM_DEFINITIONS[tool].skinArchives[skinId] : undefined;
  if (skinId && !skinArchive) throw new Error(`Unknown ${tool} skin: ${skinId}`);
  const [base, skin] = await Promise.all([assets.loadBuild(swap.archive), skinArchive ? assets.loadBuild(skinArchive) : undefined,
    PreloadSounds('dontstarve/wilson/dig', ...(tool === 'goldenshovel' ? ['dontstarve/wilson/equip_item_gold' as const] : []))]);
  // OverrideItemSkinSymbol replaces this specific held symbol even when a skin
  // omits it entirely (the invisible skins). Do not recover the base tool.
  return { tool, symbol: swap.symbol, builds: [skin ?? base] };
}

export function resolveShovelPlayerSprite(equipment: ShovelEquipment, element: AnimElement): ResolvedSprite[] {
  const symbol = smallHash(equipment.symbol);
  for (const source of equipment.builds) {
    const image = findImage(source.build, symbol, element.imageIndex);
    if (image) return [{ element, image, materials: source.materials }];
    // Source invisible skins override the held symbol with no visible frame.
    if (source.build.symbols.has(symbol)) return [];
  }
  return [];
}

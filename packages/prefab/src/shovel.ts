import type { ItemEntity } from '@dontstarve-web/inventory';
import { Tool } from '../../componets/src/tool';
import { handEquipmentVisual, type PrepareEquipmentVisual } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS, GroundItemAssets } from './groundItems';
import { PlaySound, PreloadSounds } from './sound';

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

/** Source prefab onequip/onunequip: prepared art is applied through the owner's AnimState. */
export const prepareShovelVisual: PrepareEquipmentVisual = async (assets, item) => {
  const equipment = await loadShovelEquipment(assets, item.prefab as ShovelTool, item.skinId);
  const visual = handEquipmentVisual(item, equipment.builds, equipment.symbol);
  return { ...visual, onequip(owner) { visual.onequip(owner); if (item.prefab === 'goldenshovel') PlaySound('dontstarve/wilson/equip_item_gold'); } };
};

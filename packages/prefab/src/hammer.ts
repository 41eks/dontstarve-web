import type { ItemEntity } from '@dontstarve-web/inventory';
import { Tool } from '../../componets/src/tool';
import { handEquipmentVisual, type PrepareEquipmentVisual } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS, GroundItemAssets } from './groundItems';
import { PreloadSounds } from './sound';

export function configureHammerEntity(entity: ItemEntity): void {
  entity.addTag('hammer'); // hammer.lua: SGmole distinguishes the weapon by this source tag.
  entity.components.finiteuses.setMaxUses(75); // TUNING.HAMMER_USES
  entity.components.tool = entity.component('tool', () => {
    const tool = new Tool(entity);
    tool.SetAction('HAMMER');
    return tool;
  });
}

type HammerBuild = Awaited<ReturnType<GroundItemAssets['loadBuild']>>;
export interface HammerEquipment { readonly builds: readonly HammerBuild[] }

export async function loadHammerEquipment(assets: GroundItemAssets, skinId?: string): Promise<HammerEquipment> {
  const skinArchive = skinId ? GROUND_ITEM_DEFINITIONS.hammer.skinArchives[skinId] : undefined;
  if (skinId && !skinArchive) throw new Error(`Unknown hammer skin: ${skinId}`);
  const [base, skin] = await Promise.all([
    assets.loadBuild('swap_hammer.zip'),
    skinArchive ? assets.loadBuild(skinArchive) : undefined,
  ]);
  return { builds: skin ? [skin, base] : [base] };
}

/** Source prefab onequip/onunequip: prepared art is applied through the owner's AnimState. */
export const prepareHammerVisual: PrepareEquipmentVisual = async (assets, item) => {
  const [equipment] = await Promise.all([loadHammerEquipment(assets, item.skinId), PreloadSounds('dontstarve/wilson/hit')]);
  return handEquipmentVisual(item, equipment.builds, 'swap_hammer');
};

import type { ItemEntity } from '@dontstarve-web/inventory';
import { Tool } from '../../componets/src/tool';
import { handEquipmentVisual, type PrepareEquipmentVisual } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS, GroundItemAssets } from './groundItems';
import { PreloadSounds } from './sound';

export function configureBugNetEntity(entity: ItemEntity): void {
  entity.components.finiteuses.setMaxUses(10); // TUNING.BUGNET_USES
  entity.components.tool = entity.component('tool', () => {
    const tool = new Tool(entity);
    tool.SetAction('NET');
    return tool;
  });
}

export const BUGNET_ID = 'bugnet';
// Leave room for the fleeing creature during pre + swing, including slow frames.
type NetBuild = Awaited<ReturnType<GroundItemAssets['loadBuild']>>;
export interface BugNetEquipment { readonly builds: readonly NetBuild[]; }

export async function loadBugNetEquipment(assets: GroundItemAssets, skinId?: string): Promise<BugNetEquipment> {
  const skinArchive = skinId ? GROUND_ITEM_DEFINITIONS.bugnet.skinArchives[skinId] : undefined;
  if (skinId && !skinArchive) throw new Error(`Unknown bugnet skin: ${skinId}`);
  const base = await assets.loadBuild('swap_bugnet.zip');
  const skin = skinArchive ? await assets.loadBuild(skinArchive) : undefined;
  return { builds: skin ? [skin, base] : [base] };
}

/** Source prefab onequip/onunequip: prepared art is applied through the owner's AnimState. */
export const prepareBugnetVisual: PrepareEquipmentVisual = async (assets, item) => {
  const [equipment] = await Promise.all([loadBugNetEquipment(assets, item.skinId), PreloadSounds('dontstarve/wilson/dig')]);
  return handEquipmentVisual(item, equipment.builds, 'swap_bugnet');
};

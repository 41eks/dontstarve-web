import { findImage, smallHash, type AnimElement, type ResolvedSprite } from '@dontstarve-web/animation/animationAssets';
import { GROUND_ITEM_DEFINITIONS, GroundItemAssets } from './groundItems';

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

/** bugnet.lua replaces the player's swap_object with the swap_bugnet symbol. */
export function resolveBugNetPlayerSprite(equipment: BugNetEquipment, element: AnimElement): ResolvedSprite[] {
  for (const source of equipment.builds) {
    const image = findImage(source.build, smallHash('swap_bugnet'), element.imageIndex);
    if (image) return [{ element, image, materials: source.materials }];
  }
  return [];
}

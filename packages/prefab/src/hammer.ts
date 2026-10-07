import { findImage, smallHash, type AnimElement, type ResolvedSprite } from '@dontstarve-web/animation/animationAssets';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from './groundItems';

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

/** hammer.lua: swap_object uses swap_hammer; inventory and ground art stay separate. */
export function resolveHammerPlayerSprite(equipment: HammerEquipment, element: AnimElement): ResolvedSprite[] {
  const symbol = smallHash('swap_hammer');
  for (const source of equipment.builds) {
    const image = findImage(source.build, symbol, element.imageIndex);
    if (image) return [{ element, image, materials: source.materials }];
    // hammer_invisible supplies only the ground frame (8). Missing held frames
    // in an explicitly overridden symbol mean hidden art, not base-tool fallback.
    if (source.build.symbols.has(symbol)) return [];
  }
  return [];
}

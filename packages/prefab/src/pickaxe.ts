import { findImage, smallHash, type AnimElement, type ResolvedSprite } from '@dontstarve-web/animation/animationAssets';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from './groundItems';

type PickaxeBuild = Awaited<ReturnType<GroundItemAssets['loadBuild']>>;

export type PickaxeTool = 'pickaxe' | 'goldenpickaxe';
export function isPickaxeTool(value: string): value is PickaxeTool {
  return value === 'pickaxe' || value === 'goldenpickaxe';
}

export interface PickaxeEquipment {
  readonly tool: PickaxeTool;
  /** Held symbol swapped over the player's `swap_object`, e.g. `swap_pickaxe`. */
  readonly symbol: string;
  readonly builds: readonly PickaxeBuild[];
}

const PICKAXE_SWAP: Readonly<Record<PickaxeTool, { archive: string; symbol: string }>> = {
  pickaxe: { archive: 'swap_pickaxe.zip', symbol: 'swap_pickaxe' },
  goldenpickaxe: { archive: 'swap_goldenpickaxe.zip', symbol: 'swap_goldenpickaxe' },
};

/** pickaxe.lua: swap_object uses swap_pickaxe / swap_goldenpickaxe, distinct from the ground art. */
export async function loadPickaxeEquipment(
  assets: GroundItemAssets,
  tool: PickaxeTool,
  skinId?: string,
): Promise<PickaxeEquipment> {
  const swap = PICKAXE_SWAP[tool];
  const skinArchive = skinId ? GROUND_ITEM_DEFINITIONS[tool].skinArchives[skinId] : undefined;
  if (skinId && !skinArchive) throw new Error(`Unknown ${tool} skin: ${skinId}`);
  const [base, skin] = await Promise.all([
    assets.loadBuild(swap.archive),
    skinArchive ? assets.loadBuild(skinArchive) : undefined,
  ]);
  return { tool, symbol: swap.symbol, builds: skin ? [skin, base] : [base] };
}

export function resolvePickaxePlayerSprite(equipment: PickaxeEquipment, element: AnimElement): ResolvedSprite[] {
  const symbol = smallHash(equipment.symbol);
  for (const source of equipment.builds) {
    const image = findImage(source.build, symbol, element.imageIndex);
    if (image) return [{ element, image, materials: source.materials }];
    // Missing held frames in an explicitly overridden symbol mean hidden art.
    if (source.build.symbols.has(symbol)) return [];
  }
  return [];
}

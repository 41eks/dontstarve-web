import { findImage, smallHash, type AnimElement, type ResolvedSprite } from '@dontstarve-web/animation/animationAssets';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from './groundItems';

type PitchforkBuild = Awaited<ReturnType<GroundItemAssets['loadBuild']>>;

export type PitchforkTool = 'pitchfork' | 'goldenpitchfork';
export function isPitchforkTool(value: string): value is PitchforkTool {
  return value === 'pitchfork' || value === 'goldenpitchfork';
}

export interface PitchforkEquipment {
  readonly tool: PitchforkTool;
  /** Held symbol swapped over the player's `swap_object`, e.g. `swap_pitchfork`. */
  readonly symbol: string;
  readonly builds: readonly PitchforkBuild[];
}

const PITCHFORK_SWAP: Readonly<Record<PitchforkTool, { archive: string; symbol: string }>> = {
  pitchfork: { archive: 'swap_pitchfork.zip', symbol: 'swap_pitchfork' },
  goldenpitchfork: { archive: 'swap_goldenpitchfork.zip', symbol: 'swap_goldenpitchfork' },
};

/** pitchfork.lua: held swap symbols are distinct from each tool's ground idle. */
export async function loadPitchforkEquipment(
  assets: GroundItemAssets,
  tool: PitchforkTool,
  skinId?: string,
): Promise<PitchforkEquipment> {
  const swap = PITCHFORK_SWAP[tool];
  const skinArchive = skinId ? GROUND_ITEM_DEFINITIONS[tool].skinArchives[skinId] : undefined;
  if (skinId && !skinArchive) throw new Error(`Unknown ${tool} skin: ${skinId}`);
  const [base, skin] = await Promise.all([
    assets.loadBuild(swap.archive),
    skinArchive ? assets.loadBuild(skinArchive) : undefined,
  ]);
  return { tool, symbol: swap.symbol, builds: skin ? [skin, base] : [base] };
}

export function resolvePitchforkPlayerSprite(equipment: PitchforkEquipment, element: AnimElement): ResolvedSprite[] {
  const symbol = smallHash(equipment.symbol);
  for (const source of equipment.builds) {
    const image = findImage(source.build, symbol, element.imageIndex);
    if (image) return [{ element, image, materials: source.materials }];
    // Missing held frames in an explicitly overridden symbol mean hidden art.
    if (source.build.symbols.has(symbol)) return [];
  }
  return [];
}

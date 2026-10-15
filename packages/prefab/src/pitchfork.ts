import { handEquipmentVisual, type PrepareEquipmentVisual } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS, GroundItemAssets } from './groundItems';
import { PlaySound, PreloadSounds } from './sound';

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

/** Source prefab onequip/onunequip: prepared art is applied through the owner's AnimState. */
export const preparePitchforkVisual: PrepareEquipmentVisual = async (assets, item) => {
  const [equipment] = await Promise.all([loadPitchforkEquipment(assets, item.prefab as PitchforkTool, item.skinId), PreloadSounds('dontstarve/wilson/dig', 'dontstarve/wilson/equip_item_gold')]);
  const visual = handEquipmentVisual(item, equipment.builds, equipment.symbol, [], false);
  return { ...visual, onequip(owner) {
    visual.onequip(owner);
    if (item.prefab === 'goldenpitchfork') PlaySound('dontstarve/wilson/equip_item_gold');
  } };
};

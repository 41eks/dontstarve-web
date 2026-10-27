import { handEquipmentVisual, skinArchive, type EquipmentVisualFactory } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';
import { PlaySound } from './sound';

export type PitchforkTool = 'pitchfork' | 'goldenpitchfork';
export function isPitchforkTool(value: string): value is PitchforkTool {
  return value === 'pitchfork' || value === 'goldenpitchfork';
}

const PITCHFORK_SWAP: Readonly<Record<PitchforkTool, { archive: string; symbol: string }>> = {
  pitchfork: { archive: 'swap_pitchfork.zip', symbol: 'swap_pitchfork' },
  goldenpitchfork: { archive: 'swap_goldenpitchfork.zip', symbol: 'swap_goldenpitchfork' },
};

/** pitchfork.lua: held swap symbols are distinct from each tool's ground idle. */
export const pitchforkVisual: EquipmentVisualFactory = item => {
  const tool = item.prefab as PitchforkTool, swap = PITCHFORK_SWAP[tool];
  const skin = skinArchive(tool, GROUND_ITEM_DEFINITIONS[tool].skinArchives, item.skinId);
  const visual = handEquipmentVisual(item, [...skin ? [skin] : [], swap.archive], swap.symbol, [], false);
  return { ...visual, onequip(owner) {
    visual.onequip(owner);
    if (item.prefab === 'goldenpitchfork') PlaySound('dontstarve/wilson/equip_item_gold');
  } };
};

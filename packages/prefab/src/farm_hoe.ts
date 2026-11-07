import { handEquipmentVisual, skinArchive, type EquipmentVisualFactory, type HeldEquipFunctions } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';

import type { ItemEntity } from '@dontstarve-web/inventory';
import { FarmTiller, type FarmTillerMap } from '../../componets/src/farmtiller';
import { AddWeapon, GOLDENTOOLFACTOR, WILSON_ATTACK } from './handTool';

const FARM_HOE_DAMAGE = WILSON_ATTACK * .5; // tuning.lua FARM_HOE_DAMAGE

export type FarmHoeTool = 'farm_hoe' | 'golden_farm_hoe';

/**
 * farm_hoe.lua MakeFarmHoe fn, with golden's attackwear. Its finiteuses (FARM_HOE_USES, TILL consumption) is not
 * ported: BufferedAction:Do's OnUsedAsItem does not wear the invobject for TILL yet.
 */
export function configureFarmHoeEntity(inst: ItemEntity): void {
  inst.addTag('sharp');
  const weapon = AddWeapon(inst, FARM_HOE_DAMAGE, false);
  inst.components.farmtiller = inst.component('farmtiller', () => new FarmTiller());
  if (inst.prefab === 'golden_farm_hoe') weapon.attackwear = 1 / GOLDENTOOLFACTOR;
}

/** While held in a world, the tiller tills that world's farm soil. */
export function createFarmTillerLifecycle(entity: ItemEntity, map: FarmTillerMap): HeldEquipFunctions {
  return {
    onequip() { if (entity.components.farmtiller) entity.components.farmtiller.map = map; },
    onunequip() { if (entity.components.farmtiller) entity.components.farmtiller.map = undefined; },
  };
}
const SWAPS = {
  farm_hoe: { archive: 'quagmire_hoe.zip', symbol: 'swap_quagmire_hoe' },
  golden_farm_hoe: { archive: 'swap_goldenhoe.zip', symbol: 'swap_goldenhoe' },
} as const;

/** Source prefab onequip/onunequip: the hoe's swap build, or only the skin's, named on the owner's AnimState. */
export const farmHoeVisual: EquipmentVisualFactory = item => {
  const tool = item.prefab as FarmHoeTool, swap = SWAPS[tool];
  // OverrideItemSkinSymbol replaces this specific held symbol even when a skin
  // omits it entirely (the invisible skins). Do not recover the base tool.
  const skin = skinArchive(tool, GROUND_ITEM_DEFINITIONS[tool].skinArchives, item.skinId);
  return handEquipmentVisual(item, [skin ?? swap.archive], swap.symbol);
};

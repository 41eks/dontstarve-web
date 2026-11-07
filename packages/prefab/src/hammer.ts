import type { ItemEntity } from '@dontstarve-web/inventory';
import { AddFiniteUses, AddTool, AddWeapon, WILSON_ATTACK } from './handTool';
import { handEquipmentVisual, skinArchive, type EquipmentVisualFactory } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';

export const HAMMER_USES = 75; // tuning.lua HAMMER_USES
const HAMMER_DAMAGE = WILSON_ATTACK * .5; // tuning.lua HAMMER_DAMAGE

/** hammer.lua MakeHammer fn. Equippable's onequip / onunequip draw swap_object (`hammerVisual`). */
export function configureHammerEntity(inst: ItemEntity): void {
  inst.addTag('hammer'); // SGmole distinguishes the weapon by this source tag.
  AddWeapon(inst, HAMMER_DAMAGE, true);
  AddTool(inst, 'HAMMER');
  AddFiniteUses(inst, HAMMER_USES, 'HAMMER');
}

/** hammer.lua onequip: swap_hammer, or the skin's, named on the owner's AnimState. */
export const hammerVisual: EquipmentVisualFactory = item => {
  const skin = skinArchive('hammer', GROUND_ITEM_DEFINITIONS.hammer.skinArchives, item.skinId);
  return handEquipmentVisual(item, [...skin ? [skin] : [], 'swap_hammer'], 'swap_hammer');
};

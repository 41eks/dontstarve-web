import type { ItemEntity } from '@dontstarve-web/inventory';
import { AddFiniteUses, AddTool, AddWeapon, WILSON_ATTACK } from './handTool';
import { handEquipmentVisual, skinArchive, type EquipmentVisualFactory } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';

export const BUGNET_USES = 10; // tuning.lua BUGNET_USES
const BUGNET_DAMAGE = WILSON_ATTACK * 0.125; // tuning.lua BUGNET_DAMAGE

/** bugnet.lua fn. Equippable's onequip / onunequip draw swap_object (`bugnetVisual`). */
export function configureBugNetEntity(inst: ItemEntity): void {
  const weapon = AddWeapon(inst, BUGNET_DAMAGE, true);
  weapon.attackwear = 3;
  AddTool(inst, 'NET');
  AddFiniteUses(inst, BUGNET_USES, 'NET');
}

export const BUGNET_ID = 'bugnet';

/** bugnet.lua onequip: swap_bugnet, or the skin's, named on the owner's AnimState. */
export const bugnetVisual: EquipmentVisualFactory = item => {
  const skin = skinArchive('bugnet', GROUND_ITEM_DEFINITIONS.bugnet.skinArchives, item.skinId);
  return handEquipmentVisual(item, [...(skin ? [skin] : []), 'swap_bugnet'], 'swap_bugnet');
};

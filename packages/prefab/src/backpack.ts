import type { ItemEntity } from '@dontstarve-web/inventory';

/** backpack.lua's common initialization; skins keep the same native map icon. */
export function configureBackpackEntity(entity: ItemEntity): void {
  entity.AddMiniMapEntity().SetIcon('backpack.png');
}

import { skinArchive, wornEquipmentLifecycle, type EquipmentVisualContext, type EquipmentVisualFactory, type EquipmentVisualItem, type EquipmentVisualOwner } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';

/** backpack.lua onequip/onunequip: the container lifecycle stays with inventory. */
export const backpackVisual: EquipmentVisualFactory = item => {
  const skin = skinArchive('backpack', GROUND_ITEM_DEFINITIONS.backpack.skinArchives, item.skinId);
  let owner: EquipmentVisualOwner | undefined;
  return {
    onequip(equipper) {
      owner = equipper;
      if (skin) {
        owner.PushEvent('equipskinneditem', item.skinId);
        owner.AnimState.OverrideItemSkinSymbol('swap_body', skin, 'swap_body', item.id, 'swap_backpack');
      } else owner.AnimState.OverrideSymbol('swap_body', 'swap_backpack', 'swap_body');
    },
    onunequip() {
      if (!owner) return;
      if (skin) owner.PushEvent('unequipskinneditem', item.skinId);
      owner.AnimState.ClearOverrideSymbol('swap_body');
      owner.AnimState.ClearOverrideSymbol('backpack');
      owner = undefined;
    },
  };
};

export function createBackpackEquipmentLifecycle(item: EquipmentVisualItem, context: Pick<EquipmentVisualContext, 'owner' | 'sprite'>) {
  return wornEquipmentLifecycle(backpackVisual(item), context);
}

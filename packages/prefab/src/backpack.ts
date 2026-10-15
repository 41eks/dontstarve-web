import type { ItemEntity } from '@dontstarve-web/inventory';

/** backpack.lua's common initialization; skins keep the same native map icon. */
export function configureBackpackEntity(entity: ItemEntity): void {
  entity.AddMiniMapEntity().SetIcon('backpack.png');
}

import type { EquipmentVisualOwner, PrepareEquipmentVisual } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';

/** backpack.lua onequip/onunequip: the container lifecycle stays with inventory. */
export const prepareBackpackVisual: PrepareEquipmentVisual = async (assets, item) => {
  const archive = item.skinId ? GROUND_ITEM_DEFINITIONS.backpack.skinArchives[item.skinId] : undefined;
  if (item.skinId && !archive) throw new Error(`Unknown backpack skin: ${item.skinId}`);
  const [base, skin] = await Promise.all([assets.loadBuild('swap_backpack.zip'), archive ? assets.loadBuild(archive) : undefined]);
  let owner: EquipmentVisualOwner | undefined;
  return {
    onequip(equipper) {
      owner = equipper;
      if (skin) {
        owner.PushEvent('equipskinneditem', item.skinId);
        owner.AnimState.OverrideItemSkinSymbol('swap_body', skin, 'swap_body', item.id, base);
      } else owner.AnimState.OverrideSymbol('swap_body', base, 'swap_body');
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

import { preparedEquipmentLifecycle, type EquipmentVisualContext, type EquipmentVisualItem } from './equipmentVisual';
export function createBackpackEquipmentLifecycle(item: EquipmentVisualItem, context: EquipmentVisualContext) {
  return preparedEquipmentLifecycle(() => prepareBackpackVisual(context.assets, item), context);
}

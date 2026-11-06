import type { ItemEntity } from '@dontstarve-web/inventory';
import { Equippable } from '../../componets/src/equippable';
import { skinArchive, wornOwner, type EquipmentVisual, type EquipmentVisualFactory, type EquipmentArtOwner } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';

/** backpack.lua fn: the native map icon and the body equippable's onequip/onunequip; the container belongs to inventory. */
export function configureBackpackEntity(entity: ItemEntity): void {
  entity.AddMiniMapEntity().SetIcon('backpack.png');
  const equippable = entity.components.equippable ??= new Equippable<ItemEntity>(entity, 'body');
  let visual: EquipmentVisual | undefined;
  equippable.SetOnEquip((inst, owner) => {
    visual?.onunequip();
    const worn = wornOwner(owner);
    visual = worn && backpackVisual({ id: inst.id, prefab: inst.prefab, skinId: inst.skinId });
    if (worn) visual?.onequip(worn);
  });
  equippable.SetOnUnequip(() => { visual?.onunequip(); visual = undefined; });
}

/** backpack.lua onequip/onunequip. */
export const backpackVisual: EquipmentVisualFactory = item => {
  const skin = skinArchive('backpack', GROUND_ITEM_DEFINITIONS.backpack.skinArchives, item.skinId);
  let owner: EquipmentArtOwner | undefined;
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

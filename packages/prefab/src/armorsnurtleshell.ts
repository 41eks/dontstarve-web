import { PLAYER_EQUIPMENT_CONTAINER_ID, type ItemEntity } from '@dontstarve-web/inventory';
import type { EquipmentLifecycle, EquipmentOwner } from '@dontstarve-web/signals';
import { Armor } from '../../componets/src/armor';
import { Equippable } from '../../componets/src/equippable';
import { UseableItem } from '../../componets/src/useableitem';
import type { EquipmentVisualOwner, PrepareEquipmentVisual } from './equipmentVisual';
import { PlaySound } from './sound';

// tuning.lua: wilson_health * 7 * multiplayer_armor_durability_modifier (.7), absorption .6 * 1, FULL_ABSORPTION.
export const ARMORSNURTLESHELL_ID = 'armorsnurtleshell';
export const ARMORSNURTLESHELL = 150 * 7 * 0.7;
export const ARMORSNURTLESHELL_ABSORPTION = 0.6;
export const FULL_ABSORPTION = 1;

/** armor_snurtleshell.lua fn: tags, armor, equippable and useableitem; the callbacks are bound per equip lifetime. */
export function configureArmorSnurtleshellEntity(entity: ItemEntity): void {
  entity.addTag('shell');
  entity.addTag('hardarmor');
  // Inventory re-configures entities on equip and commits; InitCondition belongs to construction only.
  if (!entity.components.armor) (entity.components.armor = new Armor(entity)).InitCondition(ARMORSNURTLESHELL, ARMORSNURTLESHELL_ABSORPTION);
  entity.components.equippable ??= new Equippable(entity, 'body');
  entity.components.useableitem ??= new UseableItem({
    addTag: tag => entity.addTag(tag),
    removeTag: tag => entity.removeTag(tag),
    isEquipped: () => entity.components.inventoryitem.owner?.address.containerId === PLAYER_EQUIPMENT_CONTAINER_ID,
  });
}

/** armor_snurtleshell.lua onequip/onunequip: the injected owner lives exactly as long as the item is worn. */
export function createArmorSnurtleshellLifecycle(entity: ItemEntity): EquipmentLifecycle {
  const stops: (() => void)[] = [];
  return {
    onequip(owner?: EquipmentOwner) {
      const armor = entity.components.armor, useable = entity.components.useableitem;
      if (!owner || !armor || !useable) return;
      // OnBlocked
      stops.push(owner.ListenForEvent?.('blocked', () => { PlaySound('dontstarve/wilson/hit_armour'); }) ?? (() => {}));
      // ProtectionLevels
      stops.push(owner.ListenForEvent?.('newstate', () => {
        if (owner.HasStateTag?.('shell')) armor.SetAbsorption(FULL_ABSORPTION);
        else {
          armor.SetAbsorption(ARMORSNURTLESHELL_ABSORPTION);
          useable.StopUsingItem();
        }
      }) ?? (() => {}));
      useable.SetOnUseFn(() => owner.GoToState?.('shell_enter'));
    },
    onunequip() {
      for (const stop of stops.splice(0)) stop();
      entity.components.useableitem?.SetOnUseFn(() => {});
    },
  };
}

/** armor_snurtleshell.lua onequip: swap_body_tall comes from the item's own build. */
export const prepareArmorSnurtleshellVisual: PrepareEquipmentVisual = async assets => {
  const build = await assets.loadBuild('armor_slurtleshell.zip');
  let owner: EquipmentVisualOwner | undefined;
  return {
    onequip(equipper) {
      owner = equipper;
      owner.AnimState.OverrideSymbol('swap_body_tall', build, 'swap_body_tall');
    },
    onunequip() {
      owner?.AnimState.ClearOverrideSymbol('swap_body_tall');
      owner = undefined;
    },
  };
};

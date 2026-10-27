import type { ItemEntity } from '@dontstarve-web/inventory';
import { Equippable } from '../../componets/src/equippable';
import { handEquipmentVisual, skinArchive, type EquipmentVisualFactory } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';

export const NIGHTSWORD_DAPPERNESS = -100 / (30 * 10); // tuning.lua CRAZINESS_MED; -20 sanity/minute.

/** nightsword.lua: magic dapperness affects the wearer through the sanity component. */
export function configureNightswordEntity(entity: ItemEntity): void {
  const equippable = entity.components.equippable ??= new Equippable(entity, 'hand');
  equippable.dapperness = NIGHTSWORD_DAPPERNESS;
  equippable.is_magic_dapperness = true;
}

/** nightsword.lua onequip: the player's swap_object is overridden with swap_nightmaresword, or the skin build's. */
export const nightswordVisual: EquipmentVisualFactory = item =>
  handEquipmentVisual(item, [skinArchive('nightsword', GROUND_ITEM_DEFINITIONS.nightsword.skinArchives, item.skinId) ?? 'swap_nightmaresword'], 'swap_nightmaresword');

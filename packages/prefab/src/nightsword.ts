import type { ItemEntity } from '@dontstarve-web/inventory';
import { Equippable } from '../../componets/src/equippable';
import { handEquipmentVisual, type PrepareEquipmentVisual } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS, GroundItemAssets } from './groundItems';

export const NIGHTSWORD_DAPPERNESS = -100 / (30 * 10); // tuning.lua CRAZINESS_MED; -20 sanity/minute.

/** nightsword.lua: magic dapperness affects the wearer through the sanity component. */
export function configureNightswordEntity(entity: ItemEntity): void {
  const equippable = entity.components.equippable ??= new Equippable(entity, 'hand');
  equippable.dapperness = NIGHTSWORD_DAPPERNESS;
  equippable.is_magic_dapperness = true;
}

export interface NightswordEquipment {
  readonly build: Awaited<ReturnType<GroundItemAssets['loadBuild']>>;
}

/** nightsword.lua onequip: the player's swap_object is overridden with swap_nightmaresword. */
export async function loadNightswordEquipment(assets: GroundItemAssets, skinId?: string): Promise<NightswordEquipment> {
  const skinArchive = skinId === undefined ? undefined : GROUND_ITEM_DEFINITIONS.nightsword.skinArchives[skinId];
  if (skinId !== undefined && !skinArchive) throw new Error(`Unknown nightsword skin: ${skinId}`);
  return { build: await assets.loadBuild(skinArchive ?? 'swap_nightmaresword.zip') };
}

/** Source prefab onequip/onunequip: prepared art is applied through the owner's AnimState. */
export const prepareNightswordVisual: PrepareEquipmentVisual = async (assets, item) => {
  const equipment = await loadNightswordEquipment(assets, item.skinId);
  return handEquipmentVisual(item, [equipment.build], 'swap_nightmaresword');
};

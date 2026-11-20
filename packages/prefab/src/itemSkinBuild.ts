import type { ItemEntity } from '@dontstarve-web/inventory';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';

/** AnimState:GetSkinBuild for an item whose skins are dynamic build archives in the ground item catalog. */
export function itemSkinBuild(entity: ItemEntity): string | undefined {
  if (entity.skinId === undefined) {
    return undefined;
  }
  const skins = GROUND_ITEM_DEFINITIONS[entity.prefab]?.skinArchives;
  const archive = skins?.[entity.skinId];
  if (!archive) {
    throw new Error(`Unknown ${entity.prefab} skin ${entity.skinId}`);
  }
  return archive.replace(/^dynamic\/|\.zip$/g, '');
}

import type { ItemEntity } from '@dontstarve-web/inventory';
import catalog from './groundItems.json' with { type: 'json' };

/** AnimState:GetSkinBuild for an item whose skins are dynamic build archives in the ground item catalog. */
export function itemSkinBuild(entity: ItemEntity): string | undefined {
  if (entity.skinId === undefined) return undefined;
  const skins = (catalog.items as Record<string, { skinArchives?: Readonly<Record<string, string>> }>)[entity.prefab]?.skinArchives;
  const archive = skins?.[entity.skinId];
  if (!archive) throw new Error(`Unknown ${entity.prefab} skin ${entity.skinId}`);
  return archive.replace(/^dynamic\/|\.zip$/g, '');
}

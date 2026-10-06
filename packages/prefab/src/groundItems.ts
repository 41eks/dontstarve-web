import {
  ArchiveSpriteAssets, createArchiveSprite,
  type ArchiveSprite, type ArchiveSpriteDefinition,
} from '@dontstarve-web/animation/archiveSprite';
import type { InventorySkinSpec } from '@dontstarve-web/inventory';
import catalog from './groundItems.json' with { type: 'json' };
import { listenInventoryEvents } from './inventoryEvents';
import type { GroundItemFactory, GroundPrefabContext } from './groundPrefab';

export interface GroundItemAssetDefinition extends ArchiveSpriteDefinition {
  readonly source: string;
  readonly name: string;
  readonly icon: string;
  readonly atlas: string;
  readonly symbolOverrides: Readonly<Record<string, { archive: string; symbol: string }>>;
  readonly skinArchives: Readonly<Record<string, string>>;
}

export const GROUND_ITEM_DEFINITIONS: Readonly<Record<string, GroundItemAssetDefinition>> = catalog.items;
export const GROUND_ITEM_DISPLAY_SPECS = Object.fromEntries(Object.entries(GROUND_ITEM_DEFINITIONS)
  .map(([id, { name, icon, atlas }]) => [id, { name, icon, atlas }]));
export const GROUND_ITEM_SKIN_SPECS: Readonly<Record<string, InventorySkinSpec>> = catalog.skinSpecs;

export function createGroundItemFactory(context: GroundPrefabContext): GroundItemFactory {
  return {
    itemIds: Object.keys(GROUND_ITEM_DEFINITIONS),
    create: (item) => createGroundItemSprite(context.assets, item.itemId, item.skinId),
  };
}

/** Keep the existing ground material names used by equipment and lighting. */
export class GroundItemAssets extends ArchiveSpriteAssets {
  constructor(animationBaseUrl: string) { super(animationBaseUrl, 'ground'); }
}

export type GroundItemSprite = ArchiveSprite;

export async function createGroundItemSprite(
  assets: GroundItemAssets,
  itemId: string,
  skinId?: string,
): Promise<GroundItemSprite> {
  const definition = GROUND_ITEM_DEFINITIONS[itemId];
  if (!definition) throw new Error(`Unknown ground item: ${itemId}`);
  const skinArchive = skinId === undefined ? undefined : definition.skinArchives[skinId];
  if (skinId !== undefined && !skinArchive) throw new Error(`Unknown ground skin ${skinId} for ${itemId}`);
  const sprite = await createArchiveSprite(assets, definition, { skinArchive, name: `GroundItem:${itemId}` });
  Object.assign(sprite.model.userData, { itemId, skinId });
  const removeInventoryEvents = listenInventoryEvents(sprite.model, {
    ondropped: () => sprite.setPaused(false),
    onload: () => sprite.setPaused(false),
    onputininventory: () => sprite.setPaused(true),
  });
  return {
    ...sprite,
    dispose() { removeInventoryEvents(); sprite.dispose(); },
  };
}

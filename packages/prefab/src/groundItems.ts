import {
  ArchiveSpriteAssets, createSharedArchiveSprite,
  type ArchiveSprite, type ArchiveSpriteDefinition,
} from '@dontstarve-web/animation/archiveSprite';
import type { InventoryItemSpec, InventorySkinSpec } from '@dontstarve-web/inventory';
import type { GroundTileName } from './groundTiles';
import catalog from './groundItems.json' with { type: 'json' };
import { listenInventoryEvents } from './inventoryEvents';
import type { GroundItemFactory, GroundPrefabContext } from './groundPrefab';
import { BURNABLE_ITEM_DEFINITIONS, configureBurnableItemEntity, burnableFireRenderEntry, createBurnableItemVisual } from './burnableItems';
import { configureBookEntity, isBook } from './books';
import { configureHeatRockEntity, HEATROCK_ID, type HeatRock } from './heatrock';
import { createEffect, watchSignal } from '@dontstarve-web/signals';
import { configureRazorEntity, RAZOR_ID } from './razor';
import { configurePanfluteEntity, PANFLUTE_ID } from './panflute';
import { configureBirdEntity, isBirdId } from './birds';
import { configureBackpackEntity } from './backpack';
import { ARMORSNURTLESHELL_ID, configureArmorSnurtleshellEntity } from './armorsnurtleshell';
import { AMULET_ID, configureAmuletEntity } from './amulet';
import { configureRockAvocadoFruitEntity } from './rock_avocado_fruit';
import { configurePlantableEntity } from './plantables';
import { configureFertilizerEntity, FERTILIZER_CYCLES } from './fertilizers';
import { configureTurfEntity, turfTileName } from './turfs';

export interface GroundItemAssetDefinition extends ArchiveSpriteDefinition {
  readonly source: string;
  readonly name: string;
  readonly icon: string;
  readonly atlas: string;
  /** tiledefs.lua's terrain key, independent of the inventory and ground art. */
  readonly groundTile?: GroundTileName;
  readonly symbolOverrides: Readonly<Record<string, { archive: string; symbol: string }>>;
  readonly skinArchives: Readonly<Record<string, string>>;
}

// The importer validates four-component colour tuples; JSON infers plain arrays.
export const GROUND_ITEM_DEFINITIONS = catalog.items as unknown as Readonly<Record<string, GroundItemAssetDefinition>>;
export const GROUND_ITEM_DISPLAY_SPECS = Object.fromEntries(Object.entries(GROUND_ITEM_DEFINITIONS)
  .map(([id, { name, icon, atlas }]) => [id, { name, icon, atlas }]));
export const GROUND_ITEM_SKIN_SPECS: Readonly<Record<string, InventorySkinSpec>> = catalog.skinSpecs;
export const TURF_ITEM_IDS = Object.keys(GROUND_ITEM_DEFINITIONS)
  .filter(id => GROUND_ITEM_DEFINITIONS[id].groundTile !== undefined);
/** turfs.lua: STACK_SIZE_MEDITEM; no equipped art or source skins. */
export const TURF_ITEM_SPECS: Readonly<Record<string, InventoryItemSpec>> = Object.fromEntries(
  TURF_ITEM_IDS.map(id => [id, { ...GROUND_ITEM_DISPLAY_SPECS[id], maxStack: 20, configureEntity: configureTurfEntity }]),
);

export function createGroundItemFactory(context: GroundPrefabContext): GroundItemFactory {
  const fires = new Set<ArchiveSprite>();
  return {
    itemIds: Object.keys(GROUND_ITEM_DEFINITIONS),
    configureEntity: entity => {
      configurePlantableEntity(entity); configureRockAvocadoFruitEntity(entity);
      if (Object.hasOwn(FERTILIZER_CYCLES, entity.prefab)) configureFertilizerEntity(entity);
      return turfTileName(entity.prefab) ? configureTurfEntity(entity)
      : isBirdId(entity.prefab) ? configureBirdEntity(entity)
      : entity.prefab === 'backpack' ? configureBackpackEntity(entity)
      : entity.prefab === ARMORSNURTLESHELL_ID ? configureArmorSnurtleshellEntity(entity)
      : entity.prefab === AMULET_ID ? configureAmuletEntity(entity)
      : entity.prefab === HEATROCK_ID ? configureHeatRockEntity(entity)
      : entity.prefab === RAZOR_ID ? configureRazorEntity(entity)
      : entity.prefab === PANFLUTE_ID ? configurePanfluteEntity(entity)
      : isBook(entity.prefab) ? configureBookEntity(entity) : configureBurnableItemEntity(entity);
    },
    async create(item) {
      const sprite = await createGroundItemSprite(context.assets, item.itemId, item.skinId);
      if (item.itemId === HEATROCK_ID) {
        let stopWatching: (() => void) | undefined;
        return {
          ...sprite,
          get currentAnimation() { return sprite.currentAnimation; },
          bindEntity(entity) {
            stopWatching?.();
            const rock = entity.getComponent<HeatRock>('heatrock');
            if (!rock) return;
            const range = watchSignal(rock.range, stop => { stopWatching = stop; });
            createEffect(() => { sprite.setAnimation(String(range.get())); });
          },
          dispose() { stopWatching?.(); sprite.dispose(); },
        };
      }
      if (!Object.hasOwn(BURNABLE_ITEM_DEFINITIONS, item.itemId)) return sprite;
      try { return await createBurnableItemVisual(context, item.itemId, sprite, fires, BURNABLE_ITEM_DEFINITIONS[item.itemId].fxLevel); }
      catch (error) { sprite.dispose(); throw error; }
    },
    update(dt, quaternion) { for (const fire of fires) { fire.model.quaternion.copy(quaternion); fire.update(dt); } },
    renderEntities: () => [...fires].map(burnableFireRenderEntry),
    dispose() { for (const fire of fires) fire.dispose(); fires.clear(); },
  };
}

/** Keep the existing ground material names used by equipment and lighting. */
export class GroundItemAssets extends ArchiveSpriteAssets {
  constructor() { super('ground'); }
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
  const sprite = await createSharedArchiveSprite(assets, definition, { skinArchive, name: `GroundItem:${itemId}` });
  Object.assign(sprite.model.userData, { itemId, skinId });
  const removeInventoryEvents = listenInventoryEvents(sprite.model, {
    ondropped: () => sprite.setPaused(false),
    onload: () => sprite.setPaused(false),
    onputininventory: () => sprite.setPaused(true),
  });
  return {
    ...sprite,
    get currentAnimation() { return sprite.currentAnimation; },
    dispose() { removeInventoryEvents(); sprite.dispose(); },
  };
}

import {
  ArchiveSpriteAssets, createSharedArchiveSprite,
  type ArchiveSpriteDefinition,
} from '@dontstarve-web/animation/archiveSprite';
import type { InventoryItemSpec, InventorySkinSpec, ItemEntity } from '@dontstarve-web/inventory';
import type { GroundTileName } from './groundTiles';
import catalog from './groundItems.json' with { type: 'json' };
import { listenInventoryEvents } from './inventoryEvents';
import type { GroundItemDefinition, GroundItemFactory, GroundItemVisual, GroundPrefabContext } from './groundPrefab';
import { BURNABLE_ITEM_DEFINITIONS, configureBurnableItemEntity, createBurnableItemVisual } from './burnableItems';
import { configureBookEntity, isBook } from './books';
import { configureHeatRockEntity, declareHeatRockSprite, HEATROCK_ID } from './heatrock';
import type { ArchiveSpriteCommands, PrefabDisplay } from '@dontstarve-web/display';
import type { PrefabInstance } from './prefabInstance';
import { createMemo } from '@dontstarve-web/signals';
import { createArchiveEntity } from './prefabInstance';
import { watchTileActivity } from './tileActivity';
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
  const displays = new Set<PrefabDisplay>();
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
      const base = await createResidentGroundItem(context, item, item.itemId === HEATROCK_ID ? declareHeatRockSprite : undefined);
      if (!Object.hasOwn(BURNABLE_ITEM_DEFINITIONS, item.itemId)) return base.visual;
      try { return await createBurnableItemVisual(context, item.itemId, base, displays, BURNABLE_ITEM_DEFINITIONS[item.itemId].fxLevel); }
      catch (error) { base.visual.dispose(); throw error; }
    },
    renderEntities: () => [...displays].flatMap(display => display.fxRenderEntries),
    dispose() { displays.clear(); },
  };
}

/** Keep the existing ground material names used by equipment and lighting. */
export class GroundItemAssets extends ArchiveSpriteAssets {
  constructor() { super('ground'); }
}

/**
 * A plain ground item whose sprite exists only while the tile under it is active. The tile is bound once the item's
 * position is settled (loaded or dropped, including the end of a fling), not while it is still moving.
 */
/** A ground item's visual with the instance and display behind it, for prefabs that declare more on its sprite. */
export interface ResidentGroundItem { readonly visual: GroundItemVisual; readonly instance: PrefabInstance<ArchiveSpriteCommands>; readonly display: PrefabDisplay }

export async function createResidentGroundItem(context: Pick<GroundPrefabContext, 'assets' | 'tickingarea'>, item: Pick<GroundItemDefinition, 'itemId' | 'skinId'>,
  /** The prefab's declaration of what its sprite follows, made once the item's entity is bound. */
  declare?: (entity: ItemEntity, sprite: ArchiveSpriteCommands) => void): Promise<ResidentGroundItem> {
  const { itemId, skinId } = item;
  const definition = GROUND_ITEM_DEFINITIONS[itemId];
  if (!definition) throw new Error(`Unknown ground item: ${itemId}`);
  const skinArchive = skinId === undefined ? undefined : definition.skinArchives[skinId];
  if (skinId !== undefined && !skinArchive) throw new Error(`Unknown ground skin ${skinId} for ${itemId}`);
  const create = (clip: { name: string; loop: boolean }) => createSharedArchiveSprite(context.assets,
    { ...definition, animation: clip.name, loop: clip.loop }, { skinArchive, name: `GroundItem:${itemId}`, instancedAnimations: 'all' });
  const clip = { name: definition.animation, loop: definition.loop };
  const { instance, display } = createArchiveEntity(itemId, { create, initial: await create(clip) },
    { name: definition.animation, held: !definition.loop }, `GroundItem:${itemId}`);
  const model = display.model, sprite = instance.sprite;
  Object.assign(model.userData, { itemId, skinId });
  const active = createMemo(() => instance.status.get() === 'active');
  let stopTile = () => {};
  const bindTile = () => {
    stopTile();
    stopTile = watchTileActivity(model, context.tickingarea, awake => instance.setActive(awake));
  };
  const removeInventoryEvents = listenInventoryEvents(model, {
    ondropped: () => { sprite.setPaused(false); bindTile(); },
    onload: () => { sprite.setPaused(false); bindTile(); },
    onputininventory: () => { sprite.setPaused(true); stopTile(); stopTile = () => {}; },
  });
  const visual: GroundItemVisual = {
    model,
    active,
    bindEntity: declare && (entity => declare(entity, sprite)),
    update: dt => sprite.update(dt),
    dispose() { removeInventoryEvents(); stopTile(); active.dispose(); instance.remove(); display.dispose(); },
  };
  return { visual, instance, display };
}

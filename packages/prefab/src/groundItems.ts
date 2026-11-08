import { addComponent } from './components';
import {
  ArchiveSpriteAssets,
  type ArchiveSpriteDefinition,
} from '@dontstarve-web/animation/archiveSprite';
import type { ItemEntity, InventoryItemSpec, InventorySkinSpec } from '@dontstarve-web/inventory';
import type { GroundTileName } from './groundTiles';
import catalog from './groundItems.json' with { type: 'json' };
import type { ItemPrefabWorld } from './groundPrefab';
import type { ReadonlySignal } from '@dontstarve-web/signals';
import type { ComponentUpdates } from '../../componets/src/componentUpdates';
import type { PrefabEntityDefinition } from './prefabInstance';
import { InventoryPhysics, type LootLaunch } from '../../componets/src/inventoryphysics';
import { syncPlacementEntity } from './placementEntities';
import { TILE_SIZE } from './tile';
import { configureTurfEntity } from './turfs';

export interface GroundItemAssetDefinition extends ArchiveSpriteDefinition {
  readonly source: string;
  readonly name: string;
  readonly icon: string;
  readonly atlas: string;
  /** tiledefs.lua's terrain key, independent of the inventory and ground art. */
  readonly groundTile?: GroundTileName;
  readonly tags?: readonly string[];
  readonly scale?: number;
  readonly ground?: boolean;
  readonly symbolOverrides: Readonly<Record<string, { archive: string; symbol: string }>>;
  readonly skinArchives: Readonly<Record<string, string>>;
}

// The importer validates four-component colour tuples; JSON infers plain arrays.
export const GROUND_ITEM_DEFINITIONS = catalog.items as unknown as Readonly<Record<string, GroundItemAssetDefinition>>;
/** Additional art shares the ground factory without registering inventory/gameplay support. */
export type GroundArtDefinition = Omit<GroundItemAssetDefinition, 'icon' | 'atlas'> & { readonly icon?: string; readonly atlas?: string };
export const GROUND_ART_DEFINITIONS = { ...GROUND_ITEM_DEFINITIONS, ...catalog.staticItems } as unknown as Readonly<Record<string, GroundArtDefinition>>;
export const GROUND_ART_SPAWN_IDS = Object.keys(catalog.staticItems);
export const GROUND_ART_VARIANTS = catalog.staticVariants as Readonly<Record<string, Readonly<Record<string, Partial<ArchiveSpriteDefinition>>>>>;
export const GROUND_ITEM_DISPLAY_SPECS = Object.fromEntries(Object.entries(GROUND_ITEM_DEFINITIONS)
  .map(([id, { name, icon, atlas }]) => [id, { name, icon, atlas }]));
export const GROUND_ITEM_SKIN_SPECS: Readonly<Record<string, InventorySkinSpec>> = catalog.skinSpecs;
export const TURF_ITEM_IDS = Object.keys(GROUND_ITEM_DEFINITIONS)
  .filter(id => GROUND_ITEM_DEFINITIONS[id].groundTile !== undefined);
/** turfs.lua: STACK_SIZE_MEDITEM; no equipped art or source skins. */
export const TURF_ITEM_SPECS: Readonly<Record<string, InventoryItemSpec>> = Object.fromEntries(
  TURF_ITEM_IDS.map(id => [id, { ...GROUND_ITEM_DISPLAY_SPECS[id], maxStack: 20, configureEntity: configureTurfEntity }]),
);

/** An item prefab: its inst, the art its display draws, and what the prefab adds to the inst once it has loaded. */
export type ItemPrefabDefinition = PrefabEntityDefinition<ItemEntity>;

/**
 * What an item's module adds to the shared ground-item prefab. As the inventory constructs an item from its stack and
 * then configures it, the module's part runs once the inst has its saved stack and the inventory metadata's
 * components; the record it was loaded from, if any, is `inst.saveRecord`.
 */
export interface ItemPrefabParts {
  configure?(inst: ItemEntity): void;
}

/** The archive an item's ground art draws, for its variant. */
export function groundArtArchive(itemId: string, variantName?: string): ArchiveSpriteDefinition & GroundArtDefinition {
  const base = GROUND_ART_DEFINITIONS[itemId];
  const variant = variantName === undefined ? undefined : GROUND_ART_VARIANTS[itemId]?.[variantName];
  if (variantName !== undefined && !variant) throw new Error(`Unknown ground variant: ${itemId}/${variantName}`);
  if (!base) throw new Error(`Unknown ground item: ${itemId}`);
  return { ...base, ...variant } as ArchiveSpriteDefinition & GroundArtDefinition;
}

/**
 * The inst of an inventory item (or of ground art alone) as its prefab's fn makes it: the inventory metadata's
 * components, MakeInventoryPhysics, its ground art's clip, tags, symbols, layer and scale on its own sprite, and the
 * module's own fn. Its display draws the art; a held inst is in limbo and is not drawn.
 */
export function groundItemPrefab(itemId: string, world: ItemPrefabWorld, parts: ItemPrefabParts = {}): ItemPrefabDefinition {
  const art = GROUND_ART_DEFINITIONS[itemId];
  const inventoryItem = world.isInventoryItem(itemId);
  const materialOptions = art.multColour || art.pointFiltering ? { multColour: art.multColour, pointFiltering: art.pointFiltering } : undefined;
  return {
    fn: () => {
      const inst = world.newItem(itemId);
      inst.sprite.resetPresentation({ name: art.animation, held: !art.loop, billboard: !art.ground });
      for (const tag of art.tags ?? []) inst.addTag(tag);
      for (const [symbol, override] of Object.entries(art.symbolOverrides)) inst.sprite.setSymbolOverride(symbol, override.archive, override.symbol);
      for (const symbol of art.hiddenSymbols ?? []) inst.sprite.setSymbolHidden(symbol, true);
      if (art.ground) { inst.sprite.setGround(3); inst.setScale(-1, 1.4, 1); }
      else if (art.scale !== undefined) inst.setScale(art.scale);
      bindItemWorld(inst, world);
      return inst;
    },
    instanceAssets: inst => groundArtArchive(itemId, inst.variant),
    assetOptions: { instancedAnimations: 'all' },
    ...Object.keys(art.skinArchives).length ? { skins: art.skinArchives } : {},
    ...materialOptions ? { materialOptions } : {},
    // Ground art alone is only looked at.
    targetable: inventoryItem,
    onSpawned: inst => {
      if (inventoryItem) world.configureItem(inst);
      else inst.components.inventoryitem.canbepickedup = false;
      // A variant's own clip and symbols, once the saved variant is known.
      const variant = groundArtArchive(itemId, inst.variant), clip = variant.animation;
      if (clip !== art.animation) { if (art.loop) inst.sprite.start(clip); else inst.sprite.holdLastFrame(clip); }
      if (variant.symbolOverrides !== art.symbolOverrides) {
        for (const [symbol, override] of Object.entries(variant.symbolOverrides)) inst.sprite.setSymbolOverride(symbol, override.archive, override.symbol);
      }
      parts.configure?.(inst);
    },
  };
}

/** An inventory item outside the ground art catalog, drawn as its inventory image. */
export function iconItemPrefab(itemId: string, icon: { readonly atlas: string; readonly image: string }, world: ItemPrefabWorld): ItemPrefabDefinition {
  return {
    fn: () => {
      const inst = world.newItem(itemId);
      inst.sprite.resetPresentation({ name: '', billboard: true });
      bindItemWorld(inst, world);
      return inst;
    },
    onSpawned: inst => world.configureItem(inst),
    icon,
  };
}

/**
 * MakeInventoryPhysics and TheWorld's services every item's callbacks read. A thrown inst lands where its flight ends,
 * and its placement and tile follow it there.
 */
export function bindItemWorld(inst: ItemEntity, world: ItemPrefabWorld): void {
  addComponent(inst, 'inventoryphysics', InventoryPhysics, world.componentUpdates, TILE_SIZE / 4);
  const dropLoot = world.dropLoot;
  inst.worldServices = { ...inst.worldServices, fx: world.fx, spawnItem: state => world.spawnItem(state), dropItem: world.dropItem,
    dropLoot: (items, position) => dropLoot?.(items.map(item => ({ ...GROUND_ITEM_DEFINITIONS[item.itemId], ...item })), position) };
  const settle = () => {
    inst.transform.tileTracker.sync();
    inst.MiniMapEntity?.tileTracker.sync();
    syncPlacementEntity(inst.transform.model);
  };
  inst.ListenForEvent('ondropped', settle);
  inst.ListenForEvent('on_landed', settle);
  // physics.lua LaunchAt, from whoever throws the inst.
  inst.ListenForEvent('launch', (_inst, launch) => inst.components.inventoryphysics?.Launch(launch as LootLaunch));
  // RemoveFromScene takes the body out of the physics world: a flight caught mid-air ends at once.
  inst.ListenForEvent('enterlimbo', () => inst.components.inventoryphysics?.Stop());
}

/**
 * butterfly.lua / fireflies.lua / lightflier.lua OnDropped: a dropped stack lets its insects go one at a time, each
 * stackable:Get() dropped where the stack lies.
 */
export function dropStackIndividually(inst: ItemEntity, world: Pick<ItemPrefabWorld, 'spawnItem'>): void {
  const stackable = inst.components.stackable;
  while (!inst.isRemoved && stackable.count > 1) {
    const { entityId: _id, ...state } = inst.snapshot(false);
    stackable.count--;
    const item = world.spawnItem({ ...state, count: 1 });
    const { x, y, z } = inst.transform.position;
    item.setPosition(x, y, z);
    item.components.inventoryitem.OnDropped();
  }
}

/**
 * StartUpdatingComponent / StopUpdatingComponent: `update` is visited each frame while `updating` is true, until the
 * inst is removed.
 */
export function bindComponentUpdates(inst: ItemEntity, updating: ReadonlySignal<boolean>, update: (dt: number) => void,
  updates: ComponentUpdates): void {
  let stop: (() => void) | undefined;
  const component = { OnUpdate: update };
  const sync = (on: boolean) => {
    if (on && !inst.isRemoved) stop ??= updates.register(component);
    else { stop?.(); stop = undefined; }
  };
  const unsubscribe = updating.subscribe(sync);
  sync(updating.peek());
  inst.onRemove(() => { unsubscribe(); sync(false); });
}

/** Keep the existing ground material names used by equipment and lighting. */
export class GroundItemAssets extends ArchiveSpriteAssets {
  constructor() { super('ground'); }
}

import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import type { ItemEntity, ItemEntityFactory, InventoryStack } from '@dontstarve-web/inventory';
import type { SpriteResources } from '@dontstarve-web/display';
import type { ComponentUpdates } from '../../componets/src/componentUpdates';
import type { BernieWorld } from './bernie';
import type { ButterflyWorld } from './butterfly';
import type { FirefliesWorld } from './fireflies';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { HandEquipment, ReadonlySignal } from '@dontstarve-web/signals';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';

export interface GroundItemDefinition {
  mole?: import('@dontstarve-web/inventory').InventoryStack['mole'];
  lightflier?: InventoryStack['lightflier'];
  container?: import('@dontstarve-web/inventory').ItemContainerState;
  /** Live inst; the remaining fields are asset metadata or detached save/UI projections. */
  entity?: ItemEntity;
  entityId?: string;
  itemId: string;
  skinId?: string;
  variant?: string;
  name: string;
  icon: string;
  atlas?: string;
  count: number;
  remainingUses?: number;
  remainingFuel?: number;
  temperature?: InventoryStack['temperature'];
  armor?: InventoryStack['armor'];
  highTemp?: number;
  lowTemp?: number;
  freshnessPercent?: number;
  wet?: boolean;
  torchLit?: boolean;
  /** machine.ison of a ground lantern. */
  lanternOn?: boolean;
  phonographRecord?: string;
  inventory?: InventoryStack[];
  playbackRemaining?: number;
}

/** The transient fx spawner shared with the rest of the scene. */
export interface GroundFx {
  collapse?: import('./world_fx').WorldFx['collapse'];
  spawn(prefab: import('./world_fx').WorldFxPrefab, position: ReadonlyVector3): void;
}

/**
 * TheWorld as the item prefabs reach it: the item registry that constructs an inst, the inventory metadata it is
 * configured with, the game-time services, and the spawns, fx and habitats its callbacks use.
 */
export interface ItemPrefabWorld {
  /**
   * The item registry's construction of a new inst of `prefab`, bound to its worlds; the item prefab's fn calls it,
   * with its own ItemEntity subclass when it has one.
   */
  newItem(prefab: string): ItemEntity;
  newItem<Entity extends ItemEntity>(prefab: string, factory: ItemEntityFactory<Entity>): Entity;
  /** SpawnPrefab of an item from its runtime stack. */
  spawnItem(state: InventoryStack): ItemEntity;
  /** SpawnSaveRecord of an item a holder saved, as a container's or inventory's OnLoad makes its contents. */
  restoreItem(record: import('./saveRecord').HeldEntityRecord): ItemEntity;
  /** inventoryitem:OnDropped of an inst a holder lets go of, at `position`. */
  dropItem?(entity: ItemEntity, position: ReadonlyVector3): void;
  /** Whether `prefab` is an inventory item; ground art alone is never picked up. */
  isInventoryItem(prefab: string): boolean;
  /** The inventory item metadata's components (stack size, perish time, uses, equip slot). */
  configureItem(entity: ItemEntity): void;
  /** Sprite sources of the effects an item spawns as its children (fire, flies); the application disposes them. */
  sprites: SpriteResources;
  animationBaseUrl: string;
  scheduler: GameTimeScheduler;
  /** StartUpdatingComponent / StopUpdatingComponent. */
  componentUpdates: ComponentUpdates;
  /** TheWorld.Map for ocean_util.lua ShouldEntitySink; without it no item sinks. */
  map?: import('./ocean_util').OceanMap;
  physics?: import('cannon-es').World;
  moleWorld?: import('./molehill').MoleHabitat;
  lightflierWorld?: import('./lightflier').LightFlierHabitat;
  fx?: GroundFx;
  handEquipment?: ReadonlySignal<HandEquipment | null>;
  /** AllPlayers and SpawnPrefab for the Bernie item's tryreanimate; without it the item never reanimates. */
  bernieWorld?: BernieWorld;
  butterflyWorld: ButterflyWorld;
  firefliesWorld: FirefliesWorld;
  /** lootdropper.lua DropLoot: each piece is spawned now and flung; the displays load the art. */
  dropLoot?(items: readonly GroundItemDefinition[], position: ReadonlyVector3): void;
  /** SpawnPrefab of a ground stack at `position`, synchronously; its display loads the art. */
  spawnGroundItem?: SpawnGroundItem;
}

/** lootdropper.lua FlingItem scatters the stack (`fling`), or `launch` gives its exact flight; otherwise it is placed. */
export interface GroundSpawnOptions {
  fling?: boolean;
  launch?: import('../../componets/src/inventoryphysics').LootLaunch;
}

/** Creates the inst and its display now; returns undefined when the world can no longer spawn. */
/** lootdropper:SpawnLootPrefab's SpawnPrefab: the loot is flung from the dropper as a ground item. */
export function groundLootSpawner(world: {
  readonly spawnGroundItem: SpawnGroundItem;
}): import('../../componets/src/lootdropper').LootSpawn {
  return (prefab, point, skinId) =>
    world.spawnGroundItem(
      { ...GROUND_ITEM_DEFINITIONS[prefab], itemId: prefab, count: 1, ...(skinId ? { skinId } : {}) },
      point,
      { fling: true },
    );
}

export type SpawnGroundItem = (
  definition: GroundItemDefinition,
  position: ReadonlyVector3,
  options?: GroundSpawnOptions,
) => ItemEntity | undefined;

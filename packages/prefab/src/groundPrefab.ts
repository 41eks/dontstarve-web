import type { PrefabInstance } from './prefabInstance';
import type { ArchiveSpriteCommands } from '@dontstarve-web/display';
import type { ItemEntity, InventoryStack } from '@dontstarve-web/inventory';
import type * as THREE from 'three';
import type { GroundItemAssets } from './groundItems';
import type { BernieWorld } from './bernie';
import type { ButterflyWorld } from './butterfly';
import type { FirefliesWorld } from './fireflies';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { HandEquipment, ReadonlySignal } from '@dontstarve-web/signals';

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
  playbackRemaining?: number;
}

export interface GroundItemVisual {
  /** The display entity; live inventory state remains on the bound ItemEntity. */
  readonly instance: PrefabInstance<ArchiveSpriteCommands>;
  model: THREE.Group;
  /** Resource presence, driven by the prefab's tile activity. Logical items still persist while false. */
  active?: ReadonlySignal<boolean>;
  /** Bind movement/proximity to the committed inst; the model only projects its position. */
  bindTransform?(transform: ItemEntity['transform']): void;
  bindEntity?(entity: ItemEntity): void;
  update?(dt: number): void;
  /**
   * StartUpdatingComponent/StopUpdatingComponent: while false the manager skips update(); absent means always
   * updating. Visuals with neither update nor isRemoved are static.
   */
  updating?: ReadonlySignal<boolean>;
  isRemoved?(): boolean;
  isClickable?(): boolean;
  isWorkable?(): boolean;
  getDefinition?(): Partial<GroundItemDefinition>;
  /** Rebind a replacement display to the item's current authoritative state. */
  setDefinition?(definition: GroundItemDefinition): void;
  dispose(): void;
}

/** The transient fx spawner shared with the rest of the scene. */
export interface GroundFx {
  prepare(prefab: import('./world_fx').WorldFxPrefab): Promise<void>;
  spawn(prefab: import('./world_fx').WorldFxPrefab, position: THREE.Vector3): void;
}

export interface GroundPrefabOptions {
  physics?: import('cannon-es').World;
  moleWorld?: import('./molehill').MoleHabitat;
  lightflierWorld?: import('./lightflier').LightFlierHabitat;
  fx?: GroundFx;
  /** Tile activity query; ground items unload their sprite while the tile under them is inactive. */
  tickingarea?: import('@dontstarve-web/signals').TileStateQuery;
  scheduler?: GameTimeScheduler;
  scene: THREE.Scene;
  animationBaseUrl: string;
  inventoryOwnerPosition?: THREE.Vector3;
  handEquipment?: ReadonlySignal<HandEquipment | null>;
  bernieWorld: BernieWorld;
  butterflyWorld: ButterflyWorld;
  firefliesWorld: FirefliesWorld;
  /** lootdropper.lua DropLoot: each piece is spawned now and flung; the displays load the art. */
  dropLoot?(items: readonly GroundItemDefinition[], position: THREE.Vector3): void;
  /** SpawnPrefab of a ground stack at `position`, synchronously; its display loads the art. */
  spawnGroundItem?: SpawnGroundItem;
}

/** lootdropper.lua FlingItem scatters the stack (`fling`), or `launch` gives its exact flight; otherwise it is placed. */
export interface GroundSpawnOptions { fling?: boolean; launch?: import('./lootFling').LootLaunch }

/** Creates the inst and its display now; returns undefined when the world can no longer spawn. */
export type SpawnGroundItem = (definition: GroundItemDefinition, position: THREE.Vector3, options?: GroundSpawnOptions) => ItemEntity | undefined;

export interface GroundPrefabContext extends GroundPrefabOptions {
  assets: GroundItemAssets;
}

/** Each prefab binds its own assets, events and world dependencies. */
export interface GroundItemFactory {
  itemIds: readonly string[];
  /** The inst and its display exist synchronously; its display loads the art. */
  create(definition: GroundItemDefinition): GroundItemVisual;
  capture?: 'net';
  configureEntity?(entity: ItemEntity): void;
  update?(dt: number, cameraQuaternion: THREE.Quaternion): void;
  renderEntities?(): readonly { object: THREE.Group; footPosition: THREE.Vector3; cameraDepth: number }[];
  dispose?(): void;
}

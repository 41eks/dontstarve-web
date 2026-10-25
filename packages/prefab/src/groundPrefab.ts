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
  /** Rebind prepared visuals to the state committed after asynchronous asset loading. */
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
  dropLoot?(items: readonly GroundItemDefinition[], position: THREE.Vector3): Promise<void>;
  /** Prepare a normal ground stack so timed prefab actions can commit without an asset-load gap. */
  prepareSpawn?(definition: GroundItemDefinition): Promise<PreparedGroundSpawn>;
}

export interface PreparedGroundSpawn {
  /** Actual committed inst, available after spawning a prepared stack. */
  readonly spawnedEntity?: ItemEntity;
  spawn(position: THREE.Vector3, count?: number, launch?: import('./lootFling').LootLaunch): boolean;
  dispose(): void;
}

export interface GroundPrefabContext extends GroundPrefabOptions {
  assets: GroundItemAssets;
}

/** Each prefab binds its own assets, events and world dependencies. */
export interface GroundItemFactory {
  itemIds: readonly string[];
  create(definition: GroundItemDefinition): Promise<GroundItemVisual>;
  /** Available after the owning prefab has preloaded its shared resources. */
  createPrepared?(definition: GroundItemDefinition): GroundItemVisual;
  capture?: 'net';
  configureEntity?(entity: ItemEntity): void;
  update?(dt: number, cameraQuaternion: THREE.Quaternion): void;
  renderEntities?(): readonly { object: THREE.Group; footPosition: THREE.Vector3; cameraDepth: number }[];
  dispose?(): void;
}

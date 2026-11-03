import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import type { PrefabDisplay } from '@dontstarve-web/display';
import type { ItemEntity, InventoryStack } from '@dontstarve-web/inventory';
import type * as THREE from 'three';
import type { SpriteResources } from '@dontstarve-web/display';
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
  inventory?: InventoryStack[];
  playbackRemaining?: number;
}

export interface GroundItemVisual {
  /** The original logical item instance, also held by its inventory owner. */
  readonly instance: ItemEntity;
  model: THREE.Group;
  /** Owns scene membership and sprite residency; the manager advances it each frame. */
  readonly display: PrefabDisplay;
  /** Resource presence, driven by the prefab's tile activity. Logical items still persist while false. */
  active?: ReadonlySignal<boolean>;
  update?(dt: number): void;
  /**
   * StartUpdatingComponent/StopUpdatingComponent: while false the manager skips frame updates; absent means always
   * advancing the display and any update callback.
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
  collapse?: import('./world_fx').WorldFx['collapse'];
  prepare(prefab: import('./world_fx').WorldFxPrefab): Promise<void>;
  spawn(prefab: import('./world_fx').WorldFxPrefab, position: ReadonlyVector3): void;
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
  dropLoot?(items: readonly GroundItemDefinition[], position: ReadonlyVector3): void;
  /** SpawnPrefab of a ground stack at `position`, synchronously; its display loads the art. */
  spawnGroundItem?: SpawnGroundItem;
}

/** lootdropper.lua FlingItem scatters the stack (`fling`), or `launch` gives its exact flight; otherwise it is placed. */
export interface GroundSpawnOptions { fling?: boolean; launch?: import('./lootFling').LootLaunch }

/** Creates the inst and its display now; returns undefined when the world can no longer spawn. */
export type SpawnGroundItem = (definition: GroundItemDefinition, position: ReadonlyVector3, options?: GroundSpawnOptions) => ItemEntity | undefined;

export interface GroundPrefabContext extends GroundPrefabOptions {
  assets: GroundItemAssets;
  /** Declares the ground items' sprite sources over `assets`; each display loads what it draws. */
  sprites: SpriteResources;
}

/** Each prefab binds its own assets, events and world dependencies. */
export interface GroundItemFactory {
  itemIds: readonly string[];
  /**
   * The inst's ground visual and its display exist synchronously; its display loads the art. The visual draws the
   * item's own sprite (`entity.sprite`, inst.AnimState), which keeps the item's skin on the ground and off it.
   */
  create(definition: GroundItemDefinition, entity: ItemEntity): GroundItemVisual;
  capture?: 'net';
  configureEntity?(entity: ItemEntity): void;
  update?(dt: number, cameraQuaternion: THREE.Quaternion): void;
  renderEntities?(): readonly { object: THREE.Group; footPosition: ReadonlyVector3; cameraDepth: number }[];
  dispose?(): void;
}

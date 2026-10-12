import type { ItemEntity } from '@dontstarve-web/inventory';
import type * as THREE from 'three';
import type { GroundItemAssets } from './groundItems';
import type { BernieWorld } from './bernie';
import type { ButterflyWorld } from './butterfly';
import type { FirefliesWorld } from './fireflies';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';

export interface GroundItemDefinition {
  container?: import('@dontstarve-web/inventory').ItemContainerState;
  /** Live inst; the remaining fields are asset metadata or detached save/UI projections. */
  entity?: ItemEntity;
  entityId?: string;
  itemId: string;
  skinId?: string;
  name: string;
  icon: string;
  atlas?: string;
  count: number;
  remainingUses?: number;
  remainingFuel?: number;
  freshnessPercent?: number;
  wet?: boolean;
  torchLit?: boolean;
  /** machine.ison of a ground lantern. */
  lanternOn?: boolean;
  phonographRecord?: string;
  playbackRemaining?: number;
}

export interface GroundItemVisual {
  model: THREE.Group;
  /** Bind movement/proximity to the committed inst; the model only projects its position. */
  bindTransform?(transform: ItemEntity['transform']): void;
  bindEntity?(entity: ItemEntity): void;
  update?(dt: number): void;
  isRemoved?(): boolean;
  isClickable?(): boolean;
  isWorkable?(): boolean;
  getDefinition?(): Partial<GroundItemDefinition>;
  /** Rebind prepared visuals to the state committed after asynchronous asset loading. */
  setDefinition?(definition: GroundItemDefinition): void;
  dispose(): void;
}

export interface GroundPrefabOptions {
  scheduler?: GameTimeScheduler;
  season?: import('@dontstarve-web/signals').ReadonlySignal<import('@dontstarve-web/signals').SeasonState>;
  scene: THREE.Scene;
  animationBaseUrl: string;
  inventoryOwnerPosition?: THREE.Vector3;
  bernieWorld: BernieWorld;
  butterflyWorld: ButterflyWorld;
  firefliesWorld: FirefliesWorld;
  getNeighbours(): readonly { model: THREE.Group; position: THREE.Vector3 }[];
  dropLoot?(items: readonly GroundItemDefinition[], position: THREE.Vector3): Promise<void>;
  /** Prepare a normal ground stack so timed prefab actions can commit without an asset-load gap. */
  prepareSpawn?(definition: GroundItemDefinition): Promise<PreparedGroundSpawn>;
}

export interface PreparedGroundSpawn {
  /** Actual committed inst, available after spawning a prepared stack. */
  readonly spawnedEntity?: ItemEntity;
  spawn(position: THREE.Vector3, count?: number): boolean;
  dispose(): void;
}

export interface GroundPrefabContext extends GroundPrefabOptions {
  assets: GroundItemAssets;
}

/** Each prefab binds its own assets, events and world dependencies. */
export interface GroundItemFactory {
  itemIds: readonly string[];
  create(definition: GroundItemDefinition): Promise<GroundItemVisual>;
  capture?: 'net';
  configureEntity?(entity: ItemEntity): void;
  update?(dt: number, cameraQuaternion: THREE.Quaternion): void;
  renderEntities?(): readonly { object: THREE.Group; footPosition: THREE.Vector3; cameraDepth: number }[];
  dispose?(): void;
}

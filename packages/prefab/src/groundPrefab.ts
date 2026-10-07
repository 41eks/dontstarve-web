import type * as THREE from 'three';
import type { GroundItemAssets } from './groundItems';
import type { BernieWorld } from './bernie';
import type { ButterflyWorld } from './butterfly';
import type { FirefliesWorld } from './fireflies';
import type { SoundPosition } from './sound';

export interface GroundItemDefinition {
  itemId: string;
  skinId?: string;
  name: string;
  icon: string;
  atlas?: string;
  count: number;
  remainingUses?: number;
  remainingFuel?: number;
  torchLit?: boolean;
  phonographRecord?: string;
  playbackRemaining?: number;
}

export interface GroundItemVisual {
  model: THREE.Group;
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
  animationBaseUrl: string;
  inventoryOwnerPosition?: SoundPosition;
  bernieWorld: BernieWorld;
  butterflyWorld: ButterflyWorld;
  firefliesWorld: FirefliesWorld;
  getNeighbours(): readonly { model: THREE.Group; position: THREE.Vector3 }[];
}

export interface GroundPrefabContext extends GroundPrefabOptions {
  assets: GroundItemAssets;
}

/** Each prefab binds its own assets, events and world dependencies. */
export interface GroundItemFactory {
  itemIds: readonly string[];
  create(definition: GroundItemDefinition): Promise<GroundItemVisual>;
  capture?: 'net';
  dispose?(): void;
}

import type * as CANNON from 'cannon-es';
import type * as THREE from 'three';
import type { InventoryStack, InventoryStore } from '@dontstarve-web/inventory';
import type { SpriteResources } from '@dontstarve-web/display';
import type { ReadonlyVector3 } from '@dontstarve-web/animation/transformRoot';
import { flingLoot, spawnGroundStack } from '@dontstarve-web/prefab/itemPrefabs';
import { GROUND_ITEM_DISPLAY_SPECS } from '@dontstarve-web/prefab/groundItems';
import type { GroundItemDefinition, GroundSpawnOptions } from '@dontstarve-web/prefab/groundPrefab';
import { turfItemForTile } from '@dontstarve-web/prefab/turfs';
import type { TurfMap } from '@dontstarve-web/prefab/turfMap';
import type { WorldContext, WorldEventEmitter } from '@dontstarve-web/prefab/worldContext';
import type { FireFxHost } from '@dontstarve-web/prefab/treeFire';
import type { WorldFx } from '@dontstarve-web/prefab/world_fx';
import { Vector3 } from 'three';
import type { DynamicMusic } from '../../packages/componets/src/dynamicmusic';
import type { LootLaunch } from '../../packages/componets/src/inventoryphysics';
import type { WorldMigratorShard } from '../../packages/componets/src/worldmigrator';
import type { camera, followCamera } from '../camera';
import type { groundDisplay, pathfinder } from '../building';
import type { player, playerInstance } from '../player';
import type { playerStats } from '../playerStats';
import type { dstLighting } from '../universal';
import type { WorldState } from '../worldState';
import type { PlaceableBuildingInteractionChange } from '../placeableBuilding';

export interface ScenePrefabServices {
  readonly world: CANNON.World;
  readonly worldState: WorldState;
  readonly inventory: InventoryStore;
  readonly worldEvents: WorldEventEmitter;
  readonly worldFx: WorldFx;
  readonly prefabFire: FireFxHost;
  readonly itemSprites: SpriteResources;
  readonly prefabBaseUrl: string;
  readonly dynamicMusic: DynamicMusic;
  readonly groundItems: ReturnType<typeof createGroundItems>;
  readonly onBuildingInteraction?: (change: PlaceableBuildingInteractionChange) => void;
  readonly shardLink: WorldMigratorShard;
  readonly isCave: boolean;
  readonly topology: import('@dontstarve-web/prefab/topology').TopologySave | undefined;
  readonly mapHalfSize: number;
  readonly camera: typeof camera;
  readonly followCamera: typeof followCamera;
  readonly groundDisplay: typeof groundDisplay;
  readonly pathfinder: typeof pathfinder;
  readonly turfMap: TurfMap;
  readonly view: WorldContext;
  readonly player: typeof player;
  readonly playerInstance: typeof playerInstance;
  readonly playerStats: typeof playerStats;
  readonly scene: THREE.Scene;
  readonly dstLighting: typeof dstLighting;
}

export type ScenePrefabInputs<Keys extends keyof ScenePrefabServices> = Pick<ScenePrefabServices, Keys>;

export function createGroundItems(inventory: InventoryStore) {
  const spawner = { spawnItem: (state: InventoryStack) => inventory.entities.create(state) };
  return {
    spawnGroundItem: (definition: GroundItemDefinition, position: ReadonlyVector3, options?: GroundSpawnOptions) =>
      spawnGroundStack(spawner, definition, position, options),
    flingLoot: (definitions: Parameters<typeof flingLoot>[1], position: ReadonlyVector3, launch?: () => LootLaunch) =>
      flingLoot(spawner, definitions, position, launch),
  };
}

export function bindDugTurf(turfMap: TurfMap, groundItems: ScenePrefabServices['groundItems']): () => void {
  return turfMap.onDig((point, tileId) => {
    const itemId = turfItemForTile(tileId);
    if (!itemId) {
      return;
    }
    const spec = GROUND_ITEM_DISPLAY_SPECS[itemId];
    groundItems.flingLoot(
      [{ itemId, count: 1, name: spec.name, icon: spec.icon, atlas: spec.atlas }],
      new Vector3(point.x, 0, point.z),
    );
  });
}

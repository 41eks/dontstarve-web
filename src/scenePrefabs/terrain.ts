import { stalagmiteRegistration } from '@dontstarve-web/prefab/stalagmite';
import { RopeBridgeManager } from '../../packages/componets/src/ropebridgemanager';
import * as THREE from 'three';
import { WORLD_TILES } from '@dontstarve-web/prefab/turfMap';
import { GROUND_ART_DEFINITIONS } from '@dontstarve-web/prefab/groundItems';
import { moonglassRockRegistration, rockRegistration } from '@dontstarve-web/prefab/rocks';
import { caveinBoulderRegistration } from '@dontstarve-web/prefab/cavein_boulder';
import { moonrockseedRegistration } from '@dontstarve-web/prefab/moonrockseed';
import type { SpawnGroundItem } from '@dontstarve-web/prefab/groundPrefab';
import { caveHoleRegistration } from '@dontstarve-web/prefab/cave_hole';
import { moonFissureRegistration } from '@dontstarve-web/prefab/moon_fissure';
import { watertreePillarRegistration } from '@dontstarve-web/prefab/watertree_pillar';
import { oceanTreePillarRegistration } from '@dontstarve-web/prefab/oceantree_pillar';
import { ROPE_BRIDGE_FX_ID, RopeBridgeFxInstance, ropeBridgePrefabs } from '@dontstarve-web/prefab/rope_bridge';
import { mastMalbatrossRegistration } from '@dontstarve-web/prefab/mast_malbatross';
import { vaultPillarRegistration } from '@dontstarve-web/prefab/vault_pillar';
import { caveEntranceRegistration, CAVES_SHARD } from '@dontstarve-web/prefab/cave_entrance';
import { caveExitRegistration, MASTER_SHARD } from '@dontstarve-web/prefab/cave_exit';
import type { WorldMigratorShard } from '../../packages/componets/src/worldmigrator';
import { grottoPoolRegistration } from '@dontstarve-web/prefab/grotto_pool';
import { pondRegistration } from '@dontstarve-web/prefab/pond';
import { hotspringRegistration } from '@dontstarve-web/prefab/hotspring';
import { lavaPondRegistration } from '@dontstarve-web/prefab/lava_pond';
import { wormholeRegistration } from '@dontstarve-web/prefab/wormhole';
import { portalRegistration } from '@dontstarve-web/prefab/portal';
import { nightmareGrowthRegistration, NightmareGrowthCrackInstance } from '@dontstarve-web/prefab/nightmaregrowth';
import { nightmareRockRegistration } from '@dontstarve-web/prefab/nightmarerock';
import { TILE_SIZE } from '../../packages/prefab/src/tile';
import { SAVE_CATALOG } from '../save/catalog';
import { registerPrefabFamily, type ScenePrefabTarget } from './registry';
import type { ScenePrefabInputs } from './services';

export function registerStalagmites(
  target: ScenePrefabTarget,
  { worldState, groundItems }: ScenePrefabInputs<'worldState' | 'groundItems'>,
) {
  registerPrefabFamily(target, stalagmiteRegistration, {
    scheduler: worldState.scheduler,
    spawnLoot: (id, position) => {
      const definition = GROUND_ART_DEFINITIONS[id];
      return definition
        ? groundItems.spawnGroundItem({ ...definition, icon: definition.icon ?? '', itemId: id, count: 1 }, position, {
            fling: true,
          })
        : undefined;
    },
  });
}

export function registerRocks(
  target: ScenePrefabTarget,
  { worldState, inventory, groundItems }: ScenePrefabInputs<'worldState' | 'inventory' | 'groundItems'>,
) {
  const { prefabs } = target;
  const spawnGroundItem: SpawnGroundItem = (definition, position, options) =>
    groundItems.spawnGroundItem(definition, position, options);
  registerPrefabFamily(target, rockRegistration, {
    handEquipment: inventory.handEquipment,
    scheduler: worldState.scheduler,
    spawnGroundItem,
    spawnPrefab: (id, position) => prefabs.spawn(id, position),
  });
  registerPrefabFamily(target, caveinBoulderRegistration, { handEquipment: inventory.handEquipment, spawnGroundItem });
  registerPrefabFamily(target, moonrockseedRegistration);
}

export function registerMoonglassRocks(
  target: ScenePrefabTarget,
  { worldState, inventory, groundItems }: ScenePrefabInputs<'worldState' | 'inventory' | 'groundItems'>,
) {
  registerPrefabFamily(target, moonglassRockRegistration, {
    handEquipment: inventory.handEquipment,
    scheduler: worldState.scheduler,
    spawnGroundItem: groundItems.spawnGroundItem,
  });
}

export function registerCaveHoles(
  target: ScenePrefabTarget,
  { worldState, view }: ScenePrefabInputs<'worldState' | 'view'>,
) {
  const { prefabs } = target;
  registerPrefabFamily(target, caveHoleRegistration, {
    getWatchWorldContent: worldState.getWatchWorldContent,
    cameraFacing: view.cameraFacing,
    spawnPrefab: (id, position) => prefabs.spawn(id, position),
  });
}

export function registerVaultPillars(target: ScenePrefabTarget) {
  const { prefabs } = target;
  registerPrefabFamily(target, vaultPillarRegistration, { spawnPrefab: (id, position) => prefabs.spawn(id, position) });
}

export function registerGrottoPools(
  target: ScenePrefabTarget,
  {
    worldState,
    inventory,
    worldFx,
    groundItems,
  }: ScenePrefabInputs<'worldState' | 'inventory' | 'worldFx' | 'groundItems'>,
) {
  const { prefabs } = target;
  registerPrefabFamily(target, grottoPoolRegistration, {
    handEquipment: inventory.handEquipment,
    scheduler: worldState.scheduler,
    registerWaterfallPool: (position, radius, large) =>
      worldState.soundPresentation.registerWaterfallPool(position, radius, large),
    getWatchWorldContent: worldState.getWatchWorldContent,
    fx: worldFx,
    spawnGroundItem: groundItems.spawnGroundItem,
    spawnPrefab: (id, position) => prefabs.spawn(id, position),
    getEntity: entityId => prefabs.get(entityId),
  });
}

export function registerLavaPonds(target: ScenePrefabTarget, { worldState }: ScenePrefabInputs<'worldState'>) {
  const { prefabs } = target;
  registerPrefabFamily(target, lavaPondRegistration, {
    scheduler: worldState.scheduler,
    spawnPrefab: (prefab, position) => prefabs.spawn(prefab, position),
  });
}

export function registerHotsprings(
  target: ScenePrefabTarget,
  { worldState, worldFx }: ScenePrefabInputs<'worldState' | 'worldFx'>,
) {
  registerPrefabFamily(target, hotspringRegistration, {
    scheduler: worldState.scheduler,
    fx: worldFx,
  });
}

export function registerWormholes(target: ScenePrefabTarget, { worldState }: ScenePrefabInputs<'worldState'>) {
  registerPrefabFamily(target, wormholeRegistration, {
    scheduler: worldState.scheduler,
    getWatchWorldContent: worldState.getWatchWorldContent,
  });
}

export function registerPortals(target: ScenePrefabTarget, { worldState }: ScenePrefabInputs<'worldState'>) {
  const { prefabs } = target;
  registerPrefabFamily(target, portalRegistration, {
    scheduler: worldState.scheduler,
    portalRez: worldState.portalRez,
    spawnPrefab: (id, position) => prefabs.spawn(id, position),
  });
}

export function registerNightmareGrowths(target: ScenePrefabTarget, { worldState }: ScenePrefabInputs<'worldState'>) {
  const { prefabs } = target;
  registerPrefabFamily(target, nightmareGrowthRegistration, {
    scheduler: worldState.scheduler,
    spawnPrefab: (prefab, position) => prefabs.spawnAs(NightmareGrowthCrackInstance, prefab, position),
  });
}

export function registerMoonFissures(target: ScenePrefabTarget, { worldState }: ScenePrefabInputs<'worldState'>) {
  const { prefabs } = target;
  registerPrefabFamily(target, moonFissureRegistration, {
    scheduler: worldState.scheduler,
    getWatchWorldContent: worldState.getWatchWorldContent,
    spawnPrefab: (id, position) => prefabs.spawn(id, position),
  });
}

export function registerWatertreePillars(target: ScenePrefabTarget, { worldState }: ScenePrefabInputs<'worldState'>) {
  registerPrefabFamily(target, watertreePillarRegistration, {
    scheduler: worldState.scheduler,
    getWatchWorldContent: worldState.getWatchWorldContent,
  });
}

export function registerOceanTreePillars(
  target: ScenePrefabTarget,
  { worldState, groundItems }: ScenePrefabInputs<'worldState' | 'groundItems'>,
) {
  const { prefabs } = target;
  registerPrefabFamily(target, oceanTreePillarRegistration, {
    scheduler: worldState.scheduler,
    getWatchWorldContent: worldState.getWatchWorldContent,
    spawnLoot: (prefab, position) => {
      groundItems.flingLoot([{ ...SAVE_CATALOG.items[prefab], itemId: prefab, count: 1 }], position);
      return undefined;
    },
    spawnPrefab: (id, position) => prefabs.spawn(id, position),
  });
}

export function registerMastMalbatross(target: ScenePrefabTarget, { worldState }: ScenePrefabInputs<'worldState'>) {
  registerPrefabFamily(target, mastMalbatrossRegistration, {
    scheduler: worldState.scheduler,
    getWatchWorldContent: worldState.getWatchWorldContent,
  });
}

export function registerNightmareRocks(
  target: ScenePrefabTarget,
  { worldState, playerInstance, pathfinder }: ScenePrefabInputs<'worldState' | 'playerInstance' | 'pathfinder'>,
) {
  const { prefabs } = target;
  registerPrefabFamily(target, nightmareRockRegistration, {
    scheduler: worldState.scheduler,
    spawnPrefab: (prefab, position) => prefabs.spawn(prefab, position),
    getPlayers: () => [playerInstance],
    pathfinder,
  });
}

export function registerPonds(
  target: ScenePrefabTarget,
  { worldState, world }: ScenePrefabInputs<'worldState' | 'world'>,
) {
  const { registry } = target;
  registerPrefabFamily(target, pondRegistration, {
    scheduler: worldState.scheduler,
    tickingarea: worldState.tickingarea,
    getWatchWorldContent: worldState.getWatchWorldContent,
    physics: world,
    spawnPrefab: (prefab, position) => registry.SpawnPrefab(prefab, position),
  });
}

export function registerCaveEntrances(
  target: ScenePrefabTarget,
  { inventory, groundItems, shardLink }: ScenePrefabInputs<'inventory' | 'groundItems' | 'shardLink'>,
) {
  const { prefabs } = target;
  registerPrefabFamily(target, caveEntranceRegistration, {
    handEquipment: inventory.handEquipment,
    spawnGroundItem: groundItems.spawnGroundItem,
    spawnPrefab: (prefab, position) => prefabs.spawn(prefab, position),
    shard: shardLink,
  });
}

export function registerCaveExits(target: ScenePrefabTarget, { shardLink }: ScenePrefabInputs<'shardLink'>) {
  registerPrefabFamily(target, caveExitRegistration, { shard: shardLink });
}

/** rope_bridge.lua's rope_bridge_fx (with its rope and icon entities) and the cave's ropebridgemanager. */
export function registerRopeBridges(
  target: ScenePrefabTarget,
  { turfMap, view }: ScenePrefabInputs<'turfMap' | 'view'>,
): RopeBridgeManager {
  const { prefabs } = target;
  prefabs.register(
    ropeBridgePrefabs({
      cameraFacing: view.cameraFacing,
      spawnPrefab: (id, position) => prefabs.spawn(id, position),
    }),
  );
  return new RopeBridgeManager(
    {
      *ropeBridges() {
        for (const tile of turfMap.exportTiles()) {
          if (tile.tileId === WORLD_TILES.ROPE_BRIDGE && tile.ropeBridge) {
            yield [tile.col, tile.row, tile.ropeBridge] as const;
          }
        }
      },
      tileCenter: (col, row) => ({ x: (col + 0.5) * TILE_SIZE, z: (row + 0.5) * TILE_SIZE }),
    },
    (x, z) => prefabs.spawnAs(RopeBridgeFxInstance, ROPE_BRIDGE_FX_ID, new THREE.Vector3(x, 0, z)),
  );
}

/** ms_playerdespawnandmigrate reloads the destination shard's save. */
export function createShardLink(migrateTo: (shard: string) => void): WorldMigratorShard {
  return {
    isWorldAvailable: shard => shard === CAVES_SHARD || shard === MASTER_SHARD,
    isWorldFull: () => false,
    migratePlayer: (_player, _portal, shard) => migrateTo(shard),
  };
}

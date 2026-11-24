import { LIGHTFLIER_FLOWER_ID, lightflierFlowerRegistration } from '@dontstarve-web/prefab/lightflier_flower';
import { LightFlierHabitat } from '../../packages/prefab/src/lightflier';
import { MAX_PHYSICS_FRAME_TIME } from '../physicsTiming';
import { createMoleHabitat, molehillRegistration, MolehillInstance } from '../../packages/prefab/src/molehill';
import { TUNING } from '../tuning';
import * as CANNON from 'cannon-es';
import { getRegisteredPhysicsBodies } from '../../packages/componets/src/physicsWorld';
import * as THREE from 'three';
import { beeQueenHiveRegistration } from '@dontstarve-web/prefab/beequeenhivegrown';
import { dragonflyRegistration, DRAGONFLY_ID } from '@dontstarve-web/prefab/dragonfly';
import { dragonflySpawnerRegistration } from '@dontstarve-web/prefab/dragonfly_spawner';
import { stagehandRegistration } from '@dontstarve-web/prefab/stagehand';
import {
  BEEFALO_BEHAVIOR,
  beefaloRegistration,
  findBeefaloSpawnPoint,
  type BeefaloWorld,
} from '@dontstarve-web/prefab/beefalo';
import {
  LIGHTNING_GOAT_RADIUS,
  lightningGoatRegistration,
  type LightningGoatWorld,
} from '@dontstarve-web/prefab/lightninggoat';
import { WORLD_SCALE } from '../../packages/prefab/src/standardcomponents';
import { SAVE_CATALOG } from '../save/catalog';
import { staticObstacleTest } from '@dontstarve-web/prefab/locomotor';
import { PREFAB_DEFINITIONS } from '../prefabDefinitions';
import { registerPrefabFamily, type ScenePrefabTarget } from './registry';
import type { ScenePrefabInputs } from './services';

export function registerMolehills(
  target: ScenePrefabTarget,
  {
    worldState,
    world,
    inventory,
    worldFx,
    groundItems,
    mapHalfSize,
    turfMap,
    pathfinder,
    view,
  }: ScenePrefabInputs<
    'worldState' | 'world' | 'inventory' | 'worldFx' | 'groundItems' | 'mapHalfSize' | 'turfMap' | 'pathfinder' | 'view'
  >,
) {
  const { prefabs } = target;
  const moleWalkable = (point: THREE.Vector3) => {
    const radius = 0.5 * WORLD_SCALE;
    const edge = mapHalfSize - radius;
    return (
      turfMap.isLandTileAtPoint(point) &&
      Math.abs(point.x) <= edge &&
      Math.abs(point.z) <= edge &&
      !getRegisteredPhysicsBodies(world).some(
        body =>
          body.type === CANNON.Body.STATIC &&
          body.collisionResponse &&
          body.shapes.some(
            shape => shape instanceof CANNON.Box || shape instanceof CANNON.Sphere || shape instanceof CANNON.Trimesh,
          ) &&
          (() => {
            body.updateAABB();
            const b = body.aabb;
            return (
              point.x >= b.lowerBound.x - radius &&
              point.x <= b.upperBound.x + radius &&
              point.z >= b.lowerBound.z - radius &&
              point.z <= b.upperBound.z + radius
            );
          })(),
      )
    );
  };
  const habitat = createMoleHabitat({
    handEquipment: inventory.handEquipment,
    itemSpecs: SAVE_CATALOG.items,
    getWatchWorldContent: worldState.getWatchWorldContent,
    cameraHeading: view.cameraHeading,
    isWalkable: moleWalkable,
    pathfinder,
    spawnItem: state => {
      const entity = inventory.entities.create(state);
      inventory.configureItem(entity);
      return entity;
    },
    restoreItem: record => {
      const entity = inventory.entities.restore(record);
      inventory.configureItem(entity);
      return entity;
    },
    dropItem: (entity, position) => inventory.DropItem(entity, position),
    // The spawned mole is set down where it comes out, as SpawnPrefab and Transform:SetPosition do.
    showMole: (entity, position) => {
      entity.setPosition(position.x, 0, position.z);
    },
    dropLoot: (itemId, position) => {
      groundItems.flingLoot([{ ...SAVE_CATALOG.items[itemId], itemId, count: 1 }], position);
    },
    spawnPrefab: (prefab, position) => prefabs.spawnAs(MolehillInstance, prefab, position),
    fx: worldFx,
  });
  registerPrefabFamily(target, molehillRegistration, habitat);
  return habitat;
}

/** lightflier_flower on the shared manager, and the lightfliers' world: their formations and SpawnPrefab("lightflier"). */
export function registerLightFlierFlowers(
  target: ScenePrefabTarget,
  {
    worldState,
    inventory,
    worldFx,
    groundItems,
    view,
    player,
    playerInstance,
    playerStats,
    dstLighting,
  }: ScenePrefabInputs<
    | 'worldState'
    | 'inventory'
    | 'worldFx'
    | 'groundItems'
    | 'view'
    | 'player'
    | 'playerInstance'
    | 'playerStats'
    | 'dstLighting'
  >,
  retain: (dispose: () => void) => void,
) {
  const { prefabs } = target;
  const lightFlierPlayer = {
    position: player.position,
    isValid: () => !playerStats.health.IsDead(),
    hasLightFlier: () => inventory.Has('lightflier'),
    getFacing: () => playerInstance.worldHeading,
    getWalkSpeed: () => 4 * WORLD_SCALE,
    wantsToMove: () => playerInstance.wantsToMoveForward,
  };
  const dropLoot = (itemId: string, count: number, position: THREE.Vector3) => {
    groundItems.flingLoot([{ ...SAVE_CATALOG.items[itemId], itemId, count }], position);
  };
  const habitat = new LightFlierHabitat({
    maxMovementStep: MAX_PHYSICS_FRAME_TIME,
    scheduler: worldState.scheduler,
    getWatchWorldContent: worldState.getWatchWorldContent,
    tickingarea: worldState.tickingarea,
    cameraHeading: view.cameraHeading,
    getPlayers: () => [lightFlierPlayer],
    fx: worldFx,
    spawnItem: state => {
      const entity = inventory.entities.create(state);
      inventory.configureItem(entity);
      return entity;
    },
    dropLoot,
    getHomes: () =>
      prefabs.instances(LIGHTFLIER_FLOWER_ID) as Iterable<
        import('@dontstarve-web/prefab/lightflier_flower').LightFlierFlowerInstance
      >,
  });
  // The formation leaders move every frame after physics.
  const stopFormations = worldState.componentUpdates.register({ OnUpdate: dt => habitat.update(dt) });
  retain(() => {
    stopFormations();
    habitat.dispose();
  });
  registerPrefabFamily(target, lightflierFlowerRegistration, {
    scheduler: worldState.scheduler,
    habitat,
    dropLoot,
    getWatchWorldContent: worldState.getWatchWorldContent,
    getLightLevel: model => dstLighting.sampleLightLevel(model.position, model),
  });
  return habitat;
}

export function registerBeeQueenHives(
  target: ScenePrefabTarget,
  { worldState, inventory }: ScenePrefabInputs<'worldState' | 'inventory'>,
) {
  registerPrefabFamily(target, beeQueenHiveRegistration, {
    handEquipment: inventory.handEquipment,
    scheduler: worldState.scheduler,
  });
}

export function registerDragonflies(target: ScenePrefabTarget, { worldState }: ScenePrefabInputs<'worldState'>) {
  registerPrefabFamily(target, dragonflyRegistration, {
    scheduler: worldState.scheduler,
    getWatchWorldContent: worldState.getWatchWorldContent,
  });
}

export function registerDragonflySpawners(
  target: ScenePrefabTarget,
  { worldState, turfMap }: ScenePrefabInputs<'worldState' | 'turfMap'>,
) {
  const { prefabs } = target;
  registerPrefabFamily(target, dragonflySpawnerRegistration, {
    scheduler: worldState.scheduler,
    spawnDragonfly: position => prefabs.spawn(DRAGONFLY_ID, position).transform.model,
    // childspawner SpawnChild's FindWalkableOffset: Map:IsAboveGroundAtPoint, a land tile.
    isPassable: position => turfMap.isLandTileAtPoint(position),
  });
}

export function registerBeefalos(
  target: ScenePrefabTarget,
  {
    worldState,
    world,
    inventory,
    groundItems,
    mapHalfSize,
    turfMap,
    pathfinder,
    player,
  }: ScenePrefabInputs<
    'worldState' | 'world' | 'inventory' | 'groundItems' | 'mapHalfSize' | 'turfMap' | 'pathfinder' | 'player'
  >,
) {
  const { prefabs, registry } = target;
  // Colliders only change between frames, so one frame's wander and path queries share an obstacle grid.
  let planningAt: number | undefined;
  let planningObstacles: ((point: THREE.Vector3) => boolean) | undefined;
  const beefaloWorld: BeefaloWorld = {
    scheduler: worldState.scheduler,
    componentUpdates: worldState.componentUpdates,
    // The scheduler runs on world seconds (src/scene.ts), so the next boundary is the next multiple of the day length.
    secondsUntilNextDay: now => TUNING.TOTAL_DAY_TIME - (now % TUNING.TOTAL_DAY_TIME),
    clock: worldState.clock,
    getWatchWorldContent: worldState.getWatchWorldContent,
    pathfinder,
    isWalkable(point) {
      const radius = BEEFALO_BEHAVIOR.radius;
      const edge = mapHalfSize - radius;
      const now = beefaloWorld.scheduler.now;
      if (planningAt !== now || !planningObstacles) {
        planningAt = now;
        planningObstacles = staticObstacleTest(getRegisteredPhysicsBodies(world), radius);
      }
      return (
        Math.abs(point.x) <= edge &&
        Math.abs(point.z) <= edge &&
        turfMap.isLandTileAtPoint(point) &&
        !planningObstacles(point)
      );
    },
    constrainPosition(position) {
      const edge = mapHalfSize - BEEFALO_BEHAVIOR.radius;
      position.x = THREE.MathUtils.clamp(position.x, -edge, edge);
      position.z = THREE.MathUtils.clamp(position.z, -edge, edge);
    },
    spawnPrize(prefab, count, position) {
      groundItems.flingLoot([{ ...SAVE_CATALOG.items[prefab], itemId: prefab, count }], position);
    },
    *getPoopPositions() {
      for (const poop of prefabs.instances('poop')) {
        if (!poop.inlimbo) {
          yield poop.position;
        }
      }
    },
    // SpawnPrefab("poop") and Transform:SetPosition.
    spawnPoop(position) {
      inventory.entities.create({ itemId: 'poop', count: 1 }).setPosition(position.x, 0, position.z);
    },
  };
  prefabs.register(beefaloRegistration.create(beefaloWorld));
  registry.register(PREFAB_DEFINITIONS.beefalos, {
    restore: (id, record) => prefabs.restore(id, record),
    debugSpawn: id => prefabs.spawn(id, findBeefaloSpawnPoint(world, beefaloWorld, player.position)),
    exportRecords: () => [],
    dispose: () => {},
  });
}

export function registerLightningGoats(
  target: ScenePrefabTarget,
  {
    worldState,
    world,
    groundItems,
    mapHalfSize,
    turfMap,
    pathfinder,
    player,
  }: ScenePrefabInputs<'worldState' | 'world' | 'groundItems' | 'mapHalfSize' | 'turfMap' | 'pathfinder' | 'player'>,
) {
  const { prefabs, registry } = target;
  // Colliders only change between frames, so one frame's wander and path queries share an obstacle grid.
  let planningAt: number | undefined;
  let planningObstacles: ((point: THREE.Vector3) => boolean) | undefined;
  const edge = mapHalfSize - LIGHTNING_GOAT_RADIUS;
  const goatWorld: LightningGoatWorld = {
    scheduler: worldState.scheduler,
    componentUpdates: worldState.componentUpdates,
    // The scheduler runs on world seconds (src/scene.ts), so the next boundary is the next multiple of the day length.
    secondsUntilNextDay: now => TUNING.TOTAL_DAY_TIME - (now % TUNING.TOTAL_DAY_TIME),
    clock: worldState.clock,
    getWatchWorldContent: worldState.getWatchWorldContent,
    pathfinder,
    isWalkable(point) {
      const now = goatWorld.scheduler.now;
      if (planningAt !== now || !planningObstacles) {
        planningAt = now;
        planningObstacles = staticObstacleTest(getRegisteredPhysicsBodies(world), LIGHTNING_GOAT_RADIUS);
      }
      return (
        Math.abs(point.x) <= edge &&
        Math.abs(point.z) <= edge &&
        turfMap.isLandTileAtPoint(point) &&
        !planningObstacles(point)
      );
    },
    constrainPosition(position) {
      position.x = THREE.MathUtils.clamp(position.x, -edge, edge);
      position.z = THREE.MathUtils.clamp(position.z, -edge, edge);
    },
    spawnLoot(prefab, position) {
      groundItems.flingLoot(
        [{ ...SAVE_CATALOG.items[prefab], itemId: prefab, count: 1 }],
        new THREE.Vector3(position.x, position.y, position.z),
      );
      return undefined;
    },
  };
  prefabs.register(lightningGoatRegistration.create(goatWorld));
  registry.register(PREFAB_DEFINITIONS.lightningGoats, {
    restore: (id, record) => prefabs.restore(id, record),
    // The same clear ring search as c_spawn("beefalo"), for a goat-sized collider.
    debugSpawn: id => prefabs.spawn(id, findBeefaloSpawnPoint(world, goatWorld, player.position)),
    exportRecords: () => [],
    dispose: () => {},
  });
}

export function registerStagehand(
  target: ScenePrefabTarget,
  {
    worldState,
    world,
    worldFx,
    prefabFire,
    groundItems,
    pathfinder,
    dstLighting,
  }: ScenePrefabInputs<
    'worldState' | 'world' | 'worldFx' | 'prefabFire' | 'groundItems' | 'pathfinder' | 'dstLighting'
  >,
) {
  registerPrefabFamily(target, stagehandRegistration, {
    scheduler: worldState.scheduler,
    componentUpdates: worldState.componentUpdates,
    fire: prefabFire,
    fx: worldFx,
    physics: world,
    pathfinder,
    getWatchWorldContent: worldState.getWatchWorldContent,
    getLightLevel: position => dstLighting.sampleLightLevel(position),
    spawnLoot(id, position) {
      const item = SAVE_CATALOG.items[id];
      if (item) {
        groundItems.flingLoot([{ ...item, itemId: id, count: 1 }], position);
      }
      return undefined;
    },
  });
}

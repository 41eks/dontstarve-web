import type { ItemEntityRegistry } from '@dontstarve-web/inventory';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';

import { turfMap, moonTreeForest } from './building';
import { WORLD_TILES } from '@dontstarve-web/prefab/turfMap';
import { camera } from './camera';
import { GroundItemManager, type GroundItemDefinition } from './groundItems';
import { FarmPlowPlacement, FARM_PLOW_ID, FARM_DECOR_IDS } from '@dontstarve-web/prefab/farm_plow';
import { playerStats } from './playerStats';
import { DwarfStarManager, DWARF_STAR_ID, POLAR_LIGHT_ID } from '@dontstarve-web/prefab/stafflight';
import { BulbPlantManager } from '@dontstarve-web/prefab/bulb_plant';
import { RockManager } from '@dontstarve-web/prefab/rocks';
import { GrassManager, GRASS_ID } from '@dontstarve-web/prefab/grass';
import { SaplingManager } from '@dontstarve-web/prefab/sapling';
import { PondManager, POND_ID } from '@dontstarve-web/prefab/pond';
import { WormholeManager, WORMHOLE_ID } from '@dontstarve-web/prefab/wormhole';
import { PortalManager, PORTAL_ID } from '@dontstarve-web/prefab/portal';
import { NightmareGrowthManager, NIGHTMAREGROWTH_ID } from '@dontstarve-web/prefab/nightmaregrowth';
import { BeefaloManager, BEEFALO_BEHAVIOR } from '@dontstarve-web/prefab/beefalo';
import { newEntityId } from '@dontstarve-web/prefab/saveRecord';
import { pigKings } from './pigking';
import { player } from './player';
import {
  PlaceableBuildingPlacement,
  type PlaceableBuildingInteractionChange,
  type PlaceableBuildingId,
} from './placeableBuilding';
import { dstLighting, renderer, scene } from './universal';
import type { ButterflyFlower } from '@dontstarve-web/prefab/butterfly';
import { FlowerPlanting } from '@dontstarve-web/prefab/flower';
import { view } from './view';
import { initialSave } from './save/initialSave';
import { ReskinEffects } from '@dontstarve-web/prefab/reskin_tool';
import { SAVE_CATALOG } from './save/catalog';
import { findGroundPath } from '@dontstarve-web/prefab/locomotor';

import { EntityRegistry } from './entityRegistry';
import { PREFAB_DEFINITIONS } from './prefabDefinitions';
import { disposeSprite } from '@dontstarve-web/prefab/disposeSprite';
import type { WorldState } from './worldState';

export function createSceneEntities(
  world: CANNON.World,
  worldState: Pick<WorldState, 'clock' | 'season'>,
  consumeBufferedBuild: (buildingId: PlaceableBuildingId, skinId?: string) => boolean,
  pickupGroundItem: (item: GroundItemDefinition, action: 'pickup' | 'net', sourcePosition: THREE.Vector3) => boolean,
  onBuildingInteraction?: (change: PlaceableBuildingInteractionChange) => void,
  onFlowerPlanted?: () => void,
  itemEntities?: ItemEntityRegistry,
) {
  scene.add(moonTreeForest.group);
  const buildingPlacement = new PlaceableBuildingPlacement(
    { ...view, dropLoot: (items, position) => {
      void groundItems.flingLoot(items.map((item) => ({ ...SAVE_CATALOG.items[item.itemId], ...item })), position)
        .catch((error: unknown) => console.error('Unable to drop building loot', error));
    } },
    consumeBufferedBuild,
    onBuildingInteraction,
  );
  const reskinEffects = new ReskinEffects(scene, `${import.meta.env.BASE_URL}dst/data/anim`);
  const flowerPlanting = new FlowerPlanting(view, `${import.meta.env.BASE_URL}dst/data/anim`, onFlowerPlanted);
  const groundItems = new GroundItemManager(
    scene,
    camera,
    renderer,
    `${import.meta.env.BASE_URL}dst/data/databundles/images.zip`,
    pickupGroundItem,
    `${import.meta.env.BASE_URL}dst/data/anim`,
    player,
    {
      isDay: () => dstLighting.getPhase() === 'day',
      getThreatPositions: () => [player.position],
      getFlowers: () => {
        const flowers: ButterflyFlower[] = [];
        scene.traverse((object) => {
          if (object.userData.tags?.includes('flower')) flowers.push({
            id: object.userData.entityId ?? object.uuid,
            position: object.getWorldPosition(new THREE.Vector3()),
          });
        });
        return flowers;
      },
      constrainPosition: (position) => {
        const edge = initialSave.world.map.generator.options.size / 2 - 0.5;
        position.x = THREE.MathUtils.clamp(position.x, -edge, edge);
        position.z = THREE.MathUtils.clamp(position.z, -edge, edge);
      },
    },
    {
      isNight: () => dstLighting.getPhase() === 'night' || dstLighting.getPhase() === 'full_moon',
      getPlayerPositions: () => [player.position],
    },
    { getSanityPercent: () => playerStats.sanity.percent.peek() },
    itemEntities,
  );
  const dwarfStars = new DwarfStarManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`,
    DWARF_STAR_ID, () => player.position);
  const polarLights = new DwarfStarManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`,
    POLAR_LIGHT_ID, () => player.position);
  const bulbPlants = new BulbPlantManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`, {
    getLightLevel: (model) => dstLighting.sampleLightLevel(model.position, model),
  });
  const rockManager = new RockManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`);
  const grasses = new GrassManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`);
  const saplings = new SaplingManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`);
  const ponds = new PondManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`);
  const wormholes = new WormholeManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`, () => [player.position]);
  const portals = new PortalManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`);
  const nightmareGrowths = new NightmareGrowthManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`);
  const pendingPoop = new Set<THREE.Vector3>();
  const beefalos = new BeefaloManager(scene, world, `${import.meta.env.BASE_URL}dst/data/anim`, {
    clock: worldState.clock,
    season: worldState.season,
    getPlayerPositions: () => [player.position],
    findPath(start, target) {
      const radius = BEEFALO_BEHAVIOR.radius;
      const edge = initialSave.world.map.generator.options.size / 2 - radius;
      const obstacles = world.bodies.filter((body) => body.type === CANNON.Body.STATIC && body.collisionResponse
        && body.shapes.some((shape) => shape instanceof CANNON.Box || shape instanceof CANNON.Sphere))
        .map((body) => { body.updateAABB(); return body.aabb; });
      return findGroundPath(start, target, { cellSize: radius,
        isWalkable: (point) => Math.abs(point.x) <= edge && Math.abs(point.z) <= edge
          && !obstacles.some((box) => point.x >= box.lowerBound.x - radius && point.x <= box.upperBound.x + radius
            && point.z >= box.lowerBound.z - radius && point.z <= box.upperBound.z + radius),
      });
    },
    constrainPosition(position) {
      const edge = initialSave.world.map.generator.options.size / 2 - BEEFALO_BEHAVIOR.radius;
      position.x = THREE.MathUtils.clamp(position.x, -edge, edge);
      position.z = THREE.MathUtils.clamp(position.z, -edge, edge);
    },
    spawnPoop(position) {
      const positions = [...pendingPoop, ...groundItems.exportRecords()
        .filter((record) => record.components.stack?.itemId === 'poop')
        .map((record) => new THREE.Vector3(...record.transform.position))];
      if (positions.some((point) => point.distanceToSquared(position) < BEEFALO_BEHAVIOR.poopSpacing ** 2)
        || positions.filter((point) => point.distanceToSquared(position) <= BEEFALO_BEHAVIOR.poopDensityRadius ** 2).length >= 2) return;
      pendingPoop.add(position);
      void groundItems.spawnFromSave(newEntityId(), {
        ...SAVE_CATALOG.items.poop, itemId: 'poop', count: 1,
      }, position).catch((error: unknown) => console.error('Unable to spawn beefalo manure', error))
        .finally(() => pendingPoop.delete(position));
    },
  });
  const registry = new EntityRegistry();
  const farmPlow = new FarmPlowPlacement(view, turfMap, `${import.meta.env.BASE_URL}dst/data`,
    async (position, item) => { await groundItems.spawnFromSave(item.entityId ?? newEntityId(), {
      ...SAVE_CATALOG.items[item.itemId], ...item,
    }, position); },
    () => {
      const blockers = registry.renderEntities.filter(({ object }) =>
        object.userData.prefab !== FARM_PLOW_ID && !FARM_DECOR_IDS.includes(object.userData.prefab))
        .map(({ object, footPosition }) => ({ position: footPosition, tags: object.userData.tags as string[] | undefined }));
      // The complete forest blocks tiles, including trees outside the visual loading radius.
      for (const tree of moonTreeForest.entities) blockers.push({ position: tree.position, tags: undefined });
      return blockers;
    });
  farmPlow.setDebrisLootHandler((itemId, position) => groundItems.flingLoot([
    { ...SAVE_CATALOG.items[itemId], itemId, count: 1 },
  ], position));
  registry.register(PREFAB_DEFINITIONS.farmPlow, {
    restore: (_, record) => farmPlow.spawn(new THREE.Vector3(...record.transform.position), {
      id: record.id, state: record.components.farmPlow!,
    }),
    debugSpawn: () => farmPlow.spawn(player.position.clone()),
    exportRecords: () => farmPlow.exportRecords().map((record) => ({ prefabId: FARM_PLOW_ID, record })),
    update: (dt, quaternion) => farmPlow.update(dt, quaternion),
    renderEntities: () => farmPlow.renderEntities,
    dispose: () => farmPlow.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.farmDecor, {
    restore: (id, record) => farmPlow.spawnDecor(id, new THREE.Vector3(...record.transform.position),
      id === 'farm_soil' ? record.components.farmSoil : record.components.farmDebris, undefined, record.id),
    debugSpawn: (id) => farmPlow.spawnDecor(id, player.position.clone()),
    exportRecords: () => farmPlow.exportDecorRecords(), dispose: () => {},
  });
  registry.register(PREFAB_DEFINITIONS.plantedSeeds, {
    restore: (_, record) => farmPlow.spawnPlantedSeed(new THREE.Vector3(...record.transform.position), record.id),
    debugSpawn: () => farmPlow.spawnPlantedSeed(player.position.clone()),
    exportRecords: () => farmPlow.exportPlantedSeedRecords(), dispose: () => {},
  });
  const treesById = new Map(moonTreeForest.entities.map((entity) => [entity.saveId!, entity]));
  registry.register(PREFAB_DEFINITIONS.moonTrees, {
    restore: (_, record) => {
      const tree = treesById.get(record.id);
      if (!tree) throw new Error(`Missing logical tree: ${record.id}`);
      return tree;
    },
    exportRecords: () => moonTreeForest.entities.map((entity) => ({ prefabId: 'moon_tree', record: {
      id: entity.saveId!, transform: { position: entity.position.toArray(), rotationY: 0 }, components: {},
    } })),
    update: (dt, quaternion) => {
      moonTreeForest.updateNearby(player.position);
      moonTreeForest.update(dt);
      moonTreeForest.setNormals(quaternion);
    },
    renderEntities: () => Array.from(moonTreeForest.activeEntities, (entity) => ({
      object: entity.model!, footPosition: entity.position, cameraDepth: 0,
    })),
    dispose: () => moonTreeForest.dispose(),
  });
  const kingsById = new Map(pigKings.map((king) => [king.record.id, king]));
  const removeKingInteractions = pigKings.map((king) => {
    world.addBody(king.body);
    scene.add(king.setPiece.group);
    king.setPiece.turf.visible = false;
    for (const tile of king.setPiece.tiles) turfMap.setOriginalTile(tile.position, WORLD_TILES.WOODFLOOR);
    return king.setupInteraction(view);
  });
  registry.register(PREFAB_DEFINITIONS.pigKings, {
    restore: (_, record) => {
      const king = kingsById.get(record.id);
      if (!king) throw new Error(`Missing pig king: ${record.id}`);
      return king.standee;
    },
    exportRecords: () => pigKings.map((king) => ({ prefabId: 'pigking', record: {
      id: king.record.id,
      transform: { position: [king.standee.position.x, 0, king.standee.position.z] as const, rotationY: 0 }, components: {},
    } })),
    beforePhysics: (dt) => pigKings.forEach((king) => king.update(dt)),
    update: (_, quaternion) => pigKings.forEach((king) => king.setNormal(quaternion)),
    renderEntities: () => pigKings.map((king) => ({
      object: king.standee, footPosition: king.setPiece.footPosition, cameraDepth: 0,
    })),
    dispose: () => {
      removeKingInteractions.forEach((remove) => remove());
      for (const king of pigKings) { world.removeBody(king.body); disposeSprite(king.setPiece.group); }
    },
  });
  registry.register(PREFAB_DEFINITIONS.buildings, {
    restore: (id, record) => buildingPlacement.spawnFromSave(id, record),
    debugSpawn: (id) => buildingPlacement.spawn(id),
    exportRecords: () => buildingPlacement.exportRecords(),
    update: (dt) => buildingPlacement.update(dt),
    renderEntities: () => buildingPlacement.renderEntities,
    dispose: () => buildingPlacement.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.groundItems, {
    restore: (_, record) => {
      const item = record.components.stack!;
      const spec = SAVE_CATALOG.items[item.itemId];
      const skin = item.skinId ? SAVE_CATALOG.skins[item.skinId] : undefined;
      return groundItems.spawnFromSave(record.id, {
        ...item, name: skin?.name ?? spec.name, icon: skin?.icon ?? spec.icon, atlas: skin?.atlas ?? spec.atlas,
        ...(record.components.phonograph ? { playbackRemaining: record.components.phonograph.remainingSeconds } : {}),
        ...(record.components.torch ? { torchLit: true } : {}),
      }, new THREE.Vector3(...record.transform.position));
    },
    debugSpawn: (id) => groundItems.spawnFromSave(newEntityId(), {
      ...SAVE_CATALOG.items[id], itemId: id, count: 1,
    }, player.position.clone().setY(0)),
    exportRecords: () => groundItems.exportRecords().map((record) => ({ prefabId: 'ground_item', record })),
    update: (dt, quaternion) => groundItems.update(dt, quaternion),
    renderEntities: () => groundItems.renderEntities,
    dispose: () => groundItems.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.flowers, {
    restore: (_, record) => flowerPlanting.spawnFromSave(record.id,
      record.components.flower!.animation, new THREE.Vector3(...record.transform.position)),
    exportRecords: () => flowerPlanting.exportRecords().map((record) => ({ prefabId: 'flower', record })),
    update: (_, quaternion) => flowerPlanting.update(quaternion),
    renderEntities: () => flowerPlanting.renderEntities,
    dispose: () => flowerPlanting.dispose(),
  });
  for (const [definition, lights] of [[PREFAB_DEFINITIONS.dwarfStars, dwarfStars], [PREFAB_DEFINITIONS.polarLights, polarLights]] as const) registry.register(definition, {
    restore: (_, record) => lights.spawn(new THREE.Vector3(...record.transform.position), {
      id: record.id, remainingSeconds: record.components.timer!.remainingSeconds,
    }),
    exportRecords: () => lights.exportRecords().map((record) => ({ prefabId: definition.prefabIds[0], record })),
    update: (dt, quaternion) => lights.update(dt, quaternion),
    renderEntities: () => lights.renderEntities,
    dispose: () => lights.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.bulbPlants, {
    restore: (id, record) => bulbPlants.spawn(id, new THREE.Vector3(...record.transform.position), {
      id: record.id, transform: record.transform, components: { bulbPlant: record.components.bulbPlant! },
    }),
    debugSpawn: (id) => bulbPlants.spawn(id, player.position.clone()),
    exportRecords: () => bulbPlants.exportRecords(),
    update: (dt, quaternion) => bulbPlants.update(dt, quaternion),
    renderEntities: () => bulbPlants.renderEntities,
    dispose: () => bulbPlants.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.beefalos, {
    restore: (_, record) => beefalos.spawn(new THREE.Vector3(...record.transform.position), {
      id: record.id, transform: record.transform, components: { beefalo: record.components.beefalo! },
    }),
    debugSpawn: () => beefalos.spawnNear(player.position),
    exportRecords: () => beefalos.exportRecords().map((record) => ({ prefabId: 'beefalo', record })),
    beforePhysics: (dt) => beefalos.update(dt),
    update: (_, quaternion) => beefalos.sync(quaternion),
    renderEntities: () => beefalos.renderEntities,
    dispose: () => beefalos.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.rocks, {
    restore: (id, record) => rockManager.spawn(id, new THREE.Vector3(...record.transform.position), {
      id: record.id, transform: record.transform, components: {},
    }),
    debugSpawn: (id) => rockManager.spawn(id, player.position.clone()),
    exportRecords: () => rockManager.exportRecords(),
    update: (dt, quaternion) => rockManager.update(dt, quaternion),
    renderEntities: () => rockManager.renderEntities,
    dispose: () => rockManager.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.grasses, {
    restore: (_, record) => grasses.spawn(new THREE.Vector3(...record.transform.position), {
      id: record.id, transform: record.transform, components: {},
    }),
    debugSpawn: () => grasses.spawn(player.position.clone()),
    exportRecords: () => grasses.exportRecords().map((record) => ({ prefabId: GRASS_ID, record })),
    update: (dt, quaternion) => grasses.update(dt, quaternion),
    renderEntities: () => grasses.renderEntities,
    dispose: () => grasses.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.saplings, {
    restore: (id, record) => saplings.spawn(id, new THREE.Vector3(...record.transform.position), {
      id: record.id, transform: record.transform, components: {},
    }),
    debugSpawn: (id) => saplings.spawn(id, player.position.clone()),
    exportRecords: () => saplings.exportRecords(),
    update: (dt, quaternion) => saplings.update(dt, quaternion),
    renderEntities: () => saplings.renderEntities,
    dispose: () => saplings.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.ponds, {
    restore: (_, record) => ponds.spawn(new THREE.Vector3(...record.transform.position), {
      id: record.id, transform: record.transform, components: {},
    }),
    debugSpawn: () => ponds.spawn(player.position.clone()),
    exportRecords: () => ponds.exportRecords().map((record) => ({ prefabId: POND_ID, record })),
    update: (dt) => ponds.update(dt),
    // Ponds are ground layers, below the foot-sorted billboards.
    dispose: () => ponds.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.nightmareGrowths, {
    restore: (_, record) => nightmareGrowths.spawn(new THREE.Vector3(...record.transform.position), {
      id: record.id, transform: record.transform, components: { nightmareGrowth: record.components.nightmareGrowth! },
    }),
    debugSpawn: () => nightmareGrowths.spawn(player.position.clone()),
    exportRecords: () => nightmareGrowths.exportRecords().map((record) => ({ prefabId: NIGHTMAREGROWTH_ID, record })),
    update: (_, quaternion) => nightmareGrowths.update(quaternion),
    renderEntities: () => nightmareGrowths.renderEntities,
    dispose: () => nightmareGrowths.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.wormholes, {
    restore: (_, record) => wormholes.spawn(new THREE.Vector3(...record.transform.position), {
      id: record.id, transform: record.transform, components: { wormhole: record.components.wormhole },
    }),
    debugSpawn: () => wormholes.spawn(player.position.clone()),
    exportRecords: () => wormholes.exportRecords().map((record) => ({ prefabId: WORMHOLE_ID, record })),
    update: (dt, quaternion) => wormholes.update(dt, quaternion),
    renderEntities: () => wormholes.renderEntities,
    dispose: () => wormholes.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.portals, {
    restore: (_, record) => portals.spawn(new THREE.Vector3(...record.transform.position), {
      id: record.id, transform: record.transform, components: {},
    }),
    debugSpawn: () => portals.spawn(player.position.clone()),
    exportRecords: () => portals.exportRecords().map((record) => ({ prefabId: PORTAL_ID, record })),
    update: (dt, quaternion) => portals.update(dt, quaternion),
    renderEntities: () => portals.renderEntities,
    dispose: () => portals.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.reskinEffects, {
    exportRecords: () => [],
    update: (dt, quaternion) => reskinEffects.update(dt, quaternion),
    renderEntities: () => reskinEffects.renderEntities,
    dispose: () => reskinEffects.dispose(),
  });
  registry.assertDefinitions(Object.values(PREFAB_DEFINITIONS));
  return { registry, buildingPlacement, groundItems, dwarfStars, polarLights, flowerPlanting, bulbPlants,
    beefalos, rockManager, grasses, saplings, ponds, wormholes, portals, nightmareGrowths, reskinEffects, farmPlow };
}

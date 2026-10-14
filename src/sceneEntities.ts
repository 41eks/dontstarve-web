import { MolehillManager, type MolehillRecord } from '../packages/prefab/src/molehill';
import { MoleBait } from '../packages/prefab/src/molebait';
import { TUNING } from './tuning';
import { DynamicMusic } from '../packages/componets/src/dynamicmusic';
import { GetTemperatureAtXZ } from '../packages/componets/src/temperatureoverrider';
import { FindEntities } from '../packages/prefab/src/actionEntity';
import type { TemperatureSource } from '../packages/componets/src/temperature';
import { PlaySound } from '@dontstarve-web/prefab/sound';
import type { ItemEntityRegistry, InventoryStore } from '@dontstarve-web/inventory';
import { createInventoryStore } from './inventory';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';

import { turfMap, moonTreeForest } from './building';
import { WORLD_TILES } from '@dontstarve-web/prefab/turfMap';
import { placeStaticLayout } from '@dontstarve-web/prefab/staticLayout';
import { camera, followCamera } from './camera';
import { GroundItemManager } from './groundItems';
import { turfItemForTile } from '@dontstarve-web/prefab/turfs';
import { GROUND_ITEM_DISPLAY_SPECS } from '@dontstarve-web/prefab/groundItems';
import { DockKitPlacement } from '@dontstarve-web/prefab/dock_kit';
import { FarmPlowPlacement, FARM_PLOW_ID, FARM_DECOR_IDS } from '@dontstarve-web/prefab/farm_plow';
import { playerStats } from './playerStats';
import { DwarfStarManager, DWARF_STAR_ID, POLAR_LIGHT_ID } from '@dontstarve-web/prefab/stafflight';
import { BulbPlantManager } from '@dontstarve-web/prefab/bulb_plant';
import { RockManager } from '@dontstarve-web/prefab/rocks';
import { RockAvocadoSaplingManager, ROCK_AVOCADO_SAPLING_ID } from '@dontstarve-web/prefab/rock_avocado_fruit_sprout_sapling';
import { RockAvocadoBushManager, ROCK_AVOCADO_BUSH_ID } from '@dontstarve-web/prefab/rock_avocado_bush';
import { BerrybushManager, BERRYBUSH_ID } from '@dontstarve-web/prefab/berrybush';
import { MonkeytailManager, MONKEYTAIL_ID } from '@dontstarve-web/prefab/monkeytail';
import { GrassManager, GRASS_ID } from '@dontstarve-web/prefab/grass';
import { GameTimeScheduler } from '@dontstarve-web/prefab/gameTimeScheduler';
import { WorldWind } from '../packages/componets/src/worldwind';
import { TumbleweedManager, TUMBLEWEED_ID } from '@dontstarve-web/prefab/tumbleweed';
import { SaplingManager } from '@dontstarve-web/prefab/sapling';
import { PondManager, POND_ID } from '@dontstarve-web/prefab/pond';
import { HotspringManager } from '@dontstarve-web/prefab/hotspring';
import { LavaPondManager, LAVA_POND_ID } from '@dontstarve-web/prefab/lava_pond';
import { WormholeManager, WORMHOLE_ID } from '@dontstarve-web/prefab/wormhole';
import { PortalManager, PORTAL_ID } from '@dontstarve-web/prefab/portal';
import { NightmareGrowthManager, NIGHTMAREGROWTH_ID } from '@dontstarve-web/prefab/nightmaregrowth';
import { NightmareRockManager } from '@dontstarve-web/prefab/nightmarerock';
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
import { RainEffect } from '@dontstarve-web/prefab/rain';
import { SnowEffect } from '@dontstarve-web/prefab/snow';
import { WorldFx } from '@dontstarve-web/prefab/world_fx';
import { OceanWaves } from '@dontstarve-web/prefab/ocean_waves';
import { WaveManager, type WaveMap } from '../packages/componets/src/wavemanager';
import { WORLD_SCALE } from '../packages/prefab/src/standardcomponents';
import { TILE_SIZE } from '../packages/prefab/src/tile';
import { SAVE_CATALOG } from './save/catalog';
import { findGroundPath } from '@dontstarve-web/prefab/locomotor';
import { createDeciduousForest, type DeciduousSpawnId } from '@dontstarve-web/prefab/deciduoustrees';
import { createEvergreenForest, type EvergreenSpawnId } from '@dontstarve-web/prefab/evergreens';

import { EntityRegistry } from './entityRegistry';
import { PREFAB_DEFINITIONS } from './prefabDefinitions';
import { disposeSprite } from '@dontstarve-web/prefab/disposeSprite';
import type { WorldState } from './worldState';

export async function createSceneEntities(
  world: CANNON.World,
  worldState: Pick<WorldState, 'clock' | 'season' | 'moon' | 'fullMoon' | 'isNight' | 'cycle' | 'getWatchWorldContent' | 'scheduler' | 'temperature' | 'weather' | 'perishClock'>,
  consumeBufferedBuild: (buildingId: PlaceableBuildingId, skinId?: string) => boolean,
  onBuildingInteraction?: (change: PlaceableBuildingInteractionChange) => void,
  onFlowerPlanted?: () => void,
  itemEntities?: ItemEntityRegistry,
  inventory?: InventoryStore,
  scheduler?: GameTimeScheduler,
) {
  const sceneInventory = inventory ?? createInventoryStore();
  sceneInventory.entities.bindPerishWorld({ perishClock: worldState.perishClock });
  sceneInventory.entities.bindTemperatureWorld({
    temperature: worldState.temperature, clock: worldState.clock, unitScale: WORLD_SCALE,
    findHeaters: (position, radius, ignoredTags) => FindEntities(scene, position, radius, ['HASHEATER'], ignoredTags) as TemperatureSource[],
  });
  const dynamicMusic = scheduler ? new DynamicMusic(scheduler, path => PlaySound(path)) : undefined;
  scene.add(moonTreeForest.group);
  const buildingPlacement = new PlaceableBuildingPlacement(
    { ...view, physics: world, scheduler, season: worldState.season, dynamicMusic, fullMoon: worldState.fullMoon,
      moon: worldState.moon,
      getLocalTemperature: (x, z) => GetTemperatureAtXZ(() => worldState.temperature.peek(), x, z), itemEntities: sceneInventory.entities,
      cycle: worldState.cycle, getWatchWorldContent: worldState.getWatchWorldContent, isNight: worldState.isNight, perishClock: worldState.perishClock,
      spawnItem: state => { const entity = sceneInventory.entities.create(state); sceneInventory.configureItem(entity); return entity; },
      dropItem: (entity, position) => { sceneInventory.DropItem(entity, position); },
      registerContainer: (id, container, saved) => sceneInventory.registerContainer(id, container, saved),
      unregisterContainer: (id, container) => sceneInventory.unregisterContainer(id, container), dropLoot: (items, position, launch) => {
      void groundItems.flingLoot(items.map((item) => ({ ...SAVE_CATALOG.items[item.itemId], ...item })), position, launch)
        .catch((error: unknown) => console.error('Unable to drop building loot', error));
    } },
    consumeBufferedBuild,
    onBuildingInteraction,
  );
  const reskinEffects = new ReskinEffects(scene, `${import.meta.env.BASE_URL}dst/data/anim`);
  const flowerPlanting = new FlowerPlanting(view, `${import.meta.env.BASE_URL}dst/data/anim`, onFlowerPlanted, Math.random, {
    forest: moonTreeForest,
    canPlant: position => turfMap.canPlant(position) || turfMap.getTileAtWorld(position) === WORLD_TILES.GRASS,
    getBlockers: () => registry.renderEntities.filter(({ object }) => !object.userData.placer)
      .map(({ object, footPosition }) => ({ position: footPosition,
        tags: object.userData.tags,
        inventoryRadius: object.userData.itemId ? object.userData.physicsRadius ?? .5 : undefined,
        smartRadius: object.userData.deploySmartRadius })),
  }, scheduler ? { scheduler, season: worldState.season, spawnAsh: position => spawnAsh(position) } : undefined);
  const worldFx = new WorldFx(scene, `${import.meta.env.BASE_URL}dst/data/anim`);
  const moleScheduler = scheduler ?? worldState.scheduler;
  const moleBaits = new Map<string, MoleBait>();
  const moleWalkable = (point: THREE.Vector3) => {
    const tile = turfMap.getTileAtWorld(point);
    const radius = .5 * WORLD_SCALE;
    const edge = initialSave.world.map.generator.options.size / 2 - radius;
    return tile !== WORLD_TILES.INVALID && tile !== WORLD_TILES.OCEAN_COASTAL && Math.abs(point.x) <= edge && Math.abs(point.z) <= edge
      && !world.bodies.some(body => body.type === CANNON.Body.STATIC && body.collisionResponse &&
        body.shapes.some(shape => shape instanceof CANNON.Box || shape instanceof CANNON.Sphere) && (() => {
          body.updateAABB(); const b = body.aabb;
          return point.x >= b.lowerBound.x - radius && point.x <= b.upperBound.x + radius && point.z >= b.lowerBound.z - radius && point.z <= b.upperBound.z + radius;
        })());
  };
  const molehills: MolehillManager = new MolehillManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`, {
    itemSpecs: SAVE_CATALOG.items, getWatchWorldContent: worldState.getWatchWorldContent, cameraHeading: view.cameraHeading,
    isWalkable: moleWalkable,
    findPath: (start, target) => findGroundPath(new THREE.Vector3(start.x, start.y, start.z),
      new THREE.Vector3(target.x, target.y, target.z), { cellSize: 1.5, isWalkable: moleWalkable }),
    spawnItem: state => { const entity = sceneInventory.entities.create(state); sceneInventory.configureItem(entity); return entity; },
    dropItem: (entity, position) => sceneInventory.DropItem(entity, position),
    showMole: (entity, position) => { void groundItems.spawnFromSave(entity.id, {
      ...SAVE_CATALOG.items.mole, ...entity.snapshot(), entity,
    }, position).catch((error: unknown) => console.error('Unable to render mole', error)); },
    dropLoot: (itemId, position) => { void groundItems.flingLoot([{ ...SAVE_CATALOG.items[itemId], itemId, count: 1 }], position)
      .catch((error: unknown) => console.error('Unable to drop mole loot', error)); },
    getEntities: () => {
      for (const entity of sceneInventory.entities.values()) if (entity.components.bait && !moleBaits.has(entity.id))
        moleBaits.set(entity.id, new MoleBait(entity, moleScheduler, moleWalkable));
      for (const [id, bait] of moleBaits) if (bait.entity.isRemoved) { bait.dispose(); moleBaits.delete(id); }
      return [...moleBaits.values(), ...molehills.habitat.getMoles(),
        { prefab: 'wilson', components: {}, isValid: () => true, hasTag: (tag: string) => tag === 'scarytoprey',
          getPosition: () => player.position, getPhysicsRadius: () => .5 * WORLD_SCALE }];
    },
  });
  const groundItems = new GroundItemManager(
    scene,
    camera,
    renderer,
    `${import.meta.env.BASE_URL}dst/data/databundles/images.zip`,
    sceneInventory,
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
    scheduler,
    worldState.season,
    worldFx,
    molehills.habitat,
  );
  // DefaultBurntFn: one ash at the burnt inst's position.
  const spawnAsh = (position: THREE.Vector3) => {
    void groundItems.spawnFromSave(newEntityId(), { ...SAVE_CATALOG.items.ash, itemId: 'ash', count: 1 },
      new THREE.Vector3(position.x, 0, position.z))
      .catch((error: unknown) => console.error('Unable to spawn ash', error));
  };
  const dwarfStars = new DwarfStarManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`,
    DWARF_STAR_ID, () => player.position, worldState.season);
  const polarLights = new DwarfStarManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`,
    POLAR_LIGHT_ID, () => player.position);
  const bulbPlants = new BulbPlantManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`, {
    scheduler,
    getLightLevel: (model) => dstLighting.sampleLightLevel(model.position, model),
  });
  const rockManager = new RockManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`, {
    prepareSpawn: (definition, fling) => groundItems.prepareSpawn(definition, fling),
  });
  const rockAvocadoBushes = new RockAvocadoBushManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`, {
    scheduler, season: worldState.season, rain: worldState.weather.preciptype, snowLevel: worldState.weather.snowLevel,
    physics: world, getLocalTemperature: position => GetTemperatureAtXZ(() => worldState.temperature.peek(), position.x, position.z),
    prepareSpawn: (definition, fling) => groundItems.prepareSpawn(definition, fling),
  });
  const rockAvocadoSaplings = new RockAvocadoSaplingManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`, {
    scheduler, season: worldState.season, bushes: rockAvocadoBushes,
    prepareSpawn: definition => groundItems.prepareSpawn(definition),
  });
  const berrybushes = new BerrybushManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`, {
    scheduler, season: worldState.season, rain: worldState.weather.preciptype, snowLevel: worldState.weather.snowLevel,
    physics: world, getLocalTemperature: position => GetTemperatureAtXZ(() => worldState.temperature.peek(), position.x, position.z),
    prepareSpawn: (definition, fling) => groundItems.prepareSpawn(definition, fling),
  });
  const monkeytails = new MonkeytailManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`, {
    scheduler, season: worldState.season, rain: worldState.weather.preciptype,
    getLocalTemperature: position => GetTemperatureAtXZ(() => worldState.temperature.peek(), position.x, position.z),
    prepareSpawn: (definition, fling) => groundItems.prepareSpawn(definition, fling),
  });
  const grasses = new GrassManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`, {
    scheduler, season: worldState.season,
    prepareSpawn: (definition, fling) => groundItems.prepareSpawn(definition, fling),
  });
  const saplings = new SaplingManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`, {
    scheduler, season: worldState.season,
    prepareSpawn: (definition, fling) => groundItems.prepareSpawn(definition, fling),
  });
  const ponds = new PondManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`, worldState.weather.snowLevel);
  const lavaPonds = new LavaPondManager(scene, world, `${import.meta.env.BASE_URL}dst/data/anim`, { scheduler });
  // forest.lua adds worldwind to the world; its change task needs a scheduler even when the caller supplies none.
  const windScheduler = scheduler ?? new GameTimeScheduler();
  const worldWind = new WorldWind(windScheduler);
  const tumbleweeds = new TumbleweedManager(scene, world, `${import.meta.env.BASE_URL}dst/data/anim`, {
    scheduler: windScheduler, wind: worldWind, cameraHeading: view.cameraHeading,
    isOnValidGround: position => { const tile = turfMap.getTileAtWorld(position);
      return tile !== WORLD_TILES.INVALID && tile !== WORLD_TILES.OCEAN_COASTAL; },
    constrainPosition: position => {
      const edge = initialSave.world.map.generator.options.size / 2 - WORLD_SCALE;
      position.x = THREE.MathUtils.clamp(position.x, -edge, edge);
      position.z = THREE.MathUtils.clamp(position.z, -edge, edge);
    },
    dropLoot: (items, position) => {
      // Prefabs this project cannot spawn yet (trinkets, creatures, blueprints) are not dropped.
      const counts = new Map<string, number>();
      for (const itemId of items) if (Object.hasOwn(SAVE_CATALOG.items, itemId)) counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
      if (counts.size === 0) return;
      void groundItems.flingLoot([...counts].map(([itemId, count]) => ({ ...SAVE_CATALOG.items[itemId], itemId, count })), position)
        .catch((error: unknown) => console.error('Unable to drop tumbleweed loot', error));
    },
  });
  const hotsprings = new HotspringManager(scene, world, `${import.meta.env.BASE_URL}dst/data/anim`);
  const wormholes = new WormholeManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`, () => [player.position]);
  const portals = new PortalManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`);
  const nightmareGrowths = new NightmareGrowthManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`);
  const pendingPoop = new Set<THREE.Vector3>();
  const beefalos = new BeefaloManager(scene, world, `${import.meta.env.BASE_URL}dst/data/anim`, {
    scheduler,
    // The scheduler runs on world seconds (src/scene.ts), so the next boundary is the next multiple of the day length.
    secondsUntilNextDay: now => TUNING.TOTAL_DAY_TIME - now % TUNING.TOTAL_DAY_TIME,
    clock: worldState.clock,
    getWatchWorldContent: worldState.getWatchWorldContent,
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
    spawnPrize(prefab, count, position) {
      void groundItems.flingLoot([{ ...SAVE_CATALOG.items[prefab], itemId: prefab, count }], position)
        .catch((error: unknown) => console.error(`Unable to spawn beefalo ${prefab}`, error));
    },
    getPoopPositions() {
      return [...pendingPoop, ...groundItems.exportRecords()
        .filter((record) => record.components.stack?.itemId === 'poop')
        .map((record) => new THREE.Vector3(...record.transform.position))];
    },
    spawnPoop(position) {
      pendingPoop.add(position);
      void groundItems.spawnFromSave(newEntityId(), {
        ...SAVE_CATALOG.items.poop, itemId: 'poop', count: 1,
      }, position).catch((error: unknown) => console.error('Unable to spawn beefalo manure', error))
        .finally(() => pendingPoop.delete(position));
    },
  });
  const registry = new EntityRegistry();
  const evergreenForest = await createEvergreenForest(`${import.meta.env.BASE_URL}dst/data/anim`, {
    camera, scene, scheduler, physics: world, season: worldState.season, spawnAsh,
    growthDuration: seconds => seconds * (worldState.season.peek().season === 'spring' ? .75 : 1),
    dropLoot: (items, position) => {
      void groundItems.flingLoot(items.map(item => ({ ...SAVE_CATALOG.items[item.itemId], ...item })), position)
        .catch((error: unknown) => console.error('Unable to drop evergreen loot', error));
    },
  });
  scene.add(evergreenForest.group);
  const deciduousForest = await createDeciduousForest(`${import.meta.env.BASE_URL}dst/data/anim`, {
    camera, scene, scheduler, physics: world, season: worldState.season, spawnAsh,
    secondsUntilNextDay: now => TUNING.TOTAL_DAY_TIME - now % TUNING.TOTAL_DAY_TIME,
    growthDuration: seconds => seconds * (worldState.season.peek().season === 'spring' ? .75 : 1),
    dropLoot: (items, position) => {
      void groundItems.flingLoot(items.map(item => ({ ...SAVE_CATALOG.items[item.itemId], ...item })), position)
        .catch((error: unknown) => console.error('Unable to drop deciduous tree loot', error));
    },
  });
  scene.add(deciduousForest.group);
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
      for (const tree of deciduousForest.entities) blockers.push({ position: tree.position, tags: undefined });
      for (const tree of evergreenForest.entities) blockers.push({ position: tree.position, tags: undefined });
      return blockers;
    });
  // Docks stand in the water: any registered entity there blocks, trees and grass included.
  const dockKit = new DockKitPlacement(view, turfMap, `${import.meta.env.BASE_URL}dst/data`, () =>
    registry.renderEntities.filter(({ object }) => !object.userData.placer)
      .map(({ object, footPosition }) => ({ position: footPosition, tags: object.userData.tags as string[] | undefined,
        inventoryRadius: object.userData.itemId ? object.userData.physicsRadius ?? .5 : undefined, smartRadius: object.userData.deploySmartRadius })));
  registry.register(PREFAB_DEFINITIONS.dockKit, {
    exportRecords: () => [],
    update: () => dockKit.update(),
    renderEntities: () => dockKit.renderEntities,
    dispose: () => dockKit.dispose(),
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
    restore: (id, record) => farmPlow.spawnPlantedSeed(new THREE.Vector3(...record.transform.position), record.id, id),
    debugSpawn: (id) => farmPlow.spawnPlantedSeed(player.position.clone(), undefined, id),
    exportRecords: () => farmPlow.exportPlantedSeedRecords(), dispose: () => {},
  });
  const treesById = new Map(moonTreeForest.entities.map((entity) => [entity.saveId!, entity]));
  const unbindTrees = moonTreeForest.bindWorld({
    camera,
    scene,
    scheduler,
    season: worldState.season,
    spawnAsh,
    growthDuration: seconds => seconds * (worldState.season.peek().season === 'spring' ? .75 : 1),
    dropLoot: (items, position) => {
      void groundItems.flingLoot(items.map((item) => ({ ...SAVE_CATALOG.items[item.itemId], ...item })), position)
        .catch((error: unknown) => console.error('Unable to drop tree loot', error));
    },
  });
  registry.register(PREFAB_DEFINITIONS.moonTrees, {
    restore: (_, record) => {
      const tree = treesById.get(record.id);
      if (!tree) throw new Error(`Missing logical tree: ${record.id}`);
      moonTreeForest.restoreState(record.id, record.components.moonTree, record.components.growable);
      return tree;
    },
    debugSpawn: async id => {
      moonTreeForest.spawnTree(id as 'moon_tree' | 'moon_tree_short' | 'moon_tree_normal' | 'moon_tree_tall',
        new THREE.Vector3(player.position.x, 0, player.position.z));
    },
    exportRecords: () => moonTreeForest.entities.map((entity) => ({ prefabId: 'moon_tree', record: {
      id: entity.saveId!, transform: { position: entity.position.toArray(), rotationY: 0 },
      components: moonTreeForest.exportState(entity),
    } })),
    update: (dt, quaternion) => {
      moonTreeForest.updateNearby(player.position);
      moonTreeForest.update(dt);
      moonTreeForest.setNormals(quaternion);
    },
    renderEntities: () => moonTreeForest.renderEntities,
    dispose: () => { unbindTrees(); moonTreeForest.dispose(); },
  });
  registry.register(PREFAB_DEFINITIONS.moonTreeSaplings, {
    restore: (_, record) => moonTreeForest.spawnSapling(new THREE.Vector3(...record.transform.position),
      { ...record, components: { saplingTimer: record.components.saplingTimer! } }),
    debugSpawn: async () => { moonTreeForest.spawnSapling(new THREE.Vector3(player.position.x, 0, player.position.z)); },
    exportRecords: () => moonTreeForest.exportSaplings().map(record => ({ prefabId: 'moonbutterfly_sapling', record })),
    dispose() {},
  });
  registry.register(PREFAB_DEFINITIONS.evergreens, {
    restore: (_, record) => evergreenForest.spawn('evergreen', new THREE.Vector3(...record.transform.position),
      { ...record, components: { ...record.components, growable: record.components.growable! } }),
    debugSpawn: async prefab => { evergreenForest.spawn(prefab as EvergreenSpawnId, new THREE.Vector3(player.position.x, 0, player.position.z)); },
    exportRecords: () => evergreenForest.exportRecords().map(record => ({ prefabId: 'evergreen', record })),
    update: (dt, quaternion) => { evergreenForest.updateNearby(player.position); evergreenForest.update(dt, quaternion); },
    renderEntities: () => evergreenForest.renderEntities,
    dispose: () => evergreenForest.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.deciduousTrees, {
    restore: (_, record) => deciduousForest.spawn('deciduoustree', new THREE.Vector3(...record.transform.position),
      { ...record, components: { deciduoustree: record.components.deciduoustree!, growable: record.components.growable! } }),
    debugSpawn: async prefab => { deciduousForest.spawn(prefab as DeciduousSpawnId, new THREE.Vector3(player.position.x, 0, player.position.z)); },
    exportRecords: () => deciduousForest.exportRecords().map(record => ({ prefabId: 'deciduoustree', record })),
    update: (dt, quaternion) => { deciduousForest.updateNearby(player.position); deciduousForest.update(dt, quaternion); },
    renderEntities: () => deciduousForest.renderEntities,
    dispose: () => deciduousForest.dispose(),
  });
  const kingsById = new Map(pigKings.map((king) => [king.record.id, king]));
  pigKings.forEach((king) => {
    world.addBody(king.body);
    scene.add(king.standee);
    // default_pigking.lua BG_TILES: the layout's grass and woodfloor tiles around the king.
    for (const { tile, position } of placeStaticLayout('default_pigking', king.feet, 'pigking').tiles) {
      turfMap.setOriginalTile(position, WORLD_TILES[tile]);
    }
    king.bind({
      camera, scheduler, isNight: worldState.isNight,
      dropLoot: (items, position, launch) => {
        void groundItems.flingLoot(items.map((item) => ({ ...SAVE_CATALOG.items[item.itemId], ...item })), position, launch)
          .catch((error: unknown) => console.error('Unable to drop pig king gold', error));
      },
    });
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
      object: king.standee, footPosition: king.feet, cameraDepth: 0,
    })),
    miniMapEntities: () => pigKings.map(king => king.MiniMapEntity),
    dispose: () => {
      for (const king of pigKings) { king.dispose(); world.removeBody(king.body); disposeSprite(king.standee); }
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
        ...(record.components.lantern ? { lanternOn: record.components.lantern.ison } : {}),
      }, new THREE.Vector3(...record.transform.position));
    },
    debugSpawn: (id) => groundItems.spawnFromSave(newEntityId(), {
      ...SAVE_CATALOG.items[id], itemId: id, count: 1,
    }, player.position.clone().setY(0)),
    exportRecords: () => groundItems.exportRecords().map((record) => ({ prefabId: 'ground_item', record })),
    update: (dt, quaternion) => groundItems.update(dt, quaternion),
    renderEntities: () => groundItems.renderEntities,
    miniMapEntities: () => groundItems.miniMapEntities,
    dispose: () => groundItems.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.flowers, {
    restore: (_, record) => flowerPlanting.spawnFromSave(record.id,
      record.components.flower!.animation, new THREE.Vector3(...record.transform.position)),
    exportRecords: () => flowerPlanting.exportRecords().map((record) => ({ prefabId: 'flower', record })),
    update: (dt, quaternion) => flowerPlanting.update(quaternion, dt),
    renderEntities: () => flowerPlanting.renderEntities,
    dispose: () => flowerPlanting.dispose(),
  });
  for (const [definition, lights] of [[PREFAB_DEFINITIONS.dwarfStars, dwarfStars], [PREFAB_DEFINITIONS.polarLights, polarLights]] as const) registry.register(definition, {
    restore: (_, record) => lights.spawn(new THREE.Vector3(...record.transform.position), {
      id: record.id, remainingSeconds: record.components.timer!.remainingSeconds,
    }),
    debugSpawn: () => lights.spawn(player.position.clone()),
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
  registry.register(PREFAB_DEFINITIONS.molehills, {
    restore: (_, record) => molehills.spawn(new THREE.Vector3(...record.transform.position), record as MolehillRecord),
    debugSpawn: () => molehills.spawn(player.position.clone().setY(0)),
    exportRecords: () => molehills.exportRecords().map(record => ({ prefabId: 'molehill', record })),
    beforePhysics: dt => { if (!scheduler) moleScheduler.advance(dt); },
    update: (dt, quaternion) => molehills.update(dt, quaternion), renderEntities: () => molehills.renderEntities,
    dispose: () => { molehills.dispose(); for (const bait of moleBaits.values()) bait.dispose(); moleBaits.clear(); },
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
  registry.register(PREFAB_DEFINITIONS.rockAvocadoSaplings, {
    restore: (_, record) => rockAvocadoSaplings.spawn(new THREE.Vector3(...record.transform.position), record),
    debugSpawn: () => rockAvocadoSaplings.spawn(player.position.clone()),
    exportRecords: () => rockAvocadoSaplings.exportRecords().map(record => ({ prefabId: ROCK_AVOCADO_SAPLING_ID, record })),
    update: (dt, quaternion) => rockAvocadoSaplings.update(dt, quaternion),
    renderEntities: () => rockAvocadoSaplings.renderEntities,
    dispose: () => rockAvocadoSaplings.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.rockAvocadoBushes, {
    restore: (_, record) => rockAvocadoBushes.spawn(new THREE.Vector3(...record.transform.position), record),
    debugSpawn: () => rockAvocadoBushes.spawn(player.position.clone()),
    exportRecords: () => rockAvocadoBushes.exportRecords().map(record => ({ prefabId: ROCK_AVOCADO_BUSH_ID, record })),
    update: (dt, quaternion) => rockAvocadoBushes.update(dt, quaternion),
    renderEntities: () => rockAvocadoBushes.renderEntities,
    dispose: () => rockAvocadoBushes.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.berrybushes, {
    restore: (_, record) => berrybushes.spawn(new THREE.Vector3(...record.transform.position), record),
    debugSpawn: () => berrybushes.spawn(player.position.clone()),
    exportRecords: () => berrybushes.exportRecords().map(record => ({ prefabId: BERRYBUSH_ID, record })),
    update: (dt, quaternion) => berrybushes.update(dt, quaternion),
    renderEntities: () => berrybushes.renderEntities,
    dispose: () => berrybushes.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.monkeytails, {
    restore: (_, record) => monkeytails.spawn(new THREE.Vector3(...record.transform.position), record),
    debugSpawn: () => monkeytails.spawn(player.position.clone()),
    exportRecords: () => monkeytails.exportRecords().map(record => ({ prefabId: MONKEYTAIL_ID, record })),
    update: (dt, quaternion) => monkeytails.update(dt, quaternion),
    renderEntities: () => monkeytails.renderEntities,
    dispose: () => monkeytails.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.grasses, {
    restore: (_, record) => grasses.spawn(new THREE.Vector3(...record.transform.position), {
      id: record.id, transform: record.transform, components: { pickable: record.components.pickable },
    }),
    debugSpawn: () => grasses.spawn(player.position.clone()),
    exportRecords: () => grasses.exportRecords().map((record) => ({ prefabId: GRASS_ID, record })),
    update: (dt, quaternion) => grasses.update(dt, quaternion),
    renderEntities: () => grasses.renderEntities,
    dispose: () => grasses.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.saplings, {
    restore: (id, record) => saplings.spawn(id, new THREE.Vector3(...record.transform.position), {
      id: record.id, transform: record.transform, components: { pickable: record.components.pickable },
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
  registry.register(PREFAB_DEFINITIONS.lavaPonds, {
    restore: (_, record) => lavaPonds.spawn(new THREE.Vector3(...record.transform.position), {
      id: record.id, transform: record.transform, components: { lavaPond: record.components.lavaPond },
    }),
    debugSpawn: () => lavaPonds.spawn(player.position.clone().setY(0)),
    exportRecords: () => lavaPonds.exportRecords().filter(record => record.prefabId === LAVA_POND_ID),
    update: (dt, quaternion) => lavaPonds.update(dt, quaternion),
    renderEntities: () => lavaPonds.renderEntities,
    dispose: () => lavaPonds.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.lavaPondRocks, {
    restore: (id, record) => lavaPonds.spawnRock(id, new THREE.Vector3(...record.transform.position), {
      id: record.id, transform: record.transform, components: {},
    }),
    debugSpawn: (id) => lavaPonds.spawnRock(id, player.position.clone().setY(0)),
    exportRecords: () => lavaPonds.exportRecords().filter(record => record.prefabId !== LAVA_POND_ID),
    // The pool family owns the shared manager's update, rendering and disposal.
    dispose: () => {},
  });
  registry.register(PREFAB_DEFINITIONS.tumbleweeds, {
    restore: (_, record) => tumbleweeds.spawn(new THREE.Vector3(...record.transform.position), {
      id: record.id, transform: record.transform, components: {},
    }),
    debugSpawn: () => tumbleweeds.spawn(player.position.clone().setY(0)),
    exportRecords: () => tumbleweeds.exportRecords().map(record => ({ prefabId: TUMBLEWEED_ID, record })),
    beforePhysics: dt => { if (!scheduler) windScheduler.advance(Math.min(dt, .1)); tumbleweeds.beforePhysics(dt); },
    update: (_, quaternion) => tumbleweeds.sync(quaternion),
    renderEntities: () => tumbleweeds.renderEntities,
    dispose: () => { tumbleweeds.dispose(); worldWind.dispose(); if (!scheduler) windScheduler.dispose(); },
  });
  registry.register(PREFAB_DEFINITIONS.hotsprings, {
    restore: (_, record) => hotsprings.spawn(new THREE.Vector3(...record.transform.position), {
      id: record.id, transform: record.transform, components: { hotspring: record.components.hotspring },
    }),
    debugSpawn: () => hotsprings.spawn(player.position.clone().setY(0)),
    exportRecords: () => hotsprings.exportRecords(),
    update: (dt) => hotsprings.update(dt),
    dispose: () => hotsprings.dispose(),
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
  registry.register(PREFAB_DEFINITIONS.worldFx, {
    exportRecords: () => [],
    update: (dt, quaternion) => worldFx.update(dt, quaternion),
    renderEntities: () => worldFx.renderEntities,
    dispose: () => worldFx.dispose(),
  });
  const nightmareRocks = new NightmareRockManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`, {
    scheduler, physics: world, fx: worldFx,
    // AllPlayers: the local player, once its sanity component is attached.
    getPlayers: () => player.userData.components?.sanity
      ? [{ position: player.position, sanity: player.userData.components.sanity }] : [],
  });
  registry.register(PREFAB_DEFINITIONS.nightmareRocks, {
    restore: (id, record) => nightmareRocks.spawn(id, new THREE.Vector3(...record.transform.position), {
      id: record.id, transform: record.transform, components: {},
    }),
    debugSpawn: (id) => nightmareRocks.spawn(id, player.position.clone()),
    exportRecords: () => nightmareRocks.exportRecords(),
    update: (dt, quaternion) => nightmareRocks.update(dt, quaternion),
    renderEntities: () => nightmareRocks.renderEntities,
    dispose: () => nightmareRocks.dispose(),
  });
  const rain = new RainEffect({
    scene, dataBaseUrl: `${import.meta.env.BASE_URL}dst/data`, animationBaseUrl: `${import.meta.env.BASE_URL}dst/data/anim`,
    getFocus: () => player.position, camera, rate: worldState.weather.rainRate,
  });
  registry.register(PREFAB_DEFINITIONS.rain, {
    exportRecords: () => [],
    update: (dt, quaternion) => rain.update(dt, quaternion),
    renderEntities: () => rain.renderEntities,
    dispose: () => rain.dispose(),
  });
  const snow = new SnowEffect({
    scene, dataBaseUrl: `${import.meta.env.BASE_URL}dst/data`,
    getFocus: () => player.position, camera, rate: worldState.weather.snowRate, cover: worldState.weather.snowCover,
    groundSize: initialSave.world.map.generator.options.size,
    groundOverlay: turfMap,
  });
  registry.register(PREFAB_DEFINITIONS.snow, {
    exportRecords: () => [],
    update: (dt, quaternion) => snow.update(dt, quaternion),
    dispose: () => snow.dispose(),
  });
  // The only ocean tile is OCEAN_COASTAL; INVALID (outside the map) is neither land nor water.
  const waveMap: WaveMap = {
    tileSize: TILE_SIZE,
    tileAt: (x, z) => turfMap.getTileAtWorld({ x, z }),
    isLandTile: tile => tile !== WORLD_TILES.INVALID && tile !== WORLD_TILES.OCEAN_COASTAL,
    isOceanTile: tile => tile === WORLD_TILES.OCEAN_COASTAL,
  };
  const oceanWaves = new OceanWaves(scene, waveMap, WORLD_SCALE, `${import.meta.env.BASE_URL}dst/data/anim`);
  await oceanWaves.prepare();
  const waveManager = new WaveManager({
    map: waveMap, spawner: oceanWaves, scale: WORLD_SCALE,
    tiles: new Map([[WORLD_TILES.OCEAN_COASTAL, 'shore']]),
    cameraDistance: () => followCamera.getDistance() / WORLD_SCALE,
    playerPosition: () => player.position,
  });
  registry.register(PREFAB_DEFINITIONS.oceanWaves, {
    exportRecords: () => [],
    update: (dt, quaternion) => { waveManager.OnUpdate(dt); oceanWaves.update(dt, quaternion); },
    dispose: () => oceanWaves.dispose(),
  });
  registry.assertDefinitions(Object.values(PREFAB_DEFINITIONS));
  const stopDugTurf = turfMap.onDig((point, tileId) => {
    const itemId = turfItemForTile(tileId);
    if (!itemId) return;
    const spec = GROUND_ITEM_DISPLAY_SPECS[itemId];
    void groundItems.flingLoot([{ itemId, count: 1, name: spec.name, icon: spec.icon, atlas: spec.atlas }],
      new THREE.Vector3(point.x, 0, point.z)).catch((error: unknown) => console.error('Unable to drop dug turf', error));
  });
  const dispose = () => {
    stopDugTurf();
    try { registry.dispose(); }
    finally { dynamicMusic?.dispose(); if (!inventory) sceneInventory.dispose(); }
  };
  return { registry, dispose, moonTreeForest, evergreenForest, deciduousForest, buildingPlacement, groundItems, dwarfStars, polarLights, flowerPlanting, bulbPlants,
    beefalos, molehills, rockManager, rockAvocadoSaplings, rockAvocadoBushes, berrybushes, monkeytails, grasses, saplings, ponds, lavaPonds, hotsprings, tumbleweeds, worldWind, wormholes, portals, nightmareGrowths, reskinEffects, worldFx, farmPlow, dockKit };
}

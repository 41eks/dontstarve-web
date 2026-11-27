import type { PrefabDisplayGroup } from '@dontstarve-web/display';
import type { PrefabRegistration } from '@dontstarve-web/prefab/prefabRegistration';
import type { PrefabEntityManager, PrefabInstance } from '@dontstarve-web/prefab/prefabInstance';
import type { Vector3 } from 'three';
import { EntityRegistry } from '../entityRegistry';
import { PREFAB_DEFINITIONS, type PrefabDefinition } from '../prefabDefinitions';

// Frame callbacks and reverse disposal have their own order, independent of construction.
const SCENE_LIFECYCLE_ORDER = [
  PREFAB_DEFINITIONS.farmPlow,
  PREFAB_DEFINITIONS.farmDecor,
  PREFAB_DEFINITIONS.plantedSeeds,
  PREFAB_DEFINITIONS.moonTrees,
  PREFAB_DEFINITIONS.moonTreeSaplings,
  PREFAB_DEFINITIONS.evergreens,
  PREFAB_DEFINITIONS.livingtree,
  PREFAB_DEFINITIONS.deciduousTrees,
  PREFAB_DEFINITIONS.pigKings,
  PREFAB_DEFINITIONS.glommerStatues,
  PREFAB_DEFINITIONS.moonFissures,
  PREFAB_DEFINITIONS.watertreePillars,
  PREFAB_DEFINITIONS.oceanTrees,
  PREFAB_DEFINITIONS.oceanTreePillars,
  PREFAB_DEFINITIONS.oceanVines,
  PREFAB_DEFINITIONS.reeds,
  PREFAB_DEFINITIONS.mastMalbatross,
  PREFAB_DEFINITIONS.supportPillars,
  PREFAB_DEFINITIONS.oasislakes,
  PREFAB_DEFINITIONS.beehives,
  PREFAB_DEFINITIONS.shadowForges,
  PREFAB_DEFINITIONS.spiderDens,
  PREFAB_DEFINITIONS.seastacks,
  PREFAB_DEFINITIONS.wasphives,
  PREFAB_DEFINITIONS.oceanVineDecos,
  PREFAB_DEFINITIONS.atriumGates,
  PREFAB_DEFINITIONS.ruinsStatueMages,
  PREFAB_DEFINITIONS.ruinsStatueMagesNoGem,
  PREFAB_DEFINITIONS.ruinsStatueHeads,
  PREFAB_DEFINITIONS.ruinsStatueHeadsNoGem,
  PREFAB_DEFINITIONS.atriumStatues,
  PREFAB_DEFINITIONS.atriumOvergrowths,
  PREFAB_DEFINITIONS.atriumRubbles,
  PREFAB_DEFINITIONS.buildings,
  PREFAB_DEFINITIONS.lightflierFlowers,
  PREFAB_DEFINITIONS.groundItems,
  PREFAB_DEFINITIONS.flowers,
  PREFAB_DEFINITIONS.staffLights,
  PREFAB_DEFINITIONS.staffCastingLights,
  PREFAB_DEFINITIONS.bulbPlants,
  PREFAB_DEFINITIONS.molehills,
  PREFAB_DEFINITIONS.beefalos,
  PREFAB_DEFINITIONS.lightningGoats,
  PREFAB_DEFINITIONS.stalagmites,
  PREFAB_DEFINITIONS.rocks,
  PREFAB_DEFINITIONS.caveinBoulders,
  PREFAB_DEFINITIONS.moonrockSeeds,
  PREFAB_DEFINITIONS.moonglassRocks,
  PREFAB_DEFINITIONS.caveHoles,
  PREFAB_DEFINITIONS.pillarRuins,
  PREFAB_DEFINITIONS.cavePillars,
  PREFAB_DEFINITIONS.atriumPillars,
  PREFAB_DEFINITIONS.archivePillars,
  PREFAB_DEFINITIONS.vaultPillars,
  PREFAB_DEFINITIONS.monkeyPillars,
  PREFAB_DEFINITIONS.caveEntrances,
  PREFAB_DEFINITIONS.caveExits,
  PREFAB_DEFINITIONS.grottoPools,
  PREFAB_DEFINITIONS.mushtrees,
  PREFAB_DEFINITIONS.mushroomPlants,
  PREFAB_DEFINITIONS.marbleBeanSaplings,
  PREFAB_DEFINITIONS.marbleShrubs,
  PREFAB_DEFINITIONS.archiveProps,
  PREFAB_DEFINITIONS.skeletons,
  PREFAB_DEFINITIONS.houndbones,
  PREFAB_DEFINITIONS.beeQueenHives,
  PREFAB_DEFINITIONS.dragonflies,
  PREFAB_DEFINITIONS.dragonflySpawners,
  PREFAB_DEFINITIONS.rockAvocadoSaplings,
  PREFAB_DEFINITIONS.rockAvocadoBushes,
  PREFAB_DEFINITIONS.berrybushes,
  PREFAB_DEFINITIONS.monkeytails,
  PREFAB_DEFINITIONS.grasses,
  PREFAB_DEFINITIONS.saplings,
  PREFAB_DEFINITIONS.caveFerns,
  PREFAB_DEFINITIONS.lichens,
  PREFAB_DEFINITIONS.ponds,
  PREFAB_DEFINITIONS.marshPlants,
  PREFAB_DEFINITIONS.lavaPonds,
  PREFAB_DEFINITIONS.lavaPondRocks,
  PREFAB_DEFINITIONS.tumbleweeds,
  PREFAB_DEFINITIONS.hotsprings,
  PREFAB_DEFINITIONS.nightmareGrowths,
  PREFAB_DEFINITIONS.wormholes,
  PREFAB_DEFINITIONS.portals,
  PREFAB_DEFINITIONS.reskinEffects,
  PREFAB_DEFINITIONS.worldFx,
  PREFAB_DEFINITIONS.staffProjectiles,
  PREFAB_DEFINITIONS.rain,
  PREFAB_DEFINITIONS.snow,
  PREFAB_DEFINITIONS.oceanWaves,
];

export interface ScenePrefabTarget {
  readonly prefabs: PrefabEntityManager<string, PrefabInstance>;
  readonly registry: EntityRegistry;
}

export function createScenePrefabRegistry(
  prefabs: ScenePrefabTarget['prefabs'],
  spawnPosition: () => Vector3,
  displays: PrefabDisplayGroup,
): EntityRegistry {
  return new EntityRegistry(SCENE_LIFECYCLE_ORDER, prefabs, spawnPosition, displays);
}

export function registerPrefabFamily<Args extends unknown[], Family extends keyof typeof PREFAB_DEFINITIONS>(
  { prefabs, registry }: ScenePrefabTarget,
  registration: PrefabRegistration<Args, Family>,
  ...args: Args
) {
  prefabs.register(registration.create(...args));
  for (const family of Object.keys(registration.families) as Family[]) {
    const definition: PrefabDefinition = PREFAB_DEFINITIONS[family];
    registry.registerPrefabs(definition);
  }
}

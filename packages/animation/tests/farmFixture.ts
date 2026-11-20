import * as THREE from 'three';
import type { HeldEntityRecord } from '../../prefab/src/saveRecord';
import { PrefabDisplayGroup } from '@dontstarve-web/display';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import {
  farmPrefabs,
  FARM_DECOR_IDS,
  FARM_PLOW_ID,
  PLANTED_SEED_IDS,
  type FarmWorld,
} from '../../prefab/src/farm_plow';
import { createFarmMap } from '../../prefab/src/farmMap';
import { PrefabEntityManager, type PrefabInstance } from '../../prefab/src/prefabInstance';
import type { EntityPersistData } from '../../prefab/src/saveRecord';
import { newEntityId } from '../../prefab/src/saveRecord';
import type { TurfMap } from '../../prefab/src/turfMap';

/** The farm prefabs on a shared manager with TheWorld.Map's soil functions, as the scene registers them. */
export function farmFixture(
  scene: THREE.Scene,
  turf: TurfMap,
  options: {
    random?: () => number;
    spawnSaveRecord?: (position: THREE.Vector3, item: HeldEntityRecord) => void;
    spawnLoot?: (itemId: string, position: THREE.Vector3) => void;
    fx?: FarmWorld['fx'];
  } = {},
) {
  const scheduler = new GameTimeScheduler(),
    displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { scheduler });
  const map = createFarmMap({ turf, entities: prefabs });
  prefabs.register(
    farmPrefabs({
      scheduler,
      map,
      fx: options.fx,
      random: options.random,
      spawnPrefab: (prefab, position) => prefabs.spawn(prefab, position),
      getEntity: id => prefabs.get(id),
      spawnSaveRecord: options.spawnSaveRecord ?? (() => {}),
      spawnLoot: options.spawnLoot,
    }),
  );
  const records = (ids: readonly string[]) => prefabs.exportRecords().filter(({ prefabId }) => ids.includes(prefabId));
  return {
    scheduler,
    displays,
    prefabs,
    map,
    /** SpawnPrefab, or SpawnSaveRecord when components or an id are given. */
    spawn: (prefab: string, position: THREE.Vector3, components?: EntityPersistData, id?: string) =>
      prefabs.spawn(
        prefab,
        position,
        components || id ? { id: id ?? newEntityId(), components: components ?? {} } : undefined,
      ),
    plows: () => records([FARM_PLOW_ID]).map(({ record }) => record),
    decor: () => records(FARM_DECOR_IDS),
    seeds: () => records(PLANTED_SEED_IDS),
    /** Game time and the displays' clips, a tenth of a second at a time. */
    async advance(seconds: number) {
      for (let i = 0; i < Math.ceil(seconds / 0.1 - 1e-9); i++) {
        scheduler.advance(0.1);
        displays.update(0.1);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    },
    dispose() {
      map.dispose();
      prefabs.dispose();
      displays.dispose();
      scheduler.dispose();
    },
  };
}

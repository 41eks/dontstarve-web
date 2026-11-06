import type * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { PrefabDisplayGroup } from '@dontstarve-web/display';
import type { TileStateQuery } from '@dontstarve-web/signals';
import { marbleShrubPrefabs, type MarbleShrubInstance, type MarbleShrubSpawnId, type MarbleShrubWorld } from '../../prefab/src/marbleshrub';
import { marbleBeanSaplingPrefabs, MARBLEBEAN_SAPLING_ID, type MarbleBeanSaplingInstance } from '../../prefab/src/marblebean_sapling';
import { PrefabEntityManager, type PrefabInstance } from '../../prefab/src/prefabInstance';

/**
 * marbleshrub.lua's prefabs, and planted_tree.lua's marblebean_sapling growing into them, on one world's
 * PrefabEntityManager, with the record view the tests compare.
 */
export function marbleShrubWorld(scene: THREE.Scene, world: MarbleShrubWorld, options: { physics?: CANNON.World; tickingarea?: TileStateQuery } = {}) {
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', options);
  prefabs.register(marbleShrubPrefabs(world) as never);
  prefabs.register(marbleBeanSaplingPrefabs({ ...world, spawnPrefab: (id, position) => prefabs.spawn(id, position) as MarbleShrubInstance }) as never);
  const records = (prefabId: string) => prefabs.exportRecords().filter(entry => entry.prefabId === prefabId).map(({ record }) => record);
  return {
    prefabs,
    saplings: {
      spawn: (position: THREE.Vector3, saved?: Parameters<typeof prefabs.spawn>[2]) => prefabs.spawn(MARBLEBEAN_SAPLING_ID, position, saved) as MarbleBeanSaplingInstance,
      exportRecords: () => records(MARBLEBEAN_SAPLING_ID),
    },
    spawn: (id: MarbleShrubSpawnId, position: THREE.Vector3, saved?: Parameters<typeof prefabs.spawn>[2]) => prefabs.spawn(id, position, saved) as MarbleShrubInstance,
    exportRecords: () => records('marbleshrub'),
    /** The display group advances the awake shrubs' clips. */
    update: (dt: number) => displays.update(dt),
    dispose: () => { prefabs.dispose(); displays.dispose(); },
  };
}

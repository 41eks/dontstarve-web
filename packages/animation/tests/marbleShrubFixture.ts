import type * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { PrefabDisplayGroup } from '@dontstarve-web/display';
import type { TileStateQuery } from '@dontstarve-web/signals';
import { marbleShrubPrefabs, type MarbleShrubInstance, type MarbleShrubSpawnId, type MarbleShrubWorld } from '../../prefab/src/marbleshrub';
import { PrefabEntityManager, type PrefabInstance } from '../../prefab/src/prefabInstance';

/** marbleshrub.lua's prefabs on a world's PrefabEntityManager, with the record view the tests compare. */
export function marbleShrubWorld(scene: THREE.Scene, world: MarbleShrubWorld, options: { physics?: CANNON.World; tickingarea?: TileStateQuery } = {}) {
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', options);
  prefabs.register(marbleShrubPrefabs(world) as never);
  return {
    prefabs,
    spawn: (id: MarbleShrubSpawnId, position: THREE.Vector3, saved?: Parameters<typeof prefabs.spawn>[2]) => prefabs.spawn(id, position, saved) as MarbleShrubInstance,
    exportRecords: () => prefabs.exportRecords().map(({ record }) => record),
    /** The display group advances the awake shrubs' clips. */
    update: (dt: number) => displays.update(dt),
    dispose: () => { prefabs.dispose(); displays.dispose(); },
  };
}

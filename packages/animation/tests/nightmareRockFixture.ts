import type * as THREE from 'three';
import { vi } from 'vitest';
import type { ReadonlyVector3 } from '../src/transformRoot';
import type * as CANNON from 'cannon-es';
import { PrefabDisplayGroup } from '@dontstarve-web/display';
import type { TileStateQuery } from '@dontstarve-web/signals';
import {
  nightmareRockPrefabs,
  type NightmareRockId,
  NightmareRockInstance,
  type NightmareRockWorld,
} from '../../prefab/src/nightmarerock';
import { PrefabEntityManager, type PrefabInstance } from '../../prefab/src/prefabInstance';
import { worldFxPrefabs } from '../../prefab/src/world_fx';

/**
 * nightmarerock.lua's sanityrock and insanityrock on one world's PrefabEntityManager, with the fx prefabs their stategraph
 * spawns. `spawnPrefab` is that manager's, observed so the tests can read what was spawned.
 */
export function nightmareRockWorld(
  scene: THREE.Scene,
  world: Omit<NightmareRockWorld, 'spawnPrefab'>,
  options: { physics?: CANNON.World; tickingarea?: TileStateQuery } = {},
) {
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', options);
  const spawnPrefab = vi.fn((prefab: string, position: ReadonlyVector3) => prefabs.spawn(prefab, position));
  prefabs.register(worldFxPrefabs({ scheduler: world.scheduler }));
  prefabs.register(nightmareRockPrefabs({ ...world, spawnPrefab }));
  return {
    prefabs,
    spawnPrefab,
    spawn: (id: NightmareRockId, position: THREE.Vector3) => prefabs.spawnAs(NightmareRockInstance, id, position),
    exportRecords: () => prefabs.exportRecords(),
    /** The display group advances the awake rocks' clips. */
    update: (dt: number) => displays.update(dt),
    dispose: () => {
      prefabs.dispose();
      displays.dispose();
    },
  };
}

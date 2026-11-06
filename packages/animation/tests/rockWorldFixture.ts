import type * as THREE from 'three';
import { PrefabDisplayGroup } from '@dontstarve-web/display';
import type { HandEquipment, ReadonlySignal, TileStateQuery } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { PrefabEntityManager, type PrefabInstance } from '../../prefab/src/prefabInstance';
import { rockPrefabs } from '../../prefab/src/rocks';
import { caveinBoulderPrefabs } from '../../prefab/src/cavein_boulder';
import { moonrockseedPrefabs } from '../../prefab/src/moonrockseed';
import type { SpawnGroundItem } from '../../prefab/src/groundPrefab';

/** One world's shared prefab manager with the rock, cave-in boulder and celestial orb prefabs registered. */
export function rockWorld(scene: THREE.Scene, options: { scheduler?: GameTimeScheduler; tickingarea?: TileStateQuery;
  spawnGroundItem?: SpawnGroundItem; handEquipment?: ReadonlySignal<HandEquipment | null> } = {}) {
  const scheduler = options.scheduler ?? new GameTimeScheduler();
  const spawnGroundItem = options.spawnGroundItem ?? (() => undefined);
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { tickingarea: options.tickingarea });
  prefabs.register(rockPrefabs({ scheduler, spawnGroundItem, handEquipment: options.handEquipment,
    spawnPrefab: (id, position) => prefabs.spawn(id, position) }) as never);
  prefabs.register(caveinBoulderPrefabs({ spawnGroundItem, handEquipment: options.handEquipment }) as never);
  prefabs.register(moonrockseedPrefabs() as never);
  return { scheduler, displays, prefabs,
    spawn: (id: string, position: THREE.Vector3, saved?: Parameters<typeof prefabs.spawn>[2]) => prefabs.spawn(id, position, saved).transform.model,
    exportRecords: () => prefabs.exportRecords(),
    dispose() { prefabs.dispose(); displays.dispose(); if (!options.scheduler) scheduler.dispose(); } };
}

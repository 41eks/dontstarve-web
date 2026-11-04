import { EventEmitter } from '@dontstarve-web/signals';
import { PrefabDisplayGroup } from '@dontstarve-web/display';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { vi } from 'vitest';
import type { TileStateQuery } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { PrefabEntityManager, type PrefabEntityDefinition, type PrefabInstance } from '../../prefab/src/prefabInstance';
import { FireFxHost } from '../../prefab/src/treeFire';
import { worldFxPrefabs } from '../../prefab/src/world_fx';
import type { WorldEvents } from '../../prefab/src/worldContext';

/** A test world's generic manager and the services the tree prefabs take from their world, including the fx they spawn. */
export function treeWorld<Extra extends object, Id extends string, Instance extends PrefabInstance>(tickingarea: TileStateQuery,
  define: (world: ReturnType<typeof services> & Extra) => Readonly<Record<Id, PrefabEntityDefinition<Instance>>>,
  extra: Extra, { scheduler = new GameTimeScheduler(), scene = new THREE.Scene(), physics = new CANNON.World() }: { scheduler?: GameTimeScheduler; scene?: THREE.Scene; physics?: CANNON.World } = {}) {
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { tickingarea, physics });
  const world = { ...services(prefabs, scheduler), ...extra };
  prefabs.register(define(world));
  prefabs.register(worldFxPrefabs({ scheduler }));
  let disposed = false;
  return { ...world, prefabs, displays, scene, physics,
    records: () => prefabs.exportRecords().map(({ record }) => record),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      prefabs.dispose(); displays.dispose(); world.fire.dispose();
    },
  };
}

function services(prefabs: PrefabEntityManager<string, PrefabInstance>, scheduler: GameTimeScheduler) {
  return { scheduler, fire: FireFxHost.create('/dst/data/anim'), camera: new THREE.PerspectiveCamera(), worldEvents: new EventEmitter<WorldEvents>(), dropLoot: vi.fn(),
    spawnPrefab: (id: string, position: Parameters<typeof prefabs.spawn>[1]) => prefabs.spawn(id, position) };
}

import { publishTestCamera } from './worldContentFixture';
import { prefabManager } from './prefabManagerFixture';
import type * as THREE from 'three';
import { PrefabDisplayGroup } from '../../packages/display/src/prefabDisplayGroup';
import { GameTimeScheduler } from '../../packages/componets/src/gameTimeScheduler';
import { worldFxPrefabs, worldFxSpawner } from '../../packages/prefab/src/world_fx';

/** The scene's world fx as the application wires them, with what a test advances them by. */
export function createTestWorldFx(scene: THREE.Scene, scheduler = new GameTimeScheduler()) {
  const displays = new PrefabDisplayGroup(scene),
    manager = prefabManager(displays, undefined, { scheduler }, worldFxPrefabs);
  return {
    ...worldFxSpawner(manager),
    scheduler,
    get renderEntities() {
      return manager.renderEntities;
    },
    update: (dt: number, rotation: THREE.Quaternion) => {
      publishTestCamera(rotation);
      displays.update(dt);
    },
    dispose: () => {
      manager.dispose();
      displays.dispose();
    },
  };
}

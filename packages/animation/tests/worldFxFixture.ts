import type * as THREE from 'three';
import { PrefabDisplayGroup } from '../../display/src/prefabDisplayGroup';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { createWorldFxManager, worldFxSpawner } from '../../prefab/src/world_fx';

/** The scene's world fx as the application wires them, with what a test advances them by. */
export function createTestWorldFx(scene: THREE.Scene, scheduler = new GameTimeScheduler()) {
  const displays = new PrefabDisplayGroup(scene), manager = createWorldFxManager(displays, { scheduler });
  return {
    ...worldFxSpawner(manager), scheduler,
    get renderEntities() { return manager.renderEntities; },
    update: (dt: number, rotation: THREE.Quaternion) => { displays.update(dt, rotation); },
    dispose: () => { manager.dispose(); displays.dispose(); },
  };
}

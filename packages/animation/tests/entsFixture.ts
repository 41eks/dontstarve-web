import * as THREE from 'three';
import { PrefabDisplayGroup, type SpriteState } from '@dontstarve-web/display';
import { PrefabEntityManager, type PrefabInstance } from '../../prefab/src/prefabInstance';

/**
 * A world's Ents for a test that builds its entities by hand: `track` puts each one where TheSim queries find it
 * and gives it that TheSim. `dispose` releases the index; the test still removes its own entities.
 */
export function testEnts() {
  const displays = new PrefabDisplayGroup(new THREE.Scene());
  const prefabs = new PrefabEntityManager<string, PrefabInstance<SpriteState, object>>(displays, undefined, {});
  return {
    prefabs,
    track<T extends PrefabInstance<SpriteState, object>>(inst: T): T {
      prefabs.track(inst);
      return inst;
    },
    dispose() {
      prefabs.dispose();
      displays.dispose();
    },
  };
}

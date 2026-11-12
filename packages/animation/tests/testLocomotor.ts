import * as THREE from 'three';
import { vi } from 'vitest';
import { Locomotor, type LocomotorOptions } from '../../prefab/src/locomotor';

/**
 * The player's real Locomotor over its own position, with spies on what a controller asks of it. A test that does not
 * simulate the walk calls `arrive()`: the player steps onto the locomotor's destination and one update reaches it,
 * which runs the walked-to action's arrival as locomotor OnUpdate does.
 */
export function testLocomotor(player: THREE.Object3D, options?: LocomotorOptions) {
  const locomotor = new Locomotor({ position: player.position, velocity: new THREE.Vector3() }, options);
  const pushAction = vi.spyOn(locomotor, 'PushAction'), goToPoint = vi.spyOn(locomotor, 'goToPoint');
  const stop = vi.spyOn(locomotor, 'stop');
  return {
    locomotor, pushAction, goToPoint, stop,
    /** Whether a walked-to action is still waiting for its arrival. */
    get walking() { return locomotor.bufferedAction !== undefined; },
    arrive(): void {
      const destination = locomotor.destination;
      if (!destination) return;
      player.position.set(destination.x, player.position.y, destination.z);
      locomotor.update(1, 1 / 30);
    },
  };
}

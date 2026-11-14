import { wilsonPlayer } from '../../animation/tests/wilsonPlayer';
import { withEntity } from '../../animation/tests/entityFixture';
import * as THREE from 'three';
import { createInventoryStore } from '../../animation/tests/testInventory';
import { testPlayer } from '../../animation/tests/testPlayer';
import { PlayerController } from '../../stategraphs/src/playercontroller';
import { testLocomotor } from '../../animation/tests/testLocomotor';
import { createEquipmentExistenceState } from '../../signals/src';

/** Standalone art fixtures share the production input path with a deterministic animation clock. */
export function fixturePickup(scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer,
  player = withEntity(new THREE.Group(), 'wilson'), inventory = createInventoryStore()) {
  const graph = wilsonPlayer(() => .25).sg;
  const animation = { stategraph: graph };
  // The player's own locomotor; settle() steps the player onto the target, where the walked-to action arrives.
  const walker = testLocomotor(player);
  const controller = new PlayerController({ scene, camera, renderer, player, ground: new THREE.Group() }, animation.stategraph,
    walker.locomotor, createEquipmentExistenceState('HANDS'), testPlayer({ model: player, inventory }));
  let allowed = true;
  const give = inventory.GiveItem.bind(inventory), equip = inventory.Equip.bind(inventory);
  inventory.GiveItem = (...args) => allowed && give(...args);
  inventory.Equip = (...args) => allowed && equip(...args);
  return { inventory, player,
    setAllowed(value: boolean) { allowed = value; },
    settle() { walker.arrive(); graph.update(.2); graph.update(.5); },
    dispose() { controller.dispose(); },
  };
}

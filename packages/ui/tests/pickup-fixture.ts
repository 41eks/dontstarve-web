import * as THREE from 'three';
import { createInventoryStore } from '../../../src/inventory';
import { createPickupDoer } from '../../stategraphs/src/pickup';
import { PlayerController, type PlayerLocomotor } from '../../stategraphs/src/playercontroller';
import { WilsonStateGraph } from '../../stategraphs/src/SGwilson';
import { createEquipmentExistenceState } from '../../signals/src';

/** Standalone art fixtures share the production input path with a deterministic animation clock. */
export function fixturePickup(scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer,
  player = new THREE.Group(), inventory = createInventoryStore()) {
  const graph = new WilsonStateGraph({ playAnimation: () => .25, playSound() {}, setCasting() {}, onStateChanged() {} });
  const animation = { stategraph: graph };
  // The player steps straight onto the target, so locomotor:PushAction buffers at once.
  const locomotor: PlayerLocomotor = { destination: undefined, stop() {}, goToPoint(point) { player.position.copy(point); return true; },
    PushAction(action, arrive) { player.position.copy(action.target.getPosition()); arrive(); } };
  const controller = new PlayerController({ scene, camera, renderer, player, ground: new THREE.Group() }, animation.stategraph,
    locomotor, createEquipmentExistenceState('HANDS'), createPickupDoer(player, inventory));
  let allowed = true;
  const give = inventory.GiveItem.bind(inventory), equip = inventory.Equip.bind(inventory);
  inventory.GiveItem = (...args) => allowed && give(...args);
  inventory.Equip = (...args) => allowed && equip(...args);
  return { inventory, player,
    setAllowed(value: boolean) { allowed = value; },
    settle() { graph.update(.2); graph.update(.5); },
    dispose() { controller.dispose(); },
  };
}

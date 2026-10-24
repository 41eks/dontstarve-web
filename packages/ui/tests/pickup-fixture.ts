import * as THREE from 'three';
import { createInventoryStore } from '../../../src/inventory';
import { createPickupDoer, PickupActionController } from '../../stategraphs/src/pickup';
import { WilsonStateGraph } from '../../stategraphs/src/SGwilson';
import type { ActionAnimationController } from '../../stategraphs/src/actionContext';

/** Standalone art fixtures share the production input path with a deterministic animation clock. */
export function fixturePickup(scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer,
  player = new THREE.Group(), inventory = createInventoryStore()) {
  const graph = new WilsonStateGraph({ playAnimation: () => .25, playSound() {}, setCasting() {}, onStateChanged() {} });
  const animation = { stategraph: graph, cancelEmote() {}, setFacing() {} } as unknown as ActionAnimationController;
  const controller = new PickupActionController({ scene, camera, renderer, player, ground: new THREE.Group() }, animation,
    { stop() {}, goToPoint(point) { player.position.copy(point); return true; }, destination: undefined }, createPickupDoer(player, inventory));
  let allowed = true;
  const give = inventory.GiveItem.bind(inventory), equip = inventory.Equip.bind(inventory);
  inventory.GiveItem = (...args) => allowed && give(...args);
  inventory.Equip = (...args) => allowed && equip(...args);
  return { inventory, player,
    setAllowed(value: boolean) { allowed = value; },
    settle() { controller.update(); controller.update(); graph.update(.2); controller.update(); graph.update(.5); },
    dispose() { controller.dispose(); },
  };
}

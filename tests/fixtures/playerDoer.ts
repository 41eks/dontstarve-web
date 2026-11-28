import type * as THREE from 'three';
import type { InventoryStore } from '../../packages/inventory/src';
import { testPlayer, type TestPlayer } from './testPlayer';

/** The player model's own entity as act.doer, owning `inventory` (an empty store unless given). */
export function playerDoer(
  player: THREE.Object3D,
  components: { readonly inventory?: InventoryStore } = {},
): TestPlayer {
  return testPlayer({ model: player, inventory: components.inventory });
}

/** inventory.lua's inst for a test player: the player's entity owns the store and picks up into it. */
export function pickupDoer(player: THREE.Object3D, inventory: InventoryStore): TestPlayer {
  return testPlayer({ model: player, inventory });
}

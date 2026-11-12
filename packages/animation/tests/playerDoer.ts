import type * as THREE from 'three';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import type { PickupDoer } from '../../stategraphs/src/pickup';
import { createInventoryStore } from '../../../src/inventory';

/**
 * A test player inst as act.doer: the player model's tags and events, its position and stategraph, its inventory (an
 * empty store unless given) and the given components, as the application binds them on its own doer.
 */
/** inventory.lua's owner for a test player: the store's actor is the player doer holding it. */
export function pickupDoer(player: THREE.Object3D, inventory: PickupDoer['components']['inventory']) {
  const doer = playerDoer(player, { inventory });
  inventory.bindActor(doer);
  return doer;
}

export function playerDoer(player: THREE.Object3D, components: Partial<PickupDoer['components']> = {}) {
  const inst = () => {
    const found = prefabInstance(player);
    if (!found) throw new Error('A test player doer needs its player entity');
    return found;
  };
  return {
    components: { inventory: createInventoryStore([]), ...components },
    position: player.position,
    get isRemoved() { return inst().isRemoved; },
    hasTag: (tag: string) => tag === 'player' || inst().hasTag(tag),
    addTag: (tag: string) => inst().addTag(tag),
    removeTag: (tag: string) => inst().removeTag(tag),
    PushEvent: (name: string, data?: unknown) => inst().PushEvent(name, data),
    getPosition: () => player.position,
    /** The player inst's TheSim: a test that queries through the doer tracks the player in its world first. */
    get TheSim() { return inst().TheSim; },
    get sg() { const sg = inst().sg; return sg && { hasStateTag: (tag: string) => sg.hasStateTag(tag) }; },
  };
}

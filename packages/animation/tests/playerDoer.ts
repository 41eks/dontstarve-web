import type * as THREE from 'three';
import { prefabInstance } from '../../prefab/src/prefabInstance';

/**
 * A test player inst as act.doer: the player model's tags and events, its position and stategraph, and the given
 * components (the application binds inventory, sanity, combat and sleepingbaguser on its own doer).
 */
export function playerDoer(player: THREE.Object3D, components: Record<string, unknown> = {}) {
  return {
    components,
    position: player.position,
    hasTag: (tag: string) => tag === 'player' || prefabInstance(player)?.hasTag(tag) === true,
    PushEvent: (name: string, data?: unknown) => prefabInstance(player)?.PushEvent(name, data),
    getPosition: () => player.position,
    /** The player inst's TheSim: a test that queries through the doer tracks the player in its world first. */
    get TheSim() { return prefabInstance(player)!.TheSim; },
    get sg() { const sg = prefabInstance(player)?.sg; return sg && { HasStateTag: (tag: string) => sg.hasStateTag(tag) }; },
  };
}

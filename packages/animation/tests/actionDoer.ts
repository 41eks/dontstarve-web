import { Vector3 } from 'three';
import type { PlayerActionDoer } from '../../stategraphs/src/actionfns';
import type { PickupDoer } from '../../stategraphs/src/pickup';
import { createInventoryStore } from '../../../src/inventory';

/**
 * act.doer for a test without a player model: a player at the origin with its own tags, an inventory (an empty store
 * unless given) and the given components.
 */
export function actionDoer(components: Partial<PickupDoer['components']> = {}): PlayerActionDoer {
  const position = new Vector3(), tags = new Set(['player']);
  return {
    components: { inventory: createInventoryStore([]), ...components },
    position, isRemoved: false,
    hasTag: tag => tags.has(tag),
    addTag: tag => { tags.add(tag); },
    removeTag: tag => { tags.delete(tag); },
    PushEvent: () => {},
    getPosition: () => position,
  };
}

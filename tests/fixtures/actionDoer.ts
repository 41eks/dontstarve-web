import type { InventoryStore } from '../../packages/inventory/src';
import { testPlayer, type TestPlayer } from './testPlayer';

/** act.doer for a test without a player model: a player entity at the origin owning `inventory` (an empty store unless given). */
export function actionDoer(components: { readonly inventory?: InventoryStore } = {}): TestPlayer {
  return testPlayer({ inventory: components.inventory });
}

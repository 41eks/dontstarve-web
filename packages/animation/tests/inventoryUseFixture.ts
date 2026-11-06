import { createSignal } from '@dontstarve-web/signals';
import type { ItemEntity } from '../../inventory/src/entity';
import { PlayerController, type PlayerLocomotor } from '../../stategraphs/src/playercontroller';
import type { ActionWorldContext } from '../../stategraphs/src/actionContext';
import type { WilsonStateGraph } from '../../stategraphs/src/SGwilson';

/**
 * The player's PlayerController with nothing in hand, for inventory.lua UseItemFromInvTile: the first of
 * GetInventoryActions(item), pushed where the doer stands.
 */
export function inventoryUse(world: object, stategraph: WilsonStateGraph, doer: object) {
  const locomotor = { stop() {}, PushAction() {} } as unknown as PlayerLocomotor;
  const controller = new PlayerController(world as ActionWorldContext, stategraph, locomotor, createSignal(null), doer as never);
  return {
    controller,
    use(item: ItemEntity): boolean {
      const action = controller.GetInventoryItemAction(item);
      return !!action && controller.DoAction(action);
    },
    cancel: () => controller.cancel(),
    dispose: () => controller.dispose(),
  };
}

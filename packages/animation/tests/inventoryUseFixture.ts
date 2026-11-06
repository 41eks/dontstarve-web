import { createSignal } from '@dontstarve-web/signals';
import type { ItemEntity } from '../../inventory/src/entity';
import { PlayerController, type PlayerLocomotor } from '../../stategraphs/src/playercontroller';
import type { ActionWorldContext } from '../../stategraphs/src/actionContext';
import type { WilsonStateGraph } from '../../stategraphs/src/SGwilson';
import { collectUseItemActions } from '../../stategraphs/src/componentactions';
import type { InventoryStore } from '../../inventory/src';

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

/**
 * The player's PlayerController holding an active (cursor) item over a world target: GetItemUseAction picks from
 * COMPONENT_ACTIONS.USEITEM and DoAction hands it to locomotor:PushAction, which `arrive()` completes.
 */
export function activeItemUse(world: object, stategraph: WilsonStateGraph,
  inventory: InventoryStore, isManualMovement = () => false) {
  let arrival: (() => void) | undefined;
  const locomotor = { destination: undefined, goToPoint: () => true, stop() { arrival = undefined; },
    PushAction(_action: unknown, arrive: () => void) { arrival = arrive; } } as unknown as PlayerLocomotor;
  const position = (world as ActionWorldContext).player.position;
  const doer = { components: { inventory }, hasTag: (tag: string) => tag === 'player', position,
    getPosition: () => position, GetPosition: () => position, PushEvent() {} };
  const controller = new PlayerController(world as ActionWorldContext, stategraph, locomotor, createSignal(null),
    doer as never, isManualMovement);
  return {
    controller, doer,
    /** CollectActions("USEITEM"): the action names the active item offers on the target for one button. */
    actions(target: object, right = false): string[] {
      const item = inventory.GetActiveItem();
      return item ? collectUseItemActions(item, doer, target as never, right) : [];
    },
    useOn(target: object): boolean {
      const item = inventory.GetActiveItem(), action = item && controller.GetItemUseAction(item, target as never);
      return !!action && controller.DoAction(action);
    },
    /** locomotor OnUpdate at the destination. */
    arrive() { const arrive = arrival; arrival = undefined; arrive?.(); },
    get walking() { return arrival !== undefined; },
    dispose: () => controller.dispose(),
  };
}

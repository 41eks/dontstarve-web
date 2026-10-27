import { ItemEntity } from '@dontstarve-web/inventory';
import { bindEquipmentLifecycle, type EquipmentOwner, type HandEquipment, type Signal } from '@dontstarve-web/signals';
import type { ActionDescription } from '@dontstarve-web/stategraphs';
import { createHandEquipmentLifecycle, getHandEquipmentDefinition, preloadHandEquipment, type HandEquipmentContext } from '@dontstarve-web/prefab/handEquipment';
import type { WilsonAnimationController } from '@dontstarve-web/prefab/player';

export interface PlayerHandEquipmentOptions extends HandEquipmentContext {
  animation?: Pick<WilsonAnimationController, 'setEquippedCarryItem' | 'playItemTransition'> & Partial<Pick<WilsonAnimationController, 'equipmentContext'>>;
  setHandAction(action: ActionDescription | null): void;
  handEquipmentExistenceState: Signal<HandEquipment | null>;
  owner?: EquipmentOwner;
}

/** Application wiring observes the injected existence state; prefabs own item behavior. */
export async function bindPlayerHandEquipment(options: PlayerHandEquipmentOptions) {
  await preloadHandEquipment();
  const slot = options.handEquipmentExistenceState;
  let disposed = false;
  let presented: HandEquipment | null = null;
  let silentDepth = 0;
  const prefabContext = {
    ...options,
    AnimState: options.AnimState ?? options.animation?.equipmentContext?.owner.AnimState,
  };
  const binding = bindEquipmentLifecycle({
    existenceState: slot,
    owner: options.owner,
    createLifecycle(equipment) {
      const entry = getHandEquipmentDefinition(equipment.itemId);
      if (entry && equipment.entity instanceof ItemEntity && !equipment.entity.isRemoved) return createHandEquipmentLifecycle(equipment.entity, prefabContext);
    },
    present(equipment) {
      const previous = presented;
      presented = equipment;
      const entry = equipment ? getHandEquipmentDefinition(equipment.itemId) : undefined;
      const previousEntry = previous ? getHandEquipmentDefinition(previous.itemId) : undefined;
      const sameItem = equipment && previous && (equipment.entity && previous.entity
        ? equipment.entity === previous.entity : equipment.itemId === previous.itemId);
      const transition = silentDepth > 0 || sameItem ? undefined
        : equipment && entry ? { state: 'item_out' as const, item: entry.carryItem }
        : !equipment && previousEntry && !previous?.entity?.isRemoved
          ? { state: 'item_in' as const, item: previousEntry.carryItem } : undefined;
      const animation = options.animation;
      animation?.setEquippedCarryItem(entry?.carryItem ?? null);
      // The held art is named on the AnimState; the player's display draws it once loaded.
      if (transition && !(!equipment && previous?.entity?.isRemoved)) animation?.playItemTransition(transition.state, transition.item);
      if (slot.peek() !== equipment) return;
      options.setHandAction(entry?.definition.handAction ?? null);
    },
  });
  return {
    flush: binding.flush,
    /** Restore committed equipment normally, without playing inventory interaction animations. */
    withoutTransitions(action: () => void): void {
      silentDepth++;
      try { action(); } finally { silentDepth--; }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      binding.dispose();
      options.animation?.setEquippedCarryItem(null);
    },
  };
}

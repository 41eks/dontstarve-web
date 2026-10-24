import { ItemEntity } from '@dontstarve-web/inventory';
import type { EquipmentOwner, HandEquipment, Signal } from '@dontstarve-web/signals';
import type { ActionDescription } from '@dontstarve-web/stategraphs';
import { createHandEquipmentLifecycle, getHandEquipmentDefinition, preloadHandEquipment, type HandEquipmentContext } from '@dontstarve-web/prefab/handEquipment';
import type { WilsonAnimationController } from '@dontstarve-web/prefab/player';
import { bindPlayerEquipment } from './playerEquipment';

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
  let presentationVersion = 0;
  let silentDepth = 0;
  let hand: ReturnType<typeof createHandEquipmentLifecycle> | undefined;
  const prefabContext = {
    ...options,
    AnimState: options.AnimState ?? options.animation?.equipmentContext?.owner.AnimState,
    assets: options.assets ?? options.animation?.equipmentContext?.assets,
  };
  const binding = bindPlayerEquipment({
    existenceState: slot,
    owner: options.owner,
    createLifecycle(equipment) {
      const entry = getHandEquipmentDefinition(equipment.itemId);
      if (entry && equipment.entity instanceof ItemEntity && !equipment.entity.isRemoved) {
        hand = createHandEquipmentLifecycle(equipment.entity, prefabContext);
        return hand;
      }
    },
    present(equipment) {
      const previous = presented;
      presented = equipment;
      const version = ++presentationVersion;
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
      const ready = hand?.ready ?? Promise.resolve();
      void ready.then(() => {
        // Asset loading may finish after another equip, depletion or shutdown.
        if (disposed || version !== presentationVersion || slot.peek() !== equipment || !transition) return;
        if (!equipment && previous?.entity?.isRemoved) return;
        options.animation?.playItemTransition(transition.state, transition.item);
      })
        .catch((error: unknown) => console.error('Unable to equip hand item', error));
      if (slot.peek() !== equipment) return;
      options.setHandAction(entry?.definition.handAction ?? null);
    },
  });
  return {
    update: binding.update,
    flush: binding.flush,
    /** Restore committed equipment normally, without playing inventory interaction animations. */
    withoutTransitions(action: () => void): void {
      silentDepth++;
      try { action(); } finally { silentDepth--; }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      presentationVersion++;
      binding.dispose();
      options.animation?.setEquippedCarryItem(null);
    },
  };
}

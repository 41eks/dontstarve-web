import { ItemEntity } from '@dontstarve-web/inventory';
import { handEquipmentState, type HandEquipment, type HandEquipmentLifecycle, type Signal } from '@dontstarve-web/signals';
import { getHandEquipmentDefinition, preloadHandEquipment, type HandEquipmentContext } from '@dontstarve-web/prefab/handEquipment';
import type { WilsonAnimationController } from '@dontstarve-web/prefab/player';

export interface PlayerHandEquipmentOptions extends HandEquipmentContext {
  animation?: Pick<WilsonAnimationController, 'setCarryItem' | 'playItemTransition'>;
  setHandAction(action: string | null): void;
  slot?: Signal<HandEquipment | null>;
}

/** Application wiring observes the shared signal; prefab definitions own item-specific behavior. */
export async function bindPlayerHandEquipment(options: PlayerHandEquipmentOptions) {
  await preloadHandEquipment();
  const slot = options.slot ?? handEquipmentState;
  let active: HandEquipmentLifecycle | undefined;
  let disposed = false;
  let transitioning = false;
  let pending = false;
  const stop = slot.subscribe(equipment => {
    if (disposed || slot.peek() !== equipment) return;
    pending = true;
    if (transitioning) return;
    transitioning = true;
    try {
      while (pending && !disposed) {
        pending = false;
        const current = slot.peek();
        const previous = active;
        active = undefined;
        previous?.onunequip();
        // Complete cleanup before handling a value published from inside a lifecycle callback.
        if (disposed || pending || slot.peek() !== current) continue;
        const entry = current ? getHandEquipmentDefinition(current.itemId) : undefined;
        if (entry && current?.entity instanceof ItemEntity && !current.entity.isRemoved) {
          active = entry.definition.createLifecycle?.(current.entity, options);
          active?.onequip(slot);
        }
        if (disposed || pending || slot.peek() !== current) continue;
        void options.animation?.setCarryItem(entry?.carryItem ?? null, current?.skinId)
          .catch((error: unknown) => console.error('Unable to equip hand item', error));
        if (disposed || pending || slot.peek() !== current) continue;
        options.setHandAction(entry?.definition.handAction ?? null);
      }
    } finally {
      transitioning = false;
    }
  });

  return {
    update(dt: number) { active?.onFrame?.(dt); },
    flush() { active?.flush?.(); },
    playTransition(state: 'item_in' | 'item_out', itemId: string) {
      if (disposed) return;
      const entry = getHandEquipmentDefinition(itemId);
      if (entry) options.animation?.playItemTransition(state, entry.carryItem);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      const previous = active;
      active = undefined;
      previous?.onunequip();
    },
  };
}

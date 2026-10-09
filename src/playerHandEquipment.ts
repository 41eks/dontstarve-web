import { ItemEntity } from '@dontstarve-web/inventory';
import type { HandEquipment, Signal } from '@dontstarve-web/signals';
import type { ActionDescription } from '@dontstarve-web/stategraphs';
import { getHandEquipmentDefinition, preloadHandEquipment, type HandEquipmentContext } from '@dontstarve-web/prefab/handEquipment';
import type { WilsonAnimationController } from '@dontstarve-web/prefab/player';
import { bindPlayerEquipment } from './playerEquipment';

export interface PlayerHandEquipmentOptions extends HandEquipmentContext {
  animation?: Pick<WilsonAnimationController, 'setCarryItem' | 'playItemTransition'>;
  setHandAction(action: ActionDescription | null): void;
  handEquipmentExistenceState: Signal<HandEquipment | null>;
}

/** Application wiring observes the injected existence state; prefabs own item behavior. */
export async function bindPlayerHandEquipment(options: PlayerHandEquipmentOptions) {
  await preloadHandEquipment();
  const slot = options.handEquipmentExistenceState;
  const binding = bindPlayerEquipment({
    existenceState: slot,
    createLifecycle(equipment) {
      const entry = getHandEquipmentDefinition(equipment.itemId);
      if (entry && equipment.entity instanceof ItemEntity && !equipment.entity.isRemoved) {
        return entry.definition.createLifecycle?.(equipment.entity, options);
      }
    },
    present(equipment) {
      const entry = equipment ? getHandEquipmentDefinition(equipment.itemId) : undefined;
      void options.animation?.setCarryItem(entry?.carryItem ?? null, equipment?.skinId)
        .catch((error: unknown) => console.error('Unable to equip hand item', error));
      if (slot.peek() !== equipment) return;
      options.setHandAction(entry?.definition.handAction ?? null);
    },
  });
  let disposed = false;
  return {
    update: binding.update,
    flush: binding.flush,
    playTransition(state: 'item_in' | 'item_out', itemId: string) {
      if (disposed) return;
      const entry = getHandEquipmentDefinition(itemId);
      if (entry) options.animation?.playItemTransition(state, entry.carryItem);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      binding.dispose();
    },
  };
}

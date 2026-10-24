import type { Equipment, EquipmentLifecycle, EquipmentSlot, Signal } from '@dontstarve-web/signals';

interface PlayerEquipmentOptions<S extends EquipmentSlot> {
  existenceState: Signal<Equipment<S> | null>;
  createLifecycle?(equipment: Equipment<S>): EquipmentLifecycle<S> | undefined;
  present(equipment: Equipment<S> | null): void;
}

/** Observe committed slot changes; finish old cleanup before processing nested writes. */
export function bindPlayerEquipment<S extends EquipmentSlot>(options: PlayerEquipmentOptions<S>) {
  const slot = options.existenceState;
  let active: EquipmentLifecycle<S> | undefined;
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
        if (disposed || pending || slot.peek() !== current) continue;
        if (current) {
          active = options.createLifecycle?.(current);
          active?.onequip(slot);
        }
        if (disposed || pending || slot.peek() !== current) continue;
        options.present(current);
      }
    } finally {
      transitioning = false;
    }
  });

  return {
    update(dt: number) { active?.onFrame?.(dt); },
    flush() { active?.flush?.(); },
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

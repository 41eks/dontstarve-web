import type { HandEquipment, ReadonlySignal } from '../../signals/src';

export type HandEquipmentSignal = ReadonlySignal<HandEquipment | null>;

/** Inventory may republish the same equipped entity after a component/slot update. */
export function watchHandEquipment(
  state: HandEquipmentSignal,
  onChange: (equipment: HandEquipment | null, previous: HandEquipment | null) => void,
): () => void {
  return state.subscribe((equipment, previous) => {
    if (equipment?.itemId === previous?.itemId && equipment?.skinId === previous?.skinId
      && equipment?.entity === previous?.entity) return;
    onChange(equipment, previous);
  });
}

/** Controllers supply their own tool predicate and own the lifetime of their frame task. */
export function bindHandEquipmentUpdate(
  state: HandEquipmentSignal,
  options: {
    isEquipped(equipment: HandEquipment | null): boolean;
    cancel(): void;
    update(dt: number): void;
    registerFrameTask?: (update: (dt: number) => void) => () => void;
  },
): () => void {
  let removeTask: (() => void) | undefined;
  let disposed = false;
  const unregister = () => {
    const remove = removeTask;
    removeTask = undefined;
    remove?.();
  };
  const sync = () => {
    if (disposed) return;
    if (!options.isEquipped(state.peek())) unregister();
    else if (!removeTask) removeTask = options.registerFrameTask?.(options.update);
  };
  const stopEquipment = watchHandEquipment(state, (_equipment, previous) => {
    if (options.isEquipped(previous)) {
      unregister();
      options.cancel();
    }
    // Cancellation may synchronously replace equipment again; use the latest signal.
    sync();
  });
  sync();
  return () => {
    if (disposed) return;
    disposed = true;
    stopEquipment();
    unregister();
  };
}

import { createRenderEffect, untrack, type HandEquipment, type ReadonlySignal } from '../../signals/src';

export type HandEquipmentSignal = ReadonlySignal<HandEquipment | null>;

/** Inventory may republish the same equipped entity after a component/slot update. */
export function watchHandEquipment(
  state: HandEquipmentSignal,
  onChange: (equipment: HandEquipment | null, previous: HandEquipment | null) => void,
): () => void {
  let previous = state.value;
  return createRenderEffect(() => {
    const equipment = state.get();
    const before = previous;
    previous = equipment;
    if (
      equipment?.itemId === before?.itemId &&
      equipment?.skinId === before?.skinId &&
      equipment?.entity === before?.entity
    ) {
      return;
    }
    untrack(() => onChange(equipment, before));
  });
}

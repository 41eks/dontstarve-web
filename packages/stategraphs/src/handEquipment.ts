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

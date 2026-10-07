import { createSignal, readonlySignal, type Signal } from './signal';

/** Stable for one equip lifetime; changing fuel/uses are stored separately. */
export interface HandEquipment {
  readonly itemId: string;
  readonly EQUIPSLOTS: 'HANDS';
  readonly skinId?: string;
}

/** Shared player hand state, statically imported by inventory and prefabs. */
const state = createSignal<HandEquipment | null>(null);
export const handEquipmentState: Signal<HandEquipment | null> = {
  ...state,
  set(value) {
    if (value !== null && value?.EQUIPSLOTS !== 'HANDS') {
      throw new TypeError('Hand equipment must declare EQUIPSLOTS = "HANDS"');
    }
    state.set(value);
  },
};
export const handEquipment = readonlySignal(handEquipmentState);

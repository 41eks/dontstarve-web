import { createSignal, readonlySignal, type Signal } from './signal';

/** Structural identity only: signals has no dependency on inventory or prefabs. */
export interface HandEquipmentEntity {
  readonly id: string;
  readonly prefab: string;
  readonly isRemoved: boolean;
}

/** Prefabs receive the concrete slot; implementations never import player state. */
export interface HandEquipmentLifecycle {
  onequip(slot: Signal<HandEquipment | null>): void;
  onunequip(): void;
  onFrame?(dt: number): void;
  flush?(): void;
}

/** Stable for one equip lifetime; changing fuel/uses are stored separately. */
export interface HandEquipment {
  readonly itemId: string;
  readonly EQUIPSLOTS: 'HANDS';
  readonly skinId?: string;
  readonly entity?: HandEquipmentEntity;
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

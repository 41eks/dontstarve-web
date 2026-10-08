import { createSignal, type Signal } from './signal';

/** Structural identity only: signals has no dependency on inventory or prefabs. */
export interface HandEquipmentEntity {
  readonly id: string;
  readonly prefab: string;
  readonly isRemoved: boolean;
}

/**
 * Prefabs receive a concrete existence state; implementations never import player state.
 * Unequip releases the binding without changing its value.
 */
export interface HandEquipmentLifecycle {
  onequip(handEquipmentExistenceState: Signal<HandEquipment | null>): void;
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

/**
 * Creates an independent hand equipment existence state, initially empty.
 * Inventory publishes the current equip identity after committing a slot change.
 * A bound prefab may set null on depletion only while that identity is still current;
 * the owning store then removes the item. Normal unequip uses inventory transfer.
 * Fuel and burning state belong to the prefab/entity, not this signal.
 */
export function createHandEquipmentExistenceState(): Signal<HandEquipment | null> {
  const state = createSignal<HandEquipment | null>(null);
  return {
    ...state,
    set(value) {
      if (value !== null && value?.EQUIPSLOTS !== 'HANDS') {
        throw new TypeError('Hand equipment must declare EQUIPSLOTS = "HANDS"');
      }
      state.set(value);
    },
  };
}

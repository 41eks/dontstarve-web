import { createSignal, type Signal } from './signal';

export type EquipmentSlot = 'HANDS' | 'HEAD' | 'BODY';

/** Structural identity only; signals has no dependency on inventory or prefabs. */
export interface EquipmentEntity {
  readonly id: string;
  readonly prefab: string;
  readonly isRemoved: boolean;
}

/** Stable for one equip lifetime; fuel and uses belong to the item entity. */
export interface Equipment<S extends EquipmentSlot = EquipmentSlot> {
  readonly itemId: string;
  readonly EQUIPSLOTS: S;
  readonly skinId?: string;
  readonly entity?: EquipmentEntity;
}

/** Unequip releases the injected binding without changing its value. */
export interface EquipmentLifecycle<S extends EquipmentSlot> {
  onequip(existenceState: Signal<Equipment<S> | null>): void;
  onunequip(): void;
  onFrame?(dt: number): void;
  flush?(): void;
}

/**
 * Creates an independent, initially empty equipment existence state.
 * Inventory publishes identity after committing a slot change. A bound prefab
 * may clear its current identity on depletion; the owning store removes the item.
 * Normal unequip uses inventory transfer. Burning and fuel are separate state.
 */
export function createEquipmentExistenceState<S extends EquipmentSlot>(slot: S): Signal<Equipment<S> | null> {
  const state = createSignal<Equipment<S> | null>(null);
  return {
    ...state,
    set(value) {
      if (value !== null && value?.EQUIPSLOTS !== slot) {
        throw new TypeError(`Equipment must declare EQUIPSLOTS = "${slot}"`);
      }
      state.set(value);
    },
  };
}

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

export type HandEquipment = Equipment<'HANDS'>;
export type HeadEquipment = Equipment<'HEAD'>;
export type BodyEquipment = Equipment<'BODY'>;

/** A character stat as equipment sees it: the value, its maximum and a capped assignment. */
export interface EquipmentStat {
  peek(): number;
  set(value: number): void;
  readonly maximum: number;
}

/** owner.components.sanity as equipment reads it; the mode is the wearer's, not the item's. */
export interface EquipmentSanity {
  IsInsanityMode(): boolean;
  GetPercent(): number;
}

/** The equipping actor's event sink (inventoryitem.owner:PushEvent); released on unequip. */
export interface EquipmentOwner {
  ListenForEvent?(name: string, listener: (data: unknown) => void): () => void;
  PushEvent(name: string, data?: unknown): void;
  /** owner.sg:HasStateTag(tag) */
  HasStateTag?(tag: string): boolean;
  /** owner.sg:GoToState(name) */
  GoToState?(name: string): void;
  /** owner.sg.currentstate.name == name */
  IsCurrentState?(name: string): boolean;
  /** owner.components: the stats equipment reads and changes. */
  readonly components?: {
    readonly health?: EquipmentStat & { GetMaxWithPenalty(): number };
    readonly hunger?: EquipmentStat;
    readonly sanity?: EquipmentSanity;
  };
}

/** Unequip releases the injected owner; removal goes through the item entity and its inventory owner. */
export interface EquipmentLifecycle {
  onequip(owner?: EquipmentOwner): void;
  onunequip(): void;
  onFrame?(dt: number): void;
  flush?(): void;
}

/**
 * Creates an independent, initially empty equipment existence state.
 * Inventory publishes identity after committing a slot change; it is observed,
 * not a removal request. A depleted prefab removes its own entity through its
 * injected owner. Burning and fuel are separate state.
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

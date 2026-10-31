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
    readonly health?: { IsHurt(): boolean; DoDelta(amount: number, overtime?: boolean, cause?: string): number };
    readonly hunger?: { readonly current: number; DoDelta(delta: number): void };
    readonly sanity?: EquipmentSanity;
  };
}

/** Unequip releases the injected owner; removal goes through the item entity and its inventory owner. */
export interface EquipmentLifecycle {
  onequip(owner?: EquipmentOwner): void;
  onunequip(): void;
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

/**
 * Runs the equip lifecycle of whatever a slot's existence state holds: the previous item is unequipped before the
 * next is equipped with the injected owner, and a write made during a transition is processed after it.
 */
export function bindEquipmentLifecycle<S extends EquipmentSlot>(options: {
  existenceState: Signal<Equipment<S> | null>;
  owner?: EquipmentOwner;
  createLifecycle?(equipment: Equipment<S>): EquipmentLifecycle | undefined;
  present(equipment: Equipment<S> | null): void;
}) {
  const slot = options.existenceState;
  let active: EquipmentLifecycle | undefined;
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
          active?.onequip(options.owner);
        }
        if (disposed || pending || slot.peek() !== current) continue;
        options.present(current);
      }
    } finally {
      transitioning = false;
    }
  });

  return {
    /** Settle the equipped item's consumption, before saving or transferring it. */
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

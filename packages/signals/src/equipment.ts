import type { Vector3 } from 'three';
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
  /** owner.Transform:GetWorldPosition(), as the ground-plane foot point. */
  getPosition?(): Vector3;
  /** owner.SoundEmitter */
  readonly SoundEmitter?: { PlaySound(path: string): unknown };
  /** owner.components: the stats equipment reads and changes. */
  readonly components?: {
    readonly health?: { IsHurt(): boolean; DoDelta(amount: number, overtime?: boolean, cause?: string): number };
    readonly hunger?: { readonly current: number; DoDelta(delta: number): void };
    readonly sanity?: EquipmentSanity;
    /** inventory:GetEquippedItem(eslot): the worn inst, with the components equipment callbacks reach. */
    readonly inventory?: { GetEquippedItem(kind: 'hand' | 'body' | 'head'): EquippedItem | null };
  };
  /**
   * The owner as one inst's equip callbacks see it. Its `AnimState` is that inst's own slot over the owner's sprite;
   * equippable:Equip opens the view and equippable:Unequip closes it after onunequip.
   */
  OpenEquipmentView?(inst: object): EquipmentOwnerView;
}

export interface EquipmentOwnerView extends EquipmentOwner {
  /** Keeps the inst's slot drawn after the view closes, until the returned function runs. */
  Retain(): () => void;
  close(): void;
}

/** An equipped inst as another equipment callback sees it through the owner's inventory. */
export interface EquippedItem {
  readonly components: {
    readonly armor?: { SetAbsorption(absorbPercent: number): void };
    readonly useableitem?: { StopUsingItem(): void };
  };
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

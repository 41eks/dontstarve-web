import { createSignal, readonlySignal, type ReadonlySignal } from '@dontstarve-web/signals';
import type { InventoryItemSignals, SlotAddress } from '@dontstarve-web/inventory';

export type { SlotAddress } from '@dontstarve-web/inventory';

export interface SlotSelectDetail {
  slot: SlotAddress;
}

export interface SlotContextMenuDetail {
  slot: SlotAddress;
  shiftKey: boolean;
}

export interface SlotItem {
  entityId?: string;
  id: string;
  skinId?: string;
  name: string;
  count: number;
  maxStack: number;
  icon: string;
  atlas?: string;
  equippable?: string;
  /** Remaining fuel/uses as a fraction of the maximum. */
  durabilityPercent?: number;
  /** Remaining freshness as a fraction; absent when no perishable projection is provided. */
  freshnessPercent?: number;
  /** inventoryitem's wetnesschange/GetIsWet is a boolean UI state. */
  wet?: boolean;
  /** Injected by inventory; the UI subscribes to the item's authoritative component state. */
  signals?: InventoryItemSignals;
}

/** Sample live values for input/transfer requests; never retain a second mutable count. */
export function currentSlotItem(item: SlotItem | null): SlotItem | null {
  if (!item?.signals) return item;
  return { ...item, count: item.signals.count.get(),
    durabilityPercent: item.signals.durabilityPercent.get(),
    freshnessPercent: item.signals.freshnessPercent.get(), wet: item.signals.wet.get() };
}

/** Live value changes are published by inventory; only identity/metadata replace the UI item. */
export function sameSlotPresentation(left: SlotItem | null, right: SlotItem | null): boolean {
  return left === right || !!left?.signals && left.signals === right?.signals
    && left.entityId === right.entityId && left.id === right.id && left.skinId === right.skinId
    && left.name === right.name && left.icon === right.icon && left.atlas === right.atlas
    && left.maxStack === right.maxStack && left.equippable === right.equippable;
}

export interface SlotModel {
  readonly address: SlotAddress;
  readonly item: ReadonlySignal<SlotItem | null>;
  getItem(): SlotItem | null;
  setItem(item: SlotItem | null): void;
  accepts(item: SlotItem): boolean;
  maxStack?(item: SlotItem): number;
}

export interface CreateSlotOptions {
  address: SlotAddress;
  accepts?: (item: SlotItem) => boolean;
}

export function createSlot(options: CreateSlotOptions): SlotModel {
  const item = createSignal<SlotItem | null>(null);

  return {
    address: { ...options.address },
    item: readonlySignal(item),
    getItem: () => currentSlotItem(item.get()),
    setItem: next => { if (!sameSlotPresentation(item.peek(), next)) item.set(next); },
    accepts: options.accepts ?? (() => true),
  };
}

export function sameSlotAddress(left: SlotAddress | null, right: SlotAddress | null): boolean {
  return left !== null
    && right !== null
    && left.containerId === right.containerId
    && left.slotKey === right.slotKey;
}

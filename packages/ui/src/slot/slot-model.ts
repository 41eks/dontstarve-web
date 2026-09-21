import { createSignal } from '../signal';

export interface SlotAddress {
  containerId: string;
  slotKey: string;
}

export interface SlotSelectDetail {
  slot: SlotAddress;
}

export interface SlotContextMenuDetail {
  slot: SlotAddress;
  shiftKey: boolean;
}

export interface SlotItem {
  id: string;
  name: string;
  count: number;
  maxStack: number;
  icon: string;
  atlas?: string;
  equippable?: string;
}

export interface SlotModel {
  readonly address: SlotAddress;
  getItem(): SlotItem | null;
  setItem(item: SlotItem | null): void;
  accepts(item: SlotItem): boolean;
}

export interface CreateSlotOptions {
  address: SlotAddress;
  accepts?: (item: SlotItem) => boolean;
}

export function createSlot(options: CreateSlotOptions): SlotModel {
  const item = createSignal<SlotItem | null>(null);

  return {
    address: { ...options.address },
    getItem: item.get,
    setItem: item.set,
    accepts: options.accepts ?? (() => true),
  };
}

export function sameSlotAddress(left: SlotAddress | null, right: SlotAddress | null): boolean {
  return left !== null
    && right !== null
    && left.containerId === right.containerId
    && left.slotKey === right.slotKey;
}

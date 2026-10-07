import { createSignal } from '../signal';
import type { SlotAddress } from '@dontstarve-web/inventory';

export type { SlotAddress } from '@dontstarve-web/inventory';

export interface SlotSelectDetail {
  slot: SlotAddress;
}

export interface SlotContextMenuDetail {
  slot: SlotAddress;
  shiftKey: boolean;
}

export interface SlotItem {
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
}

export interface SlotModel {
  readonly address: SlotAddress;
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

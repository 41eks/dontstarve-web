import { createSlot, type SlotItem, type SlotModel } from './slot-model';

export type SlotContainerKind = 'inventory' | 'equipment' | 'chest';

export interface SlotContainer {
  readonly id: string;
  readonly kind: SlotContainerKind;
  readonly slots: readonly SlotModel[];
  getSlot(slotKey: string): SlotModel;
}

export interface CreateSlotContainerOptions {
  id: string;
  kind: SlotContainerKind;
  slotKeys: readonly string[];
  accepts?: (slotKey: string, item: SlotItem) => boolean;
}

export function createSlotContainer(options: CreateSlotContainerOptions): SlotContainer {
  if (!options.id) throw new TypeError('Slot container id must not be empty');

  const uniqueKeys = new Set(options.slotKeys);
  if (uniqueKeys.size !== options.slotKeys.length || uniqueKeys.has('')) {
    throw new TypeError('Slot keys must be unique and non-empty');
  }

  const slots = options.slotKeys.map((slotKey) => createSlot({
    address: { containerId: options.id, slotKey },
    accepts: (item) => options.accepts?.(slotKey, item) ?? true,
  }));
  const slotsByKey = new Map(slots.map((slot) => [slot.address.slotKey, slot]));

  return {
    id: options.id,
    kind: options.kind,
    slots,
    getSlot(slotKey) {
      const slot = slotsByKey.get(slotKey);
      if (!slot) throw new RangeError(`Unknown slot ${options.id}:${slotKey}`);
      return slot;
    },
  };
}

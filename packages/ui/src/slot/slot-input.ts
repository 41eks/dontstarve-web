import { createSignal, readonlySignal, type ReadonlySignal } from '@dontstarve-web/signals';
import type { SlotContextMenuDetail, SlotItem, SlotModel } from './slot-model';

export interface SlotSecondaryInput {
  shiftKey: boolean;
}

export interface SlotContextMenuRequest extends SlotContextMenuDetail {
  action: 'drop' | 'use';
  /** UI snapshot for validation against the authoritative inventory entity. */
  item: Readonly<SlotItem> | null;
}

/** invslot.lua:OnControl -> DropItem / UseItem; concrete actions belong to inventory. */
export function bindSlotContextMenuInput(
  input: ReadonlySignal<SlotSecondaryInput | null>,
  slot: SlotModel,
) {
  const request = createSignal<SlotContextMenuRequest | null>(null);
  // Subscribe to each input transition: effects may coalesce repeated clicks and
  // must never execute an action again when only the slot's UI projection changes.
  const dispose = input.subscribe(control => {
    if (!control) return;
    const item = slot.item.peek();
    request.set({
      slot: { ...slot.address },
      shiftKey: control.shiftKey,
      action: control.shiftKey ? 'drop' : 'use',
      item: item ? { ...item } : null,
    });
  });
  return { request: readonlySignal(request), dispose };
}

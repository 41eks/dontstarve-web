import {
  createRenderEffect,
  createSignal,
  readonlySignal,
  untrack,
  type ReadonlySignal,
} from '@dontstarve-web/signals';
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
export function bindSlotContextMenuInput(input: ReadonlySignal<SlotSecondaryInput | null>, slot: SlotModel) {
  const request = createSignal<SlotContextMenuRequest | null>(null);
  // Each click is a new input object handled synchronously once; the slot's UI projection is read untracked, so a
  // change to it never executes an action again.
  let handled = input.peek();
  const dispose = createRenderEffect(() => {
    const control = input.get();
    if (control === handled) {
      return;
    }
    handled = control;
    if (!control) {
      return;
    }
    const item = untrack(() => slot.getItem());
    request.set({
      slot: { ...slot.address },
      shiftKey: control.shiftKey,
      action: control.shiftKey ? 'drop' : 'use',
      item: item ? { ...item } : null,
    });
  });
  return { request: readonlySignal(request), dispose };
}

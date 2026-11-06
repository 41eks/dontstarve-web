import type { ReadonlySignal } from '@dontstarve-web/signals';
import type { SlotItem } from './slot-model';
import type { SlotContainer } from './slot-container';

/** A logical slot (inventory.lua's itemslots/equipslots/activeitem or container.lua's slots) holding its inst. */
export interface EntitySlotSignal<TItem> { readonly entity: ReadonlySignal<TItem | null> }

/**
 * itemslot.lua / itemtile.lua: each UI slot follows the inst in its logical slot, and `toItem` maps the inst to a UI
 * item whose tile declaration carries its live values. Shared by the inventory bar and container panels.
 */
export function bindSlotEntities<TItem>(target: SlotContainer, slots: readonly (readonly [slotKey: string, slot: EntitySlotSignal<TItem>])[],
  toItem: (item: TItem) => SlotItem): () => void {
  const stops = slots.map(([slotKey, slot]) => {
    const model = target.getSlot(slotKey);
    const show = (item: TItem | null) => model.setItem(item === null ? null : toItem(item));
    show(slot.entity.peek());
    return slot.entity.subscribe(show);
  });
  return () => stops.splice(0).forEach(stop => stop());
}

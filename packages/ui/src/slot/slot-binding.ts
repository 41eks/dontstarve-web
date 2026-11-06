import type { ReadonlySignal } from '@dontstarve-web/signals';
import type { SlotItem } from './slot-model';
import type { SlotContainer } from './slot-container';

/** A logical slot (inventory.lua's itemslots/equipslots/activeitem or container.lua's slots) holding its inst. */
export interface EntitySlotSignal<TItem> { readonly entity: ReadonlySignal<TItem | null> }

/**
 * Logical slots keyed as their UI slots: an array by index (container slots, itemslots, the active item) or a record
 * by slot key (equipslots). Missing entries leave their UI slot unbound.
 */
export type EntitySlots<TItem> = readonly (EntitySlotSignal<TItem> | undefined)[]
  | Readonly<Partial<Record<string, EntitySlotSignal<TItem>>>>;

/**
 * itemslot.lua / itemtile.lua: each UI slot subscribes to its own logical slot's inst, and `toItem` maps the inst to a
 * UI item whose tile declaration carries its live values. The inventory bar and every container panel bind through this.
 */
export function bindSlotEntities<TItem>(target: SlotContainer, slots: EntitySlots<TItem>, toItem: (item: TItem) => SlotItem): () => void {
  const stops = Object.entries(slots).flatMap(([slotKey, slot]) => {
    if (!slot) return [];
    const model = target.getSlot(slotKey);
    const show = (item: TItem | null) => model.setItem(item === null ? null : toItem(item));
    show(slot.entity.peek());
    return [slot.entity.subscribe(show)];
  });
  return () => stops.splice(0).forEach(stop => stop());
}

# Inventory package instructions

适用于 `packages/inventory` 及其在应用层、UI 中的接线。

## Inventory architecture

- `packages/inventory` owns authoritative state and domain types. Concrete slot kinds must not share an implementation superclass; `InventorySlot` supplies stack limits, pure `craft()` computes the result, and `InventoryStore` applies it atomically.
- Keep application item metadata/overrides in `src/inventoryItems.ts`, player store construction in `src/inventory.ts`, UI rendering in `packages/ui/src/inventory-bar.ts`, and store/UI/gameplay wiring in `src/main.ts`. UI slot models mirror application state; they are not authoritative.
- Equipment prefabs receive only an injected owner at equip time (`onequip(owner)`, an `EquipmentOwner` with `PushEvent`), keep it while equipped, and release it on `onunequip()` or disposal. When fuel or durability is exhausted they remove their own item entity (`entity.remove()` delegates to the inventory owner, as `inst:Remove()` does in Lua) and then push the Lua event (for example `itemranout`) to the owner, so removal precedes the event and auto-re-equip works. Prefabs must not import global player equipment state or write equipment existence signals; unbound ground items have no owner and only remove themselves.
- Use stable `{ containerId, slotKey }` addresses and the existing address helpers, including `inventorySlotAddress()` and `equipmentSlotAddress()` for player slots.
- The cursor holds an authoritative inventory entity at `cursorSlotAddress()`, not a second UI-owned item copy. Preserve it through failed placement, cancellation, and save/load; exclude it from automatic item allocation and crafting materials or products.
- Play inventory transfer, drop, and pickup result animations only after the operation succeeds. Preserve ground models' source origin as the foot point for ordering, pickup, and saves.
- See [inventory wiring, initial state, and gameplay behavior](../../docs/inventory-architecture.md).

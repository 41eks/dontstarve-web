# Repository instructions

## DST asset paths

- Assets sourced from `/data/copy/AssetArchive-Dev/data/DST/data` must be placed under `public/dst/data`.
- Preserve each asset's relative path below the source `data` directory. For example, `/data/copy/AssetArchive-Dev/data/DST/data/anim/wilson.zip` maps to `public/dst/data/anim/wilson.zip`.
- Runtime URLs must follow the same mirrored path below `${import.meta.env.BASE_URL}dst/data/`; do not flatten or rename DST asset files.

## Inventory architecture

- `src/inventory.ts` owns authoritative inventory state through `InventoryStore`. It defines item metadata, the 15 player inventory slots, three equipment slots (`hand`, `body`, and `head`), stack rules, crafting consumption, and atomic slot changes.
- `packages/ui/src/inventory-bar.ts` renders inventory and equipment slots. UI slot models mirror state supplied by the application; they are not the source of truth.
- `src/main.ts` connects the store and UI. Store notifications call `setSlot`, while UI events are translated back into store operations or gameplay actions.
- Slot addresses are stable `{ containerId, slotKey }` values. Use `inventorySlotAddress()` and `equipmentSlotAddress()` instead of constructing player slot addresses ad hoc.
- Drag-and-drop emits `game:slot-transfer-request`; selection emits `game:slot-select`; right-clicking a slot emits `game:slot-context-menu`. These events bubble across the inventory bar's shadow root.
- The webpage suppresses the browser's native context menu. In the current gameplay mapping, right-clicking a `meatballs` stack calls `WilsonAnimationController.playEat()` and plays `anim/player_actions_eat.zip`; it does not consume the stack.
- Moving `torch` into the hand equipment slot plays `item_out`; moving it back to inventory plays `item_in`. Both one-shot animations come from `anim/player_actions_item.zip` and only run after a successful inventory transfer.
- Shift-right-clicking an occupied inventory or equipment slot drops one item at the player's current ground position. Ground items are rendered from their inventory-atlas icon and return to inventory when clicked; successful dropping and pickup both play `pickup` from `anim/player_actions_item.zip` at half of the source animation's playback speed.
- Add item definitions or overrides in `src/inventory.ts`. Inventory icons default to `images/inventoryimages.xml` inside `public/dst/data/databundles/images.zip`, with an optional per-item atlas override.

# Repository instructions

## DST asset paths

- Assets sourced from `/data/copy/AssetArchive-Dev/data/DST/data` must be placed under `public/dst/data`.
- Preserve each asset's relative path below the source `data` directory. For example, `/data/copy/AssetArchive-Dev/data/DST/data/anim/wilson.zip` maps to `public/dst/data/anim/wilson.zip`.
- Runtime URLs must follow the same mirrored path below `${import.meta.env.BASE_URL}dst/data/`; do not flatten or rename DST asset files.

## Billboard drawing order

- Treat each overlapping animated billboard, such as the player or Pig King, as one render-order entity. Every frame, sort entities from far to near using the camera-space depth of their ground-contact/foot point.
- Merge all parts of one animated sprite frame into one `BufferGeometry`. Bake each DST element's 2D transform into its quad vertices and preserve DST layer order through the index/group sequence; do not restore one `Mesh` per body part.
- Apply entity order to the innermost `visual` `THREE.Group` registered by `@three-roaming/wilson`. Do not rely on `scene.add()` order or assign globally colliding per-part `renderOrder` values.
- Preserve consecutive material groups when a frame uses multiple atlas materials. Three.js issues one draw call per geometry group, so do not describe a multi-material frame as unconditionally one draw call; Wilson carrying an item may mix base and swap atlases.
- Precompose layered DST frames used by instanced scenery through the RGBA sprite-atlas API in `packages/wilson/src/rgbaSpriteAtlas.ts`. Instances must share the resulting texture and single-quad geometry; do not instance the unresolved overlapping DST part geometry.
- Instanced billboard forests cannot be interleaved per instance with dynamic transparent entities in one draw call. Use an alpha-tested, color-disabled depth prepass (`colorWrite = false`, `depthWrite = true`) followed by a transparent color pass with `depthWrite = false`; submit the color pass before dynamic characters. Do not enable depth writes on the forest color materials because coplanar DST layers will z-fight and flicker while the camera moves.
- Use the actual foot point for depth ordering rather than the sprite center or bounding-box center; tall sprites otherwise switch order too early or too late.

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

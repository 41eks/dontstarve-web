# Repository instructions

## Lua parity and missing implementations

- Align TypeScript implementations with the corresponding DST Lua source under `/data/copy/AssetArchive-Dev/data/DST/data/databundles/scripts_unpacked/scripts`: preserve responsibility boundaries, tags and components, action selection and buffering, stategraph timing and lifecycle, validation, state transitions, consumption, and save/load behavior.
- If Lua alignment depends on missing functionality in `packages/prefab`, `packages/brains`, `packages/componets`, or another package, add the smallest source-faithful implementation in the owning package as part of the same change. Do not bypass missing implementations with application-level prefab special cases, callback chains, or duplicate controllers.
- Read the relevant prefab, component, brain, action, and stategraph Lua before implementing a behavior. Keep the minimal implementation within the source branches needed by the task; do not invent behavior or leave a required dependency unimplemented.

## Spatial queries and distance calculations

- Pass positions as `Vector3` values and calculate distances directly with `distanceTo()` or `distanceToSquared()`; use squared distances for radius comparisons. Ground-contact positions already have `y = 0`, so do not separate the Y axis, project onto XZ, or create temporary vectors to zero Y. Reuse existing position vectors without mutating them.

## Component signals, timers, and derived state

- `createEffect` 回调按同步代码编写，调度语义保持现状；观察 effect 更新结果时在后续宏任务断言，专门验证同步契约的测试除外。宏任务等待示例：`await new Promise(resolve => setTimeout(resolve, 0))`。
- Do not refactor global signals, change effect scheduling, or add timing compensation merely because an effect update takes a microtask. For plant growth and other game-time behavior, use the component's scheduler and deadlines; a negligible microtask delay does not justify a global timing change. Keep fixes within the requested feature and its necessary owning components.
- Classes and components consuming global/world signals or injected shared signals must create one private local signal per source with `watchSignal(source, registerCleanup)` from `packages/signals`. Do not use the source's `peek()` as a substitute for lifecycle-managed state access, or register the class's multiple consumers directly on the shared source. Use the local signal's `get()` inside ordinary `createEffect` / pure `createMemo` computations; local `peek()` remains valid for intentional non-reactive reads, including initialization and timer callbacks.
- Register each `watchSignal` cleanup with the owning class and invoke it on entity/component removal or explicit disposal. That cleanup owns the source bridge and all local effects/memos that read `get()` and local `subscribe()` listeners, including effects that later switch dependencies; do not separately collect every consumer's cleanup. Keep watched signals private to their owner, and let other classes create their own watched signals from the shared source. Returned signals retain the standard `get()` / `set()` / `peek()` / `subscribe()` interface; use ordinary `createEffect`, not signal `.effect()` / `.dispose()` methods. Authoritative shared state remains owned by its original source.
- Components must use `createEffect` and `get()` to respond to external state changes, calling component methods to perform transitions. Presentation effects must not perform domain actions. Timer expiration and completion actions must still execute through the game-time scheduler; `createMemo` computations must always remain pure.
- All components involving time scheduling must store each timer itself as a private writable signal and expose only a read-only view. Represent scheduled deadlines, paused remaining time, stopped timers, and expired timers distinctly; cancellation must not be indistinguishable from expiration.
- Derive timer-dependent state with pure `createMemo` computations from the timer signal and any other authoritative component data. Do not maintain separate writable copies of derived state, perform domain actions in memos, or rely on presentation effects to execute timer completion or entity removal.
- The game-time scheduler registers and cancels tasks and updates timer signals on setup, pause, resume, cancellation, expiration, and restoration. Discrete timers remain unchanged while waiting; do not decrement them each frame or subscribe entity memos to the global clock to detect expiration. Preserve the existing settlement rules for fuel, freshness, and world time; animation and light interpolation may still sample time each frame.
- Port Lua `WatchWorldState("cycles", fn)` (a once-per-day callback) as a discrete timer on the game-time scheduler, not as a subscription to the global clock signal or a `cycles` comparison. The component owns a `ComponentTimer` whose read-only snapshot is exposed; the world injects `secondsUntilNextDay(now)` (the component never reads the clock or tuning). On expiry, run the day callback and arm the next boundary, so a long frame or a load catches up one day at a time. Disabling or removing the component writes `stopped` and cancels the task; the timer is not saved, and load re-arms it from the current world time. See [DST events, timer signals, and derived state](docs/dst-event.md) (beefalo beard).
- Preserve timer state through save/load according to the source component's persistence behavior, rebuilding deadlines and tasks from saved remaining time; cancel tasks on permanent removal and retain logical timers when only unloading or replacing visuals. See [DST events, timer signals, and derived state](docs/dst-event.md).

## Page lifecycle

- Do not register resource cleanup on `pagehide`; leaving the page does not require application-managed disposal. Do not move the same cleanup to `beforeunload` or `unload`, or add a shutdown manager solely for page departure.
- Keep explicit disposal and subscription cleanup for lifecycles within the running page, including entity removal, unequipping, scene teardown or reinitialization, and tests.

## Representative tests

- Tests may copy `public/saves/initial-world copy.json` into the relevant `tests` directory and modify the copied save to construct any required test scene.
- Keep tests focused on representative behavior: a normal flow, a meaningful boundary or cancellation, and state/resource preservation where relevant. Avoid adding a separate test for every prefab, cosmetic skin, equivalent command spelling, or combination of inputs handled by the same implementation.
- Sample distinct asset/rendering paths, such as split bank/build archives, symbol overrides, layered sprites and invisible equipment. Use the asset import scripts' `--check` modes for exhaustive catalog/path/byte validation instead of rendering every cosmetic variant in tests.
- Keep browser tests for actual input, layout, WebGL/audio behavior and a few complete gameplay flows. Cover pure domain rules in unit tests and avoid repeating the same assertion in both suites. Remove obsolete tests and unused fixtures rather than leaving them skipped or excluding them through runner configuration.

## Debug command documentation

- After each change, check whether debug commands, arguments, behavior, or prefab IDs changed. Update the debug command section of `README.md` in the same change, including syntax, parameters, examples, and supported `c_spawn` IDs; revise or remove outdated entries.
- After completing a change that adds a debug command or newly supported prefab/item ID, consult [the prefab command static audit](docs/dst-prefab-console.md) and test the new command support, including `c_spawn` and/or `c_give` as applicable. Also test `c_save()` after executing the commands: verify successful save export and reload, preserving the resulting entities/items and relevant identity, position, quantity, skin, and component state. Keep automated coverage representative as required above.

## Prefab porting requirements

- Resolve inventory UI icons, ground/world art, and equipped art separately from source Lua and metadata, including the actual atlas, bank/build/clip, and skin overrides. Use animation/build assets for available ground art, including single-frame poses; do not substitute inventory icons or infer assets from item IDs.
- Prefabs with source-defined skins must support the existing `reskin_tool` workflow, including skin assets, symbol overrides, and inventory icons where applicable. Preserve identity, position, component state, and selected skins through reskinning, dropping, pickup, equipment changes, and save/load. Do not invent skins for prefabs without them.
- Expose world prefabs through `c_spawn("prefab_id")` and inventory items through `c_give("item_id", count)`, using actual source IDs. Support both when both forms exist.
- These requirements also apply to artwork/animation-only ports unless the user explicitly narrows the scope.

## DST assets and sound

- Mirror assets from `/data/copy/AssetArchive-Dev/data/DST/data` under `public/dst/data`, preserving relative paths and original filenames. Runtime URLs must use the same paths below `${import.meta.env.BASE_URL}dst/data/`.
- Resolve each inventory icon's actual `images/inventoryimages*.xml` atlas in `databundles/images.zip`, including skin overrides; do not assume all icons belong to `inventoryimages.xml`.
- Inventory icons are only a ground-art fallback for items outside the ground prefab/catalog system. Keep NPC-only `shadow_thrall_parasitehat` excluded from hat imports, inventory metadata, recipes, and fallbacks.
- Regenerate and verify catalogued ground assets with `packages/prefab/scripts/import-ground-items.py` and `--check`, preserving source paths and bytes. See [item asset examples and import workflow](docs/dst-item-assets.md).
- Decode DST FSB banks with `/usr/bin/vgmstream-cli`; read [the extraction guide](docs/vgmstream-cli-guide.md) and check the installed CLI's `-h` before extracting. Inspect metadata without creating WAVs beside source banks; export unextended samples with `-i` and implement looping in the browser.
- Verify source Lua event → FEV event → sound definition → bank/file mapping; do not choose streams by name similarity. Convert zero-based FEV `file_index` to one-based extraction indices. Distinguish prefab appearance audio from player casting audio.
- Decoded WAVs are the filename exception: preserve the bank's relative directory and use `<bank>.fsb-<index>.wav` with `-`, not `#`. Compare exported bytes with an existing decoded source WAV when available.
- Centralize event mappings and playback in `packages/prefab/src/sound.ts` using `PlaySound`, `PreloadSounds`, and `DisposeSounds`; do not add a separate audio class/file per prefab or special Vite sound middleware.
- Preload/decode before spawning or timed actions, resume audio during a user gesture, give each entity an independent looping source, and stop/disconnect its sounds on removal. Dispose all sounds on explicit game shutdown within the running page; do not trigger this cleanup on `pagehide`.

## Billboard drawing order and wall facing

- Sort animated billboards as whole entities each frame, far to near by camera-space depth of the actual ground-contact/foot point, never the sprite or bounding-box center.
- Merge each animated frame's parts into one `BufferGeometry`, baking their 2D transforms into vertices and preserving DST layer order through indices and consecutive material groups. Do not restore one mesh per body part or assume a multi-material frame is one draw call.
- Apply entity order to the innermost registered `visual` group; do not rely on `scene.add()` order or globally colliding per-part `renderOrder` values.
- Set `forceSinglePass = true` on transparent `DoubleSide` materials used by merged billboards to preserve layer order for mirrored parts.
- Precompose layered frames for instanced scenery through `packages/animation/src/rgbaSpriteAtlas.ts`; instances must share the resulting texture and single-quad geometry, not unresolved overlapping part geometry.
- For instanced billboard forests, use an alpha-tested, color-disabled depth prepass (`colorWrite = false`, `depthWrite = true`) followed by a transparent color pass (`depthWrite = false`) before dynamic characters. Do not write depth in the forest color pass.
- Walls remain at world rotation `0` and switch eight-faced art using the source facing masks and camera heading. Pair equivalent frames from the same animation across facings.
- List all static sprite facings in `imageIndices` and switch with `showImage()` rather than rebuilding the sprite. Preserve layered wall art through `overlay` with positionally paired `imageIndices`.
- See [rendering rationale, wall masks, and frame examples](docs/dst-billboard-rendering.md).

## World time and temperature

- Refresh day/night progress and world temperature once every 60 active game frames. Accumulate the actual `dt` of those frames and apply the whole elapsed time in each settlement; never assume a fixed frame rate or replace this with a fixed wall-clock interval. Per-frame scheduling must not write day/night progress or world temperature signals, or refresh their UI, between settlements.
- Settle any partial batch before saving or stopping/disposing the scene. Initialize and restore clock/temperature state immediately on load, preserving elapsed game time, seasonal temperature, and noise time through save/load. Season changes remain explicit signal updates; they must not trigger redundant per-frame writes.
- Keep day/night and season inputs as signals and derive world temperature with `createMemo`. Release memo dependencies and clock/season presentation subscriptions when disposing the scene.

## Inventory architecture

- `packages/inventory` owns authoritative state and domain types. Concrete slot kinds must not share an implementation superclass; `InventorySlot` supplies stack limits, pure `craft()` computes the result, and `InventoryStore` applies it atomically.
- Keep application item metadata/overrides in `src/inventoryItems.ts`, player store construction in `src/inventory.ts`, UI rendering in `packages/ui/src/inventory-bar.ts`, and store/UI/gameplay wiring in `src/main.ts`. UI slot models mirror application state; they are not authoritative.
- Equipment prefabs receive only an injected owner at equip time (`onequip(owner)`, an `EquipmentOwner` with `PushEvent`), keep it while equipped, and release it on `onunequip()` or disposal. When fuel or durability is exhausted they remove their own item entity (`entity.remove()` delegates to the inventory owner, as `inst:Remove()` does in Lua) and then push the Lua event (for example `itemranout`) to the owner, so removal precedes the event and auto-re-equip works. Prefabs must not import global player equipment state or write equipment existence signals; unbound ground items have no owner and only remove themselves.
- Settle remaining fuel once every 60 active game frames, accumulating the actual `dt` of those frames. Settle food freshness every 10 game seconds through the game-time scheduler, using actual elapsed game time so consumption and spoilage rates remain independent of frame rate. Per-frame scheduling must not write these values or refresh their UI. Settle any partial batch before saving, transferring, dropping, picking up, reskinning, or stopping the item's timer, preserving elapsed time and item state across lifecycle changes.
- Use stable `{ containerId, slotKey }` addresses and the existing address helpers, including `inventorySlotAddress()` and `equipmentSlotAddress()` for player slots.
- The cursor holds an authoritative inventory entity at `cursorSlotAddress()`, not a second UI-owned item copy. Preserve it through failed placement, cancellation, and save/load; exclude it from automatic item allocation and crafting materials or products.
- Keep `game:slot-transfer-request`, `game:slot-select`, and `game:slot-context-menu` bubbling across the inventory bar's shadow root. Selection must remain cancelable and run before transfer pickup so placement can claim the click with `preventDefault()`.
- Play inventory transfer, drop, and pickup result animations only after the operation succeeds. Preserve ground models' source origin as the foot point for ordering, pickup, and saves.
- See [inventory wiring, initial state, and gameplay behavior](docs/inventory-architecture.md).

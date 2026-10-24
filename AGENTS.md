# Repository instructions

## Lua parity and missing implementations

- Align TypeScript implementations with the corresponding DST Lua source under `/data/copy/AssetArchive-Dev/data/DST/data/databundles/scripts_unpacked/scripts`: preserve responsibility boundaries, tags and components, action selection and buffering, stategraph timing and lifecycle, validation, state transitions, consumption, and save/load behavior.
- If Lua alignment depends on missing functionality in `packages/prefab`, `packages/brains`, `packages/componets`, or another package, add the smallest source-faithful implementation in the owning package as part of the same change. Do not bypass missing implementations with application-level prefab special cases, callback chains, or duplicate controllers.
- Read the relevant prefab, component, brain, action, and stategraph Lua before implementing a behavior. Keep the minimal implementation within the source branches needed by the task; do not invent behavior or leave a required dependency unimplemented.
- When porting a prefab or child/FX entity, keep every tag the Lua source adds (`inst:AddTag(...)`, such as `FX`, `NOCLICK`, `DECOR`), regardless of whether its semantics seem relevant or are consumed yet. Apply them on the entity (`addTag` / `userData.tags`) exactly as in Lua, including non-networked child entities like mist or particles; never drop or substitute a tag because it looks unused.

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

## Tickingarea and animation

- `tickingarea` is this project's own mechanism with no Lua counterpart; do not describe it or justify behavior with Lua semantics. Animation playback must not be decided by `tickingarea`: whether and which animation plays follows the source Lua and the entity's own state, and `tickingarea` only gates resource loading, subscriptions and logical activity as in [tile lifecycle](docs/tile-lifecycle.md). Camera culling is separate from both.

## Page lifecycle

- Do not register resource cleanup on `pagehide`; leaving the page does not require application-managed disposal. Do not move the same cleanup to `beforeunload` or `unload`, or add a shutdown manager solely for page departure.
- Keep explicit disposal and subscription cleanup for lifecycles within the running page, including entity removal, unequipping, scene teardown or reinitialization, and tests.

## Representative tests

- Tests may copy `public/saves/Cluster_1` into the relevant `tests` directory and modify the copied save to construct any required test scene.
- Keep tests focused on representative behavior: a normal flow, a meaningful boundary or cancellation, and state/resource preservation where relevant. Avoid adding a separate test for every prefab, cosmetic skin, equivalent command spelling, or combination of inputs handled by the same implementation.
- Sample distinct asset/rendering paths, such as split bank/build archives, symbol overrides, layered sprites and invisible equipment. Use the asset import scripts' `--check` modes for exhaustive catalog/path/byte validation instead of rendering every cosmetic variant in tests.
- Keep browser tests for actual input, layout, WebGL/audio behavior and a few complete gameplay flows. Cover pure domain rules in unit tests and avoid repeating the same assertion in both suites. Remove obsolete tests and unused fixtures rather than leaving them skipped or excluding them through runner configuration.

## Debug command documentation

- After each change, check whether debug commands, arguments, behavior, or prefab IDs changed. Update the debug command section of `README.md` in the same change, including syntax, parameters, examples, and supported `c_spawn` IDs; revise or remove outdated entries.
- After completing a change that adds a debug command or newly supported prefab/item ID, consult [the prefab command static audit](docs/dst-prefab-console.md) and test the new command support, including `c_spawn` and/or `c_give` as applicable. Also test `c_save()` after executing the commands: verify successful save export and reload, preserving the resulting entities/items and relevant identity, position, quantity, skin, and component state. Keep automated coverage representative as required above.

## Prefab porting requirements

- sprite 创建与共享：prefab 动画必须通过 `createSharedArchiveSprite()`（含预载入口 `preloadSharedArchiveSprite()`）或 `createSpriteFactory()` 获取。不得在 prefab 中直接调用 `createArchiveSprite()`、自行创建逐实体帧几何，或新增仅包装 prefab 动作名称的动画构造层。动画名称、循环方式、动作选择及后续播放由 prefab 按源 Lua 通过控制器的 `playOnce()` / `start()` 等接口指定。
- 植物实例化：植物 prefab 的 sprite 必须通过上述 shared archive 路径创建；需要预载后同步创建时使用 `preloadSharedArchiveSprite()`。所有循环动画必须通过 `instancedAnimations` 使用共享的 `InstancedMesh` 合批渲染，并保留各实体独立的播放进度、交互和生命周期；需要同时实例化非循环动画时可使用 `instancedAnimations: 'all'`，保留完成回调和末帧语义。动画是否循环仍按源 Lua 决定，不得为了实例化将非循环动画改为循环。
- sprite 驻留：需要按 tile 活动状态卸载／重建 visual 的 prefab，由 `PrefabInstance`（逻辑实体）声明状态、动画与 FX，`packages/display` 的 `PrefabDisplay` 订阅并绘制；tile 活动通过 `watchTileActivity()` 写入 `instance.setActive()`。`PrefabDisplay` 内部复用 `packages/animation/src/residentSprite.ts` 的 `ResidentSprite`（`ArchiveSprite` 路径）或 `ResidentSpriteController`（factory／`SpriteController` 路径）；创建回调仍须使用上述共享入口。它负责稳定根节点、场景挂载、逻辑播放记录及实体 visual 的释放，不创建独立资源缓存，也不选择 prefab 动作或承载组件规则。此通用生命周期封装不属于禁止的 prefab 动作名称包装层。
- 逻辑实体与显示层：`PrefabInstance`（`packages/prefab/src/prefabInstance.ts`）是逻辑实体，声明 `status`（`active | asleep | removed`）、`sprite`（`SpriteState` 的 json：clip、队列、外观、`followAnimation`、`attachFx`／`detachFx` 声明的 FX）、`entityId`、`saveRecord`、`skinId`、`persists`。prefab 只修改这些数据，不得直接创建、挂载或释放 model／sprite，也不得为 FX、跟随动画另写逐 prefab 的 effect；`PrefabDisplay` 订阅这些信号，通过 `createEffect` 做对应的 diff：asleep 释放 sprite 并把 model 移出场景，active 重建并放回原父节点，removed 释放全部。heatrock 的跟随动画、火焰、毒蝇等 FX 由 display 的 `AnimationFollower`／`FxAttachments` 处理，prefab 只声明。
- model 归属与 transform：model 由 display 创建，创建后 display 通过 `instance.attach(model)`（`bindInstance`）把 model 交给 `PrefabInstance`；实例直接读写 model 的 transform（`instance.position` 即 `model.position`），出于性能考虑位置不做成信号，不经 effect、比较或克隆。`status` 与 `sprite` 变化少，仍用信号。实例不负责 model 的场景挂载与释放，这些归 display；未 attach 前读取 `position` 会抛错。
- 驻留状态：卸载 visual 时保留实体身份、脚点、组件和逻辑 timer，重建时恢复记录的 clip 与外观。沿用现有 resident 实现：卸载时正在进行或未加载时请求的过渡动画直接结算至完成状态，执行其完成回调，重新加载后不重播；不保证卸载前的精确播放进度。此为项目资源生命周期约定，不归因于 Lua；游戏时间到期、消耗及实体移除仍由所属组件和调度器负责，不得依赖 visual 重建或卸载来完成。
- 共享缓存：同一 manager／资源生命周期内的实体，shared archive 路径必须复用同一个 `ArchiveSpriteAssets`；factory 路径必须按实际 animation／build、皮肤及控制器配置复用兼容的 factory。不得逐实体或每次唤醒时创建资源缓存、共享源材质或帧几何缓存；实体独立颜色／透明度所需的私有材质副本由动画实现管理。
- 外观状态归属：`overrideSymbol`、`setSymbolOverride`、`setBuildArchive`、`setSymbolHidden`、`setColour` 等外观调用由 prefab 通过 `instance.sprite`（`SpriteState`）声明，保存在 sprite json 的 `appearance` 中；display 在每次 sprite 加载或替换后按 json 重新应用，ResidentSprite／ResidentSpriteController 本身不持有这些状态，也不自行重放。需要在 json 之外保留的外观，prefab 仍须用依赖 `instance.sprite.art` 的 `createEffect` 重新应用；`art` 在 sprite 绘制或释放时变化，不从 tickingarea 信号复制。换皮肤时用 `display.adopt()` 接管替换品的 sprite，保留实体、model 与 json。
- 独立实体状态：各实体独立维护模型位置、播放进度、完成回调和私有外观状态，通过 sprite／控制器接口修改；不得直接修改或释放共享帧的顶点、UV、索引、几何体、源材质或纹理。
- 资源释放：asleep 只释放实体 visual（display 内部的 `sprite.dispose()` 或通过注入的 release 回调调用 `factory.disposeSprite(sprite)`），并把 model 移出场景；共享资源保留供其他实体及再次唤醒复用。永久移除时 prefab 把 `status` 写为 `removed`（`instance.remove()`），display 释放 visual、model 并清理实体订阅；prefab 不绕过 display 直接释放 sprite 或 model。资源所有者须先释放全部实体，再统一调用 `assets.dispose()` 或 `factory.dispose()`，不得在单实体休眠或移除时销毁共享资源。
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
- 图集合成统一走现有 GPU 合成与 CPU 回退入口；运行中的首次外观准备须按帧预算推进，不得在 prefab 或逐实体绘制中增加同步整段合成。预算需包含帧解析与布局，单次不可拆的上传等操作应单独测量；加载预热和测试 `flush()` 可显式完成全部任务。实现与待优化项见 [GPU atlas composition](docs/dst-gpu-atlas-composition.md)。
- 借鉴 Spine 的 sprite 合批时，保留源图层顺序，只合并连续且贴图／混合状态兼容的部件；临时动态缓冲按容量复用，仅提交有效绘制及更新区间，保留尚未消费的更新。不得为缓冲复用改写不可变共享帧，或直接套用 Spine 的颜色空间、预乘 alpha 与深度配置；合成输出必须兼容本项目的 `dstLighting` 和深度预通道。
- 排除离屏合成的绘制统计时，只恢复 calls／triangles／lines／points，不得回退 Three.js 的 `renderer.info.render.frame`；该内部帧编号参与可复用 geometry 的上传判定，回退会使动画后续帧跳过上传。
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

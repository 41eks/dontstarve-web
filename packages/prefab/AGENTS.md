# Prefab package instructions

适用于 `packages/prefab`：prefab、`PrefabInstance`、manager、prefab 资源导入脚本与 `src/sound.ts`。全仓库分工和通用规则见[根 AGENTS.md](../../AGENTS.md)；显示层与动画层的规则分别见 [display](../display/AGENTS.md)、[animation](../animation/AGENTS.md)。

## Tags

- When porting a prefab or child/FX entity, keep every tag the Lua source adds (`inst:AddTag(...)`, such as `FX`, `NOCLICK`, `DECOR`), regardless of whether its semantics seem relevant or are consumed yet. Apply them on the entity exactly as in Lua, including non-networked child entities like mist or particles; never drop or substitute a tag because it looks unused. An entity with a `PrefabInstance` owns its tags there: write them with `instance.addTag()` / `removeTag()` (or through its `actionEntity`) and read them with `instance.hasTag()`; its model has no `userData.tags`. Code that only holds a model uses `modelHasTag()` / `setModelTag()`. Only models without an instance, such as bare FX sprites, keep their tags in `userData.tags`.

## Prefab callbacks

- Lua prefab 自己定义的特殊回调（如 `OnWork`、`OnFinish`、`OnEat`、`OnAccept`）必须实现在所属 prefab 模块内，与该 prefab 的 `PrefabInstance`／专用实例构造放在同一模块，并按 Lua 注册到真实实例或其组件。回调通过传入的 `inst` 操作所属状态；同一模块内的相关 prefab 可以按源码共享回调。
- controller 只做动作请求和真实实例引用的转发，严禁在 controller 中用 `if`／`switch` 或 prefab 分发表实现 prefab 专属业务分支；也不得用 controller 内的闭包、helper 或注入的业务回调隐藏这些分支。已有此类逻辑迁移时必须移回所属 prefab 模块。
- 保持 Lua 的调用关系：共享 `ACTIONS.fn` 调用组件，组件执行通用规则并触发已注册的 prefab 回调。伤害、工作量、进食、消耗等组件规则继续由组件负责；通用动作入口不在各 prefab 重复实现。动作转发细则见 [stategraphs](../stategraphs/AGENTS.md)。

## Instances, display contract and ownership

- prefab、专用实例、行为回调及 manager 不得持有 `scene`（包括 `private readonly scene: THREE.Scene`、构造参数属性、闭包捕获，以及以 `root`、`world.scene` 等方式保留或访问场景的别名）。应用层注入的场景只在接线时交给 `PrefabDisplay`／`PrefabDisplayGroup` 等 display 层所有者；实体的挂载、显示更新、渲染条目与显示资源释放由 display 层管理。prefab 只声明实例状态、transform、动画、外观和 FX；邻居发现使用注入的逻辑查询或既有实体查询入口，不遍历场景。迁移必须移动实际职责，不能仅改字段名、换成转发回调或增加包装类来隐藏场景引用。
- 实体事件属于逻辑实体：用 `instance.PushEvent()`／`ListenForEvent()`（返回取消函数）／`RemoveEventCallback()` 收发，监听方收到的是 `data`。不在 model 上 `dispatchEvent` 或 `addEventListener` 游戏事件；model 上只保留 three.js 自身的场景树事件（`added`、`removed`、`childadded` 等）。
- 实体根节点由 `PrefabInstance.transform` 创建并持有，display 接收同一个根节点并管理其场景挂载和 visual。逻辑代码通过 `instance.position`／`instance.scale` 读取 transform，通过 `setPosition()`／`setScale()`／`setRotation()` 写入；不得用遍历 `children`、取内层 visual、读取 mesh／材质等方式恢复逻辑状态、选择动画或操作控制器。脚点、sprite 对齐偏移和相机朝向的区别由 display 保持。
- `SpriteResources`／assets／factory 是共享资源所有者，manager 可以持有它们并同步声明 source；实际美术加载、预热和 sprite 创建在 display 的资源路径中执行。prefab／组件／brain／stategraph 不持有加载 Promise，也不在资源完成后回写逻辑状态。实体的卸载不能销毁共享缓存。
- 火焰等通用效果复用已有组件绑定和 FX 显示入口，例如 `BurnableBinding`／`FireFxHost`、`attachFx()`、`followAnimation()`；不为每个 prefab 再写一套火焰创建、挂载、相机跟随、音效和灯光联动 effect。prefab 按 Lua 指定效果及参数，display 绘制，所属组件继续管理业务计时。
- 鼠标命中 model 后，通过 `prefabInstance(model)`／`findActionEntity(model)` 取得逻辑实体；需要显示资源时通过 `prefabDisplay(model)` 取得 display。`reskinTarget` 等操作由实体所有者注册；工具动作（MINE／CHOP／HAMMER／DIG／NET）不注册目标 view，`PlayerController` 直接以命中实体为目标，使用现有实例／display 的目标 view，提交仍委托组件。目标 view 不成为组件、皮肤或生命周期的第二个所有者。
- `model.userData` 不得作为有实例实体的数据总线：不新增 `components`、`animationController`、`display`、`skinIdSignal`、`pickablePlantState`、`removed`、`persists`、目标操作、业务回调等写入或别名。限制同样覆盖 `Object.assign`、属性描述符、嵌套赋值和局部别名修改。没有实例的裸 FX 按前文保留 `userData.tags`；材质／几何上的渲染缓存属于渲染内部数据，不能用来保存实体业务状态。
- 迁移要同时检查 prefab、关联组件／行为／子实体、调用方以及公共创建／绑定 helper。先把消费者改为读取实例和组件，再清理不再使用的写入；不通过新 getter、复制信号或转发回调维持旧 `userData` 接口。公共兼容桥尚未迁移时明确其保留范围，不因当前文件没有 `userData` 字符串就宣称生成的 model 已完全清空。测试也通过实例／display 接口断言状态与生命周期。

## Prefab porting requirements

- 实体管理：移植 prefab（包括把已有 prefab 迁移过来）时，只能用通用的 `PrefabEntityManager`（`packages/prefab/src/prefabInstance.ts`）管理 `PrefabInstance`。`PrefabEntityManager` 必须是应用层统一创建并持有的全局单例，所有 prefab 共用这一个实例；不得按 prefab、模块或类别分别创建 manager 实例，prefab 模块也不得自行创建 manager。prefab 的实例构造、组件、业务回调和资源声明留在所属 prefab 模块。不新增专用 manager 类，也不通过继承或包装它来添加 prefab 规则；已有的专用 manager 不能作为继续新增的依据。
  - 不得在 `PrefabEntityManager` 中按 `prefabId`／prefab 名称分支，包括 `if`、`switch`、分发表和名单判断。prefab 之间的差异写在 `PrefabEntityDefinition` 的声明或实例、组件上；通用能力不足时，增加对所有 prefab 含义相同的声明字段。
  - 不得把回调写入 `PrefabEntityManager`。Lua 回调（`OnWork`、`OnSave`／`OnLoad`、事件监听等）和 `PrefabEntityDefinition` 中各函数（如 `fn`、`onSpawned`、`update`）的实现都放在所属 prefab 模块；manager 只调用 `PrefabEntityDefinition` 声明的函数和实例的 `GetPersistData()`／`SetPersistData()`。
- sprite 创建与共享：prefab 声明的动画由 display 的创建回调或资源入口通过 `createSharedArchiveSprite()`（含预载入口 `preloadSharedArchiveSprite()`）或 `createSpriteFactory()` 获取。共享入口不允许 prefab 逻辑自行加载资源或持有实际 sprite。不得在 prefab 中直接调用 `createArchiveSprite()`、自行创建逐实体帧几何，或新增仅包装 prefab 动作名称的动画构造层。动画名称、循环方式、动作选择及后续播放由 prefab 按源 Lua 通过 `instance.sprite` 的 `playOnce()` / `start()` 等接口声明。
- 植物实例化：植物 prefab 的 sprite 必须通过上述 shared archive 路径创建；需要预载后同步创建时，由 display 的资源路径使用 `preloadSharedArchiveSprite()` 完成预载和后续创建，不在 prefab 的构造或行为回调中执行。所有循环动画必须通过 `instancedAnimations` 使用共享的 `InstancedMesh` 合批渲染，并保留各实体独立的播放进度、交互和生命周期；需要同时实例化非循环动画时可使用 `instancedAnimations: 'all'`，保留完成回调和末帧语义。动画是否循环仍按源 Lua 决定，不得为了实例化将非循环动画改为循环。
- 逻辑实体与显示层：`PrefabInstance`（`packages/prefab/src/prefabInstance.ts`）是逻辑实体，声明 `status`（`active | asleep | removed`）、`sprite`（`SpriteState` 的 json：clip、队列、外观、`followAnimation`、`attachFx`／`detachFx` 声明的 FX）、`entityId`、`saveRecord`、`skinId`、`persists`。prefab 通过 transform 创建实体根节点并修改这些数据，不得直接创建、挂载或释放 visual／sprite，也不得为 FX、跟随动画另写逐 prefab 的 effect；`PrefabDisplay` 订阅这些信号，通过 `createEffect` 做对应的 diff：asleep 释放 sprite 并把 model 移出场景，active 重建并放回原父节点，removed 释放全部。跟随动画（`followAnimation`）以及火焰、毒蝇等 FX 由 display 的 `AnimationFollower`／`FxAttachments` 处理，prefab 只声明。
- 资源加载归属：加载 assets（build、anim、atlas、皮肤 archive 等）只能发生在 display 层。`PrefabInstance` 及 prefab 逻辑（含装备 onequip/onunequip、组件与 stategraph 回调）不得有任何 IO 或等待：不调用加载接口、不 `await`、不持有加载 Promise，也不在加载完成后回写状态。prefab 只按名字（Lua build 名或 archive 路径）同步声明外观，如 `AnimState:OverrideSymbol(symbol, build, sourceSymbol)`；display 从实体资源所有者的缓存读取已加载的资源，加载其余部分，加载完成后按当前声明重新应用，被替换的声明只留下缓存。
- transform 归属：`PrefabInstance.transform` 持有实体根节点（`Transform` 内部的 `Group`），在 display 创建前即可访问位置、缩放和以度表示的朝向。`PrefabDisplay`／resident 必须复用该根节点；`bindInstance()` 只登记对应关系，不接管或复制 transform。拾取、休眠、换肤及 display 重建保留根节点和向量引用，display 释放自己的 visual 与场景挂载。逻辑位置不做成信号，不经 effect 或逐帧克隆／同步；写入统一走实例或 transform 的方法以刷新 tile 并标脏。静态实体在构造时使用 `Transform.stationary()`，共享创建 helper 的 `staticTransform` 参数只负责选择这个实例 transform；静态矩阵仍遵守现有标脏机制。相机朝向、脚点对齐和显示偏移作用在 visual，不能修改逻辑根节点的朝向。
- 活动区归属：每个 transform 只有一个惰性 `tileTracker`；`getTileActivity(query, cleanup)` 按所属世界的查询函数共享活动区 memo，并在最后一个使用者退出时释放。prefab 休眠、动作查询、世界输入门控及实体静态物理绑定复用这一结果，不自行创建同位置的 tracker 或活动区查询。`setPosition()` 等写入累计 60 次才刷新已有 tracker，不在写入后立即 `sync()`：逐帧同步的性能开销很大，一次性跳变也由后续写入累计刷新。连续移动同样通过 transform 方法写入，不能靠玩家位置快照扫描全部实体补刷。
- 外观状态归属：`overrideSymbol`、`setSymbolOverride`、`setBuildArchive`、`setSymbolHidden`、`setColour` 等外观调用由 prefab 通过 `instance.sprite`（`SpriteState`）声明，保存在 sprite json 的 `appearance` 中；display 在每次 sprite 加载或替换后按 json 重新应用，ResidentSprite／ResidentSpriteController 本身不持有这些状态，也不自行重放。需要在 json 之外保留的外观，prefab 仍须用依赖 `instance.sprite.art` 的 `createEffect` 重新应用；`art` 在 sprite 绘制或释放时变化，不从 tickingarea 信号复制。皮肤同样是声明的外观：prefab 用 `instance.sprite.setSkinSource()` 声明源皮肤名与资源所有者（不做 IO），换皮肤只写 `instance.skinId`（即 sprite json 的 `skinId`，实例不另存副本）；display 加载对应皮肤资源，并在每次 sprite 加载或替换后按 json 重新穿上。不得为换皮肤创建替换实体或替换 display、接管其 sprite，实体、model 与 json 保持不变。
- `AnimState` 声明与插槽：display 的合并顺序与订阅见 [display](../display/AGENTS.md)。
  - 引用而非副本：实体自己的 `AnimState`（含 stategraph 写入的部分）用 `instance.sprite.setAnimState(anim.json, art)` 声明一次，sprite json 只保存该 `AnimState` 的 json 信号和加载其命名美术的 `art`。不得在每次 `OverrideSymbol`／`Show`／`Hide` 后用回调、`createEffect` 或 `createRenderEffect` 把 `anim.json.peek()` 快照写回 sprite json。
  - 插槽：装备、跟随 FX 等另一实体要改写宿主的符号或图层时，在宿主的 sprite 上用 `declareAnimState(key, anim.json, art)` 声明一个插槽，传入它自己 `AnimState` 的 json 信号，卸下时用 `declareAnimState(key, undefined)` 移除；不得写入宿主的 `AnimState`。装备的 onequip／onunequip 照源码写 `owner.AnimState`，其 `AnimState` 是 `EquipmentAnimState` 提供的本装备插槽：由 `wornEquipmentLifecycle`／`createHandEquipmentLifecycle` 在装备时声明、卸下时移除，手持物的 `createLifecycle` 也收到同一个插槽（如 lantern 的 `LANTERN_OVERLAY`）。移除插槽即恢复下层，卸下时写入的反向操作（`ClearOverrideSymbol`、`Hide('ARM_carry')` 等）只作用于本插槽。
  - Lua 时序差异：Lua 中所有调用作用于同一个 `AnimState`，后写者生效；插槽是分层的，宿主声明上的写入不能清除或盖过插槽。迁移 stategraph 与装备互相改写同一符号或图层的分支时逐一核对；源码在卸下后有意保留装备美术、直到某个状态结束才清除的（如 `amulet_rebirth` 的 `swap_body`），由该装备保留插槽并在对应状态结束时移除，不在宿主声明上模拟这次清除。
- Resolve inventory UI icons, ground/world art, and equipped art separately from source Lua and metadata, including the actual atlas, bank/build/clip, and skin overrides. Use animation/build assets for available ground art, including single-frame poses; do not substitute inventory icons or infer assets from item IDs.
- Prefabs with source-defined skins must support the existing `reskin_tool` workflow, including skin assets, symbol overrides, and inventory icons where applicable. Preserve identity, position, component state, and selected skins through reskinning, dropping, pickup, equipment changes, and save/load. Do not invent skins for prefabs without them.
- Expose world prefabs through `c_spawn("prefab_id")` and inventory items through `c_give("item_id", count)`, using actual source IDs. Support both when both forms exist.
- These requirements also apply to artwork/animation-only ports unless the user explicitly narrows the scope.

## DST assets and sound

- Resolve each inventory icon's actual `images/inventoryimages*.xml` atlas in `databundles/images.zip`, including skin overrides; do not assume all icons belong to `inventoryimages.xml`.
- Inventory icons are only a ground-art fallback for items outside the ground prefab/catalog system. Keep NPC-only `shadow_thrall_parasitehat` excluded from hat imports, inventory metadata, recipes, and fallbacks.
- Regenerate and verify catalogued ground assets with `packages/prefab/scripts/import-ground-items.py` and `--check`, preserving source paths and bytes. See [item asset examples and import workflow](../../docs/dst-item-assets.md).
- Decode DST FSB banks with `/usr/bin/vgmstream-cli`; read [the extraction guide](../../docs/vgmstream-cli-guide.md) and check the installed CLI's `-h` before extracting. Inspect metadata without creating WAVs beside source banks; export unextended samples with `-i` and implement looping in the browser.
- Verify source Lua event → FEV event → sound definition → bank/file mapping; do not choose streams by name similarity. Convert zero-based FEV `file_index` to one-based extraction indices. Distinguish prefab appearance audio from player casting audio.
- Decoded WAVs are the filename exception: preserve the bank's relative directory and use `<bank>.fsb-<index>.wav` with `-`, not `#`. Compare exported bytes with an existing decoded source WAV when available.
- Centralize event mappings and playback in `packages/prefab/src/sound.ts` using `PlaySound`, `PreloadSounds`, and `DisposeSounds`; do not add a separate audio class/file per prefab or special Vite sound middleware.
- Preload/decode before spawning or timed actions, resume audio during a user gesture, give each entity an independent looping source, and stop/disconnect its sounds on removal. Dispose all sounds on explicit game shutdown within the running page; do not trigger this cleanup on `pagehide`.

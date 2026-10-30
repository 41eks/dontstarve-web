# Repository instructions

本文件只划分 monorepo 各部分的职责，并列出全仓库通用的规则。各 package 的具体规则写在其目录下的 `AGENTS.md`，修改某个 package 前先读对应文件；规则只写在它所属的 package 中，不在此重复。

## Packages and ownership

以下职责适用于新增代码和迁移代码；已有兼容实现不能作为继续跨层存取状态、加载资源或复制控制器的依据。

| 层次／入口 | 负责 | 不负责 | 细则 |
| --- | --- | --- | --- |
| `PrefabInstance` 及 prefab 专用实例子类 | 实体身份、`saveRecord`、`status`、`persists`、标签、组件、逻辑 transform，以及 `SpriteState` 声明；prefab 专有状态和纯派生状态也放在实例或所属组件上 | 美术资源 IO、实际 sprite／model 的创建挂载释放、相机朝向、逐帧几何和渲染排序 | [prefab](packages/prefab/AGENTS.md) |
| `packages/prefab` 的 prefab、行为回调和 manager | 按 Lua 组装实例与组件，选择动画及循环方式，声明外观／FX，处理源 prefab 回调与保存恢复；manager 管集合、查询索引、注入依赖和共享资源所有者的生命周期 | 复制组件规则，另存实例状态副本，管理 model 子树、逐实体材质和相机 effect，等待美术加载后才创建或修改逻辑实体 | [prefab](packages/prefab/AGENTS.md) |
| `packages/componets`、`packages/prefab/src/components` | 组件的权威数据、校验、状态转换、消耗、游戏时间任务、组件事件和组件存档；通过注入的逻辑实体访问标签、位置与其他组件 | 通过 `model.userData` 找宿主数据，选取鼠标目标，加载或操作显示对象，以动画绘制／卸载代替业务计时完成 | [componets](packages/componets/AGENTS.md) |
| `packages/brains`、`packages/behaviours` | 按源 brain 评估行为优先级、选择目标和发起逻辑动作 | 直接提交 stategraph 命中帧的工作，改写组件结算规则，操作 model／sprite 或加载美术 | — |
| `packages/stategraphs` 的动作选取、`BufferedAction` 和 stategraph | 根据实体标签与组件能力选动作，缓冲与取消动作，按源状态图帧点提交，在提交时重新校验并调用组件／实体提供的操作 | 在控制器中重做伤害、工作量、采摘、掉落等组件规则；按 prefab ID／受击动画猜能力；创建或替换目标的 sprite／display | — |
| `packages/display` 的 `PrefabDisplay`、`PrefabDisplayGroup`、`SpriteResources` 等 | 订阅实例的生命周期和 sprite json，执行显示 diff；创建、挂载、释放 model／visual，加载并缓存声明的美术；应用皮肤、符号、跟随动画、FX、相机朝向、八向画面和显示偏移 | 决定 prefab 的业务状态、源动作或循环方式；扣物品、采摘、成长、工作量结算或决定实体何时永久移除 | [display](packages/display/AGENTS.md) |
| `packages/animation` 的 sprite／controller、resident、atlas 和批次 | 解码与复用动画资源，推进实际播放，执行帧／队列／完成通知，生成和合成帧几何，合批及渲染；resident 提供 display 使用的通用驻留机制 | 持有实体组件或存档状态，选择某 prefab 下一步业务动作，以是否有 visual 决定业务结果 | [animation](packages/animation/AGENTS.md) |
| 应用层 `src`，包括 `sceneEntities.ts`、`registerDisposal.ts`、`main.ts` | 构造世界，注入 scheduler、世界信号、库存和查询接口，连接输入／UI／存档，注册控制器与显式释放 | 增加 prefab 专用规则、备用控制器或资源加载流程；在动作接线处逐个枚举 manager 的目标列表作为目标发现机制 | [src](src/AGENTS.md) |
| `packages/signals` | 信号、memo 与 effect 调度，`watchSignal` 生命周期桥，世界输入的绑定与门控 | 业务状态、组件规则或显示对象 | [signals](packages/signals/AGENTS.md) |
| `packages/inventory` | 库存权威状态与领域类型、槽位与堆叠限制、纯 `craft()` 计算及原子应用 | UI 渲染；应用物品元数据（在 `src/inventoryItems.ts`） | [inventory](packages/inventory/AGENTS.md) |
| `packages/ui` | DOM UI：物品栏、制作栏、容器面板等，镜像应用状态并发出 UI 事件 | 持有权威库存或游戏状态 | [ui](packages/ui/AGENTS.md) |
| `packages/map` | 地图视图：地皮整图、小地图图标与 DOM 呈现 | 世界地皮或实体的权威数据 | — |
| `packages/sound` | 声音呈现调度 | Lua 事件到 FEV 的映射与播放入口（在 `packages/prefab/src/sound.ts`） | [prefab](packages/prefab/AGENTS.md) |

## Lua parity and missing implementations

- Align TypeScript implementations with the corresponding DST Lua source under `/data/copy/AssetArchive-Dev/data/DST/data/databundles/scripts_unpacked/scripts`: preserve responsibility boundaries, tags and components, action selection and buffering, stategraph timing and lifecycle, validation, state transitions, consumption, and save/load behavior.
- If Lua alignment depends on missing functionality in `packages/prefab`, `packages/brains`, `packages/componets`, or another package, add the smallest source-faithful implementation in the owning package as part of the same change. Do not bypass missing implementations with application-level prefab special cases, callback chains, or duplicate controllers.
- Read the relevant prefab, component, brain, action, and stategraph Lua before implementing a behavior. Keep the minimal implementation within the source branches needed by the task; do not invent behavior.


## Cross-package ownership

- 状态只有一个权威所有者：工作量在 `workable`，再生任务在 `pickable`／`growable`，燃烧任务在 `burnable`，实体持久化在 `instance.persists`，皮肤在 `instance.skinId`（即 sprite json 的字段）。manager、目标 view、display 和 UI 不另建同名可写副本或靠 effect／回调双向同步。组合状态用纯 `createMemo` 从所属实例和组件派生。
- prefab 通过 `instance.sprite` 声明 clip、队列、外观和 FX；display 将声明交给 animation 执行。display／animation 可以通知已加载、已绘制和 clip 完成，也可以调用实例已经声明的完成回调；业务规则和实体移除决定仍属于声明该回调的 prefab／组件。游戏时间任务不能改成等待这个完成通知。


## Spatial queries and distance calculations

- Pass positions as `Vector3` values and calculate distances directly with `distanceTo()` or `distanceToSquared()`; use squared distances for radius comparisons. Ground-contact positions already have `y = 0`, so do not separate the Y axis, project onto XZ, or create temporary vectors to zero Y. Reuse existing position vectors without mutating them.


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


## DST assets

- Mirror assets from `/data/copy/AssetArchive-Dev/data/DST/data` under `public/dst/data`, preserving relative paths and original filenames. Runtime URLs must use the same paths below `${import.meta.env.BASE_URL}dst/data/`.

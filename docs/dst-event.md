# DST 事件与 signal：草丛、洞穴花、灰烬和矮星

本文记录 `grass` 的采摘／再生、`flower_cave` 的采摘／再生、`ash` 的生成／拾取／消散，以及矮星 `stafflight` 的生成／到期／移除如何映射到 signal。矮星不涉及库存转移和合堆，可先阅读其生命周期示例。矮星已接入下述 signal／memo／effect 生命周期；草丛和洞穴花已接入组件 timer signal 与阶段 memo，灰烬消散仍是后续实施方案，下文分别说明当前实现。原版名称是 `flower_cave`，每个实体都使用独立 ID，不能用 prefab 名称作为唯一实例键。

实体状态统一采用：signal 保存组件权威数据，`createMemo` 始终纯计算派生状态。组件应该使用 `createEffect` 和 `get()` 响应外部状态变化，调用组件方法执行转换；表现 effect 只更新表现，不承担领域动作。计时到期及完成动作仍由游戏时间调度器执行，不能通过观察 timer signal 的 effect 补做。组件拥有写权限，表现层读取只读 signal／memo；产物生成、库存转移和实体移除不能依赖表现 effect 执行。memo 表示当前状态，不对应 Lua 的事件名，也不保存事件次数或事件参数。

同一次动作涉及多项权威数据变化时，通过 `batch()` 提交，再发布完整的派生结果；例如灰烬入库存时一起提交归属和停止消散，避免表现读取转移中的组合状态。

## 场景的灰烬生成事件

每个场景创建独立的 `EventEmitter<WorldEvents>`。常青树、桦树和月树的树桩，以及种下的花，在原有烧尽回调中同步发出 `worldEvents.emit('spawnAsh', position.clone())`，然后移除原实体；不再注入 `spawnAsh` 函数。事件携带实体地面位置的 `Vector3`，不修改原位置。

`GroundItemManager` 监听该事件，使用应用物品规格及原有 `spawnFromSave` 路径生成一份灰烬；在开始异步加载前复制事件位置，避免后续位置变化影响生成结果。管理器释放时解除监听，其他场景的 emitter 不会触发本场景生成。事件本身不保存，生成后的灰烬继续按原有实体记录保存和恢复。

## Workable：工作量、动作能力和完成回调

[Workable](../packages/componets/src/workable.ts) 用私有可写 signal 保存 `workleft`、启用状态和工作动作，公开只读视图；组件停止状态和实体的只读 `removal` 信号共同参与纯 `createMemo`，派生 `canBeWorked` 和 `actionTag`。`GetWorkLeft()` 保留 Lua 语义：禁用时返回 0，原始剩余工作量仍保留。`SetWorkLeft()` 恢复启用状态并按源规则将工作量限制到至少 1；成功工作可将它扣到 0。

库存实体的移除状态由自身 signal 保存，世界实体现有的 `model.userData.removed` 写入则通过属性访问器更新同一生命周期 signal。实体 `hasTag()` 从组件派生工作标签，静态 `model.userData.tags` 不再存储一份 `HAMMER_workable`、`DIG_workable` 等工作能力。动作收集、命中校验和其他组件都使用实体标签 API。

`WorkedBy()` 显式按 Lua 顺序执行：更新工作量 → worker 的 `working` → target 的 `worked` → `onwork` → 耗尽时 `onfinish` → `workfinished` → worker 的 `finishedwork`。memos 仅计算数值和标签，工作量的表现订阅仅观察状态，不根据数值变化补做完成回调；禁用、取消或 `OnLoad({ workleft: 0 })` 不执行完成回调。批次内动作和事件回调通过 `CanBeWorked()` / `hasTag()` 对当前权威输入应用同一纯计算，避免读取尚未提交的 memo 快照；memo 订阅在批次提交后观察完整结果。

`OnSave()` 继续遵守 `savestate`：关闭时返回空组件状态，开启时保存剩余工作量；读取和载入不额外执行工作。普通墙和岩石保持源 Lua 的默认规则，读档恢复初始工作量。工作计数没有 timer、逐帧扣减或全局时钟依赖。永久移除时先更新生命周期，再释放组件 memo；取消墙预览、废弃换肤资源也释放临时实例的派生依赖，实际墙换肤保留原有工作组件。

## 月亮石的满月计时和魔杖转化

`WorldState.fullMoon` 是从夜间状态与月相派生的只读 memo，只在满月夜进入或离开时通知月亮石；世界时钟仍按 60 个有效游戏帧结算。月亮石接收共享游戏时间调度器，不在每帧写计时值，也不订阅全局时钟来判断到期。

`Timer` 的各具名计时分别使用 `ComponentTimer` 的私有 signal，保留 `scheduled`、`paused`、`stopped`、`expired` 的区别。`moonbase.lua` 的 `fullmoonstartdelay`、`moonchargepre`、`mooncharge`、`mooncharge2`、`mooncharge3` 对应 10 秒缓冲、至少 1 秒预备、49.9 秒总充能、两个 18.7 秒阶段。阶段和 `intense` 标签纯粹从计时快照、所持魔杖、工作量及满月状态推导；领域回调负责开始／取消计时及转化，不在 memo 或表现 effect 内生成或移除魔杖。

到期时同步创建新的 `opalstaff`（满耐久 50），从资源导入器读取源皮肤的 `granted_items` 映射，移除旧 `yellowstaff`，更新持有实体和 pickable 产物。提前取杖或月落取消充能，不把取消当成到期；第二、三阶段的 `intense` 标签经通用实体标签接口阻止 PICK。按本次范围，月兽不生成。

保存只记录仍存在的具名计时的剩余时间、暂停标志和初始时长；读档用当前游戏时间重建任务，并恢复相应光束阶段和取杖锁定。FX 自己的 3／9 帧灯光任务、退场移除任务和周期音乐推送各自拥有 timer signal，不参与持久化；重新准备美术不替换月亮石的逻辑计时。永久移除取消任务和世界订阅，释放光照、每实体音源、FX 几何及工厂资源。月亮石移除时释放自身由私有 Moon／Cycle 信号派生的 `fullMoon` memo。

音乐由共享 `DynamicMusic` 接收附近月亮石每秒的阶段触发；同阶段延长 10 秒期限，第三阶段切换到第二段曲目。月落或完成后停止推送，最后一次触发的 10 秒期限到期后停止音乐，符合 `dynamicmusic.lua` 的触发音乐尾声行为。

## 装备的持续理智消耗

`nightsword.lua` 通过装备组件的 `dapperness = TUNING.CRAZINESS_MED` 和 `is_magic_dapperness = true` 降低持有者理智。`CRAZINESS_MED = -100 / (30 * 10)`，对应干燥暗夜剑每分钟降低 20 点；`Equippable:GetDapperness()` 还读取物品自身湿状态，按 `WET_ITEM_DAPPERNESS = -0.1` 叠加每分钟 6 点惩罚。

[Equippable](../packages/componets/src/equippable.ts) 保存装备属性；[Sanity](../packages/componets/src/sanity.ts) 从库存的实际装备槽读取组件，每个活跃游戏帧按实际 `dt` 汇总消耗并更新注入的玩家理智 signal。持续速率没有离散 timer，也没有重复保存的理智值；物品 configure 保留原有 equippable 实例，转移和换肤后仍使用同一个组件。库存、鼠标槽或地面物品不参与汇总。卸下或更换工具后下一次更新立即读取新装备；休眠或显式停止组件时不消耗，永久场景销毁取消注册任务。HUD 和滤镜订阅理智信号，仅负责表现。

`c_save()` 直接保存玩家当前理智和装备，读档先恢复数值及库存，再接入活跃帧更新，不扣除离线时间。没有待结算的理智时间批次；不用从保存、掉落或表现回调额外执行消耗。

## effect 的订阅边界：自身 get，环境 peek

实体表现／生命周期 effect 只订阅该实体自身的 signal 或派生 memo。用 `.get()` 读取驱动当前 effect 的自身状态，例如洞穴花的 `appearance` memo、灰烬的 `phase` memo、矮星的 `phase` memo。`picked`、`alive`、`onGround` 等可查询状态从权威数据派生，不再分别维护可写副本。

执行时需要参考环境中的其他 signal，例如世界季节、环境温度、玩家状态或其他实体状态，必须使用 `.peek()` 读取当前值，不将它们加入当前 effect 的依赖。项目实际 API 名称为 `peek()`，不是 `peak()`。这条约束也适用于 effect 同步调用的表现回调和辅助函数：它们内部读取外部 signal 时也必须使用 `.peek()`，否则依然会被当前 effect 收集为依赖。

以下为注入自身状态、环境状态与表现回调后的示意：

```ts
createEffect(() => {
    const state = appearance.get();        // 订阅这株植物自身的派生状态
    const currentSeason = season.peek();   // 只读取环境，不订阅季节
    syncPlantPose(state, currentSeason);
});
```

环境 signal 的变化不会单独触发这个 effect；它只在首次运行或自身依赖变化时读取最新环境值。若环境变化需要改变植物生长或照明，由负责该行为的组件／环境系统处理并更新实体自身状态，再驱动表现；不能期待 `.peek()` 自动提供环境变化通知。

## beefalo：胡须与睡眠

`beard.lua` 的 `bits`、`daysgrowth`、`daysgrowthaccumulator` 是 [Beard](../packages/componets/src/beard.ts) 的私有 signal，只读视图对外；`hairy`（`bits > 0`）是纯 memo。`Shave`、`OnDayComplete`、`Reset`、`OnLoad` 在组件内按 Lua 顺序执行，成对写入用 `batch()`，回调与领域判断读取 `peek()` 的权威值，不读尚未提交的 memo。每日生长是调度器上到下一个日界的一个 `ComponentTimer`（私有 signal 快照，对外只读的 `dayTimerState`）：世界侧注入 `secondsUntilNextDay(now)`，`Beard` 不读时钟或 tuning，也不订阅全局时钟；到期执行 `OnDayComplete` 再登记下一个日界，跨多天时逐天补发，等待期间 signal 不变；销毁写入 `stopped`、撤销任务并释放 memo。timer 不入档，读档按当前世界时间重新登记。

标签不保存副本：`Beard.HasTag('bearded')` 恒为真，牛的 `has_beard` 经 `HasTag` 从 `hairy` 派生，实体 `hasTag()` 读取同一份。表现 effect 只订阅牛自己的 `hairy`（`get()`），把 `beefalo_shaved_build` 与 `beefalo_build` 切换交给精灵控制器；世界昼夜等环境值由领域代码读取，不加入 effect 依赖。`hairGrowthPending` 对应 Lua 的 `inst.hairGrowthPending`，是牛私有的 signal，由第 3 天回调置位，`idle` 状态读取并在 `hair_growth_pop` 清除。

[Sleeper](../packages/componets/src/sleeper.ts) 的 `isasleep` 是私有 signal，周期测试（4 ± 0.5 秒）由 `ComponentTimer` 在共享游戏时间调度器上登记，等待期间不逐帧扣减；`GoToSleep`、`WakeUp`、`StartTesting`、`StopTesting` 分别更新 signal 与 timer，销毁时停止测试。

## 鸟笼：鸟的饥饿、饿死与腐烂

鸟的饥饿就是 [Perishable](../packages/componets/src/perishable.ts) 的剩余时间：私有 `timer` signal 区分 `perishing`／`paused`／`perished`／`stopped`，`percent` 与 `stage` 是纯 memo。`MakeFeedableSmallLivestock` 的“放入物品栏开始、落地停止”由 `localMultiplier` 表达（有 `inventoryitem.owner` 或 `occupier` 的 owner 为 1，否则为 0），读档不必重放 `OnPutInInventory`；`occupierCage` 对应 `perishable.lua` 里无 owner 时取 `occupier:GetOwner()`，笼内用 `PERISH_CAGE_MULT`。所有鸟和货架物品通过游戏时间调度器每 10 个游戏秒结算一次，鸟笼的 `update(dt)` 推进组件调度器；长帧跨越多个周期时依次结算，保存前 `flush()` 结清不足 10 秒的部分，停止或永久移除时取消周期任务。

[Occupiable](../packages/componets/src/occupiable.ts) 的 `occupant` 是私有 signal（对外只读），`occupied`／`bird_occupiable` 标签随它同步。`Occupy` 先写 occupant，再执行 `occupier.onoccupied` 与 `onoccupied`，最后登记 `perished` 和 `onremove` 监听；`perished` 的顺序与 Lua 一致：`onemptied` → `onperishfn(cage, bird)`（此时 occupant 仍可读）→ 清除 occupant → 销毁鸟。`onperishfn` 里货架组件移除 `occupiable`，随后 `setOccupant(nil)` 仍会写回 `bird_occupiable`，与 Lua 属性监听在已移除组件上的行为一致；STORE 的可用性读取组件的 `CanOccupy`，不依赖这个标签。

[Birdcage](../packages/prefab/src/birdcage.ts) 把 `CAGE_STATE`、`bird_type` 保存在私有 signal，`status`（`GENERIC／OCCUPIED／HUNGRY／STARVING／SLEEPING／DEAD／SKELETON`）由 `cageState`、占用鸟的 `percent` 和睡眠 signal 派生。动画、声音、货架转换只在 `Occupy`、`perished`、`TakeItem` 等领域方法里执行，不放在 memo 或表现 effect 中。每 6 秒的待机动画是调度器上的一个 `ComponentTimer`（占用时启动，睡眠、空笼和腐烂时停止，到期后重新登记）；`sleeper` 的 4 ± 0.5 秒测试也是调度器任务，睡眠组件接收世界的 `getWatchWorldContent` 函数，自行监听私有 `Cycle` signal，并从返回值的 `scheduler` 取得共享游戏时间调度器；effect 用 `cycle.get()` 响应阶段转换，周期回调用本地 `peek()`，不订阅全局时钟；60 帧后的消化、各帧的啼叫等一次性任务由调度器登记，销毁时统一取消。

```text
鸟的 perishable 到期 → perished 事件 → occupiable.onemptied（空笼）→ onBirdStarve
  → CAGE_STATE = _death，播放 death，货架放入 smallmeat
smallmeat 的 perishable 到期 → perished 事件 → 调度器 0 秒后 → CAGE_STATE = _skeleton，货架放入 spoiled_food
TAKEITEM → shelf.ontakeitem → 恢复 occupiable → CAGE_STATE = _empty
```

保存时 `occupant` 和笼内物品是 `ItemEntity` 快照（身份、剩余饥饿度），`CAGE_STATE`、`bird_type` 与它们一起入档；读档先占用鸟再写 `CAGE_STATE` 与 `bird_type`，最后把笼内物品放回货架（对应 `OnLoad` → `OnLoadPostPass`）。调度器任务和 memo 不入档；占用时重新登记待机动画，货架物品用恢复后的 `perishable` 继续腐烂。

## 原版移除流程与源码依据

本地 DST 源码根目录为 `/data/copy/AssetArchive-Dev/data/DST/data/databundles/scripts_unpacked/scripts`。相关入口是 `entityscript.lua`、`mainfunctions.lua`、`prefabs/flower_cave.lua`、`components/pickable.lua`、`prefabs/ash.lua`、`components/disappears.lua`、`standardcomponents.lua`、`prefabs/stafflight.lua`、`components/timer.lua` 和 `tuning.lua`。

普通 `inst:Remove()` 由 Lua 组织：解除父实体和平台关系 → 全局 `OnRemoveEntity(GUID)` 清理管理器及 `Ents` 注册 → Lua 执行 `self:PushEvent("onremove")` → 清理监听和任务 → 直接调用组件及 replica 的 `OnRemoveEntity()` → 移除子实体、执行 prefab 移除回调 → 设置 `persists = false` → 最后调用 `self.entity:Retire()`。

`onremove` 位于 `Retire()` 之前，由 Lua 发出；组件清理并非全部通过事件监听完成。`IsValid()` 查询底层 entity 的有效性，从 `Ents` 移除不能等同于底层已经失效。仅凭 Lua 不能确定 C++ 的空间索引结构或实际销毁时机。Lua 对象能否被 GC 回收取决于是否仍可达，释放订阅只是解除引用关系的一部分。

## grass：原生草丛采摘、生长、点燃与铲起

[GrassManager](../packages/prefab/src/grass.ts) 使用同一个 `Pickable`，产物为 1 个 `cutgrass`，基础再生时间来自 `TUNING.GRASS_REGROW_TIME = 3 * 480`。保持 `plant`／`renewable`／`silviculture`／`lunarplant_target` 标签，可采摘时由组件添加 `pickable`。通用 `PICK` 输入和 `SGwilson` 负责走近、动作时机与取消；组件负责产物交付和再生，prefab 管理器负责组件接线、草丛动画与音效。

```text
成熟 idle → 成功采摘 picking → picked
             设置再生 timer signal
等待：timer 保持 scheduled 快照，按截止时间查询剩余秒数
到期：timer = expired → 同步 Regen() → phase = ready → grow → idle
冬季：暂停再生，timer = paused；成熟草仍可采摘
恢复：用暂停剩余时间或基础再生时间重新登记任务
```

`MakeNoGrowInWinter()` 的世界状态绑定位于管理器的组件接线：季节订阅只处理是否进入／离开冬季，释放管理器时解除订阅。`SpringGrowthMod()` 在设置或恢复再生任务时通过 `season.peek()` 读取当前季节；春季乘 0.75，秋／夏季基础再生为 1440 秒，春季为 1080 秒。冬季采摘时没有再生任务，恢复时按当前季节设置完整再生时长。原生草丛没有 `transplanted`，不消耗 Lua 仅对移植草执行的采摘次数。当前支持原生采摘／再生、冬季暂停、点燃和铲起，不包含重新栽种、施肥、夏季枯萎和变色蜥蜴转换。

timer 使用 [共享游戏时间调度器](../packages/componets/src/gameTimeScheduler.ts)，场景按现有世界时钟推进，不依赖真实时间。大步长跨过截止时间时，回调在实际截止点运行；保存和显式场景释放先推进到当前游戏时间。草丛 `state.phase` 的表现 effect 只订阅自身阶段；采摘声及 `picking → picked`、`grow → idle` 由成功动作／再生入口执行一次，恢复采用当前稳定姿态。

产物在动作开始前准备地面资源，提交时调用现有 `InventoryStore.GiveItem()`，保留库存实体、合堆和溢出规则。库存满时产物仍生成并落地；预备地面表现同步接替溢出请求，立即保存不会重复或丢失产物。取消动作只释放未提交的准备资源，保留草丛状态。

存档的 `components.pickable` 保存 `picked`、`paused` 和 `regrowSeconds`，恢复后重建任务，保留草丛 ID、脚点及产物状态；旧草丛的 `components: {}` 恢复为成熟状态。永久移除取消 timer 并释放阶段 memo、表现 effect、音源和独立网格。调试入口为 `c_spawn("grass")`、`c_give("cutgrass", count)` 和 `c_save()`，参数保持不变。

`grass.lua` 的 `DIG` 由 `Workable` 管理，工作量为 1；通用工具验证和 `SGwilson` 在 `shovel_loop` 第 15 帧提交。`onfinish` 通过 `LootDropper` 生成成熟草的 `cutgrass`，再生成 `dug_grass`，最后移除原草丛。产物美术提前准备，提交时同步落地并执行原版 `LootFling`；失败、取消或重复命中不生成产物、不消耗耐久。普通铲子每次消耗 1，黄金铲子消耗 0.25，原始耐久均为 25，存档验证保留黄金铲子的小数步长。

`Burnable` 保存燃烧／闷烧 timer signal，`Propagator` 保存传播调度 timer signal，两者使用同一游戏时间调度器。`Propagator` 接收世界只读 season signal，通过纯 memo 派生有效传播半径：春季使用基础半径的 0.67，其他季节使用基础半径。原版 `propagator.lua:OnUpdate` 每次读取 `TheWorld.state.isspring`；这里的周期任务读取派生半径，用于邻居查询和热量距离衰减。季节变化不重新登记传播任务，也不立刻传热。可燃库存实体首次绑定地面时注入季节依赖，替换或释放表现保留逻辑组件及其世界依赖；永久移除释放半径 memo。`LIGHT` 沿用火把动作提交帧；草丛燃烧 20 秒，显示原版 level3 火焰，`DefaultBurnFn` 设置不可保存，熄灭恢复可保存，`DefaultBurntFn` 同步生成 1 个灰烬再移除草丛。阶段 memo 从移除、燃烧和可采摘状态派生，领域动作不依赖表现 effect；永久移除撤销再生与燃烧任务并释放 memo。在外层 `batch()` 内移除实体时，memo 的 `dispose()` 先结算待处理的派生状态，再解除依赖，使最终快照保留 `removed`。

新增 `c_spawn("dug_grass")` 和 `c_give("dug_grass", count)`：草簇每叠最多 10 个，支持地面／库存转移、点燃和保存恢复；可燃草簇整叠燃烧 30 秒后生成同数量灰烬。其地面姿态来自 `plantables.lua` 的 `grass` bank、`grass1` build、`dropped` 动画，不使用库存图标替代地面美术。

## flower_cave：采摘与再生

### 组件数据 signal 与派生状态 memo

`Pickable` 拥有原版 `canbepicked` 对应的可采摘条件 `canBePicked`、交互开关 `canInteractWith` 与再生 timer，`BulbPlantController` 拥有独立灯光模式 `lightState` 和 `recharge`／`turnoff` timer，实体生命周期拥有最终移除标记 `removed`。再生、充能和关闭照明均将 timer 本身保存为私有可写 signal，对外提供只读视图；不在组件里逐帧用 `dt` 扣减这些 timer。

`phase` 由可采摘条件和移除标记派生为 `'ready' | 'picked' | 'removed'`，`regrowing` 从再生 timer 是否正在运行派生；`appearance` 将这些派生状态与独立灯光模式组合为表现快照。`picked` 可从 `!canBePicked` 派生，不额外维护可写布尔值；可交互性依据 `!removed && canBePicked && canInteractWith` 派生，组件据此同步维护 `pickable` 标签，保留 `plant` 等其他标签。

```ts
import { createSignal, createMemo } from '@dontstarve-web/signals';

type PlantPhase = 'ready' | 'picked' | 'removed';
type PlantLightState = 'ON' | 'CHARGED' | 'RECHARGING';
type TimerSnapshot =
    | { status: 'stopped' }
    | { status: 'scheduled'; endTime: number }
    | { status: 'paused'; remainingSeconds: number }
    | { status: 'expired' };
type PlantAppearance = {
    phase: PlantPhase;
    regrowing: boolean;
    lightState: PlantLightState;
};

// 在这株植物的组件／生命周期作用域中创建，初值来自生成或存档数据。
const canBePicked = createSignal(initialCanBePicked);
const canInteractWith = createSignal(initialCanInteractWith);
const lightState = createSignal<PlantLightState>(initialLightState);
const removed = createSignal(false);
const regrowTimer = createSignal<TimerSnapshot>(initialRegrowTimer);
const rechargeTimer = createSignal<TimerSnapshot>(initialRechargeTimer);
const turnoffTimer = createSignal<TimerSnapshot>(initialTurnoffTimer);
const regrowing = createMemo(() => regrowTimer.get().status === 'scheduled');
const canHarvest = createMemo(() =>
    !removed.get() && canBePicked.get() && canInteractWith.get(),
);
const phase = createMemo<PlantPhase>(() => {
    if (removed.get()) return 'removed';
    return canBePicked.get() ? 'ready' : 'picked';
});
const appearance = createMemo<PlantAppearance>(() => ({
    phase: phase.get(),
    regrowing: regrowing.get(),
    lightState: lightState.get(),
}));
// 对外提供只读数据和 memo；timer 的设置／取消／到期由调度器接入提交。
```

`lightState` 保留 Lua 直接维护的独立灯光模式：`ON`、`CHARGED`、`RECHARGING`。它的转换由灯光 timer 到期和原有领域方法提交，不从 `picked` 或再生剩余时间猜测。未采摘植物也可能正在充能或关闭照明。再生 timer 也不能单独代替全部可采摘条件：暂停、贫瘠或 `MakeEmpty()` 等分支可以处于不可采摘但没有运行再生任务的状态。

### timer signal 的设置与到期

这里的 timer signal 表示定时器本身，不是逐帧递减的剩余秒数。设置时写入 `{ status: 'scheduled', endTime: gameTime.peek() + duration }`，并向游戏时间调度器登记一次性任务。等待期间保持 signal 值不变，调度器到达目标时间时提交 `expired`，并由领域转换方法执行再生或灯光转换；暂停保存剩余时间，恢复重新计算截止时间，取消写入 `stopped` 并撤销任务。

```text
采摘 → 设置 regrowTimer signal 的截止时间，登记任务
等待 → timer signal 不逐帧变化
到期 → 调度器提交 timer signal，执行再生转换
       → 自身 memo 派生新阶段／外观 → effect 更新表现
```

`rechargeTimer` 和 `turnoffTimer` 采用相同方式。timer signal 的到期与取消需要区别表示，不能仅用 `null` 同时表示两者，否则 memo 无法区分正常完成和中途停止。领域转换可以清理或重新设置 timer，但不能靠微任务 effect 保证每一次到期回调执行；最终 timer 快照也不代替一次性的 Lua 事件数据。

signal 本身不会计时，memo 也不通过 `.get()` 订阅全局时钟反复计算是否过期；到期通知由调度器写入这株植物的 timer signal。组件不再逐帧 `remaining -= dt` 来推进再生或充能。光照渐变和动画仍可按帧采样表现时间，与离散 timer 的设置／到期分开。memo 只派生当前阶段／外观，不在里面登记任务、播放声音或移除实体。

### Lua → signal／memo／行为映射

下表描述普通、可再生洞穴花；贫瘠、枯萎、移植次数和季节修正仍需按相应 Lua 分支实现。

| 动作／Lua 入口 | 权威数据变化与派生结果 | 表现与事件职责 |
| --- | --- | --- |
| 生成、读档、`MakeEmpty()`／`MakeFull()` | 恢复可采摘条件、交互开关、灯光模式与各 timer signal，重新登记未完成任务，memo 派生阶段和外观，再建立表现绑定 | 显示对应姿态或循环动画，不重播采摘声、`picking` 或 `grow` |
| `Pickable:Pick(picker)` 成功 | 原版先生成产物、调用 `onpickedfn`，再置 `canbepicked = false`、安排再生，最后推送 `picked` 事件；映射中提交 `canBePicked = false`、设置再生 timer signal 并登记到期任务，memo 得到 `picked` 阶段 | 洞穴花回调强制关闭照明，取消 `turnoffTimer`／`rechargeTimer`，播放采摘声与 `picking → picked`；派生阶段不替代事件中的 `picker`／`loot` |
| 采摘失败或动作取消 | 不修改可采摘数据，不启动新的再生计时，memo 阶段不变 | 不生成产物，不播放成功动画 |
| 再生任务到期 → `Pickable:Regen()` | 调度器提交再生 timer 到期，并执行转换、提交 `canBePicked = true`，memo 得到 `ready`，同步恢复相应标签 | 原版直接调用 `onregenfn`，这里没有推送通用 `regen` 事件；洞穴花设置充能 timer，播放 `grow → idle` |
| 光照变化、亮灯／充能 timer 到期 → `SetLightState()` | 调度器提交对应 timer signal 的到期状态，领域方法提交独立灯光模式及下一次 timer，`appearance` memo 更新，采摘阶段不变 | 保留原版光照曲线及 `recharge → idle`、`revive → off`、`drain → withered` 序列；采摘／再生动画可按原调用顺序覆盖这些序列 |
| 植物永久移除 | 提交 `removed = true`，memo 得到 `removed`，同步使动作目标失效、注销实体并撤销全部 timer 任务 | 释放表现绑定、动画回调和光照，再释放 `appearance`、`phase` 等 memo；采摘本身不释放绑定，之后仍需再生 |

标签和动作校验同步读取组件状态，不等待 effect 微任务。表现层不能通过 `.tag = ...` 覆盖全部标签，也不能维护第二份权威采摘状态。

### effect 绑定示意

以下接收上述 `appearance` memo 的只读接口，属于拟新增方案，并非当前组件已有 API。`syncPose` 与 `releaseVisual` 是表现层提供的幂等操作：

```ts
import { createEffect, type ReadonlySignal } from '@dontstarve-web/signals';

function bindFlowerCaveAppearance(
    appearance: ReadonlySignal<PlantAppearance>,
    syncPose: (state: PlantAppearance) => void,
    releaseVisual: () => void,
) {
    const stop = createEffect(() => {
        syncPose(appearance.get()); // 只读取这株植物的派生表现状态
    });

    return () => {
        stop();
        releaseVisual();
    };
}

// 采摘、再生期间保留绑定；植物移除或替换美术时调用返回的释放函数。
```

`syncPose` 同步已有模型的目标姿态，不执行采摘、计时或实体创建。一次性采摘声和过渡动画继续由动作／组件回调触发；表现绑定必须协调过渡与目标姿态，不能立即切换静态姿态而覆盖 `picking`／`grow`。动画完成回调保留代次校验，旧回调不能覆盖新状态。

本项目 `createEffect()` 首次立即执行，后续通过微任务合并更新。最终派生阶段无法表示同一任务中的每一次采摘／再生，也无法携带事件数据；需要这些信息的逻辑继续处理事件或直接组件回调。

采摘／再生期间保留表现绑定与 memo；替换美术或卸载模型时只释放表现绑定，保留逻辑状态、timer 及 memo。永久移除时同步注销权威索引、提交移除标记、撤销 timer 任务，直接调用表现释放函数完成清理，再依次释放 `appearance`、`phase`、`regrowing`、`canHarvest` 及其他派生 memo。不能只等待排队 effect 清理，也不在 effect 初始化回调中自调用释放函数。

### 当前实现

[Pickable](../packages/prefab/src/components/pickable.ts) 已使用私有 signal 保存可采摘、交互、暂停和移除条件，`ComponentTimer` 保存再生 timer signal；`phase`／`regrowing` 为纯 memo，`state` 提供只读视图。成功采摘保留产物交付 → prefab 回调 → 清除可采摘条件并登记再生 → 发布带 picker／loot／plant 的 `picked` 事件的顺序；标签同步更新，领域转换不等待 effect。[BulbPlantController](../packages/prefab/src/bulb_plant.ts) 的独立灯光模式已使用 signal，wake／recharge／turnoff 均通过 timer signal 与游戏时间任务驱动，`appearance` memo 组合阶段、灯光和再生状态；光照曲线仍逐帧采样。草丛与洞穴花在运行场景中共享同一个调度器。贫瘠、移植和枯萎分支尚未完整移植；洞穴花沿用现有再生时长，不在本次草丛实现中扩展季节规则。

## ash：生成、拾取与永久移除

### 组件数据 signal 与派生阶段 memo

灰烬将消散 timer 本身 `disappearTimer`、归属 `placement` 与最终移除标记 `removed` 保存为私有可写 signal，阶段 `phase` 由 `createMemo` 派生。`disappearTimer` 使用洞穴花示例中的 `TimerSnapshot`：设置时记录截止游戏时间，取消写入 `stopped`，到期写入 `expired`；等待期间不逐帧扣减剩余时间。归属取值为 `'pending' | 'ground' | 'inventory'`，其中 `pending` 仅表示实体尚未提交到地面或库存，不是新增玩法。

消散 timer 为 `scheduled` 时保持地面待机；调度器到期后将其提交为 `expired`，memo 得到 `disappearing`。该状态保留到最终移除，不因清掉已完成任务而重置为 `stopped`；这对应原版 `isdisappear` 开始后不能由 `StopDisappear()` 撤销的边界。作祟也由生命周期取消原任务、提交 `expired`，进入同一消散过程。

```ts
import { createSignal, createMemo } from '@dontstarve-web/signals';

type AshPlacement = 'pending' | 'ground' | 'inventory';
type AshPhase = 'pending' | 'ground' | 'inventory' | 'disappearing' | 'removed';

// 在这叠灰烬的组件／生命周期作用域中创建；归属由转移事务提交。
const disappearTimer = createSignal<TimerSnapshot>(initialDisappearTimer);
const placement = createSignal<AshPlacement>(initialPlacement);
const removed = createSignal(false);
const phase = createMemo<AshPhase>(() => {
    if (removed.get()) return 'removed';
    const location = placement.get();
    if (location !== 'ground') return location;
    return disappearTimer.get().status === 'expired' ? 'disappearing' : 'ground';
});
// 对外提供只读数据和 phase，计时与转移不在 memo 中执行。
```

如果需要 `alive`／`onGround`，分别从 `!removed`、`!removed && placement === 'ground'` 派生，不维护额外可写副本。拾取后实体仍存活，再丢弃时同一实体可以重新进入地面阶段；`removed` 才是不可逆终态。

归属不能仅由 `inventoryitem.owner == null` 推导，未提交的资源准备实体也可能没有 owner。地面／库存提交路径维护同一权威归属，不能在应用或表现层复制一份独立状态。延迟任务到期及作祟分支提交 timer 为 `expired`，生命周期同步设置不可拾取／不可保存并登记动画兜底移除，effect 只负责消散表现。

```text
生成／丢弃 → 设置 disappearTimer signal 的截止时间，登记任务
等待       → timer signal 保持不变
成功拾取   → 取消任务，timer 写 stopped，归属写 inventory
到期／作祟 → timer 写 expired → memo 得到 disappearing
最终移除   → removed 写 true → memo 得到 removed，注销并释放
```

timer signal 自身不会计时，memo 不订阅全局时钟检查截止时间；调度器负责到期时更新这叠灰烬的 timer。暂停或停止游戏不以真实时间继续触发消散。领域转换独立于表现 effect 执行，不能因为 effect 尚未运行而允许拾取已进入消散的灰烬。

### Lua → signal／memo／行为映射

| 动作／Lua 入口 | 权威数据变化与派生结果 | 必须保留的行为 |
| --- | --- | --- |
| 材料烧毁 → `DefaultBurntFn()` | 新建 ash 实体，成功提交 `placement = 'ground'`，`removed = false`，memo 得到 `ground` | 原版在非海洋位置先生成 ash，复制原位置及受堆叠上限约束的数量，再移除原材料；生成不能由表现 effect 执行 |
| ash 初始化 → `PrepareDisappear()` | 提交消散 timer 的截止时间和 `scheduled` 状态、登记一次性任务，memo 仍为 `ground` | 原版延迟为 `25 + random() * 10` 秒；等待期间不扣值、不发布逐帧倒计时 |
| 成功入库存 → `inventoryitem` 的 `OnPickup` 回调 | 取消消散任务，一起提交 `disappearTimer = { status: 'stopped' }` 和 `placement = 'inventory'`，memo 得到 `inventory`；`removed` 不变 | 原版调用 `StopDisappear()`；只释放地面表现，保留实体 ID、数量、皮肤和组件状态。失败拾取不提交这些变化 |
| 丢弃 → `ondropped` | 提交 `placement = 'ground'`，重新设置消散 timer 截止时间并登记任务，memo 得到 `ground` | 原版再次 `PrepareDisappear()`；为新地面表现建立绑定，保留同一实体及逻辑 memo |
| 延迟到期或作祟 → `Disappear()` | 提交 `disappearTimer = { status: 'expired' }`，memo 得到 `disappearing`，`removed` 暂时仍为 `false` | 醒着时同步设置 `persists = false`、`NOCLICK` 和不可拾取，播放 `dust_blowaway` 与 `disappear`，保留模型直到动画结束 |
| `animover` 或动画时长加 `0.1` 秒兜底 → `inst:Remove()` | 提交 `removed = true`，memo 得到 `removed`，同步注销逻辑及地面归属 | 完成实体清理，释放表现 effect 和逻辑 memo；原版睡眠实体进入消散时直接移除，跳过可见动画 |
| 堆叠变化 → `stacksizechange` | 数量由 `stackable` signal 表示，不是生成／死亡事件 | 原版数量大于 1 时清空遗骸名字；合堆通过库存事务，完全并入其他堆叠的源实体清理旧表现 |

原材料的 `burning`／`burnt` 不能代替新灰烬的 `alive`，两者是不同实体。灰烬拾取也不是 `onremove`：从地面转入库存时实体仍存活。

### 地面表现绑定示意

以下接收上述 `phase` memo 的只读接口，属于拟新增方案。`syncVisual`／`releaseVisual` 是表现层提供的幂等操作，不修改逻辑实体或库存。权威索引在转移／移除提交路径同步维护，effect 只同步模型和表现索引。

```ts
import { createEffect, type ReadonlySignal } from '@dontstarve-web/signals';

function bindAshGroundAppearance(
    phase: ReadonlySignal<AshPhase>,
    syncVisual: (phase: AshPhase) => void,
    releaseVisual: () => void,
) {
    const stop = createEffect(() => {
        syncVisual(phase.get()); // 只订阅这叠灰烬自身的派生阶段
    });

    return () => {
        stop();
        releaseVisual();
    };
}

// 成功拾取、永久移除或替换美术时，由生命周期调用返回的释放函数。
// 同一灰烬再次丢弃时，为新的地面表现重新绑定。
```

`syncVisual('ground')` 保持地面待机，`syncVisual('disappearing')` 播放一次消散动画，其他阶段清除这次地面表现。同阶段更新不重播动作；读档或替换美术按当前权威数据恢复，不重放首次生成效果。

成功拾取时取消消散任务并释放本次地面表现绑定，逻辑状态及 `phase` memo 随实体保留。替换美术或卸载模型只释放表现绑定，不取消仍有效的逻辑 timer；永久移除时同步注销、提交移除标记并取消全部剩余任务，直接调用表现释放函数，再执行 `phase.dispose()`；若另外创建 `alive`／`onGround` memo，也一并释放。不能只等待排队 effect 删除模型，否则停止 effect 时可能取消最后一次清理。

不要让初始化回调调用尚未赋值的 `const dispose = createEffect(...)`：首次执行发生在返回释放函数之前。释放函数由明确的表现／实体生命周期持有，即使创建时已经不在地面也能安全清理。

`delete ground.insts[id]` 只解除一个索引引用；模型、动画、音源、effect、memo 和异步资源请求仍需分别释放或取消。共享纹理／材质由资源拥有者管理，不随单个灰烬销毁。不将整个清理流程宣称为 O(1)，也不将解除订阅等同于立即 GC。

### 当前实现

[BurnableItemController](../packages/prefab/src/burnableItems.ts) 已在烧毁回调中同步提交预备好的灰烬、复制脚点与数量，再移除原材料；`burning`、`burnt` 和 `persistence` 已使用 signal。[GroundItemManager](../src/groundItems.ts) 通过实体 `onputininventory`／`onremove` 清理地面表现。[ItemEntity](../packages/inventory/src/entity.ts) 的 `isRemoved` 目前是普通字段，没有接入本文的消散 timer／归属／移除标记 signal 或阶段 memo。

ash 已有地面美术、库存、堆叠和保存支持，尚未移植 `disappears` 的消散计时／动画及遗骸名字分支。映射表中的这些 Lua 行为是后续实现要求，不能当作当前已支持的功能。

## stafflight：矮星的简单生命周期

矮星不会拾取、入库存或合堆，只需要一条单向生命周期：

```text
生成 → active → disappearing → removed
                  消失动画       永久注销
```

### 寿命 signal 与派生状态 memo

每颗矮星的生命周期拥有者维护两项权威状态：剩余寿命 `remaining` 和最终移除标记 `removed`，均为私有可写 signal，对外提供只读视图。`phase` 用 `createMemo` 从它们派生，取值为 `'active' | 'disappearing' | 'removed'`，不再维护一份可写阶段状态。

```ts
import { createSignal, createMemo, readonlySignal } from '@dontstarve-web/signals';

type StarPhase = 'active' | 'disappearing' | 'removed';

// 在这颗矮星的生命周期作用域中创建；读档使用已恢复的剩余时间。
const remaining = createSignal(initialRemainingSeconds);
const removed = createSignal(false);
const phase = createMemo<StarPhase>(() => {
    if (removed.get()) return 'removed';
    return remaining.get() > 0 ? 'active' : 'disappearing';
});

const remainingView = readonlySignal(remaining);
const removedView = readonlySignal(removed);
// 对外提供 remainingView、removedView 和 phase；写入由生命周期负责。
```

消失动画期间 `remaining = 0`、`removed = false`。如果需要 `alive`，从 `!removed` 派生即可，不创建另一份可写存活标记；额外创建的 memo 也随逻辑实体释放。`removed` 是终态，同一实体不重新变成存活状态。

### Lua → signal／memo／行为映射

signal 对应组件的权威数据，memo 对应由数据推导的当前状态，effect／生命周期处理对应状态变化后的行为。`createMemo` 不对应 Lua 的事件名：`timerdone` 表示一次到期事件，可能携带 timer 名称；`phase` 表示现在处于哪个阶段，没有事件次数或事件参数。

| TS 职责 | Lua 中对应的职责 | 约束 |
| --- | --- | --- |
| `remaining` signal | `timer` 保存／查询的剩余时间 | signal 自身不会计时，也不包含任务登记、暂停或恢复 |
| 游戏时间调度／组件结算 | `DoTaskInTime()` 及 timer 的到期处理 | 推进寿命，到期时提交 `remaining = 0`；读环境时间使用 `.peek()`，不让每颗星订阅全局时钟 |
| `phase = createMemo(...)` | 按组件数据判断当前状态 | 纯计算，不播放动画、不登记任务、不移除实体 |
| 生命周期方法、表现 effect 和动画回调 | `ontimer()`、`kill_light()`、`kill_sound()` 等转换处理 | 生命周期保证顺序与一次性执行，表现只读取派生状态 |

| 动作／Lua 入口 | 权威数据变化与派生结果 | 行为与地面表现 |
| --- | --- | --- |
| `stafflight` 生成，启动 `extinguish` timer | `remaining > 0`、`removed = false`，memo 得到 `active` | 准备资源后提交实体；首次生成播放 `appear → idle_loop` 和出现声，启动独立循环声与光照 |
| `timerdone`，且 `data.name == 'extinguish'` → `kill_light()` | 提交 `remaining = 0`，memo 得到 `disappearing`，实体仍存活 | 原版播放 `disappear`、设置 `persists = false`、标记 `_killed`，安排 1 秒后 `Remove()`；保留模型播放动画，不立即注销 |
| `disappear` 的 `animover` → `kill_sound()` | 不修改寿命或移除标记，memo 仍为 `disappearing` | 只停止 `staff_star_loop`；原版这里没有直接移除实体 |
| 开始消失后的 1 秒任务 → `inst:Remove()` | 提交 `removed = true`，memo 得到 `removed`，派生 `alive = false` | 同步注销逻辑实体和地面权威索引，停止任务，释放表现、光照、音源、effect 和 memo |
| 显式移除或场景释放 | 任意未移除状态提交 `removed = true` | 幂等清理；旧动画回调及异步资源请求不能恢复实体 |

Lua 的作祟分支先停止 `extinguish` timer，再调用相同的 `kill_light()`；在映射中由生命周期停止寿命任务、提交 `remaining = 0`，进入同一消失流程。脉动光照按时间推进，不要求每帧发布寿命或阶段。

到期时生命周期方法先提交寿命为零、设置不可保存并直接登记 1 秒后的移除任务；这些领域操作不能由表现 effect 延迟执行。消失过程只启动一次，后续结算或重复通知不重复登记任务。剩余寿命的更新仍遵守组件结算规则，不因采用 signal 就逐帧更新。

### effect 示例与释放

下面演示已经加载、处于活动范围内的矮星的绑定职责。运行时的等价绑定位于 `DwarfStarManager.load()`，传入的 `phase` 是上述 memo 的只读接口。`syncVisual` 由表现层提供，用实体 ID 同步其模型／表现索引；它只在阶段变化时切换姿态，剩余寿命降低但阶段仍为 `active` 时不重新播放待机，重复调用也不重复创建模型或播放消失动画。

```ts
import { createEffect, type ReadonlySignal } from '@dontstarve-web/signals';

type StarPhase = 'active' | 'disappearing' | 'removed';

function bindDwarfStarAppearance(
    phase: ReadonlySignal<StarPhase>,
    syncVisual: (phase: StarPhase) => void,
    releaseVisual: () => void,
) {
    const stop = createEffect(() => {
        syncVisual(phase.get()); // 只订阅这颗矮星自身状态
    });

    return () => {
        stop();
        releaseVisual(); // 幂等移除模型和表现索引，释放独立光照与音源
    };
}
```

`syncVisual('active')` 保持已有待机表现，`syncVisual('disappearing')` 进入消失动画，`syncVisual('removed')` 清除地面表现。出现动画与出现声由首次生成路径负责，读档或重新加载模型不能重播。同步辅助函数若需读取环境 signal，仍使用 `.peek()`。

生命周期在最终移除时同步注销权威索引、写入 `removed = true`，并调用绑定返回的释放函数。因为 effect 后续运行在微任务中，调用释放函数可能取消尚未执行的最终阶段更新，所以 `releaseVisual()` 必须直接完成清理，不能只等待 effect 删除模型。完成表现释放后再调用 `phase.dispose()`，解除其对寿命与移除标记的依赖。释放函数不在 effect 初始化回调中自调用。

因此“寿命结束”对应 `disappearing`，“可以永久从地面注销”对应 `removed`。若只用 `alive`，应在最终移除时才写 `false`；消失动画仍需单独由生命周期触发。注销索引与释放 effect 是两项操作，前者不会自动完成后者。

### 当前实现、远近加载与保存

[DwarfStarManager](../packages/prefab/src/stafflight.ts) 已用私有 `remaining`／`removed` signal 保存权威状态，用可释放的 `phase` memo 派生阶段，每次加载模型创建自身阶段的表现 effect。`getStaffLightState(model)` 提供只读的 `remaining`、`removed`、`phase`，不暴露 setter 或 memo 的释放权。`removalAtSeconds` 只保存消失后的移除截止时间，不作为第二份阶段状态；计时仍由同一管理器推进。矮星寿命保留项目指定的 24 分钟；本地 Lua 的 `TUNING.YELLOWSTAFF_STAR_DURATION = total_day_time * 3.5`，默认一天 480 秒，即 28 分钟。共享管理器的极光 `staffcoldlight` 同样使用这套生命周期，寿命保留 16 分钟。

自然到期或 `haunt(model)` 同步提交剩余寿命为零、`persists = false` 和移除截止时间；表现 effect 在微任务中播放一次 `disappear`，动画完成只停止本次绑定的循环声。结算越过寿命边界时，截止时间仍为实际到期点加 1 秒，不从结算点重新计时；已越过消失窗口的直接移除。重复作祟不重播动画、不延长截止时间。`haunt(model)` 提供生命周期入口，玩家幽灵的作祟输入尚未接入。`remove(model)` 支持同步显式移除，取消排队表现也会直接释放模型、独立光照与音源；旧模型动画回调校验控制器身份，不会修改替换后的表现。资源准备期间场景释放会拒绝后续生成。

现有管理器在附近每 60 个有效游戏帧按实际累计 `dt` 结算寿命，保存、远离时结算部分批次；远处只保留逻辑状态，重新靠近时先补算游戏时间，已过期的直接移除。远离卸载模型不代表实体已移除，不能写入 `removed = true` 或注销仍存活的逻辑实体；卸载时只释放这次表现绑定，保留寿命／移除标记及阶段 memo，重新加载时建立新表现绑定。更完整的活动区域方案见 [按 tile 管理生命周期](tile-lifecycle.md)。

保存依据组件寿命与生命周期读取权威状态，不等待 effect。`active` 星体保存 ID、脚点及最新剩余时间，读档先恢复 `remaining`，再建立 memo 和表现绑定，恢复待机；`disappearing`／`removed` 不写入存档，memo 与 signal 对象不写入存档。永久移除由管理器注销实体、提交移除标记，直接释放表现 effect 和独立资源，最后释放阶段 memo；远离时只执行 `unload()`，保留逻辑状态与 memo。场景释放前结算尾帧，永久清理所有实体。应用不复制寿命或并列运行第二个计时器。

## 保存、释放与验证

保存读取组件状态，不等待表现 effect 刷新。洞穴花保存身份、位置、变体、采摘状态、再生剩余时间和独立灯光状态／计时；灰烬保存身份、位置、数量、皮肤及已接入的组件状态。新增消散组件时须明确剩余计时恢复策略；原版 `disappears.lua` 没有 `OnSave`／`OnLoad`，不能把保存剩余延迟宣称为现有 Lua 行为。正在消散的灰烬遵循 `persists = false` 不入存档。

洞穴花的 timer signal 保存时按截止时间与当前游戏时间计算剩余时间，暂停 timer 保存已经记录的剩余时间；读档用恢复后的游戏时钟重新建立截止时间并登记任务，不照搬上次运行的绝对截止时间，也不保存任务句柄。设置、取消、到期与恢复均更新 timer signal，等待期间无需逐帧写入。

恢复时先建立权威实体和归属、恢复组件数据，再建立 memo 和表现绑定，不重播一次性动作。signal／memo 对象、effect、模型引用和释放函数不写入存档。拾取、实体移除、换肤和页面内场景释放清理各自的订阅与资源：移除或替换表现只释放对应 effect，逻辑实体永久移除才释放其 memo。不在 `pagehide`、`beforeunload` 或 `unload` 注册清理。

后续实施保持代表性验证：

- 洞穴花的再生／灯光 timer 只在设置、暂停、恢复、取消或到期时发布；等待期间不逐帧扣值。到期派生对应阶段，取消不误触发再生；失败采摘不改状态，读档重建截止时间和任务且不重播过渡声，永久移除取消任务，替换美术保留逻辑 timer 和 memo。
- 矮星寿命变化只派生阶段，同阶段更新不重播动画；到期先消失再永久注销，最终清理释放 effect 和 memo，即使取消排队 effect 也完整执行；远离卸载保留逻辑状态和 memo，恢复保留身份和寿命。
- 材料烧毁先生成灰烬再移除原物品；灰烬等待期间 timer signal 不变，成功拾取取消任务并派生库存阶段，再丢弃重设截止时间及任务；过期与取消不混淆，永久移除撤销剩余任务并释放 memo，旧 effect 或异步回调不重建模型。
- 消散开始时同步禁止拾取，动画完成或兜底只清理一次；同批次状态变化不丢失必须执行的领域动作。
- 修改环境 signal 不单独触发实体表现 effect；自身 signal 变化时读取最新环境值，表现回调中的外部读取也不形成额外依赖。
- 保存不依赖微任务刷新，恢复保留身份、脚点、数量和组件状态；释放一叠灰烬不影响其他实体的共享资源。

矮星运行时已接入上述生命周期，草丛与洞穴花已接入上述 timer／memo 计时，灰烬消散的映射仍待实施。调试命令语法保持不变；本次补齐 `c_spawn("stafflight")`／`c_spawn("staffcoldlight")` 的注册，新增 `dug_grass` 的生成／给予入口。 `c_spawn("flower_cave")`、`c_spawn("ash")`、`c_spawn("stafflight")`、`c_give("ash", count)`、`c_give("yellowstaff")` 和 `c_save()` 以 [README 调试命令](../README.md#调试命令debugcommand) 为准。

## worldwind：世界风向

`worldwind.lua` 的 `angle` 是 [WorldWind](../packages/componets/src/worldwind.ts) 的私有可写 signal，对外只读（`angle`）；Lua 的 `windchange` 事件对应只读 signal `windchange`，每次变风都写入一个新的冻结 `{angle, velocity}`，因此角度重复时订阅者仍会收到通知。`velocity` 恒为 1。下一次变风是 `ComponentTimer` 上的离散任务：首次 1 秒（Lua 初值 `timeToWindChange = 1`），之后 `math.random(15, 30)` 秒（`0.5 × SEG_TIME` 到 `SEG_TIME`）；到期时 `angle` 与 `windchange` 在同一 `batch()` 中提交，再登记下一次，长帧会逐次补发。等待期间不逐帧递减，`Stop()` 写入 `stopped` 并撤销任务。组件没有 `OnSave`，不入档，读档重新随机。

世界 init 创建 `WorldWind`，把原有 `windchange` signal 注入 `WorldContentKey.Wind`。风滚草在游戏场景中用 `getWatchWorldContent(WorldContentKey.Wind, registerCleanup)` 建立私有本地 signal（独立注入组件时继续由 `watchSignal` 桥接），用 `subscribe()` 监听后续变风（不读取源的 `peek()`，也不把初始值当作事件）；摄像机航向同样用本地 watched signal。移除风滚草时只调用注册的清理函数，同时停止 `startlongaction` 监听、ground-check／重启计时和 `blowinwind`。`blowinwind` 的速度积分是每帧连续运动，保持逐帧更新；世界风向本身不进入逐帧路径。


## 世界腐烂累计刻度的初始化注入

`WorldPerishClock` 在组件内保留温度倍率、历史区间及冻结累计量的计算。世界 init 把组件原有的只读 `snapshot` 注入 `WorldContentKey.PerishClock`（来源名 `perishTick`），并把同一个组件的 `GetTick()`／`GetFrozenTick()` 服务作为 `perishClock` 引用注入上下文和 watched signal。已结算快照只在 60 帧结算或显式 `Flush()` 时通知；当前刻度和历史查询通过服务读取，不能用快照替代尚未结算的前缀。世界释放组件，本地消费者只清理自己的监听；累计刻度仍是应用的休眠补算适配，Lua 原版依赖 `perishable.lua` 每次更新时的温度。

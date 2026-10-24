# Beefalo

在游戏控制台输入 `c_spawn('beefalo')`，会在玩家附近的空地生成一只成年野生皮弗娄牛。可重复生成，每只牛拥有独立行为、动画和物理碰撞体，共享原始贴图。

prefab 装配与物理位于 `packages/prefab/src/beefalo.ts`，行为树位于 `packages/brains/src/beefalobrain.ts`，状态图位于 `packages/stategraphs/src/SGBeefalo.ts`，依据 DST 的 `prefabs/beefalo.lua`、`brains/beefalobrain.lua`、`stategraphs/SGBeefalo.lua` 和 `components/periodicspawner.lua`：

- `Wander` 按源行为树等待 1～4 秒、行走 2～5 秒，从当前位置寻找 12 个 DST 单位外的可行走点；有 `knownlocations.herd` 时才按白天 20、其他时段 5 个单位的距离回到牛群位置。`walk_start → walk → walk_stop` 播放 `walk_pre/loop/pst`，前摇期间就开始移动；`walk` 每个动画周期重新进入，状态计时使用游戏时间调度器。`locomotor.StopMoving()` 只停电机，保留行为树目的地；`Stop()` 清除移动意图和路径。寻路避开建筑，物理碰撞防止穿过角色。
- `idle` 进入时设置 1～2 秒 timeout；野生牛的零饥饿分支按 50% / 25% / 25% 选择 `graze_empty`、`shake`、`bellow`。`graze_empty` 播放 `graze2_pre`，排队播放非循环的 `graze2_loop`，从进入状态起计时 1～6 秒；到期播放 `graze2_pst` 并立即进入 `idle`，把循环 `idle_loop` 排在后面，新的 idle timeout 同时开始。`graze` 是独立状态，播放循环 `graze_loop`，不能与 `graze_empty` 混用；它对应有饥饿度的分支，喂养和 hunger 组件尚未接入。`shake` 有 `idle/canrotate` 标签，允许移动打断；`bellow` 只有 `canrotate`。
- `FaceEntity` 优先于 `Wander`：玩家进入 4 个 DST 单位内时停止移动，进入 `alert → actual_alert`，播放 `alert_pre → alert_idle`；仅有 `canrotate` 标签时转向目标。保持到目标距离达到 6 个单位或失效，随后行为树恢复游荡；`actual_alert` 的 2～4 秒 timeout 不重播已经运行的 `alert_idle`。
- 睡眠由 `packages/componets/src/sleeper.ts` 的 `Sleeper` 驱动（`components/sleeper.lua`）：`isasleep` 是私有 signal，只读视图对外；通过 `createEffect` 和 `get()` 跟踪世界从时钟 phase 派生的只读 `isNight` signal，进入或离开夜晚时在微任务中执行现有测试；此外每 4 ± 0.5 秒游戏时间由 `ComponentTimer` 在共享调度器上检查忙碌、战斗等条件，`StopTesting()` 同时阻止昼夜回调测试，销毁时释放订阅。时钟仍每 60 个有效游戏帧结算；与 Lua 的纯周期测试相比，昼夜变化改为 signal 更新后的微任务检查，无需等待周期定时器。默认测试为夜间且没有 `busy` 状态标签时入睡，天亮或着火、有战斗目标时醒来。源状态名为 `sleep → sleeping → wake`，对应 `sleep_pre → sleep_loop → sleep_pst`；`sleeping` 的每次非循环动画结束重新进入自身。`sleep` 的 `nowake` 标签让前摇期间的醒来先等到 `animover`，`wake` 的 `nosleep` 标签防止立即跳回入睡。入睡停止 brain，醒来重新启动；事件直接驱动状态图，不由 prefab 每帧轮询补做转换。`BeefaloManager` 初始化时读取并订阅世界的昼夜、季节 signal，`dispose()` 取消订阅并停止所有 sleeper 的测试；季节状态暂不触发发情等行为。
- `PeriodicSpawner` 使用 `SetRandomTimes(40, 60)`，即每 40～100 秒尝试在身后生成粪肥，密度与间距检查由 `PeriodicSpawner` 拥有，按 Lua 在牛的原点检查最小间距 8、半径 20 内最多 2 个，再由 prefab 将新粪肥放到身后；世界只提供现有位置查询和生成入口。粪肥由通用 `poop` prefab 创建，可以拾取和保存，并带有 `flies` 子实体的原版动画和循环声；靠近、拾取和燃烧的规则见下文。

距离与行走速度按 `TILE_SIZE / 4` 转换为场景单位。牛保持源动画原点为脚点；六向画面根据运动方向和相机方向选择，改变朝向不会重播动画。所有部件合并为一份帧几何，透明双面材质使用 `forceSinglePass`，与玩家和建筑按脚点深度统一排序。

资源按源目录原样保存于 `public/dst/data/anim/`：`beefalo_basic.zip`、`beefalo_actions.zip`、`beefalo_actions_domestic.zip`、`beefalo_build.zip`。前三份提供动画，最后一份提供 `beefalo_build` 和两个贴图图集。动画支持集中在 `packages/animation/src/beefaloSprite.ts`，组合这些资源包、切换六方向动画，并隐藏源脚本中的 `HEAT` 层。

`c_save()` 保存牛的 ID、位置、`knownlocations`、朝向和粪肥剩余计时；`PeriodicSpawner.OnSave()` 按 Lua 向下取整剩余秒数，读档重新登记截止时间。新生成的独立牛没有虚构的 herd 位置；旧存档的 `home` 转为 herd，新存档保留兼容字段并以 named locations 为准。状态图和 Wander 的临时等待不保存，加载从 `idle` 初始化，再由当前昼夜与行为树驱动。状态 timeout、timeline 和粪肥 timer 都是调度器上的离散 `ComponentTimer`，等待期间不逐帧改写信号；状态退出和销毁取消任务。本次仅实现被动基础行为，尚未接入牛自身的音效、战斗、发情、喂养、驯化或骑乘；粪肥的苍蝇动画和声音已接入。

## 剃毛

`packages/componets/src/beard.ts` 按 `components/beard.lua` 提供 `Beard`：`bits`、`daysgrowth`、`daysgrowthaccumulator` 是私有可写 signal，只公开只读视图（`beard.bits.peek()`）；`hairy` 是由 `bits > 0` 派生的纯 memo；预设值用 `SetBits` / `SetDaysGrowth` 写入，`Reset`、`OnLoad` 用 `batch()` 一次提交，领域逻辑读取 `peek()`，批次内也能看到已写入的值。组件自带 `HasTag('bearded')`，与胡须数量无关。牛初始 `bits = 3`、`daysgrowth = 4`，回调为第 0 天 `OnShaved` 和第 3 天 `OnHairGrowth`；`OnShaved` 在 Lua 里只调用 `ApplyBuildOverrides`，这里由外观 effect 承担，第 0 天的空回调仅保留 `Shave` 回溯所需的标记。每日生长是共享游戏时间调度器上的一个离散 timer：`Beard` 持有 `ComponentTimer`（只读视图 `dayTimerState`，状态为 `scheduled` / `stopped` / `expired`），截止点是世界注入的 `secondsUntilNextDay(now)` 给出的下一个日界（`TOTAL_DAY_TIME` 的整数倍，调度器以世界已流逝秒数起算）。等待期间 signal 不变；到期时执行 `OnDayComplete` 并登记下一个日界，所以一次长帧或读档后的时间跳跃会逐天补发，第 3 天的 `OnHairGrowth` 只在恰好第 3 天执行一次。`Beard` 不读时钟或 tuning，也不订阅全局时钟；销毁、`EnableGrowth(false)` 写入 `stopped` 并撤销任务。timer 不入档，读档按当前世界时间重新登记。

`Beard:Shave` 沿用 Lua 的回溯算法：先检查 `bits == 0`（`NOBITS`）和 `canshavetest`，再从当前 `daysgrowth` 向前找回调，`daysgrowth <= 0` 时 `Reset()` 调用 `OnResetBeard`——移除 `has_beard` 标签、播放 `shaved` 状态。`CanShaveTest` 在牛睡着时通过，醒着返回 `AWAKEBEEFALO`；牛铃主人、死亡与 `SOMEONEELSESBEEFALO` 分支依赖未移植的 `health` / `beefbell`。掉落的 `beefalowool` 由 `groundItems.flingLoot` 抛出，数量为剃掉的毛量。

`OnResetBeard` 在睡着时设置 `statemem.continuesleeping`，保证切换到 `shaved` 不触发睡眠状态的退出唤醒。`shaved` 带 `busy/sleeping` 标签，播放 `shave`，结束后睡着则进入 `sleeping`，否则进入 `wake`；`hairGrowthPending` 是牛自己的私有 signal（对应 Lua 的 `inst.hairGrowthPending`），第 3 天回调在 `bits == 0` 时置位，牛下次进入 `idle` 时读取它，播放 `hair_growth_pre`，随后 `hair_growth_pop` 用 `SetBits(3)` 恢复毛量并清除标记。`has_beard` 不再是存储的标签：牛的 `hasTag()` 经组件 `HasTag` 从 `beard.hairy` 派生，`model.userData.tags` 只保留 `beefalo`、`animal`、`largecreature`。外观由一个只订阅 `beard.hairy` 的 effect 驱动 `SpriteController.setBuild`，在 `beefalo_build` 与 `beefalo_shaved_build` 之间切换（对应 `getbasebuild`），读档时随载入的毛量自动正确，无需单独的 `OnLoadPostPass`。两个 build 的材质由工厂共享并统一释放；牛销毁时取消每日订阅、停止 effect 并释放 memo，之后的天数变化不再生长。

玩家使用鼠标举着的 `razor`（`components/shaver.lua`）左键点击带 `bearded` 标签的牛，`ItemUseActionController` 发出 `SHAVE`：`SGwilson` 的 `shave` 状态先用 `beard:ShouldTryToShave` 检查，失败时推送带原因的 `actionfailed`；通过则播放 `build_pre → build_loop` 和 `dontstarve/wilson/shave_LP`，1 秒后提交，随后 `build_pst`。声音经 FEV 核对：`wilson/shave_LP` 为 sounddef 82，`sfx/wilson/Shave_1..6.wav`，`wilson.fsb` 零基索引 87–92（提取索引 88–93），可用 `packages/prefab/scripts/fev-events.py` 复核。

`c_save()` 在 `components.beefalo.beard` 保存 `growth`、`growthaccumulator`、`bits`；读档按 `beard.lua:OnLoad` 重放 0 到 `daysgrowth` 的回调，`bits == 0` 时移除 `has_beard` 并应用剃光外观（对应 `OnLoadPostPass`）。缺少该字段的旧存档按满毛加载。

尚未移植：`brushable`、`domesticatable`（剃毛的顺从度变化）、`skinner_beefalo`（`UnSkin`）、`rideable:Buck`、牛铃与 `health`。已移植的 passive 分支由 `BeefaloBrain` 的 `PriorityNode(.25)`、共享 `FaceEntity` 与 `Wander` 驱动；其余未接入分支不作为当前支持的功能。

## 粪肥的苍蝇与声音

`packages/prefab/src/poop.ts` 按 `poop.lua` 装配地面便便与 `flies` 子实体；`flies.ts` 使用原版 `anim/flies.zip` 的 bank/build `flies`、`swarm_pre/loop/pst`。苍蝇是 `NOCLICK/DECOR`，原点跟随便便的权威 transform，部件仍合并为整帧几何；它以便便脚点参与排序，使用父对象的 sort group 和后续 sort layer，不参与父对象的拾取射线。每份地面便便有独立动画、`playerprox` 和循环音源，资源在创建实体前准备。

`packages/componets/src/playerprox.ts` 实现 Lua 默认 `AnyPlayer` 分支：near=2、far=3 个 DST 单位，距离使用严格小于比较，10/30 秒一次离散检查；`isclose` 是私有 signal，定时器为 `ComponentTimer`，只读快照通过 `timerState` 暴露。初次 0 秒任务强制更新邻近状态，远处播放苍蝇循环声，近处播放 `swarm_pst` 并停声；远离后 `swarm_pre → swarm_loop` 并重新启动声音。这不是夜间睡眠，`OnEntitySleep/OnEntityWake` 对应实体活动区域的休眠和唤醒。取消、移除写入 stopped，旧动画完成回调不能恢复已经散开的苍蝇。

`poop.lua` 的 `OnPutInInventory` 和 `OnBurn` 都移除苍蝇，`OnDropped` 在地面重新创建；便便通过既有 `BurnableItemController` 使用 `MED_BURNTIME=15` 秒和灰烬输出，不添加应用层的便便判断。每份循环声由统一 `sound.ts` 的 `PlaySound/PreloadSounds` 管理，移除时 stop/disconnect；模型、邻近检测和声音均在显式销毁时释放，不注册 pagehide 清理。

`dontstarve/common/flies` 经源 `dontstarve.fev` sound definition 56 映射至 `common.fsb` 零基 file_index 74～80，即提取索引 75～81，原样本为 `Flies_soothed_DST_-001..007.wav`。按 `vgmstream-cli -i` 导出的七个 WAV 与源目录已有解码 WAV 字节一致；浏览器选择一个样本循环。便便入档只保存物品身份、脚点、数量等组件数据，苍蝇及临时检测不入档，恢复时重新创建并按当前玩家位置决定是否播放。

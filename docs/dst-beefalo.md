# Beefalo

在游戏控制台输入 `c_spawn('beefalo')`，会在玩家附近的空地生成一只成年野生皮弗娄牛。可重复生成，每只牛拥有独立行为、动画和物理碰撞体，共享原始贴图。

实现位于 `packages/prefab/src/beefalo.ts`，依据 DST 的 `prefabs/beefalo.lua`、`brains/beefalobrain.lua`、`stategraphs/SGBeefalo.lua` 和 `components/periodicspawner.lua`：

- 随机游荡和停步，使用 `walk_pre`、`walk_loop`、`walk_pst`；寻路避开建筑，物理碰撞防止穿过角色。
- 空闲时吃草、抖毛或播放嚎叫动作。野生牛初始饥饿值为零，吃草使用 `graze2_pre/loop/pst`。
- 玩家进入 4 个 DST 单位内时停步注视，超过 6 个单位才恢复游荡。
- 睡眠由 `packages/componets/src/sleeper.ts` 的 `Sleeper` 驱动（`components/sleeper.lua`）：`isasleep` 是私有 signal，只读视图对外；每 4 ± 0.5 秒游戏时间由 `ComponentTimer` 在共享调度器上测试一次，默认测试为夜间且没有 `busy` 状态标签时入睡，天亮或着火、有战斗目标时醒来。入睡播放 `sleep_pre → sleep_loop`，醒来播放 `sleep_pst`。`BeefaloManager` 初始化时读取并订阅世界的昼夜、季节 signal，`dispose()` 取消订阅并停止所有 sleeper 的测试；季节状态暂不触发发情等行为。
- 每 40–60 秒尝试在身后生成粪肥，遵守最小间距 8、半径 20 内最多 2 个的源脚本规则。粪肥使用已有地面动画，可以拾取和保存。

距离与行走速度按 `TILE_SIZE / 4` 转换为场景单位。牛保持源动画原点为脚点；六向画面根据运动方向和相机方向选择，改变朝向不会重播动画。所有部件合并为一份帧几何，透明双面材质使用 `forceSinglePass`，与玩家和建筑按脚点深度统一排序。

资源按源目录原样保存于 `public/dst/data/anim/`：`beefalo_basic.zip`、`beefalo_actions.zip`、`beefalo_actions_domestic.zip`、`beefalo_build.zip`。前三份提供动画，最后一份提供 `beefalo_build` 和两个贴图图集。动画支持集中在 `packages/animation/src/beefaloSprite.ts`，组合这些资源包、切换六方向动画，并隐藏源脚本中的 `HEAT` 层。

`c_save()` 保存牛的 ID、位置、游荡中心、朝向和粪肥剩余计时。加载时重新创建碰撞体和动画，依据当前昼夜恢复行为。本次仅实现被动基础行为，尚未接入音效、战斗、发情、喂养、驯化或骑乘。

## 剃毛

`packages/componets/src/beard.ts` 按 `components/beard.lua` 提供 `Beard`：`bits`、`daysgrowth`、`daysgrowthaccumulator` 是私有可写 signal，只公开只读视图（`beard.bits.peek()`）；`hairy` 是由 `bits > 0` 派生的纯 memo；预设值用 `SetBits` / `SetDaysGrowth` 写入，`Reset`、`OnLoad` 用 `batch()` 一次提交，领域逻辑读取 `peek()`，批次内也能看到已写入的值。组件自带 `HasTag('bearded')`，与胡须数量无关。牛初始 `bits = 3`、`daysgrowth = 4`，回调为第 0 天 `OnShaved` 和第 3 天 `OnHairGrowth`；`OnShaved` 在 Lua 里只调用 `ApplyBuildOverrides`，这里由外观 effect 承担，第 0 天的空回调仅保留 `Shave` 回溯所需的标记。每日生长是共享游戏时间调度器上的一个离散 timer：`Beard` 持有 `ComponentTimer`（只读视图 `dayTimerState`，状态为 `scheduled` / `stopped` / `expired`），截止点是世界注入的 `secondsUntilNextDay(now)` 给出的下一个日界（`TOTAL_DAY_TIME` 的整数倍，调度器以世界已流逝秒数起算）。等待期间 signal 不变；到期时执行 `OnDayComplete` 并登记下一个日界，所以一次长帧或读档后的时间跳跃会逐天补发，第 3 天的 `OnHairGrowth` 只在恰好第 3 天执行一次。`Beard` 不读时钟或 tuning，也不订阅全局时钟；销毁、`EnableGrowth(false)` 写入 `stopped` 并撤销任务。timer 不入档，读档按当前世界时间重新登记。

`Beard:Shave` 沿用 Lua 的回溯算法：先检查 `bits == 0`（`NOBITS`）和 `canshavetest`，再从当前 `daysgrowth` 向前找回调，`daysgrowth <= 0` 时 `Reset()` 调用 `OnResetBeard`——移除 `has_beard` 标签、播放 `shaved` 状态。`CanShaveTest` 在牛睡着时通过，醒着返回 `AWAKEBEEFALO`；牛铃主人、死亡与 `SOMEONEELSESBEEFALO` 分支依赖未移植的 `health` / `beefbell`。掉落的 `beefalowool` 由 `groundItems.flingLoot` 抛出，数量为剃掉的毛量。

`shaved` 状态播放 `shave`，结束后睡着则继续 `sleep_loop`，否则 `sleep_pst`；`hairGrowthPending` 是牛自己的私有 signal（对应 Lua 的 `inst.hairGrowthPending`），第 3 天回调在 `bits == 0` 时置位，牛下次进入 `idle` 时读取它，播放 `hair_growth_pre`，随后 `hair_growth_pop` 用 `SetBits(3)` 恢复毛量并清除标记。`has_beard` 不再是存储的标签：牛的 `hasTag()` 经组件 `HasTag` 从 `beard.hairy` 派生，`model.userData.tags` 只保留 `beefalo`、`animal`、`largecreature`。外观由一个只订阅 `beard.hairy` 的 effect 驱动 `SpriteController.setBuild`，在 `beefalo_build` 与 `beefalo_shaved_build` 之间切换（对应 `getbasebuild`），读档时随载入的毛量自动正确，无需单独的 `OnLoadPostPass`。两个 build 的材质由工厂共享并统一释放；牛销毁时取消每日订阅、停止 effect 并释放 memo，之后的天数变化不再生长。

玩家使用鼠标举着的 `razor`（`components/shaver.lua`）左键点击带 `bearded` 标签的牛，`ItemUseActionController` 发出 `SHAVE`：`SGwilson` 的 `shave` 状态先用 `beard:ShouldTryToShave` 检查，失败时推送带原因的 `actionfailed`；通过则播放 `build_pre → build_loop` 和 `dontstarve/wilson/shave_LP`，1 秒后提交，随后 `build_pst`。声音经 FEV 核对：`wilson/shave_LP` 为 sounddef 82，`sfx/wilson/Shave_1..6.wav`，`wilson.fsb` 零基索引 87–92（提取索引 88–93），可用 `packages/prefab/scripts/fev-events.py` 复核。

`c_save()` 在 `components.beefalo.beard` 保存 `growth`、`growthaccumulator`、`bits`；读档按 `beard.lua:OnLoad` 重放 0 到 `daysgrowth` 的回调，`bits == 0` 时移除 `has_beard` 并应用剃光外观（对应 `OnLoadPostPass`）。缺少该字段的旧存档按满毛加载。

尚未移植：`brushable`、`domesticatable`（剃毛的顺从度变化）、`skinner_beefalo`（`UnSkin`）、`rideable:Buck`、牛铃与 `health`。同时，`beefalobrain.lua` 的行为仍在 `BeefaloController` 内，未迁到 `packages/brains`。

# Lightning goat

在游戏控制台输入 `c_spawn("lightninggoat")`，会在玩家附近的空地生成一只伏特羊（与 `c_spawn("beefalo")` 使用同一个空地查找）。没有 `c_give`。

移植方式与[皮弗娄牛](dst-beefalo.md)相同：`packages/prefab/src/lightninggoat.ts` 的 `lightningGoatPrefabs` 登记在应用层共享的 `PrefabEntityManager`，`LightningGoatInstance` 是实体本身，组件经 `addComponent` 加在它上面，`setcharged`／`discharge`／`ReduceCharges`／`OnSave`／`OnLoad` 是模块顶层函数；`MakeCharacterPhysics(inst, 100, .5)` 由定义的 `physics` 声明，每帧在物理步之后经 `componentUpdates` 跟随刚体，再推进状态图、brain 和 locomotor。依据 DST 的 `prefabs/lightninggoat.lua`、`brains/lightninggoatbrain.lua`、`stategraphs/SGlightninggoat.lua`。

- 标签 `lightninggoat`、`animal`、`lightningrod`，以及组件加上的 `herdmember`、`saltlicker`、`locomotor`、`inspectable`。`Transform:SetFourFaced`：四向画面。
- 组件：`health`（`LIGHTNING_GOAT_HEALTH` = 700）、`sleeper`（抗性 4）、`lootdropper`（`lightninggoat` / `chargedlightninggoat` 两张掉落表，死亡未移植所以不会掉落）、`inspectable`（充电时 `CHARGED`）、`knownlocations`、`herdmember`（`lightninggoatherd`）、`timer`、`saltlicker`（`SetUp(1)`）、`locomotor`（走 4、跑 8）。
- `herdmember`、`saltlicker`、`electricattacks` 是新补的最小实现（`packages/componets/src/`）：只有标签、字段和源方法签名，羊群与盐块未移植，所以 `GetHerd()` 为空、不会去找盐块；`electricattacks` 只记录来源，最后一个来源移除时自行移除组件，战斗读取它的电击伤害未移植。
- 充电：带 `lightningrod` 标签，`SendLightningStrike`（`c_lightning()`）会把 40 单位内的落雷引到它身上并推送 `lightningstrike`；`electrocute` 事件同样充电。`setcharged` 加 `charged`、`electricdamageimmune` 标签和 `electricattacks`，换 `lightning_goat_shocked_build`、显示 `fx` 层、开灯（半径 .85、衰减 .5、强度 .75），进入 `shocked`，`chargeleft = 3`；每到一个日界（`WatchWorldState("cycles")`）减 1，归零时 `discharge`：去掉标签与组件、关灯，`discharge` 状态第 18 帧隐藏 `fx` 层并换回普通 build。泛光（bloom）没有渲染。
- 状态图：`idle`（2～6 秒后 `bleet`，充电时每 44 帧 `jacobshorn`，两次 `chew` 的帧号按源在加载时随机一次）、`bleet`、`walk_start` / `walk` / `walk_stop`（`walk` 第 2 帧跑、第 14 帧走）、`taunt`、`discharge`、`electrocute`→`shocked`、以及 commonstates 的 `sleep` / `sleeping` / `wake`。源码把入睡时间线写成 `startsleeptimeline`，而 `AddSleepStates` 读的是 `starttimeline`，所以源入睡时不播 `jacobshorn`，这里保持一致。战斗（attack/hit/death）、冰冻和尸体状态未移植。
- 行为树：`PanicTrigger`、`FaceEntity`（10 单位内的玩家，14 单位外放弃，0.25 秒超时）后接 `RunAway`（8 单位内的 `character`，跑到 12 单位外）、单独的 `FaceEntity`、`Wander`（回 `herd` 位置，白天 20、其他 5）。`OnInitializationComplete` 记住 `spawnpoint`。没有盐块，`ShouldSeekSalt` 恒为假，`AnchorToSaltlick` 不运行；`AttackWall`、`ChaseAndAttack` 需要未移植的战斗。
- 声音：`dontstarve_DLC001/creatures/lightninggoat/*` 经 `dontstarve_DLC001.fev` sounddef 25～37 映射到 `lightninggoat.fsb` file_index + 1；62 个 WAV 用 `vgmstream-cli -i` 导出，与源目录已解码 WAV 字节一致。`headbutt` 只在未移植的攻击时间线使用。
- 资源：`import-rocks.py` 镜像 `lightning_goat_basic.zip`、`lightning_goat_actions.zip`、`lightning_goat_build.zip`、`lightning_goat_shocked_build.zip` 并审计状态图播放的全部 clip；`walk`、`walk_pst` 各朝向帧数相差 1，逻辑时长取首个朝向。

`c_save()` 由 `GetPersistData` 保存 `health`（`{ health, maxhealth }`）、`knownlocations` 和充电时的 `lightninggoat`（`{ charged, chargeleft }`，即源 `OnSave` 的两个字段）；读档时按源 `setcharged(inst, true)` 恢复充电外观而不进入 `shocked`。`scripts/import-dst-region.py` 导入源存档里的伏特羊（健康值、`spawnpoint` / `herd` 位置与充电），`Cluster_65` 最新地表快照导入 4 只；`lightninggoatherd` 不导入，`herd` 位置停在原羊群处。

未移植：战斗（`RetargetFn`、`KeepTargetFn`、`OnAttacked` 的电击反伤与 `ShareTarget`）、`MakeMediumBurnableCharacter`、`MakeMediumFreezableCharacter`、`MakeHauntablePanic`、`spawnedforhunt`、阴影、羊群与交配季。

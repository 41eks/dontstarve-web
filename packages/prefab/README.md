# @dontstarve-web/prefab

DST 场景预制体。该包基于 `@dontstarve-web/animation` 组合具体资源，当前提供：

`skinId` 保存在 `SpriteJson.skinId` 中；`PrefabInstance.skinId` 的 getter / setter 读写同一份声明，修改时发布 sprite signal。prefab 用 `sprite.setSkinSource()` 声明源皮肤 ID 到 archive 的映射、共享资源所有者及符号／附加动画 bank 配置。`PrefabDisplay` 在收到声明后查询共享缓存，缺失的 build／animation 由 display 异步加载；完成后按当前 json 应用，过期请求只留下缓存。直接设置 `instance.skinId` 即可换皮，设为 `undefined` 恢复基础外观，保留实体、sprite 控制器、动画进度及完成回调。休眠不为换皮加载资源，唤醒后应用最新声明。

- `wortox`（`wortox.ts`）：`MakePlayerCharacter('wortox', assets, common_postinit, master_postinit)` 返回的玩家 prefab。`player_common.ts` 的 `MakePlayerCharacter` 对应 `player_common.lua` 的同名函数，负责所有角色共用的 fn；角色专有的 ANIM 资源、标签和 `master_postinit` 状态（wortox 的传送计数 `inst.wortox`）写在角色文件里。幽灵与复活在 `player_common_extensions.ts`
- `pigKingPrefabs`（`pigking`）：猪王的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册
- `nightmareRockPrefabs`（`nightmarerock`）对应 `sanityrock` / `insanityrock` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册：`NightmareRockInstance` 持有状态图、`AddRefreshTask`（文件级 `UPDATE_OFFSET` 错开各实体的刷新）、`updatephysics` 和寻路墙（升起且未隐藏时在周围 3×3 DST 单位登记 `Pathfinder` 墙，移除时撤销），刷新时跳过带 `notarget` 标签的玩家，inspectable 状态为 `ACTIVE` / `INACTIVE`；只保存身份与位置，状态在载入后按附近玩家的理智重新推导；地图图标 `obelisk.png`。
- `Pathfinder`（`pathfinder.ts`）：`TheWorld.Pathfinder` 的 Lua 接口（`SubmitSearch`、`GetSearchStatus`、`GetSearchResult`、`KillSearch`、`IsClear`、`AddWall`、`RemoveWall`、`GetPathTileIndexFromPoint`），位置用世界单位的向量，搜索由 `update()` 分帧推进。只考虑地皮和 `AddWall` 登记的墙；引擎算法不可见，路径可能与原版不同。应用层 `src/building.ts` 持有唯一实例，每帧 `update()`；玩家的 `Locomotor` 和 `componets` 的 `LocoMotor` 共用 `LocoMotorPath` 走 Lua 的 `FindPath` 流程，墙、栅栏和 `atrium_gate` 用 `AddWall` 登记。树、石头等其他障碍交给物理碰撞。
- `rockAvocadoSaplingPrefabs`：石果萌芽的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册。
- `pillarPrefabs`：`pillar.lua` 的遗迹和洞穴石柱（`pillar_ruins`、`pillar_cave`、`pillar_cave_flintless`、`pillar_cave_rock`、`pillar_algae`）的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册。`atriumPillarPrefabs`、`archivePillarPrefabs`、`vaultPillarPrefabs`、`monkeyPillarPrefabs` 同样注册 `pillar_atrium`、`archive_pillar`、`vault_pillar`（含不入档的下半部分子实体）和 `monkeypillar`；`archive_pillar` 的 bank 和 build 由实例在构造和 `choosebroken` 里用 `AnimState.SetBank`／`SetBuild` 声明。这些 ID 都可 `c_spawn`，都没有 `c_give`。
- `tentaclePillarPrefabs`（`tentacle_pillar.ts`）：`tentacle_pillar.lua` 的触手柱 `tentacle_pillar` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；bank `tentaclepillar`、build `tentacle_pillar`（同一个 `tentacle_pillar.zip`），`idle` 循环 billboard（`instancedAnimations: ['idle']`、`staticBillboard`），`MakeObstaclePhysics` 半径 2、高 24，小地图 `tentacle_pillar.png`，标签 `blocker`、`cavedweller`、`tentacle_pillar`、`wet`、`NPCcanaggro`、`inspectable`。`TentaclePillarInstance` 持有 `health`（750，`nofadeout`）、`playerprox`（10／30）、`lootdropper`（共享 `tentacle_pillar` 表：`tentaclespike` 0.5、`turf_marsh` 0.25、`tentaclespots` 0.4、`rocks` 1.0）、`combat`（`onhitfn`）、`inspectable`、`hauntable`。`OnHit` 播 `hit` 后压 `idle`（循环）；`OnEmerge`／`OnEmergeOver` 播 `emerge` 后回 `idle`，期间 `notarget`／无敌；`OnDeath` 播 `retract` 并掉落。`c_spawn("tentacle_pillar")` 无额外参数，没有 `c_give`；`c_save()` 保存 ID、位置、`health` 和 `overtaken`。未移植：`teleporter` 组件及 `SwapToHole`／`Overtake`／`OnActivateByOvertake`／`DoRetract`／`OnLoadPostPass` 的配对（`tentacle_pillar_hole` 未移植）、`SpawnArms`／`KillArms`／`StartTrackingArm`／`OnFar`（`tentacle_pillar_arm` 未移植）、`OnEntitySleep`／`OnEntityWake` 与声音、`CustomOnHaunt`（缺 `health:Kill`）、`CreateHiddenGlobalIcon`（`globalmapiconseeable`）、`SetAABB`、`SetPlayerAliveMode`、`tentacle_pillar_atrium`。美术由 `import-rocks.py` 镜像并审计 `tentaclepillar` bank 的 `idle`、`hit`、`emerge`、`retract`。
- `moonFissurePrefabs`（`moon_fissure.ts`）：月亮裂隙 `moon_fissure` 及发光子实体 `moon_fissure_fx` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；`MoonFissureInstance` 持有 `inspectable`、`workable`（0／1）、`sanityaura`、`repairable`（`moon_altar`）、`_level` 和 `fx`。监听月相（`WorldContentKey.Moon` 上的 `createEffect`）：月相变化时延迟 `math.random()` 秒播 `transition` 再压回 `crack_idle`，5 帧后 `UpdateState` 按新月相切换图层与 `max_distsq`；`inst.Light` 由 `OnUpdateLight`（`DoPeriodicTask(FRAMES)`）逐帧读 `inst.light` 插值半径／强度／衰减并按昼夜亮度染色，新月置空，休眠取消、唤醒恢复（`watchSignal(inst.status)` + `createEffect`）。`inspectable.getstatus` 在新月返回 `NOLIGHT`；`sanityaura` 的 `aurafn`／`fallofffn` 按 `_level` 取 `lightstate_data` 的 sanityaura 值。`moon_fissure_fx`（`fx_fn`）是 `persists = false`、标签 `DECOR`／`NOCLICK`、bank／build `moon_fissure_fx` 的子实体：`fn` 里 `SpawnPrefab("moon_fissure_fx")` 并 `entityParent` 挂到裂隙上，`UpdateState` 按月亮盈亏在 `fx` 上显示／隐藏 `low`／`med`／`high`／`full` 发光图层，发光月相把 `backing` 移到 `fx`、新月放回自身。`c_spawn("moon_fissure")`／`c_spawn("moon_fissure_fx")` 无额外参数，没有 `c_give`；`c_save()` 保存 `moon_fissure` 的 ID 和位置（`moon_fissure_fx` 不入档）。未移植：`repairable` 的 `onrepaired`／`checkmaterialfn`（嵌入未移植的 `moon_altar` 部件）。美术由 `import-rocks.py` 镜像并审计两个 bank 的 `crack_idle`、`transition`；`delayed_transition` 的 `crack_open` 声音映射在 `sound.ts`（`turnoftides/common/together/moon_fissure/crack_open`）。
- `oceanVineDecoPrefabs`（`oceanvine_deco.ts`）：装饰藤蔓 `oceanvine_deco` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；bank `vine_rainforest_border`、build `waterforest_vines`，构造时随机 `animnum`（1～6）并循环 `idle_<animnum>`（普通 sprite 绘制，不进实例批次：6 个 72 帧的大幅循环预合成后约 5.7 GB），标签 `NOBLOCK`、`NOCLICK`、`flying`，`distancefade` 只有构造签名（`Setup(15, 25)` 未调用）。`c_spawn("oceanvine_deco")` 无额外参数，没有 `c_give`；`c_save()` 保存 ID、位置和 `animnum`。美术由 `import-rocks.py` 镜像并审计 `idle_1`～`idle_6`。
- `oceanVinePrefabs`（`oceanvine.ts`）：悬垂藤蔓 `oceanvine` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；bank／build `oceanvine`，`idle_fruit` 循环（实例化，读档后随机帧），小地图 `oceanvine.png`，标签 `hangingvine`、`flying`、`NOBLOCK`、`oceanvine`、`high_dolongaction`、`inspectable`、`pickable`、`canlight`。`OceanVineInstance` 持有 `inspectable`、`pickable`（`fig`，再生 1200 秒，`cycles_left` 1）、`burnable`（燃烧 7 秒）、`propagator`（small）、`hauntable`（冷却 5 秒）；`makeemptyfn`／`makefullfn` 按源切换 `fig` 图层、`idle_nofruit`／`idle_fruit`（读档时不播 `fruit_grow`）和 `inspectable`。`c_spawn("oceanvine")` 无额外参数，没有 `c_give`；`c_save()` 保存 ID、位置和 `pickable`。未移植：采摘回调（惊动附近藤茧、`harvest` 动画）、燃烧回调与火焰 fx、作祟点燃、`fall`／`fall_down_fn`／`placegoffgrids`、动态阴影、声音、`oceanvine_patch`。美术由 `import-rocks.py` 镜像并审计全部 8 个源码动画。
- `reedsPrefabs`（`reeds.ts`）：芦苇 `reeds` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；bank `grass`（`grass.zip`）、build `reeds.zip`，`idle` 循环（`instancedAnimations: 'all'`、`staticBillboard`，随机起始帧，`colour` 实例属性承载随机 `SetMultColour`），小地图 `reeds.png`，标签 `plant`、`silviculture`、`pickable`、`inspectable`、`BURNABLE_fuel`、`canlight`。`ReedsInstance` 持有 `pickable`（`cutreeds`，再生 1440 秒，`makeemptyfn` 播 `picked`）、`inspectable`、`fuel`（15）、`burnable`（fx 2 级、燃烧 15 秒）、`propagator`（small）、`hauntable`（冷却 5 秒）。`c_spawn("reeds")` 无额外参数，没有 `c_give`；`c_save()` 保存 ID、位置和 `pickable`。未移植：`onpickedfn`、`onregenfn`、燃烧 fx 与回调、`SetOnFlashPoint`、`AddToRegrowthManager`、`MakeNoGrowInWinter`、`SetOnHauntFn`、声音。美术由 `import-rocks.py` 镜像并审计 `grass` bank 的 `idle`、`picking`、`picked`、`grow`。
- `ropeBridgePrefabs`（`rope_bridge.ts`）：`rope_bridge.lua` 的 `rope_bridge_fx` 及其绳子（`rope_bridge_fx_rope`）和小地图图标（`rope_bridge_fx_icon`）实体，均 `persists = false`，只由洞穴的 `RopeBridgeManager` 在读档时生成，不提供 `c_spawn`。桥面 OnGround、`LAYER_BACKGROUND`、`SortOrder 1`，八向朝向随 `SetRotation`（`SetEightFaced` 的 `rotation` 参数）；两根绳子按 `ROPE1/ROPE2_OFFSET` 随朝向放在桥两侧，变体随机且互不相同。未移植：声音、`OnAnimOver`（`bridge_place` → `bridge_idle`）、`ShakeIt`、`KillFX`、绳桥套装和放置器。
- `mastMalbatrossPrefabs`（`mast_malbatross.ts`）：`mast.lua` 的 `mast_malbatross` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；bank `mast_malbatross` 的 clip 分在三个动画包（`assets.extraAnimationArchives`），build `boat_mast_malbatross_build.zip`，`Transform:SetEightFaced` 与 `SetRotation` 记在 sprite 的 `facingRotation` 上（同 fence），`closed` 不循环；`skins` 为 `dynamic/mast_malbatross_tesla.zip`、`dynamic/mast_malbatross_wagstaff.zip`。`MastMalbatrossInstance` 持有 `burnable`（fx 4 级、30 秒、`ignorefuel`）、`propagator`（large）、`hauntable`（`HAUNT_TINY`）、`inspectable`、`mast`、`lootdropper`、`workable`（HAMMER，3）、`upgradeable`（`mast`）。`componets` 的 `Mast` 与 `Upgradeable` 只实现帆状态／阶段、它们的标签、`SailFurled`／`SailUnfurled` 的动画和存档。`c_spawn("mast_malbatross")` 无额外参数，没有 `c_give`；`c_save()` 保存 ID、位置、`mastMalbatross`（`rotation`、`is_sail_raised`、`skinId`）和 `upgradeable`。未移植：`on_hammered`、`on_hit`、`onbuilt`、`onburnt`、`ondeconstructstructure`、`OnUpgrade`（灯、避雷针）、`SetLootSetupFn`、燃烧 fx 与回调、`SetOnFlashPoint`、舵、船、拉帆、声音与灯光。美术由 `import-rocks.py` 镜像（含两款皮肤的 `.zip`／`.dyn`）并审计该 bank 的全部 11 个 clip。
- `supportPillarPrefabs`（`support_pillar.ts`）：支撑柱 `support_pillar` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；bank／build `support_pillar`，`Transform:SetEightFaced` 记为 sprite 的朝向旋转 0，构造时 `idle_4` 播一次，`OnLoad` 的 `UpdateLevel` 按 `constructionsite` 的石料数算 `_level`／`suffix` 并播 `idle<suffix>`（不循环）；`MakeObstaclePhysics` 半径 1.45、高 6，小地图 `support_pillar.png`，标签 `blocker`、`structure`、`antlion_sinkhole_blocker`、`constructionsite`、`repairconstructionsite`、`inspectable`，有石料时加 `quake_blocker`。`SupportPillarInstance` 持有 `constructionsite`（`componets/src/constructionsite.ts`：材料、启用状态与存档；满 40 块时 `Disable`）、`inspectable`、`lootdropper`（`y_speed` 4）、`workable`（HAMMER，5，`SetRequiresToughWork(false)`），以及只有构造签名的 `deployhelper`。`c_spawn("support_pillar")` 无额外参数，没有 `c_give`；`c_save()` 保存 ID、位置、`supportPillar`（`reinforced`）和 `constructionsite`（`materials.rocks`）。未移植：`OnConstructed`、`LootSetupFn`、`onhit`／`onhammered`、`OnAnimOver`、`onsink`、`OnEntitySleep`／`OnEntityWake` 与地震监听、`DoRegen`、碎石 fx、`MakeReinforced`、`RegisterPathFinding`、`SetPrefabNameOverride`、`OnEnableHelper`、声音，以及 `support_pillar_dreadstone`、脚手架和放置器。美术由 `import-rocks.py` 镜像并审计 `support_pillar` bank 的全部 25 个 clip。
- `shadowForgePrefabs`（`shadow_forge.ts`）：暗影术基座 `shadow_forge` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；bank／build `shadow_forge`（`shadow_forge.zip`，另声明 `snow.zip` 与隐藏的 `snow` 层），`idle` 播一次（不循环），`MakeObstaclePhysics` 半径 0.4，`SetDeploySmartRadius(1)`，小地图 `shadow_forge.png`（优先级 5），标签 `blocker`、`structure`、`shadow_forge`、`prototyper`、`SnowCovered`、`inspectable`、`HAMMER_workable`。`ShadowForgeInstance` 持有 `inspectable`、`prototyper`（`PROTOTYPER_TREES.SHADOW_FORGE`：`SHADOWFORGING` 2）、`lootdropper`、`workable`（HAMMER，4）、`hauntable`（`HAUNT_TINY`）和只有构造签名的 `lunarhailbuildup`。`c_spawn("shadow_forge")` 无额外参数，没有 `c_give`；`c_save()` 保存 ID 和位置，无组件字段。未移植：`onturnon`／`onturnoff`／`onactivate`、`onhit`、`on_finished_hammering`、`onbuilt`、声音、图鉴数据、`shadow_forge_kit` 与放置器。美术由 `import-rocks.py` 镜像并审计 bank 的全部 9 个 clip。
- `oasislakePrefabs`（`oasislake.ts`）：绿洲湖 `oasislake` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；bank／build `oasis_tile`，`idle` 循环，`SetOrientation(OnGround)` + `LAYER_BACKGROUND` + `SetSortOrder(-3)` 对应 `setGround(0)` + `setMeshOrder(-.56)`，`Transform:SetRotation(45)` 转动平放的贴图；`MakeObstaclePhysics` 半径 6，`SetDeploySmartRadius(3.8)`，小地图 `oasis.png`，标签 `blocker`、`watersource`、`birdblocker`、`antlion_sinkhole_blocker`、`allow_casting`、`inspectable`、`fishable`。`OasislakeInstance` 持有 `inspectable`、`fishable`（`maxfish` 15、再生 90 秒）、`hauntable`（`HAUNT_TINY`），以及只有构造签名的 `pointofinterest`、`oasis`、`watersource`（`componets/src/oasislakeSignatures.ts`）。`c_spawn("oasislake")` 无额外参数，没有 `c_give`；`c_save()` 保存 ID、位置、`oasislake`（`regrowth`）和 `fishable`。未移植：`OnInit` 及其 `ms_stormchanged` 监听、`OnSandstormChanged`、`TryFillLake`、`OnIsWet`／`OnIsWetChanged`（干涸、`wet`／`dry_*` 动画、碰撞掩码与 `NOCLICK` 切换）、`SpawnOasisBugs`、`SpawnSucculents`、`SetGetFishFn(GetFish)`、`ms_registeroasis`、`oasis.radius`、`pointofinterest:SetHeight`、声音。美术由 `import-rocks.py` 镜像 `oasis_tile.zip` 与 `splash.zip`，并审计 `oasis_tile` 的 `idle`、`wet`、`dry_pre`、`dry_idle`、`dry_pst` 和 `splash/splash`。
- `beehivePrefabs`（`beehive.ts`）、`wasphivePrefabs`（`wasphive.ts`）：蜂巢 `beehive` 和杀人蜂巢 `wasphive` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；bank／build 分别为 `beehive`、`wasphive`（加 `snow.zip`），`cocoon_small` 循环 billboard，`MakeObstaclePhysics` 半径 0.5，小地图 `beehive.png`／`wasphive.png`；`MakeSnowCoveredPristine`（`standardcomponents.ts`，从 `MakeSnowCovered` 拆出）在 Lua 的位置加 `SnowCovered`。组件按 Lua 顺序：`health`（200／250）、`childspawner`（蜂巢 `bee`，`SeasonalSpawnChanges` 按生成时的季节设再生 30 秒、释放 40 秒、最多 5 只，春季除以 1.33、最多 7 只；杀人蜂巢 `childname` 保持 `""`（源码写成 `childspawner.childspawner`），再生、释放 20 秒，最多 5 只；两者应急 8 只，半径 20／25）、`worldsettingstimer`（签名）、`lootdropper`（3 个 `honey`、1 个 `honeycomb`）、`burnable`（fx 4 级、30 秒）、蜂巢的 `freezable`（抗性 2）、杀人蜂巢的 `playerprox`（10／13）、`combat`、`propagator`（蜂巢 large、杀人蜂巢 medium）、`lunarhailbuildup`（签名）、`hauntable`（`HAUNT_SMALL`／`HAUNT_MEDIUM`）、`inspectable`。`c_spawn` 无额外参数，没有 `c_give`；`c_save()` 保存 ID、位置、`health` 和 `childspawner`。未移植：`OnInit` 的 `isday` 监听与 `StartSpawning`／`StopSpawning`（因此不出蜂）、季节监听、`OnPreLoad`、`WorldSettings_ChildSpawner_*` 的外部计时器、`OnIgnite`、`OnFreeze`／`OnThaw`／`OnUnFreeze`、`OnHit`／`onhitbyplayer`、`OnKilled`、`onnear`、`SetPlayerAliveMode`、`OnHaunt`、燃烧与碎冰 fx、`SetOnFlashPoint`、`SetLunarHailBuildupAmountSmall`、声音。美术由 `import-rocks.py` 镜像并审计两个 bank 的 `cocoon_small`、`cocoon_small_hit`、`cocoon_dead`、`frozen`、`frozen_loop_pst`。
- `spiderdenPrefabs`（`spiderden.ts`）：蛛巢 `spiderden` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；bank／build `spider_cocoon`，按 `growable` 阶段 1～3 循环 `cocoon_small`／`cocoon_medium`／`cocoon_large`，`SetStage` 在构造和 `OnLoad` 时先播一次 `grow_sac_to_small`／`grow_small_to_medium`／`grow_medium_to_large` 再压入对应 idle 循环，并隐藏 `bedazzled_flare`；`MakeObstaclePhysics` 半径 0.5，小地图 `spiderden_<stage>.png`；标签 `blocker`、`cavedweller`、`structure`、`lifedrainable`、`beaverchewable`、`hostile`、`spiderden`、`bedazzleable`、`hive`、`NPC_workable`，阶段 3 的 `AddSleepingBag` 另加 `tent`，未满阶段由 `upgradeable` 加 `spider_upgradeable`。`SpiderdenInstance` 持有 `health`（250／500／1000）、`childspawner`（`spider`，再生 90 秒、释放 5 秒，阶段 3／6／9 只、应急 0／4／8 只、半径 10／15／20）、`worldsettingstimer`（签名）、`lootdropper`、`burnable`（fx 3／3／4 级、20／20／30 秒）、`freezable`（碎冰 3／4／5 级、抗性 2／3／4）、`combat`、`upgradeable`（`SPIDER`）、`propagator`（medium）、`growable`（3 阶段，源第 4 阶段的 `AttemptMakeQueen` 未声明，`springgrowth`，春季战斗按生成时季节）、`inspectable`、`workable`（无动作）、`hauntable`（冷却 5 秒）、`shaveable`（只有构造签名）、`bedazzlement`（只有构造签名）和阶段 3 的 `sleepingbag`。`c_spawn("spiderden")` 生成阶段 1，没有 `c_give`；`c_save()` 保存 ID、位置、`health`（`current`／`maximum`）、`growable`、`childspawner` 和 `upgradeable`；`shaveable.prize_count`、`worldsettingstimer` 的计时器和阶段 4 的蜂后生成不移植。未移植：`OnInit` 的洞穴白天监听、`OnPreLoad`、`OnLoadPostPass`、`OnWork`／`OnHit`／受击防守、`OnKilled`、`OnFreeze`／`OnThaw`／`OnUnFreeze`、`OnIgnite`／`OnExtinguish`、`OnUpgrade`／`OnStageAdvance`／`CanUpgrade`、`OnShaved`／`CanShave`、`OnHaunt`、`OnGoHome`／`onspawnspider`、`OnEntitySleep`／`OnEntityWake`、地面蛛网、声音和 `spiderden_bedazzled`。美术由 `import-rocks.py` 镜像 `spider_cocoon.zip` 并审计该 bank 的全部 28 个 clip。
- `seastackPrefabs`（`seastack.ts`）：海蚀柱 `seastack` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；bank `water_rock01`、build `water_rock_01`（`water_rock_01.zip`），`UpdateArt` 按 `stackid` 1～5 与剩余工作量循环声明 `<stackid>_full`（>6）或 `<stackid>_low`，均不循环，`<stackid>_med` 分支因源中未设置 `has_medium_state` 不会被选中；构造隐藏 `paint_A`／`paint_B`，`OnLoad` 的 `tinted` 为真时随机显示一层并切换到小地图 `seastack_painted.png`；`MakeWaterObstaclePhysics` 半径 0.8、高 2，物理半径覆盖 2.35，标签 `blocker`、`ignorewalkableplatforms`、`seastack`、`inspectable`、`waterplant_upgradeable`、`MINE_workable`。`SeastackInstance` 持有 `waterphysics`（签名）、`floater`（签名）、`inspectable`、`lootdropper`（共享 `seastack` 表：4 个 `rocks`，`y_speed` 14）、`workable`（MINE、9、`savestate`）、`upgradeable`（`WATERPLANT`）和 `hauntable`（小冷却）；`OnSave`／`OnLoad` 写在模块顶层的 `saveSeastack`／`loadSeastack`。`c_spawn("seastack")` 无额外参数，没有 `c_give`；`c_save()` 保存 ID、位置、`stackid`、`tinted`、`workable.workleft` 和 `upgradeable`。未移植：撞船 `on_collide`、`OnWork` 的采完掉落与 `rock_break_fx`、`OnUpgraded` 的水草替换、`TestForPowderMonkeyTint`、`floater` 的尺寸／偏移／缩放／`SetIsObstacle`／`bob_percent`／`OnLandedServer`、投掷速度字段、`MakeHauntableWork` 的回调、声音，以及同文件的 `seastack_spawner_swell`／`seastack_spawner_rough`。美术由 `import-rocks.py` 镜像 `water_rock_01.zip` 并审计该 bank 的全部 19 个 clip。
- 龙鳞火炉 `dragonflyfurnace`（`dragonfly_furnace.ts`，`dragonfurnace.lua` 的 `fn`）：可建造、`c_spawn("dragonflyfurnace")`，`c_save()` 保存位置、皮肤（`dragonflyfurnace_adventure`／`_antique`／`_crystal`）与容器内容；无 `c_give`。bank／build `dragonfly_furnace`，`hi` 循环，placer `idle`，小地图 `dragonfly_furnace.png`，`SetLightOverride(.4)`，自带光源（半径 1、衰减 .9、强度 .5，橙色）与 `heater`（热量 115，标签 `HASHEATER`），标签 `structure`、`wildfireprotected`、`cooker`。醒着时循环 `fire_LP`（三层）；`onbuilt` 播 `place` → `hi_pre` → `hi` 与放置声，第 30 帧 `fireAddFuel`，第 40 帧 `light` 并开始 `fire_LP`。锤 6 次，每次播 `hi_hit` 并掉出、关闭容器，最后按配方掉落并播放 `collapse_big`（金属）。容器为 `containers.lua` 的 2×2 `dragonflyfurnace`（类型 `cooker`，拒收 `irreplaceable`），面板与烹饪锅共用 `DstCookPotPanelElement`，按钮按 `buttoninfo`（文字、`validfn`、位置）显示“摧毁”；打开时右键也提供 `INCINERATE`。`incinerator`（`componets/src/incinerator.ts`）销毁除 `winter_food4`、`irreplaceable` 与非空容器以外的内容并推送 `onincinerated`，随后播 `incinerate` 与 `qol1/dragonfly_furnace/incinerate`，关闭容器并禁止打开到该段动画结束后一帧。未移植：`cooker` 组件、`SetBloomEffectHandle`、`saladfurnace`。
- 冰魔杖 `icestaff`（`staff.ts`，`staff.lua` 的 `blue_common("blue", 1)`）：手持武器，伤害 0、攻击距离 8／10（DST 单位）、20 次耐久，标签 `icestaff`、`weapon`、`rangedweapon`、`extinguisher`、`shadowlevel`；`c_give("icestaff")`、`c_spawn("icestaff")`，`c_save()` 保存剩余次数与皮肤（8 款）。装备后左键点战斗目标（`combat` + `health`，非墙、非其他玩家）发射 `ice_projectile`（`staff_projectile.ts`，`ice_spin_loop`）；命中时 `onattack_blue` 扣 1 理智、叫醒睡眠目标、扑灭燃烧或冒烟的目标、`SuggestTarget`、推送 `attacked`，并给 `freezable` 加 1 点寒冷值与碎冰特效；不能冰冻的目标原地播 2 级 `shatter`。燃烧或冒烟的目标左右键都是“扑灭”。冰冻由 `componets/src/freezable.ts`（`components/freezable.lua`）负责：寒冷值每 10 秒衰减 1 点，未冻结时按比例加 `FREEZE_COLOUR`，达到抗性冻结 10 秒，再解冻 10 秒，任何 `attacked` 累计伤害达到 `damagetobreak`（默认 0）即碎冰；`standardcomponents.ts` 的 `Make{Tiny,Small,Medium,Large,Huge}FreezableCharacter` 设碎冰等级与抗性。碎冰特效 `shatter`（`world_fx.ts`，`frozen_shatter.zip`，`WorldFx.shatter(position, level)`）放在实体位置，未跟随符号。冰冻外观：蜂巢 `beehive` 与光虫 `lightflier` 播 `frozen` / `frozen_loop_pst` 并叠加 `frozen.zip` 的 `swap_frozen`，声音 `freezecreature`、`freezethaw`（循环）。未移植：作祟反应、皮肤音效、`colouradder`、`BlankOutAttacks`、`icestaff2`／`icestaff3`、玩家自身被冰冻、`dragonfly` 的冰冻显示。
- `oceanTreePrefabs`（`oceantree.ts`）：水中树 `oceantree` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；走共享 archive 路径：`SetShort`／`SetNormal`／`SetTall` 用 `AnimState.SetBank`／`SetBuild` 声明当前生长阶段 `oceantree_short`／`_normal`／`_tall` 的 bank 和 build（`assets` 另含 `snow.zip`），display 读档后按声明创建，运行中长到下一阶段时经 archive 精灵的 `setArtSource` 切换；两个 sway 循环用 `instancedAnimations` 合批，随机明暗用 `colour` 实例属性，`sway1_loop`／`sway2_loop` 随机循环并随机起始帧，随机明暗、缩放 1.1，`MakeWaterObstaclePhysics` 半径 0.8、高 2，物理半径覆盖 2.35，小地图 `oceantree_tall.png`（优先级 -1），雪覆盖用 `MakeSnowCovered`，`tree_bud1`～`7` 图层按 `buds_used` 显示。`OceanTreeInstance` 持有 `burnable`（燃烧 45 秒、fx 5 级）、`propagator`（medium）、`inspectable`、`workable`（CHOP，5／10／15）、`lootdropper`（1／2／3 个 `log`）、`growable`（3 阶段循环）、`simplemagicgrower`、`timer`、`hauntable`，以及只有构造签名的 `waterphysics`、`lunarhailbuildup`、`waxable`。`c_spawn("oceantree")` 无额外参数，随机 1～3 阶段，没有 `c_give`；`c_save()` 保存 ID、位置、`growable` 和 `oceantree`（`no_grow`、`buds`、`buds_used`、`supertall_growth_progress`）。未移植：砍伐与倒下（`oceantree_falling`）、树桩、燃烧与烧毁、生长过渡动画、休眠时移除／唤醒时补回燃烧组件、船撞、树果 `oceantreenut` 掉落、催长液与 `oceantree_pillar`、水波纹与根部阴影子实体 `oceantree_ripples_*`／`oceantree_roots_*`、陆地上换成半径 0.25 的普通障碍、检查状态、声音。美术由 `import-rocks.py` 镜像，并审计三个阶段 bank 的全部源码动画。
- `watertreePillarPrefabs`（`watertree_pillar.ts`）：水中木柱 `watertree_pillar` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；bank `oceantree_pillar`、build `oceantree_pillar_build1`，经 `AnimState.AddOverrideBuild` 叠加 `oceantree_pillar_build2`，`idle` 循环 billboard（树冠帧超过 4096 像素的实例化图集，故不走 `instancedAnimations`），`MakeWaterObstaclePhysics` 半径 4、高 2，小地图 `oceantree_pillar.png`，标签 `blocker`、`cocoon_home`、`shadecanopy`、`ignorewalkableplatforms`、`inspectable`。`WatertreePillarInstance` 持有 `childspawner`（`grassgator`，最多 1 个，再生 120 秒、释放 30 秒）、`timer`、`playerprox`（28／29）、`inspectable`，以及只有构造签名的 `waterphysics`、`distancefade`、`canopyshadows`、`canopylightrays`、`worldsettingstimer`、`lightningblocker`。`c_spawn("watertree_pillar")` 无额外参数，没有 `c_give`；`c_save()` 保存 ID、位置和 `watertreePillar`（`num_oceantreenuts`、`last_ram_time`、`cocoons_to_regrow`、`childspawner.childreninside`、`timer`）。撞击掉落、闪电、萤火虫、藤茧再生、`grassgator` 生成、玩家进出树冠和 `watertree_pillar_ripples`／`_roots` 子实体未移植。美术由 `import-rocks.py` 镜像并审计 `idle`、`root_ripple`、`root_shadow`。
- `oceanTreePillarPrefabs`（`oceantree_pillar.ts`）：小水中木柱 `oceantree_pillar` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；bank `oceantree_pillar_small`、build `oceantree_pillar_small_build1`，经 `AnimState.AddOverrideBuild` 叠加 `oceantree_pillar_small_build2`，`idle` 循环 billboard（与 `watertree_pillar` 一样不走 `instancedAnimations`），`MakeWaterObstaclePhysics` 半径 1.5、高 2，小地图 `oceantree_pillar_small.png`，标签 `blocker`、`shadecanopysmall`、`event_trigger`、`ignorewalkableplatforms`、`CHOP_workable`、`inspectable`、`canlight`。`OceanTreePillarInstance` 持有 `lootdropper`（4 个 `log`、3 个 `twigs`）、`playerprox`（22／23）、`workable`（CHOP，25）、`inspectable`、`burnable`（燃烧 30 秒、fx 6 级）、`propagator`（medium），以及只有构造签名的 `waterphysics`、`distancefade`、`canopyshadows`、`lightningblocker`。`c_spawn("oceantree_pillar")` 无额外参数，没有 `c_give`；`c_save()` 保存 ID、位置和 `oceantreePillar`（`droppedvines`）。未移植：`sproutfn`（`OnSprout`）、砍伐与倒下、燃烧、船撞、闪电掉落、`startvines` 藤蔓生成、`OnRemoveEntity`、玩家进出树冠、`_hascanopy`、声音。`fn` 生成 `oceantree_pillar_ripples`（`root_ripple` 循环，`SetOceanBlendParams(0.6)` 按海洋颜色染色）和 `oceantree_pillar_roots`（`root_shadow` 播一次；`LAYER_WIP_BELOW_OCEAN` + `UNDERWATER` 对应 `setLayer('background')` + `setMeshOrder(-1.755)`，排在海洋底色与海面之间），二者标签 `FX`、`NOCLICK`，`persists = false`，经 `entityParent` 挂到柱子上、随柱子移除；`c_spawn("oceantree_pillar_ripples")`／`c_spawn("oceantree_pillar_roots")` 单独生成，不入档，没有 `c_give`。`oceantree_pillar_leaves`（`FX`、`NOCLICK`，`leaf_fall_ground` 播一次，`persists = false`）只由未移植的 `chop_down_tree` 生成，可 `c_spawn`，不入档，没有 `c_give`；`animover` 移除、水面改播 `leaf_fall_water` 及声音未移植。美术由 `import-rocks.py` 镜像并审计源码播放的全部 clip。
- `atriumFencePrefabs`（`atrium_fence.ts`）：`c_spawn("atrium_fence")` 在玩家脚点生成中庭尖刺栅栏，无额外参数，`c_give` 会拒绝。初始播放一次 `shrunk`，形状在 1～5 中随机选取。`c_save()` 保留 ID、位置与 `fenceid`，读档后从收起重新按距离和中庭供电状态升降。供电时升起并切换到对应形状的 `idle*_active`，断电后距可见玩家不足 7 DST 单位时收起，8 DST 单位内保持收起。两种升降都使用 Lua 的非循环队列和碰撞掩码，并播放一次对应音效。
- `atriumOvergrowthPrefabs`（`atrium_overgrowth.ts`）：中庭雕文 `atrium_overgrowth` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；bank／build `atrium_overgrowth`，`idle` 播一次（不循环），`MakeObstaclePhysics` 半径 1.5，小地图 `atrium_overgrowth.png`，标签 `ancient_text`、`blocker`、`sanityaura`、`inspectable`。`AtriumOvergrowthInstance` 持有 `sanityaura`（`aura = -SANITYAURA_SUPERHUGE`）、`inspectable`，以及只有构造签名的 `roseinspectable`；`OnSave`／`OnLoad` 为模块顶层的 `rune_onsave`／`rune_onload`，读档时按源把模块级 `_storyprogress` 抬到读到的最大值。`c_spawn("atrium_overgrowth")` 无额外参数，没有 `c_give`；`c_save()` 保存 ID、位置和 `atriumOvergrowth`（`storyprogress`）。未移植：`rune_getstatus`／`rune_getdescription`（因此不会调用 `rune_AdvanceStory`）、`MakeRoseTarget_CreateFuel_IncreasedHorror` 的 `SetOnResidueActivated`／`SetForcedInduceCooldownOnActivate`、`SanityAura:GetAura`、声音、已弃用的 `atrium_idol`。美术由 `import-rocks.py` 镜像并审计 `idle`。
- `atriumRubblePrefabs`（`atrium_rubble.ts`）：中庭碎石 `atrium_rubble` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册，配置全部来自 `generated/atrium_rubble.schema.ts`（`pnpm extract:lua --prefab atrium_rubble`）；bank／build `atrium_rubble`，构造先播 `idle1`，再按 `SetAnimId(inst, math.random(2))` 改播 `idle1`／`idle2`（都不循环），`MakeObstaclePhysics` 半径 0.5，小地图 `atrium_rubble.png`，标签 `blocker`、`inspectable`。`AtriumRubbleInstance` 持有 `inspectable`（`getstatus` 按模块级 `_storyprogress` 轮流分配 `LINE_1`～`LINE_5` 并记在 `storyprogress`）、`hauntable`（冷却 3 秒，作祟返回 false），以及只有构造签名的 `roseinspectable`；`OnSave`／`OnLoad` 保存并恢复 `animid` 与 `storyprogress`。`c_spawn("atrium_rubble")` 无额外参数，没有 `c_give`；`c_save()` 保存 ID、位置和 `atriumRubble`（`animid`、`storyprogress`）。未移植：`MakeRoseTarget_CreateFuel_IncreasedHorror` 的 `SetOnResidueActivated`／`SetForcedInduceCooldownOnActivate`、图鉴字段的 UI。美术由 `import-rocks.py` 镜像并审计 `idle1`、`idle2`。
- `archivePropsPrefabs`（`archive_props.ts`）：档案馆静态物件（`archive_moon_statue`、`archive_rune_statue`、`archive_portal` 及其不入档的 `archive_portal_shadow` 阴影子实体、`archive_switch_base`、`archive_switch_pad`、`archive_ambient_sfx`、`rubble1`、`rubble2`）的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；月亮雕像的采矿回调、符文雕像的故事进度和存档字段 `archiveProp` 写在各自实例上。`c_spawn` 的 ID 与语法不变，均无 `c_give`；`rubble1`／`rubble2` 按源在下一游戏帧自我移除。
- `caveExitPrefabs`（`cave_exit.ts`）：洞穴出口的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；`worldmigrator` 和迁移事件对应的动画回调写在 `CaveExitInstance` 上，分片连接由应用层注入。`c_spawn("cave_exit")` 无额外参数，没有 `c_give`；`c_save()` 保存 ID 和位置。
- `bulbPlantPrefabs`（`bulb_plant.ts`）：`flower_cave`、`flower_cave_double`、`flower_cave_triple` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；`BulbPlantInstance` 持有 LightWatcher 灯光循环、`pickable` 回调和存档字段 `bulbPlant`，`flower_cave` 的 single／springy 由实例按 plantname 用 `AnimState.SetBank`／`SetBuild` 声明（构造和读档时）。三个 ID 均可 `c_spawn`，没有 `c_give`。
- `marbleShrubPrefabs`（`marbleshrub.ts`）：`marbleshrub` 及 `marbleshrub_short`／`_normal`／`_tall` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；ID 只决定初始成长阶段，按源 `SetPrefabName("marbleshrub")` 都保存为 `marbleshrub`。`MarbleShrubInstance` 持有成长、采矿、掉落和 `marbleShrub` 存档字段；`marblebean_sapling` 通过注入的 `spawnPrefab("marbleshrub_short")` 后调用 `growfromseed()` 长成灌木。四个 ID 均可 `c_spawn`，没有 `c_give`。
- `marbleBeanSaplingPrefabs`（`marblebean_sapling.ts`）：大理石豆苗 `marblebean_sapling` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；`grow` 计时器按与石果萌芽相同的方式存为 `saplingTimer`，到期后生成 `marbleshrub_short` 并调用 `growfromseed()`。`c_spawn("marblebean_sapling")` 无额外参数，没有 `c_give`；种子 `marblebean` 部署时经 `SpawnPrefab` 生成。
- `caveHolePrefabs`：洞穴破洞及其 `cave_hole_surface` 子实体的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册。
- `skeletonPrefabs`（`skeleton.ts`）：`skeleton`、`skeleton_player`、`skeleton_notplayer`、`skeleton_notplayer_1`、`skeleton_notplayer_2` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；玩家骷髅的死亡描述由 `SkeletonInstance.SetSkeletonDescription`（Lua `Player_SetSkeletonDescription`）写在实例上，并随 `skeleton` 存档字段保存。均可 `c_spawn`，无 `c_give`。
- `hotspringPrefabs`（`hotspring.ts`）：温泉的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；热源、bathbombable、光照与周期蒸汽任务写在 `HotspringInstance` 上，蒸汽 `crater_steam_fx1`～`4`、`slow_steam_fx1`～`5` 是 `world_fx` 的 fx.lua 条目。`c_spawn("hotspring")`，无 `c_give`；月圆结晶、开采和泡澡分支未移植。
- `caveEntrancePrefabs`（`cave_entrance.ts`）：`cave_entrance`、`cave_entrance_open` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；`CaveEntranceInstance` 持有封闭入口的 `workable`／`lootdropper` 与开放入口的 `worldmigrator`，开采完成时经注入的 `spawnPrefab` 在原地生成开放入口后移除自身。开放入口以非平铺的背景层 ground order 绘制。均可 `c_spawn`，无 `c_give`；蝙蝠 `childspawner`、`cave_entrance_ruins` 未移植。
- `lavaPondPrefabs`（`lava_pond.ts`）：`lava_pond` 与 `lava_pond_rock`、`lava_pond_rock2`～`7` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；`LavaPondInstance` 持有 `heater`（500）、光照和 `DoTaskInTime(0, SpawnRocks)`，随池生成的焦岩不入档，布局随 `lavaPond.rocks` 保存。均可 `c_spawn`，无 `c_give`；碰撞点燃、propagator、cooker 与龙蝇音乐未移植。
- `molehillPrefabs`（`molehill.ts`）：鼹鼠丘 `molehill` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；`MolehillInstance` 持有 50 格 `inventory`、单子代 `spawner`、1 次 DIG 的 `workable`、`dig_up` 掉落和 `AdoptChild`，存档字段仍为 `molehill`（`items`、`child`／`childid`／`startdelay`）。应用层用 `createMoleHabitat` 构造鼹鼠共享的世界：`MAKEMOLEHILL` 经注入的 `spawnPrefab("molehill")` 建丘，读档时在外的子代按 `childid` 在该鼹鼠加入世界时认领；`mole_move_fx` 是 `world_fx` 的 fx.lua 条目。`c_spawn("molehill")` 无额外参数，没有 `c_give`；hauntable、inspectable 未移植。
- `beeQueenHivePrefabs`（`beequeenhivegrown.ts`）：长成的蜂后蜂巢 `beequeenhivegrown` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；`BeeQueenHiveInstance` 持有 16 次 HAMMER 的 `workable`（`savestate`）、`hiveregen` 计时器、锤击回调和蜂蜜外观，`OnLoad` 按源 `RefreshHoneyState` 刷新蜂蜜层级；计时器存档字段仍为 `beeQueenHiveTimer`。`c_spawn("beequeenhivegrown")` 无额外参数，没有 `c_give`；`beequeenhive` 基座、蜂后生成与锤击掉落未移植。
- `ruinsRelicPrefabs`（`ruinsrelic.ts`）：`ruinsrelic.lua` 六种复制品、`smashables.lua` 六种天然遗迹和 `ruins_rubble_table/chair/vase` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；`RuinsRelicInstance` 持有锤击、碎石／修复、health 与皮肤，`OnLoad` 按源 `OnPreLoad` → health 顺序恢复，存档字段仍为 `ruinsRelic`、`health`（`current`／`maximum`）和保留的 `inventoryitemmoisture`。15 个 ID 均可 `c_spawn`；复制品 vase/chipbowl/bowl/plate 另可 `c_give`；`ruinsrelic_chair` 支持 `ruinsrelic_chair_tesla`、`ruinsrelic_chair_toilet` 皮肤。
- `nightmareGrowthPrefabs`（`nightmaregrowth.ts`）：`nightmaregrowth` 与 `nightmaregrowth_crack` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；`NightmareGrowthInstance` 持有 `ancient_text` 标签、`MakeObstaclePhysics(1.1)`、小地图图标和 `DoTaskInTime(0, SpawnCrack)`，裂纹经注入的 `spawnPrefab` 生成为不入档的 `entityParent` 子实体（背景层平铺，FX/NOCLICK/DECOR），随本体移除；裂纹角度以度存为 `nightmareGrowth.crackRotation`。`c_spawn("nightmaregrowth")` 无额外参数，没有 `c_give`；SpawnCrack 摧毁周边可工作物、sanityaura、inspectable 状态、storyprogress 及生成器 prefab 未移植。
- `rockPrefabs`、`moonglassRockPrefabs`（`rocks.ts`）、`caveinBoulderPrefabs`（`cavein_boulder.ts`）、`moonrockseedPrefabs`（`moonrockseed.ts`）：`rock1`、`rock2`、`rock_flintless`、`rock_flintless_med`、`rock_flintless_low`、`rock_moon`、`rock_moon_shell`、`moonglass_rock`、`cavein_boulder`、`moonrockseed` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册。`RockInstance` 即 `baserock_fn`（MINE 工作量、`OnWork`、掉落表、明暗、积雪符号），月亮玻璃岩的 `set_moonglass_type` 按 `rock_type` 用 `AnimState.SetBank`／`SetBuild` 选四套 bank 与 build 之一。`rock_moon_shell` 开采完成后经注入的 `spawnPrefab` 生成 `moonrockseed`，不再入档，2 秒后按游戏时间逐帧侵蚀 1 秒再移除。`cavein_boulder` 的外形编号与 raised／formed 存为 `caveinBoulder`，搬运、下落与组合未移植；`moonrockseed` 仅为静态美术。均可 `c_spawn`（无额外参数），无 `c_give`。
- `flowerPrefabs`（`flower.ts`）：`flower`、`flower_rose`、`planted_flower` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；`FlowerInstance` 持有 `pickable`、`MakeSmallBurnable`／`MakeSmallPropagator`（烧完经 `DefaultBurntFn` 生成灰烬）与 `SetRayTestOnBB`，三者都以 `flower` 存档。均可 `c_spawn`，无 `c_give`；蝴蝶按 `flower` 标签查找它们。
- `tumbleweedPrefabs`（`tumbleweed.ts`）：`tumbleweed` 与 `tumbleweedbreakfx` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；`TumbleweedInstance` 持有 `blowinwind`／`locomotor`、地面检查与长动作重启任务，经注入的 `componentUpdates`（StartUpdatingComponent）在物理步进后跟随刚体并更新风速，采摘时经注入的 `spawnPrefab` 生成 `tumbleweedbreakfx`。`c_spawn("tumbleweed")`，无 `c_give`；燃烧、音效与作祟未移植。
- `berniePrefabs`（`bernie.ts`）：`bernie_active`、`bernie_big` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册。地上的 `bernie_inactive` 物品在醒着时按 `tryreanimate` 每秒寻找 16 单位内理智疯狂、可见的玩家，经注入的 `spawnPrefab` 生成 `bernie_active`（皮肤加 `_active`）后移除自身。`BernieInstance` 持有 health、`SGbernie`／`SGberniebig`（`activate`→`idle_nodir`→`idle`、`deactivate`）、在游戏时间上计时的 AnimState，以及 `BernieBrain`／`BernieBigBrain`：带 `bernieowner` 标签的疯狂玩家在 8 单位内时变大（`leader.bigbernies` 记录领队），没有疯狂玩家时坐下并经注入的 `spawnInactive` 变回物品（去掉皮肤后缀）。health 存为 `health`（`current`／`maximum`），读档的 `bernie_big` 直接进入 `idle`。`c_spawn("bernie_active")`、`c_spawn("bernie_big")` 无额外参数，物品仍为 `c_give("bernie_inactive")`；跟随、战斗、嘲讽、拾取替换、燃料与腐坏、技能树、音效未移植。
- `itemPrefabs`（`itemPrefabs.ts`）：每个库存物品与地面展示美术的 `PrefabEntityDefinition<ItemEntity>`，由应用层的 `PrefabEntityManager` 注册，库存的物品注册表经它 SpawnPrefab。物品在世界中各自以 prefab ID 存档（`world.entities.<prefab>[]`，记录含 `stack`，火把／提灯／留声机另有 `torch`／`lantern`／`phonograph`），不再使用 `ground_item` 分组；被持有的物品（包括地上背包里的物品）处于 limbo，由持有者保存。`c_spawn` 与 `c_give` 支持的 ID 与语法不变；`c_spawn` 按源 `SpawnPrefab` 生成而不经过丢弃，所以 `c_spawn("lantern")` 的提灯为关闭状态（只有 `ondropped` 会打开），需对它执行 TURNON 或丢弃一次。
- `archiveCentipedeHuskPrefabs`（`archive_centipede.ts`）：档案馆蜈蚣残骸 `archive_centipede_husk` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；`ArchiveCentipedeHuskInstance` 持有 health（每秒回复 1 点）、`OnHealthDelta`／`OnAttacked` 的分段动画、`idle2task` 和 lootdropper／inspectable／combat／hauntable，`OnSave`／`OnLoad` 按 `health`（`current`／`maximum`）存取，读档时 `ForceUpdateHUD` 不切换动画。`c_spawn("archive_centipede_husk")` 无额外参数，没有 `c_give`；活体 `archive_centipede` 与 `possess` 复活未移植。
- `chesspiecePrefabs`（`chesspieces.ts`）：大理石信天翁雕像 `chesspiece_malbatross_marble` 的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；`ChesspieceInstance` 持有 `workable`（锤 1 次）、`lootdropper`（`marble`）、`heavyobstaclephysics` 等组件，存档写 `chesspiece.materialid`，`submersible` 组件自存 `force_no_repositioning`。`c_spawn`，无 `c_give`；其他雕像、材质与月相变形未移植。
- `moonTreePrefabs`、`evergreenPrefabs`、`deciduousPrefabs`、`mushtreePrefabs`：月树与幼苗、常青树、桦树、蘑菇树（含 `_stump` 与烧毁特效）的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；不生成森林
- `torch.ts`：`torch.lua` 的回调按源注册在实例的组件上（`configureTorchEntity` 对应 `fn()`）：`burnable:SetOnExtinguishFn(OnExtinguish)`、`fueled:SetSectionCallback(onfuelchange)`、`inventoryitem:SetOnPutInInventoryFn(OnPutInInventory)`，`equippable` 的 `onequip`／`onunequip` 经 `createTorchHandLifecycle` 接入；`inst.fires`、声音任务、`_owner`、`_fuelratemult` 和 `SetFuelRateMult` 都在 `TorchEntity`（`ItemEntity` 子类，经 `registerItemEntityClass` 注册）上。燃烧状态即 `burnable:IsBurning()`。
- `@dontstarve-web/animation/residentSprite` 的 `ResidentSprite` / `ResidentSpriteController`：固定实体的 visual 驻留封装，保留根节点与动画请求；`ResidentEntity` 记录稳定的身份和脚点。常青树、桦树、月树和蘑菇树通过 `PrefabInstance` + `PrefabDisplay` 与 `watchTileActivity()` 加载／释放 visual，不重建实体或 Workable。
- `cookPotPrefabs`（`cook_pot.ts`）、`bookstationPrefabs`（`bookstation.ts`）：烹饪锅与书架的 `PrefabEntityDefinition`，和其他建筑一样由应用层的 `PrefabEntityManager` 注册，placer 为 `COOK_POT_PLACER`／`BOOKSTATION_PLACER`
- `wallPrefabs`（`walls.ts`）：`prefabs/walls.lua` `MakeWallType` 的 9 种墙（石、档案馆石、木、草、铥、档案馆铥、月岩、绝望石、废料）的 `PrefabEntityDefinition`，由应用层的 `PrefabEntityManager` 注册；`wall_*_item` 与 `fence_item` 拿到光标上后吸附到墙格，右键发起 `DEPLOY`。命中帧由 `deployable` 复检落点，`ondeploywall` 生成带关联皮肤的实体并消耗一件。存档为 `health`（`current`／`maximum`），皮肤在记录的 `skinname`。`c_spawn("wall_*")` 与 `wall_*_item` 别名都在玩家前方的墙格生成建成墙。

火把的 `onequip` 点燃并在持有者的 `swap_object` 上生成 torchfire 与 `AttachLightTo(owner)` 的光源，`onunequip` 移除它们并熄灭；被外部熄灭时，持有中的火把保留 `inst.fires`，与源码一致。`OnPutInInventory` 恢复闲置状态并停止火焰，保留 fuel；`OnExtinguish` 只处理未持有且未耗尽的地面火把并按源弹起（`inventoryphysics.Launch`）；`IgniteTossed` 在实例自己的 `swap_torch` 上生成 torchfire 与光源。`torchPrefabs()` 只负责地面 prefab 的存读档：`OnSave` 只在未处于 limbo 且燃烧时写 `torch.lit`，读档时按源 `OnLoad` 播放 `land` 并 `IgniteTossed`。声音通过共享 `PlaySound()` / `PreloadSounds()` 播放，地面声音在拾取或移除时释放，玩家拥有的一次性音效允许自然播放结束。地面 lit 状态及 fuel 可保存和恢复，换肤保持状态，恢复不重播点燃声。

烹饪锅 `cookpot` 按 `cookpot.lua` 的 `MakeCookPot` 组装（`anim/cook_pot.zip`，`MakeObstaclePhysics(inst, .5)`，
小地图图标 `cookpot.png`），默认停在 `idle_empty`，放置时播放 `place` 后回到 `idle_empty`。`stewer` 经
`addComponent` 加在容器之后，`startcookfn`／`donecookfn`／`harvestfn` 等回调以 `inst` 为参数，`SetProductSymbol`
写入 `inst.AnimState`，`cookingpot_rattle` 走实例 `SoundEmitter` 的 `snd`。存档由 `GetPersistData` 写
`stewer.lua` 的 `OnSave` 形状：`stewer.product`、`done: true` 或 `remainingtime`，以及 `ingredient_prefabs`／`chef_id`；
收获后的锅只留 `ingredient_prefabs`，读档时忽略。Light、腐坏、`cookingpot_open`／`cookpot` 循环／`cook_pot_craft` 声音未移植。
应用已接入制作放置、`c_spawn("cookpot")` 和存档恢复；支持 8 个皮肤 ID。靠近后点击锅会播放
`cooking_pre_loop`，并在锅右侧显示 4 个竖向的 `PreparedFoodSlot`，每格最多 1 个
物品，背景取自 `images/hud2.xml` 的 `preparedfood_slot.tex`。再次点击或走远会关闭
面板并回到 `idle_empty`；槽位内容随存档保存和恢复。面板的烹饪按钮经
`PlaceableBuildingPlacement.performContainerAction()` 对打开的实体执行 `ACTIONS.COOK`。

书架 `bookstation` 按 `bookstation.lua` 组装（`MakeObstaclePhysics(inst, .4)`，小地图图标 `bookstation.png`）：
`ItemGet`／`ItemLose` 跟随容器槽位，有书时以 `inst.DoPeriodicTask(30, RestoreBooks)` 保存在 `inst.RestoreTask`，
`UpdateBookAesthetics` 按书量对 `inst.AnimState` 的 `empty`／`mid`／`full` 层执行 Show／Hide。`c_spawn("bookstation")`，
无 `c_give`；制作动画（`onactivate`）与礼物未移植。

四种科技建筑 `researchlab` / `researchlab2` / `researchlab3` / `researchlab4` 由
`researchLabPrefabs` 声明、在应用层的 `PrefabEntityManager` 注册，placer 为 `RESEARCH_LAB_PLACERS`；
支持全部 37 个皮肤 ID，`c_spawn` 的 ID 与语法不变，没有 `c_give`。制作时选择的皮肤用于预览和放置，靠近时的
`proximity_loop` 及存档恢复也保留皮肤。`researchlab4` 按 DST 源码仅替换
`machine_hat`（`skinSymbols`），其余部件使用原始 build；科学机器和炼金引擎保留源码指定的基础特效
symbol，炼金打印舱的 `researchlab2_pod_fx` 动画层合并到同一帧几何体中。

四种科技建筑分别由 `scienceprototyper.ts`（`researchlab` / `researchlab2`）和 `magicprototyper.ts`
（`researchlab3` / `researchlab4`）按同名 Lua 的 `createmachine` 组装，回调都以 `inst` 为参数，
循环音效走实例的 `SoundEmitter`（`idlesound`）。workable 回调接入 `onhit` 和 `onhammered`：4 次成功锤击后掉落配方材料（50%，逐项向上取整），
生成原版 `structure_collapse_fx.zip` 的 `collapse_small` 木质坍塌效果并移除实体。
掉落通过 `WorldContext.dropLoot` 交给应用的地面物品管理器，以 `flingLoot()`
逐件同步生成：实体与 display 立即存在并写入存档，美术由 display 加载后绘制。`LootFling` 按 `lootdropper.lua:FlingItem()` 的随机方向、水平 `0–2`、
向上 `8±4` 和物品/建筑碰撞半径初始化，场景长度换算为 `TILE_SIZE / 4`。
简化轨迹负责回落、轻微弹跳和停稳；抛起高度只影响 visual，地面脚点用于排序、
拾取和存档。飞行中保存只保存当前地面位置，读档不重播散射。短暂坍塌特效由
世界 fx（`WorldContext.fx.collapse`）更新、排序和释放，不写入存档。皮肤切换保留剩余锤击次数，
读档则按 Lua 默认恢复 4 次。其他建筑继续使用原有受击反馈。

皮肤 build `.zip` 与贴图 `.dyn` 保留在 `public/dst/data/anim/dynamic/` 下。
build 从 DST `databundles/anim_dynamic.zip` 提取，`.dyn` 文件原样复制，运行时解码。
可通过 `python3 packages/prefab/scripts/import-building-skins.py` 重新同步，或用
`--source <DST data 目录>` 指定来源。`COOK_POT_SKIN_ARCHIVES` 和
`RESEARCH_LAB_SKIN_ARCHIVES` 导出对应的皮肤资源映射。

箱子 `treasurechest` 按 DST `treasurechest.lua` 的状态切换：点击关闭的箱子播放
`open` 并停留在打开帧，再次点击播放 `close`，完成后回到 `closed`。
`treasurechest.ts` 的 `onopen` / `onclose` 直接调用通用 `PlaySound()`，分别播放
`dontstarve/wilson/chest_open` / `chest_close`；`icebox.ts` 同样播放
`dontstarve/common/icebox_open` / `icebox_close`。创建实例时预加载共享音频，
点击开关及走远自动关闭均在动画开始时播放一次，恢复存档时不重放开关声。
应用的箱子面板跟随玩家头顶，背景使用 `anim/ui_chest_3x3.zip`，打开和关闭时
分别播放背景的 `open` / `close`，关闭动画完成后才隐藏面板。
制作时选择的箱子皮肤会映射到 `${import.meta.env.BASE_URL}dst/data/anim/dynamic/`
下对应的 DST build，并在预览、放置及后续开关动画中保持不变。

`pigKingPrefabs` 对应 `pigking.lua`：`PigKingInstance` 由全局 `PrefabEntityManager` 生成与保存，声明 billboard、`SetFinalOffset(1)`（`setDepthOffset`）、`MakeObstaclePhysics(inst, 2, .5)`、地图图标 `pigking.png`（优先级 1）、`inspectable`、`trader` 组件和 `SGpigking` 状态机（注入的 `WatchWorldState("isnight")` 驱动昼夜睡觉、金块交易、拒绝）；美术未绘制时单次动画立即结算，状态机直接走到下一状态。不创建任何地皮，`default_pigking` 布局的地皮已写在存档地图里。小游戏、`hauntable`、`DynamicShadow`、音乐与节日交易未移植。
猪王周围的地皮和岩石属于世界生成（原版 `default_pigking.lua` 静态布局），运行时不再摆放：从 DST 导入的存档地图本来就带有
worldgen 写好的地皮；手写的初始存档由 `scripts/import-static-layouts.py` 把 40 块 `GRASS`、12 块 `WOODFLOOR` 写进 `world.map.tiles`，
并校验 8 块岩石已是存档实体（见 [静态布局](../../docs/dst-static-layouts.md)）。
`TurfMap`（`@dontstarve-web/prefab/turfMap`）提供按格查询、挖地、稀疏存档，并像 `world.lua`
（`MapLayerManager:CreateRenderLayer` / `Map:AddRenderLayer`）一样声明地皮渲染层：`groundLayers()` 给出每层的地皮 ID、美术和顺序，
`groundLayerQuads(bounds)` 给出范围内各层的边缘掩码四边形，改动通过 `onTerrainChanged(bounds)` 通知。它不持有地皮层 mesh，也不加载地皮美术；
`packages/display` 的 `GroundDisplay` 加载声明的美术，按 32×32 格分块绘制，改动只重建所触及的分块，新声明的地皮层由它加载后自行绘制，
铺地动作不等待美术。`SnowEffect` 声明 snow.lua 的发射器（`SNOW_FX`，由 `packages/display` 的 `Snowfall` 加载贴图、模拟并绘制粒子），并通过 `declareOverlay('snow', …)` 声明 weather.lua 的地面积雪（贴图与覆盖程度 signal），自身不加载资源；`GroundDisplay` 按 `ground_overlay.ksh` 用各地皮层的 atlas alpha（含海岸裙边）分块绘制，地皮改动同样只重建所触及的分块，覆盖程度只改 uniform 与可见性。`groundOverlay` 为必填，雪不再绘制独立的地面平面。`RainEffect` 同样只声明 rain.lua 的发射器（`RAIN_FX`，由 `display` 的 `Rainfall` 加载贴图、模拟并绘制雨丝），自身持有雨声与 `raindrop` 水花对象池；水花美术经 `SpriteResources.archive` 声明 raindrop 的共享 archive（`instancedAnimations: 'all'`，由共享批次绘制），由各水花的 display 按需加载。悬崖和海洋表面同样由 `TurfMap` 声明（`falloffArt`／`falloffEdges()`、`oceanArt()`／`oceanSurfaceCells()` 与各格海洋颜色），`GroundDisplay` 加载美术并绘制，海洋按 `bindOceanClock()` 跟随昼夜、`update(dt)` 推进噪声。小地图同样只读声明：`tileLayerArt()` 给出各陆地层的 `minimap_tile_def` 美术，`minimapOceanTileIds()` 给出由 `minimapocean.ksh` 绘制的海洋地皮，`packages/map` 的 `MiniMapRenderer` 加载美术，新铺地皮声明的图层由它加载后重绘。主场景将猪王木地板格登记到该地图。`groundTiles.json` 从 `tiledefs.lua` 提取 ID、atlas/noise 路径和
绘制顺序；`pnpm --filter @dontstarve-web/prefab ground-tiles:import` 导入原版资产，
`ground-tiles:check` 校验源字节和定义。`groundTiles.ts` 根据八邻格选择 48 个源 atlas
图块，并按 `ground.ksh` 的方式将 atlas RGBA 与世界坐标噪声相乘。内部同种格用完整
图块，交界使用边、外角和内角；挖地同步刷新相邻掩码，存档只记录地皮状态。

基础 turf 与木地板均不写入深度缓冲，避免裁掉动画图像延伸到脚点下方的部分；
两者保持相同地面高度，按 `renderOrder` 的 `-2`、`-1` 顺序绘制。
应用从存档中的每个 `pigking` 记录恢复猪王，并按其位置登记木地板，无需单独保存固定地皮布局。

调用方负责传入 `${import.meta.env.BASE_URL}dst/data/anim` 形式的动画资源根路径；prefab 包不依赖应用的 Vite base 配置。

月树默认有 500 个实体记录，visual 按所在 tile 的 tickingarea 驻留；地图分布沿用原有的
1000 × 1000 区域和出生点空地。月树通过 `createSharedArchiveSprite()` 的预加载入口（`preloadSharedArchiveSprite()`，先加载一次再同步创建）使用共享帧缓存；`sway1_loop_*` 待机交给 `InstancedArchiveSprites`，同积雪状态的月树共享合成图集，砍伐、倒下、树桩和燃烧后的 `burnt_*` 继续用共享帧。积雪由 `snow.zip` 的 `snow` 符号覆盖，`snow` 层由 display 按世界 `SnowCovered` 切换（`TheSim:HandleAllSnowSymbols`）。所有实体保留稳定根节点、组件与逻辑动画，活动实体持有实际 visual。tile effect 更新活动集合和驻留，无需逐帧扫描全部实体；每帧调用 `update(dt)` 和 `setNormals(cameraQuaternion)`；
将 `activeEntities` 的模型及其 `position` 脚点加入动态精灵的深度排序。
`dispose()` 会释放全部模型及共享资源。

应用通过 `positions` 选项传入 `public/saves/initial-world.json` 中的固定随机坐标，
每次进入页面使用同一组初始位置。显式位置优先于 `count`、`areaSize`、
`exclusionRadiusSquared` 和 `random`；Prefab 会复制坐标，避免修改调用方的数据。

帽子由 `@dontstarve-web/prefab/hats` 提供：`HAT_DEFINITIONS` 包含 `hats.lua`
返回的 82 种可用帽子，`HAT_ITEM_SPECS` 指定头部装备、单件上限、中文名称和真实
inventory atlas 路径。`HAT_SKIN_SPECS` 及 `skinArchives` 对应 144 个皮肤 ID；
皮肤别名沿用 DST 的 `build_name_override`，露顶皮肤保留原始头发显示规则。
资源仍位于 `public/dst/data/anim/hat_*.zip` 和 `anim/dynamic/`，物品图标读取
`databundles/images.zip` 内对应的 `images/inventoryimages*.xml`。
原游戏的内部实体 `shadow_thrall_parasitehat` 已从导入目录、物品定义和制作入口中排除，
不再镜像其动画包，也不提供图标或地面图像回退。

`wortox(assetBaseUrl, world, options)` 同步返回玩家模型／实例和刚体。玩家只声明动画 archive、bank、build 和 override build；`PrefabDisplay` 通过 `SpriteResources` 加载并应用当前声明，加载完成不回写玩家逻辑。需要等到可绘制时，由应用调用 `await display.artLoaded()`。幽灵／复活、读书、工具动作和表情的时长来自导入的 `animationTimings.json`，不等待美术；读书／工具破损 FX 的定时移除也独立于资源加载。用 `python3 packages/prefab/scripts/import-animation-timings.py --check` 校验时长。

`WilsonAnimationController.setHat(itemId, skinId?)` 同步声明装备贴图，由 display 按需加载；传入 `null`
卸下帽子。普通帽、露顶帽、全头盔分别切换头发与脸部；Walter 帽使用 Wilson 的
`swap_hat_large`，矿工帽使用不发光的 `swap_hat_off`。月亮头盔、虚空兜帽、
W.A.R.B.I.S. 头戴装备、检查镜和兔子帽的主体跟随部件直接合入玩家
同一帧的 `BufferGeometry`，保持原始层序及连续材质组。上述帽子的发光与粒子部件
被排除，头盔主体和活动机械部件保留。

启迪之冠激活时按 `hats.lua` 的 `alterguardian_activate` 生成两个
`alterguardian_hat_equipped` FX 实体（`alterguardian_hat_equipped.ts`，`FX`、`DECOR`、
`persists = false`），各自 `OnActivated(owner, is_front)`：`Hide("back" / "front")`，
在玩家 sprite 上以 `attachFx` 声明跟随 `hair`、`SetFinalOffset(±1)` 与 `SetNoFaced()`，
并播放自己的 `activate_pre` → `activate_loop`。玩家 display 把两者的帧分别合入自身帧的
最前与最后，仍是同一 `BufferGeometry`。实体的 AnimState 声明 `SetSymbolLightOverride("flame_swap", 0.5)`；
有皮肤时 `SetSkin` 覆盖 `p4_piece` / `fx_glow`。用源冠冕贴图的局部模糊加色光晕近似原版
`SetBloomEffectHandle`；模糊限制在图集元素边界内。原版只给 `flame_swap` 设光照覆盖，
`fx_glow` 与光晕在夜间由冠冕自身光源照亮。理智下降时 `OnDeactivated` 播放 `activate_pst`，
动画结束移除实体及其跟随声明；卸下帽子立即移除。种子火焰（`SetFlameLevel`）及其
`SetSymbolMultColour` 尚未移植。独立的光源子节点使用原版半径 4（本场景 12）、强度 0.8、衰减 0.5 和空容器
的黄绿色光。创建玩家时通过 `options.sanityPercent` 注入拥有者的只读理智比例 signal，
激活 memo 直接读取该 signal，高于 0.85 激活；降到阈值时立即关灯，
第 8 帧恢复静态帽子。应用传入 `playerStats.sanity.percent`，
未注入状态的独立预览默认按满理智展示；卸下或换帽立即移除 FX 实体及光源，
并解除 memo 对理智的依赖，不与手持提灯的光源互相覆盖。

火坑（`firepit.ts`）按 `firepit.lua` 挂载 `burnable` 与 `fueled`（`packages/componets/src/fueled.ts`，
世界实体的 `fueled.lua`：4 段、`FIREPIT_FUEL_MAX` 360、初始 180、`bonusmult` 2，消耗为游戏时间
调度器上每秒一次的周期任务）。燃料段变化时 `onfuelchange` 点燃或熄灭，并以
`Burnable:SetFXLevel(段, 段内比例)` 设置火焰等级；熄灭把燃料归零，燃到最高段后熄灭掉落 1 个木炭。
`Burnable:AddBurnFX("campfirefire", (0, 25, 0), "firefx", true, nil, true)` 由 `SpawnFX` / `KillFX`
通过世界注入的 `FireFxHost.spawnCampfire` 生成和移除 `campfirefire`（`campfirefire.ts`，闪烁注册在 `ComponentUpdates` 上，`FX`、`HASHEATER`、`persists = false`，
`anim/campfire_fire.zip`）：它以 `attachFx` 的 `composite` 跟随火坑的 `firefx` 符号，偏移在符号空间内，
帧合入火坑同一 `BufferGeometry` 的该符号层。`firefx` 组件（`packages/componets/src/firefx.ts`）按
等级播放 `level1`–`level4`、调整 `firefx_light` 子实体的半径／亮度并按 `OnUpdate` 闪烁，管理
`campfire` 循环声与 `fireBurstSmall/Large`、`fireOut`；光源挂在火坑上。各皮肤的 `SetFXOffset`
与换肤后的 `restart_firepit` 已接入。保存 `firepit.fueled.fuel`（满燃料时按 Lua 省略）与
`queued_charcoal`；燃烧中的火坑不按结构燃烧存为 `burnt`。下雨时燃料消耗倍率为 `1 + FIREPIT_RAIN_RATE × 降水率`。可燃物品的 `fuel` 组件、
`heater` 供热、烹饪、作祟和火鸟皮肤加燃料特效尚未移植。

`HAT_CRAFTING_DEFINITIONS` 保留 52 条原始配方及科技、角色、技能、制作站
元数据。`HAT_RECIPES` 提供现有 InventoryStore 可以执行的 51 条背包配方；
木雕帽需持有 Lucy，但不消耗它。气球帽需要理智值，当前没有对应的权威状态与
扣减接口，因此保留原始定义并锁定 UI 制作；可以用 `c_give("balloonhat")`
检查装备。掉落帽子没有新增配方。科技和角色限制仍依照当前合成系统的行为，
当前未实现解锁系统、装备耐久和帽子战斗能力；启迪之冠提供上述照明与动态外观。

`python3 packages/prefab/scripts/import-hats.py` 可重新生成帽子目录并镜像资产，
`--source` 可指定 DST data 根目录，`--check` 校验目录与所有镜像文件。

`hatPrefabs(world)` 把每顶帽子声明为物品 prefab，使用独立的落地 `anim` 动画，遵循
`hats.lua` 的 `SetBank(name.."hat")` / `SetBuild("hat_"..name)` / `PlayAnimation("anim")`。
美术以 `assets` 声明帽子的共享 archive（bank 即帽子 ID），`instancedAnimations: 'all'` 由共享批次绘制；
皮肤列表即 `skins`。落地帽子按实体的地面接触点参与遮挡排序，点击合并 Mesh 可拾取，存档保存真实落点。
兔子帽按 `rabbit_custom_init` 以 `rabbit_build` 为 build，`AddOverrideBuild("hat_rabbit")` 声明为 `buildArchives: ['hat_rabbit.zip', 'rabbit_build.zip']`（覆盖 build 在前），由 display 随 archive 一起加载。

`@dontstarve-web/prefab/groundItems` 提供 `GROUND_ITEM_DEFINITIONS`、`groundArtArchive(itemId, variant?)`
和 `groundItemPrefab(itemId, world, { configure? })`。prefab 的 `fn` 在物品自己的 `sprite` 上声明 clip、标签、符号覆盖、
地面层和缩放，美术按定义的 `assets` 由 `PrefabEntityManager` 的 display 在读档之后加载，换 bank 的 variant（`blueprint` 的 rare）在 `onSpawned` 里用 `AnimState.SetBank`／`SetBuild` 声明；地面、背包、装备栏和
存档中的皮肤都来自该实例的 `sprite.skinId`，存档写在记录的 `skinname`（与建筑等所有实体相同）。休眠和 limbo 时 display 释放 sprite，模型、身份与组件保留。
通用资源加载、动画选择、符号覆盖、模型创建和逐帧绘制由
`@dontstarve-web/animation/archiveSprite` 提供；prefab 层负责物品定义、皮肤校验、实体物品信息和库存事件。
目录包含 221 种材料、工具、提灯、荧光果、唤星者魔杖、唤月者魔杖、清洁扫把、肉类、蔬菜、墙体物品和普通烹饪食物，以及 94 个皮肤 ID。
初始背包里的物品均已接入地面动画；未进入目录的其他物品由 `iconItemPrefab` 画物品栏图标。
资源由 `python3 packages/prefab/scripts/import-ground-items.py` 镜像，`--check`
校验目录及源文件字节，`--source` 可指定 DST data 根路径。

动画 bank 和 build 可以来自不同的包：火把使用 `torch.zip` 的 `idle` 与
`swap_torch.zip` 的 build，锤子使用 `hammer.zip` 与 `swap_hammer.zip`。
肉丸等食物使用 `cook_pot_food` bank，并按源 Lua 将 `swap_food` 替换为对应
食物的 symbol；新食物的 `cook_pot_foodN` build 也保留原路径。
掉落的墙体物品使用 `wall.zip`（绝望石墙为 `wall_dreadstone.zip`）的 `idle`
（`wall_segment-7`），建造后的墙仍显示 `half` 的正面／侧面。石头和冰固定采用源包的 `f1` 姿态；不实现随机外观或融化。
各帧所有部件合并为一个 Mesh，保留材质组顺序及 DoubleSide 单次绘制。
地面模型的原点保持真实落点，动画视觉不改变存档位置；点击 Mesh 可拾取，
资源加载或背包扣减失败时不会丢失物品。普通地面精灵不创建灯光、声音或独立特效实体；
提灯通过下述专用 prefab 提供亮灯状态与局部光源描述。

提灯由 `@dontstarve-web/prefab/lantern` 提供。物品 ID 是 `lantern`，源代码为
`prefabs/mininglantern.lua`。地面使用 `lantern.zip` 的 bank/build `lantern`，
亮灯播放 `idle_on`，熄灭播放 `idle_off`；手持使用 `swap_lantern.zip` 的
`swap_lantern` 和 `lantern_overlay` 符号，主体与覆盖层合入 Wilson 同一帧的 Mesh。
12 个皮肤 ID 使用目录中的原始 build 和别名，缺少的手持符号回退到基础手持 build。

```ts
// lanternPrefabs(world) 声明 lantern 的 prefab；SpawnPrefab 经物品注册表进入世界。
const lantern = inventory.entities.create({ itemId: 'lantern', count: 1 });
inventory.DropItem(lantern, position); // inventoryitem:OnDropped：ondropped 先关后开
inventory.GiveItem(lantern); // OnPutInInventory 关灯，RemoveFromScene 使地面光源随 display 休眠

// 手持提灯走库存：装备时 equippable:Equip(owner) 执行 prefab 的 onequip，卸下时执行 onunequip。
inventory.EquipFromInventory(lantern);
inventory.Unequip('hand'); // 收回背包；mininglantern 的规则决定何时关灯
```

物品（库存物品与只作展示的地面美术）是 `PrefabEntityManager` 上的 prefab：`itemPrefabs(world, icons)`（`src/itemPrefabs.ts`）为每个物品 ID 组装 `PrefabEntityDefinition<ItemEntity>`，有专门模块的物品取自己模块的定义（`hatPrefabs`、`firefliesPrefabs`、`butterflyPrefabs`、`molePrefabs`、`lightflierPrefabs`、`lightbulbPrefabs`、`lanternPrefabs`、`phonographPrefabs`、`torchPrefabs`、`poopPrefabs`、`rockAvocadoFruitPrefabs`、`gunpowderPrefabs`、`bernieItemPrefabs`、`burnableItemPrefabs`），其余按 `groundItemPrefab` 用地面美术目录，目录外的库存物品按 `iconItemPrefab` 画物品栏图标。`fn` 经注入的 `ItemPrefabWorld.newItem` 由物品注册表构造实例、声明美术和 `MakeInventoryPhysics`；`onSpawned` 在存档状态恢复后由库存元数据配置组件，再运行模块自己的部分（`configure`），读档时的 prefab 记录（`torch`、`lantern`、`phonograph`）从 `inst.saveRecord` 读取，保存时写在 `inst.OnSave`。

应用层先在 `src/prefabWorld.ts` 创建这个管理器，库存的 `ItemEntityRegistry` 构造时即以它的 SpawnPrefab 为唯一造实例的途径（没有脱离 world 的退路），所有物品实例都经 SpawnPrefab 进入世界：放进库存时 `inventoryitem` 设置 owner 并 `RemoveFromScene`（`INLIMBO`，display 休眠、不保存），`inventory:DropItem` → `inventoryitem:OnDropped()` 时 `ReturnToScene`，`inventoryphysics` 按 `launch` 抛出；`inventoryitem` 逐帧轮询到实体静止（`SetLanded`）才发 `on_landed` 并 `TryToSink`：落点不在可通行地面（`ItemPrefabWorld.map`，陆地边缘画进海洋格的裙边也算可通行（裙边规则与各 `Map:Is*AtPoint` 的对应见 [陆地裙边](../../docs/dst-visual-ground.md)），海面对 `sinks` 为假的物品算可通行）时下一帧 `SinkEntity`（`ocean_util.ts`）掉出携带物并移除。`sinks` 来自物品目录（导入脚本按源构造函数里的 `SetSinks(true)` 生成）；沉没特效与 `irreplaceable`／`shoreonsink` 冲上岸尚未移植，这类物品沉没时原地保留。目录里带 `floater`（导入脚本按各物品构造链上的 `MakeInventoryFloatable` 及其后的 `floater:Set*` 生成，静态美术如暗影心房同样适用）的物品由 `bindItemWorld` 调用 `MakeInventoryFloatable`：落在开阔海面（`ItemPrefabWorld.map.isOceanAtPoint`，即 `TurfMap.isOceanAtPoint`：海洋格中不被陆地裙边覆盖的部分，裙边范围按引擎 `Map:IsVisualGroundAtPoint` 的反汇编实现为 `TurfMap.isVisualGroundAtPoint`）时 `floater` 把物品弄湿、生成 `splash`、推送 `floater_startfloating`，工具类按 `bankSwap` 换成 `floating_items` 的 `floating_item` 帧并覆盖 `swap_spear`；`float_fx.ts` 在漂浮期间挂上 `float_fx_front`／`float_fx_back` 波纹。离地或移除时恢复。漂浮期间物品 `AnimState:SetFloatParams(-0.05, 1.0, bob_percent)`、波纹 `SetOceanBlendParams(0.6)`：精灵着色器按 `anim.ksh` 随时间上下起伏、截掉水线以下部分并乘上海洋颜色贴图（`@dontstarve-web/animation/oceanShading`，海洋管线发布贴图和时钟）。`splash` 音效和温度惩罚（`hot_splash`）尚未移植。腐烂替换由 `perishable` 经 `PerishWorld.SpawnPrefab` 完成；拾取（`PICKUP`）直接读目标的 `inventoryitem`；换皮从实例 sprite 声明的皮肤源取皮肤列表；绿杖拆解对可堆叠实例只移除一个。成堆的萤火虫、蝴蝶、光虫按各自的 `OnDropped` 逐只放下（`dropStackIndividually`）。`spawnGroundStack()`／`flingLoot()` 是 SpawnPrefab 加 `OnDropped`／`FlingItem` 的封装，应用层注入为 `spawnGroundItem`／`dropLoot`。

萤火虫的 prefab 声明 `fireflies.zip` 和 `instancedAnimations: ['swarm_loop']`，由管理器的共享资源绘制：`swarm_loop` 预合成完整帧后实例化，`swarm_pre` / `swarm_pst`
仍使用共享帧几何。虫群的播放和完成回调独立；休眠释放实体视觉并退出实例批次，唤醒时
重新绑定当前逻辑动画，异步创建的过期结果立即释放。源 bloom 效果沿用共享 lightmap 中的
`lightOverride`，实例属性传递各实体的覆盖值，发光半径和淡入淡出仍由原控制器负责。
昼夜与位置监听在休眠时保持门控；`tickingarea` 恢复为 true 后，显隐 effect 先检查同步后的昼夜，
白天立即清除旧光照、淡变与延迟任务并隐藏虫群、禁用 NET。活动区进入白天或白天丢弃也立即隐藏。
萤火虫的鼠标交互还要求玩家装备 `bugnet`：prefab 私有监听注入的手部装备 signal，空手或其他工具时
给逻辑实体和模型加上 `NOCLICK`；装备虫网后仅在原本可点击时移除。换装备不改变光源、动画或 `NET`
工作状态，休眠暂停装备监听，唤醒重新读取，永久移除时释放监听。源 `firefly`、`cattoyairborne`、`flying`、
`NOBLOCK` 标签也应用在逻辑实体上。

`inventoryphysics`（`packages/componets/src/inventoryphysics.ts`）的 `LootFling` 接收实体的 `transform`，直接推进其中的地面坐标；
`height` 写入实例 sprite 的 `visualHeight`。只有飞行中的物体经 `componentUpdates` 每帧更新。

提灯的 `fuelupdate` 按源 Lua 在燃料比例 0～1 时使用半径 3～5（换算为场景的
9～15 世界单位）、强度 0.4～0.6、Falloff 0.9，以及 RGB `(180,195,150)/255`；
零燃料时关闭光源。光源声明在 `lanternlight` 光源实体的 `instance.light` 上，
由其 display 列入光源列表，应用的局部光照渲染器只读取该列表。

应用支持把提灯拖到手部装备、Shift+右键丢到地面，以及点击地面提灯拾回背包。
地面模型移出场景后不再参与光照；失败的扣减或拾取保留原有物品状态。
可以用控制台命令 `c_give("lantern")` 获取提灯，现有制作配方也会产出该物品。
地面存档保存物品、皮肤、真实落点和 `lantern.ison`，恢复后按开关状态点亮。

当前背包没有逐件燃料状态，因此应用使用满燃料，不自动耗油或保存开关／燃料比例；
Prefab API 可由后续权威燃料状态驱动。声音、单独的粒子特效和地面开关交互尚未接入。

荧光果由 `@dontstarve-web/prefab/lightbulb` 的 `lightbulbPrefabs(world)` 声明。使用 `lightbulb.lua` 指定的 `anim/bulb.zip`、
bank/build `bulb` 和 `idle` 动画，`inst.light` 一直声明；放进库存时 limbo 使 display 休眠，光源随之不再列出。
它的原版半径为 0.5，换算为场景的 1.5 世界单位；强度 0.5、Falloff 0.7，
RGB `(237,237,209)/255`。范围不随掉落堆叠数量增加，也没有火把的额外 50% 倍率。

应用支持 `c_give("lightbulb")` 获取荧光果，Shift+右键丢一颗到地面发光；
点击拾回背包后该地面光源消失，失败的拾取会保持发光。存档恢复的荧光果也会发光。
图标从真实 inventory atlas 读取，地面模型使用原始动画，不使用图标回退。
本次提供局部照明，尚未接入原版 Bloom 后处理、腐坏和食用效果。

唤星者魔杖由 `@dontstarve-web/prefab/staff` 提供，经库存装备（`inventory.EquipFromInventory(staff)`），
由 equippable 的 onequip 在玩家的装备插槽上声明外观。手持使用 `swap_staffs.zip`
的 `swap_yellowstaff`，地面使用 `staffs.zip` 的 bank/build `staffs`、`yellowstaff`
动画；基础外观和 4 个皮肤均使用原始资源。

应用中用 `c_give("yellowstaff")` 获取魔杖，拖入手部装备栏后右键地面施法。
`player_staff.zip` 播放 `staff_pre → staff`，第 13 帧调用
`PlaySound('dontstarve/common/staffteleport')`，第 53 帧生成矮星并扣一次耐久与 20 理智；重复点击不重复提交，
施法过程中停止移动，卸下魔杖或开始其他动作会取消尚未提交的召唤。

`getLightStaffController(entity, world)` 在真实物品实体上配置 `SpellCaster`，按法杖自身 ID 选择 `stafflight` / `staffcoldlight`，黄／蓝法杖分别为 20／50 次。`onequip(slotSignal)` 绑定装备生命周期，卸下只解除绑定，耗尽通过实体的库存 owner 移除。`SpellCastActionController` 读取组件和能力标签、共享鼠标动作选择器及真实 `BufferedAction.invobject`，不包含法杖 ID、星体 Manager 或法术函数；异步准备完成后进入状态图，过远先接近，尚未提交的装备替换使旧动作失效。第 53 帧释放临时光效的取消所有权，剩余光效自然结束；第 69 帧解除 busy 并恢复世界输入。

`@dontstarve-web/prefab/stafflight` 的 `StaffLightInstance` 按 `stafflight.lua` 的 `fn()` 组装矮星（`stafflight`）和极光（`staffcoldlight`）：
标签、`heater`、`sanityaura`、`hauntable`、`timer`，矮星另有 `propagator`。`staffLightPrefabs` 提供两颗星的构造与资源声明，由应用注册到全局唯一的 `PrefabEntityManager`（`prefabInstance.ts`）；所有已迁移的 prefab 共用其实体集合、显示生命周期与共享 archive 缓存；存档按组件写入（`components.timer` 即 `timer.lua` 的 `OnSave`）。`PrefabEntityDefinition` 还可以声明 `physics`（`Make*Physics` 与半径）和 `minimapIcon`，`pond` 用它们声明障碍物碰撞和地图图标。

`BuildingPlacer` 显示已预付配方的预览。左键将放置点、旋转及皮肤交给 `Builder.MakeRecipeAtPoint`。`BUILD` 在状态图命中帧重验落点、生成建筑并结算预付配方。右键取消预览后，预付配方仍保存在库存中。`src/placeableBuilding.ts` 的 `MANAGED_BUILDING_PLACERS` 用它；所有建筑（`cookpot`、`bookstation`、`wardrobe`、`campfire`、`nightlight`、`pighouse`，`firepit`，`tent`、`moonbase`、`moondial`、`sculptingtable`、`winterometer`、`lightning_rod`、`pighead`、`mermhead`、`birdcage`、四种科技建筑，以及容器建筑 `treasurechest`、`pandoraschest`、`icebox`、`dragonflychest`、`dragonflyfurnace`、`saltbox`、`mushroom_light`、`mushroom_light2`）都登记在 `PrefabEntityManager`，由 `building.ts` 的 `buildingPrefab`／`buildingPlacer` 从 `definitions.json` 声明，存档仍写 `components.building`。这些建筑及其预览（`buildingPlacer(declaration, bank)`，bank 与 `buildingPrefab` 相同）都用共享 archive sprite 绘制，AnimState 的符号／build 覆盖和 `SetPercent` 姿态（`winterometer`、`sculptingtable`、`moondial`、`moonbase`、`birdcage`）也由 archive 路径执行，prefab 不选择绘制路径。随建筑生成的子实体（`pighead`／`mermhead` 的 `flies`、`moonbase` 的 `positronbeam_*`、`positronpulse`、`staffcoldlightfx`）从 `fn` 收到的共享 `SpriteResources` 声明美术，以 `attachFx` 挂在建筑上。容器建筑在 `fn` 中调用 `MakeBuildingContainer`：`SetPersistData` 先由 `Container.OnLoad` 读入 `components.container`，再在 `inst.OnLoad` 之前登记 `world:<prefab>:<entityId>` 地址，新建的建筑则在 `onSpawned` 登记。
`star_hot.zip` 播放 `appear → idle_loop`，`star_cold.zip` 在 `appear` 后随 `animover` 随机切换三个待机；到期或作祟时走 `kill_light`：
播放 `disappear`、`persists = false`，1 秒后移除。局部光源由 0.1 秒周期任务脉动，半径 33～36 世界单位。
寿命（矮星 1440 秒）在世界 `GameTimeScheduler` 上的 `extinguish` timer 中计时，休眠不暂停；存档保存落点和剩余寿命。
`spawn(position, saved?)` 同步创建星体，施法提交帧与读档都用它，美术由 display 加载；`update(dt, cameraQuaternion)` 只推进显示，
`exportRecords()` 返回可保存记录，`dispose()` 移除所有星体并释放共享资源。

`c_spawn("pighead")` 和 `c_spawn("mermhead")` 生成可检查、可闹鬼的头部建筑。闹鬼会唤醒头部，4 秒后在非满月时恢复睡眠。烧毁状态通过 `c_save()` 保存在 `components.building.burnt`。

`c_spawn("moondial")` 生成的月晷可以检查并按月相更新反光和灯光。放置、锤击和月相切换的动画与声音由 `SGmoondial` 驱动，皮肤和建筑位置沿用现有存档格式。

`c_spawn("livingtree")` 在玩家脚点生成正常活木树，无额外参数。`c_give("livingtree")` 会被拒绝。树干有 20 点 `CHOP` 工作量，倒下时按镜头右向和砍伐者的位置决定倒向及掉落位置。树桩可 `DIG` 一次，烧焦树可 `CHOP` 一次。`c_save()` 保留实体 ID、位置、树桩、烧焦及月雹积层状态，读回时按 Lua 选择外观。

`c_spawn("stagehand")` 在玩家脚点生成舞台之手，语法为 `c_spawn("stagehand")`，不需要额外参数。`c_give("stagehand")` 会被拒绝。它从四向、非循环的躲藏动画开始，夜间按 Lua 寻找灯火，受锤时播放对应姿势的动画。燃烧时 `campfirefire` 跟随 `swap_fire`，熄灭按状态图帧点处理。`c_save()` 保留 ID、变换、已有皮肤和月雹积层；锤击计数在读回时重置。当前项目尚无 `endtable_blueprint` 实体和主动月雹天气，蓝图掉落请求没有对应实体，存档中的积层可显示并随游戏时间消退。

`c_spawn("wood_chair")` 在玩家前方生成木椅（`furniture_chairs.lua` 的 `AddChair`），无额外参数，不支持 `c_give`。椅子用 `anim/wood_chair.zip` 的 bank `wood_chair` 和 `anim/wood_chair_chair.zip` 的 build，按 Lua 不循环 `idle`、`SetFinalOffset(-1)`、隐藏 `back_over` 图层，四向朝向；同时生成不入档的 FX 子实体 `wood_chair_back`（同一 bank／build，`SetFinalOffset(3)`，隐藏 `parts` 图层）。标签 `blocker`、`structure`、`faced_chair`、`rotatableobject`、`inspectable`、`cansit`、`canlight`、`HAMMER_workable`，半径 0.25 的障碍碰撞。锤子一击播放 `wood` 坍塌效果、按配方掉落后移除；受击时椅子与靠背播 `hit` 后回到 `idle`；建造（`onbuilt`）播 `place` 后回到 `idle`；可燃，烧毁后椅子循环 `burnt`、靠背播一次 `burnt` 并移除 `sittable`。皮肤 `wood_chair_cawnival`、`_fantasy`、`_hallowed`、`_handmade`、`_rose`、`_western`：椅子整体换 build，靠背只换 `chair01_parts` 符号。`c_save()` 保存 ID、位置、`building.burnt`、`savedrotation.rotation` 和皮肤；默认 `Cluster_1/Master.json` 含 1 把（朝向 -75°）。未接入：坐下（SIT 动作与坐者状态图，`sittable` 没有占用者）、建造音效 `repair_stonefurniture`、`CHEVO_makechair` 世界事件、放置器的四向朝向与固定镜头偏移、建造时按放置朝向写入旋转。

矮星音频随场景启动时的 `PrewarmSounds()` 一起解码：出现时播放 `dontstarve/common/staff_star_create`，
每颗矮星独立循环 `dontstarve/common/staff_star_LP`，消失动画结束时停止；
移除及 `dispose()` 会停止并断开所属矮星的音源。休眠不停声，由距离衰减静音；读档与 Lua 一样重新执行 `fn()`，出现声和 `appear` 也会重播。
音频由 vgmstream 从 `sound/common.fsb` 的流 273（`staff_star_create`）和
274（`staff_star_fireLP`）提取，保留源 bank 的目录，导出为 `sound/common.fsb-273.wav`、
`sound/common.fsb-274.wav`；声音在用户交互后启用。提取方法见 [sound](docs/sound.md)。

通用音频 API 由 `@dontstarve-web/prefab/sound` 提供，直接调用 `PlaySound('事件路径')`；场景声音调度器由 `@dontstarve-web/sound` 提供。
位置参数统一使用现有地面 `THREE.Vector3`：`PlaySound(path, position?, offsetSeconds?)` 和 `inverseSquareAttenuation(position, listenerPosition, referenceDistance?, maxDistance?)`。场景持有 `SoundPresentationScheduler`，直接订阅已有的 `playerpositions` signal，统一更新监听器；瀑布 prefab 只注册池的位置、半径和大小，调度器按源 Lua 每 5 帧选择最近的 3 个池并处理音量过渡。声源保留位置引用；衰减通过 `distanceToSquared()` 计算平方距离，避免开方、拆分 XZ 坐标和每次更新创建临时向量。距离计算不修改传入的向量；省略声源位置仍以完整音量播放。
支持 `dontstarve/common/staff_star_create`、`dontstarve/common/staff_star_LP` 和
`dontstarve/wilson/use_gemstaff`（流 284，`sound/common.fsb-284.wav`），以及
`dontstarve/wilson/hit`（`sfx.fsb` 流 423 / 424，等权随机）和
`dontstarve/wilson/use_pick_rock`（`wilson.fsb` 流 124）。还支持冰箱开关声
`dontstarve/common/icebox_open` / `icebox_close`（`sfx.fsb` 流 383 / 382）及木箱开关声
`dontstarve/wilson/chest_open` / `chest_close`（`wilson.fsb` 流 15 / 14）。循环行为由事件映射
决定；返回句柄的 `stop()` 停止该次播放，`PreloadSounds(...paths)` 预加载指定事件的共享音频，
`PrewarmSounds()` 在场景启动时预加载声音表中全部事件的所有层与随机变体，等待下载和解码完成。
预热可在音频上下文暂停时完成，用户交互负责恢复播放；按需加载与预热共享同一份请求及解码缓存，失败音频允许后续重试。
prefab、装备回调和动作状态图只调用 `PlaySound()`；它们不预加载音效，也不等待音频准备。
`DisposeSounds()` 用于页面内显式结束游戏时停止全部声音并释放音频上下文；`pagehide` 不调用该清理。

锤子与两种鹤嘴锄在共享 `pickaxe_loop` 第 7 帧分别调用
`PlaySound('dontstarve/wilson/hit')` 和 `PlaySound('dontstarve/wilson/use_pick_rock')`。
每次挥击只触发一次；命中前取消动作不会播放声音。这里只提供动作声音及受击反馈。

当前实现手持、施法动作、临时施法照明和矮星局部照明；尚未接入魔杖耐久、
理智消耗、矮星加热／烹饪／引燃、独立施法特效和 Bloom 后处理。

清洁扫把的 `ReskinActionController` 由 `@dontstarve-web/stategraphs/reskin_tool` 导出，
`ReskinEffects` 和装备资源由 `@dontstarve-web/prefab/reskin_tool` 导出。玩家手持时右键有已导入皮肤的建筑或地面物品，
超出原版 CASTSPELL 的 20 单位距离（本场景 60）会先走近。动作控制器把目标选出的皮肤 ID 交给 display 的 `preloadSkin()`，与特效一起预热；目标声明和逻辑实体保持原样。资源加载完成后，
`WilsonAnimationController.playReskin()` 按 `SGwilson.lua` 的 `veryquickcastspell`
播放 `player_attacks.zip` 的 `atk_pre → atk`，第 9 帧将预备好的 FX 消息交给目标的换肤提交。
命中时目标只更新皮肤声明，由 display 切换已加载的 build；随后以自身的 prefab ID 和地面脚点放置、启动独立 FX。失败或取消只释放未使用的消息，不创建替身实体或替换组件。
目标目录按支持的皮肤 ID 循环，最后恢复基础外观；目前不实现原版所有权与事件锁筛选。

`ReskinEffects` 使用 `reskin_tool_fx.zip` 的 `fx_shadow_dust/puff`，4 个工具皮肤按
`explode_small.lua` 的定义替换 `shadow_dust`；保留目标专属大小和高度、基础特效的
`SetLightOverride(1)` 与皮肤特效的 `0`。prefab 通过 `PrefabInstance` 声明 `FX` 标签、
不持久化属性及 sprite 的符号覆盖、照明和单次动画；`packages/display` 的 `PrefabDisplayGroup` /
`PrefabDisplay` 负责模型创建、场景挂载、朝向、绘制与释放，通过 `preloadSharedArchiveSprite()`
共享资源和帧几何。烟雾生成后独立存在，不跟随目标位置。每帧部件合入一个 Mesh，按真实目标脚点排序，
第 16 帧移除特效；不保存临时特效。当前渲染器不提供原版 Bloom 后处理。
声音经共享 `PlaySound()` 播放：开始时 `dontstarve/wilson/attack_weapon`，提交时
`dontstarve/common/together/reskin_tool`，幽灵画笔改用 `terraria1/skins/spectrepaintbrush`。
FEV 和音频索引见 `docs/vgmstream-cli-guide.md`。

建筑的换肤目标（`MakeBuildingTargets` 登记的 `reskinTarget`）保留实体根节点、开关状态和容器引用；
地面物品保留数量、实体 ID 和真实落点，拾回时携带新皮肤。换肤后的皮肤进入现有
存档字段；取消、目标移除或资源加载失败不会提交变化。场景退出调用控制器和
特效的 `dispose()`，并用 `DisposeSounds()` 释放共享声音。

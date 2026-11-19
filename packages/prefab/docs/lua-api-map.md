# Lua → TS API map

查“这句 Lua 该怎么写”。只收现有代码用到的写法，每行的示例在 `packages/prefab/src`。规则和归属见 [display-declarations](display-declarations.md)、[instance-ownership](instance-ownership.md)。新增写法或实现了“未实现”项时，同一改动里更新本表。

`sprite` 指 `inst.sprite`（`SpriteState`）。它只声明，由 display 绘制。

## 实体与生命周期

| Lua | TS | 示例 | 差异 |
| --- | --- | --- | --- |
| `Prefab(name, fn, assets)` | `PrefabEntityDefinition`：`fn`、`assets` | `atrium_pillar.ts` | 只由 `PrefabEntityManager` 管理 |
| `CreateEntity()` | `new PrefabInstance(id, new SpriteState(clip))` | `atrium_pillar.ts` | 根节点由默认的 `Transform` 创建为 `TransformRoot` |
| `Transform:SetPosition` | `inst.setPosition(x, y, z)`、`copyPosition` | `atrium_pillar.ts` | 位置不是信号 |
| `Transform:SetScale`、`SetRotation` | `inst.setScale`、`inst.setRotation(degrees)` | `moontree.ts`、`lightflier.ts` | |
| `inst:Remove()` | `inst.remove()` | `vault_pillar.ts` | 按 Lua 顺序：离开 `AddChild` 的父实体，推 `onremove`（此时仍有效），撤销双向事件监听、取消 `DoTaskInTime` 任务，执行组件与 `onRemove` 回调，`Remove` 脚本子实体，调用 `inst.OnRemoveEntity`，`persists = false`，最后 Retire 并移除 `entity:SetParent` 的子实体 |
| `inst:AddChild(child)`、`RemoveChild`、`SpawnChild` 的父子关系 | `inst.AddChild(child)`、`inst.RemoveChild(child)` | `entityScript.test.ts` | 子实体随父实体 `Remove`（先于 `OnRemoveEntity`） |
| `child.entity:SetParent(inst.entity)` | `child.entityParent = inst` | `vault_pillar.ts` | 存档跳过子实体；父实体 Retire 时子实体一起移除（从 `CreateBottom` 等从不手动移除的写法推断），不要在 `onRemove` 里再手动移除 |
| `inst.OnRemoveEntity` | `inst.OnRemoveEntity = fn`（模块顶层函数，在组件与子实体之后调用）；只做 Lua 的 `OnRemoveEntity` 做的事 | `atrium_gate.ts`、`nightmaregrowth.ts` | `inst.onRemove(fn)` 与组件拆除按注册顺序执行，返回取消函数 |
| `inst.persists = false` | `inst.persists = false` | `atrium_gate.ts` | |
| `OnEntitySleep`、`OnEntityWake` | `watchSignal(inst.status, …)` + `createEffect`，比较 `asleep`／`active` | `monkeypillar.ts` | |
| `SpawnPrefab(id)` | `world.spawnPrefab(id, position)` | `vault_pillar.ts` | 注入，不是全局函数 |
| `inst.entity:AddChild`（非存档子实体） | `child.entityParent = inst`，并 `inst.onRemove(() => child.remove())` | `vault_pillar.ts` | 子实体定义 `targetable: false` |
| `inst:AddTag`、`RemoveTag`、`HasTag` | `addTag`、`removeTag`、`hasTag` | `atrium_pillar.ts` | 含 `Make*` 和组件构造函数加的标签 |
| 组件属性 setter 按自身状态增删标签（`workable.lua` 的 `onworkable`／`onaction`、`repairable.lua` 的 `onworkrepairable` 等） | 组件实现 `DerivedTags`（`derivedTags` memo），`addComponent` 登记、`removeComponent` 取消；只在构造／`OnRemoveFromEntity` 增删的标签（`sleeper`、`bearded`、`battery`）直接 `inst.addTag`／`removeTag` | `workable.ts`、`repairable.ts`、`sleeper.ts` | `hasTag`、`listTags` 都包含派生标签；监听标签变化订阅 `inst.tags`（只读 memo，批次内读取也是当前值） |
| `inst:AddOrRemoveTag(tag, cond)`、`HasTags`（`HasAllTags`）、`HasOneOfTags`（`HasAnyTag`） | 同名方法，多标签传数组：`inst.HasTags(['a', 'b'])` | `entityScript.test.ts` | 不支持 Lua 的可变参数写法；别名 `HasAllTags`、`HasAnyTag` 不另设 |
| `inst:GetDistanceSqToInst`、`GetDistanceSqToPoint`、`IsNear` | 同名方法，点用 `Vector3` | `entityScript.test.ts` | `GetDistanceSqToInst` 与 Lua 一样要求两实体有效，否则抛错 |
| `inst:GetAngleToPoint`、`FacePoint`、`ForceFacePoint` | 同名方法，传 `(x, y, z)` 或一个点；角度为度 | `entityScript.test.ts`、`locomotor.ts` | `FacePoint` 在 `sg` 有 `busy` 标签时不转向 |
| `inst:GetTimeAlive()` | `inst.GetTimeAlive()` | `stafflight.ts`、`bernie.ts` | 出生时间取实体首次绑定 world 调度器时的 `GetTime()`（manager 生成时一定绑定）；换到另一 world 的调度器时保留已存活时间 |
| `inst:SetBrain(brain)`、`StopBrain(reason)`、`RestartBrain(reason)` | `inst.SetBrain(inst => new XBrain(inst))`、`inst.StopBrain('sleeper')`、`inst.RestartBrain('sleeper')` | `beefalo.ts`、`bernie.ts`、`sleeper.ts` | 实体睡眠或进入 limbo 时丢弃 `inst.brain`，醒来或回到场景时用构造函数新建，所以 `inst.brain` 可能为空；`Brain.Start`／`Stop` 对应 Lua 的 `_Start_Internal`／`_Stop_Internal`，prefab 不直接调用。没有 Lua 的 `sleepstatepending`：构造时若尚未入睡，brain 会先启动再随入睡丢弃 |
| `inst:PushBufferedAction(act)`、`PerformBufferedAction()`、`ClearBufferedAction()`、`inst.bufferedaction` | `inst.PushBufferedAction(action)`、SG 命中帧调用 `inst.PerformBufferedAction()`、`inst.ClearBufferedAction()` | `butterfly.ts`、`lightflier.ts`、`mole.ts` | `PrefabInstance` 的 EntityScript 方法，prefab 不另写副本；交给 `inst.sg.startAction`，没有 SG 时推 `startaction`。尚未移植 WALKTO 和 instant 动作的分支。没有 `StartAction` 的状态图（玩家的控制器）不接收 |
| `inst:IsAsleep()` | `inst.IsAsleep()` | `entityScript.test.ts` | 与 `status` 的 `asleep` 一致：tile 不在活动区或处于 limbo |
| `TheSim:FindEntities(x, y, z, r, must, cant, oneof)` | `inst.TheSim.FindEntities(position, r, must, cant, oneof)`，由实体所在 world 的 `PrefabEntityManager` 回答；manager 之外生成的实体（玩家、placer）用 `track(inst)` 加入并获得 `TheSim`；应用层直接用 manager | `fence.ts`、`burnableItems.ts`、`prefabEntityFind.test.ts` | 查全部有效实体（含休眠），按距离升序（同距离的顺序不定）；manager 用 16 单位的空间网格（`entityGrid.ts`），由 `Transform.setPosition` 同步更新，位置只能经 `setPosition` 写入；不自动排除自身和 `INLIMBO`，按 Lua 写 `v ~= inst` 和 cant 标签。未加入任何 world 的实体读 `TheSim` 会抛错 |

## 动画

| Lua | TS | 示例 | 差异 |
| --- | --- | --- | --- |
| `SetBank`、`SetBuild`（固定） | 定义的 `assets: { animationArchive, buildArchives, bank }` | `atrium_pillar.ts` | |
| `SetBank`、`SetBuild`（按实例，构造或读档时定） | 定义的 `instanceAssets(inst)` | `archive_pillar.ts` | |
| `SetBank`、`SetBuild`（运行中切换） | `inst.AnimState.DeclareAnimationAssets(archives, art)` 声明 Lua 的全部 ANIM 资源，之后 `inst.AnimState.SetBank(bank)`／`SetBuild(archive)`；`PlayAnimation` 在当前 bank 下跨这些文件找动画，`GetCurrentAnimationLength` 按同一组文件取时长。不按动画换文件 | `fence.ts`、`oceantree.ts`、`player_common_extensions.ts`（`makeGhost`／`makeAlive`） | 世界 prefab（植物、栅栏等）仍走共享 archive 路径：定义用 `instanceAssets` 按当前 bank 声明，运行中的切换经 archive 精灵的 `setArtSource` 生效并保持 `instancedAnimations` 合批；不要为此改用 `factory` |
| 构造函数里 `PlayAnimation(x, true)` | `new SpriteState({ name: x })` | `atrium_pillar.ts` | |
| 构造函数里 `PlayAnimation(x)` | `new SpriteState({ name: x, held: true })`，或构造后 `sprite.playOnce(x)` | `atrium_gate.ts`、`vault_pillar.ts` | |
| `PlayAnimation(x, loop)` | `inst.AnimState.PlayAnimation(x, loop)`（循环转 `sprite.start(x)`，否则 `sprite.playOnce(x)`） | `birdcage.ts`、`fire.ts` | 循环方式按 Lua，不为实例化改动；不发 `animover`，要完成通知用下一行 |
| `PlayAnimation(x)` 并等 `animover` | `sprite.playOnce(x, complete)` | `monkeypillar.ts`、`campfirefire.ts` | 没有绘制时立即结算，`complete` 同步执行 |
| `PushAnimation(x, loop)` | `inst.AnimState.PushAnimation(x, loop)`（即 `sprite.pushAnimation`） | `birdcage.ts`、`atrium_gate.ts` | TS 默认 `loop = false`。Lua 不传 `loop` 时的行为由引擎决定，脚本里查不到（见下方说明），要显式传 |
| 不播放动画（只有 bank、build） | `{ none: true }` 或 `sprite.clearAnimation()` | `fireflies.ts` | 不绘制，直到有 clip |
| `SetPercent(x, p)` | `sprite.setPercent(x, p)` | `winterometer.ts` | |
| `SetFrame(n)` | `sprite.setFrame(n)`；随机帧用 `sprite.setFrameAt(fraction)` | `monkeypillar.ts` | `setFrameAt` 取 0–1 比例，未加载时也能声明 |
| `SetDeltaTimeMultiplier` | `inst.AnimState.SetDeltaTimeMultiplier(rate)`（写入 `sprite.setPlaybackRate`） | `SGwilson.ts` | |
| `GetCurrentAnimationLength`、`GetCurrentAnimationNumFrames` | 声明了 ANIM 资源（`DeclareAnimationAssets`）的实体用 `inst.AnimState.GetCurrentAnimationLength()`，按源 anim.bin 时长计算，可用于业务计时；其余用 `sprite.currentAnimationLength`、`sprite.numFrames` | `SGwilson.ts`；`moonbaseFx.ts`、`cactus.ts` | sprite 上的两项**未绘制时为 0**，业务计时不能依赖 |
| `inst:SetStateGraph("SGx")`、`ClearStateGraph()` | `inst.SetStateGraph(inst => createXStateGraph(inst, scheduler))`：`packages/stategraphs/src/SGx.ts` 的 `StateGraphInstance`（传入 scheduler，timeline 走游戏时间），实例实现状态图读取的方法；`animover` 由 `playOnce` 的 `complete` 推给 `sg.pushEvent`；`inst.ClearStateGraph()` | `portal.ts`、`nightmarerock.ts`、`wormhole.ts` | SG 模块的构造自己进入首个状态（代替 Lua 的 `defaultstate`）；替换或清除时旧 SG 释放；`RemoveFromScene` 暂停、`ReturnToScene` 恢复，暂停期间进入的状态从恢复时起计时；实体移除时释放 SG，`inst.sg` 仍可读。不做 Lua 的睡眠 hibernate（醒来补算时间），SG 照常由 prefab 的 update 推进；未绘制时暂停 animover 链，见 `portal.ts` |
| `ListenForEvent("animover", fn)` | `playOnce` 的 `complete` | `monkeypillar.ts` | 未绘制时结算，见上；需要等重新绘制时跟 `sprite.art` |
| 循环动画批量绘制 | `assetOptions.instancedAnimations`、`staticBillboard` | `pillar.ts` | 只是绘制方式，非 Lua 调用 |

**`PushAnimation` 不传 `loop`：** 源脚本有 435 处不传，1033 处显式传 `false`，`pillar.lua` 的 `doshake` 也是 `hit` 后不传 `loop` 回到循环的 `idle`，这些都提示默认可能是循环，但引擎实现不在脚本里，尚未证实。移植时先看该动画在上下文里是否应循环，再显式传值，并在汇报里写明。

## 外观与层级

| Lua | TS | 示例 | 差异 |
| --- | --- | --- | --- |
| `OverrideSymbol`（prefab 自身） | `sprite.setSymbolOverride(symbol, archive, source)` | `monkeypillar.ts` | 写入 sprite json，跨休眠保留 |
| `OverrideSymbol`、`Show`、`Hide` 等（共用 `AnimState`） | `inst.AnimState` 同名方法 + 一次 `sprite.setAnimState(inst.AnimState.json, art)` | `sculptingtable.ts`、`player_common.ts` | 只声明一次，不回写快照；`inst.AnimState` 与播放是同一个对象 |
| 装备改写 `owner.AnimState` | `EquipmentAnimState` 插槽（`declareAnimState`） | `equipmentVisual.ts` | 分层，不是后写者生效 |
| `HideSymbol`、`ShowSymbol` | `sprite.setSymbolHidden(symbol, hidden)` | `monkeypillar.ts` | |
| `Hide(layer)`、`Show(layer)` | `sprite.hideLayer`、`sprite.showLayer` | `display/src/spriteState.ts` | |
| `SetMultColour` | `sprite.setColour(rgba)` | `walls.ts` | |
| `SetLightOverride` | `sprite.setLightOverride(value)` | `deployPlacer.ts` | |
| `SetSymbolBloom` | `AnimState.SetSymbolBloom(symbol)` | `alterguardian_hat_equipped.ts` | 局部光晕近似 |
| `SetOrientation(OnGround)` | `sprite.setGround(order)` | `atrium_gate.ts` | |
| `SetLayer(LAYER_BACKGROUND)` + `SetSortOrder`（立着的美术） | `sprite.setLayer('background')` + `sprite.setMeshOrder(-.5 + (sortOrder - 3) * .01)` | `molehill.ts`、`cave_entrance.ts` | 地形在组顺序 0 上按 mesh 顺序排列（turf -1～-0.6、雪 -0.55），背景美术留在组顺序 0、用 mesh 顺序排在其上；`setGround` 不接受负的组顺序（会被所有 turf 盖住） |
| `SetOrientation(OnGround)` + `SetLayer(LAYER_BACKGROUND)` + `SetSortOrder` | `sprite.setGround(0)` + `setMeshOrder(...)`，同上 | `cave_hole.ts`、`archive_props.ts` | |
| `SetLayer(LAYER_WIP_BELOW_OCEAN)`（即 `LAYER_BELOW_GROUND`）+ `SetSortOrder(ANIM_SORT_ORDER_BELOW_GROUND.UNDERWATER)` | `sprite.setLayer('background')` + `sprite.setMeshOrder(-1.755)` | `oceantree_pillar.ts` | 排在海洋底色（-1.76）之后、半透明海面（-1.75）之前，海面盖在上面，陆地 turf 也盖住它 |
| `SetOrientation(OnGround)` + `Transform:SetEightFaced()` | `setGround(0)`（平放、固定在世界里，不随镜头转）+ `SetEightFaced(inst, world.cameraFacing)`（`eightFaced.ts`，按镜头朝向选帧） | `cave_hole.ts`、`archive_props.ts` | 八个帧是同一张图逐 45° 反向旋转（并按镜头俯角拉伸），世界固定的平面配合按朝向选帧，屏幕上的样子保持不变；只有一帧的 OnGround 美术（`pond`、`lava_pond`）就固定在世界里。`cave_hole` 的左侧两个斜向帧是右侧帧的上下翻转，存放位置互换，用 `SetEightFaced` 的第三个参数（`pitFrame`）把 UPLEFT／DOWNLEFT 对调，不改共享的 `facing.ts`。再加 `Transform:SetRotation` 时引擎会把平面随实体转动：`rope_bridge_fx` 八个朝向画的是同一张本地坐标系里的桥，`SetRotation` 同时写根节点的 `transform.setRotation`（见 `rope_bridge.ts`） |
| `SetFinalOffset`（正值） | `sprite.setDepthOffset(true)` | `world_fx.ts` | 不区分具体数值 |
| `SetFinalOffset`（符号跟随者） | `attachFx` 的 `finalOffset` | `display/src/fxAttachments.ts` | 负值在宿主后，正值在宿主前 |
| 独立实体的 `SetFinalOffset`（负值） | `sprite.setBehindFoot(true)` | `ruinsrelic.ts` | 同一脚点上排在其他实体之前（排序层 0），不区分具体数值 |
| `Follower:FollowSymbol` | `sprite.followSymbol`、`attachFx` | `display/src/spriteState.ts` | |
| `SetFourFaced`、`SetEightFaced` | `sprite.setFacing`、`setFacingRotation` | `lightflier.ts` | |
| `SetSkin`、皮肤 | `sprite.setSkinSource`，换肤写 `inst.skinId` | `wormhole.ts` | 没有源皮肤就不做 |
| 皮肤 init_fn 只调 `OverrideItemSkinSymbol(sym, build, sym, ...)` | `PrefabEntityDefinition`／`BuildingDeclaration` 的 `skinSymbols` | `definitions.json` 的 `moondial`、`researchlab4` | 不写 init_fn 或 AnimState override |
| 皮肤下仍取基础 build 的 symbol、皮肤 archive 自带的动画层 | `baseSymbols`、`skinAnimationBanks`（按皮肤名） | `definitions.json` 的 `researchlab`、`researchlab2` | display 负责合成 |

## 组件、事件与存档

| Lua | TS | 示例 | 差异 |
| --- | --- | --- | --- |
| `inst:AddComponent("x")` | `const x = addComponent(this, 'x', X, ...args)`（`src/components.ts`） | `moontree.ts` | 只能这样加组件，见 [AGENTS.md](../AGENTS.md#components)；`inst:RemoveComponent("x")` 用 `removeComponent`；查有没有实现：`dst-lua-inventory.py` |
| `inst.components.workable.workleft = n`（直接写字段） | `workable.WriteWorkLeft(n)` | `moon_fissure.ts` | 不钳制、不改 `workable` 开关；`SetWorkLeft` 至少为 1 |
| 组件回调（`SetOnFinishCallback` 等） | 同名方法 | `chesspieces.ts` | 回调写在所属 prefab 模块 |
| `inst:ListenForEvent(event, fn, source)`、`PushEvent`、`RemoveEventCallback` | 同名方法 | `mushroom_light.ts` | `fn(inst, data)`，`inst` 是推送事件的实体；`source` 监听别的实体，双方记账，任一方 Remove 时自动解除；`ListenForEvent` 另返回取消函数；`PushEvent` 在 `inst.sg` 监听该事件时转发给它，再转给 `inst.brain`，不要再手写转发；不用 `model` 事件 |
| 事件的 `data`（如 `{ name = name }`） | 推送方在 `EntityEventData`（`componets/src/entityEvents.ts`）登记数据形状；prefab 自己推的事件在推送方旁用 `declare module '../../componets/src/entityEvents'` 补登记 | `timer.ts`、`player_common_extensions.ts` | `ListenForEvent`、`PushEvent`、`EventHandler`、`sg.listenForEvent` 按事件名推出 `data` 类型，监听方不再写 `data as`；已登记事件 `PushEvent` 必须带数据（数据可缺省的事件除外），未登记事件的 `data` 是 `unknown`；组件的结构接口用 `EventListening['ListenForEvent']` |
| `inst:WatchWorldState("snowlevel", fn)` | `world.getWatchWorldContent(WorldContentKey.SnowLevel, cleanup)` + effect | `monkeypillar.ts` | 也有注入的世界信号；按相邻 prefab 选用 |
| stategraph 的全局 `EventHandler`；`GoToState` 推的 `"newstate"` | `sg.listenForEvent(name, fn)`；`sg.onNewState(fn)` | `SGwilson.ts` | `listenForEvent` 决定 `isListeningForEvent`，即 `inst:PushEvent` 会不会转发；`newstate` 不是 sg 事件，`listenForEvent('newstate')` 会抛错 |
| `inst:DoTaskInTime(t, fn)` | `inst.DoTaskInTime(t, fn)`（`fn(inst)`） | `monkeypillar.ts` | 返回 `EntityTask`（`Cancel()`、`NextTime()`），Remove 自动取消，`onRemove` 里不再手写取消；Lua 的额外参数写进闭包。不要再为实体计时 `new ComponentTimer` 或调 `scheduler.schedule` |
| `inst:DoPeriodicTask(t, fn, initialdelay)` | `inst.DoPeriodicTask(t, fn, initialdelay)` | `nightmarerock.ts` | 同上；回调里 `Cancel()` 自己即停止 |
| `inst:PushEventInTime(t, event, data)`、`inst:CancelAllPendingTasks()` | 同名方法 | `entityScript.test.ts` | |
| `GetTaskRemaining(task)`、`task:NextTime()` | `GetTaskRemaining(task, now)`（`prefabInstance.ts`）、`task.NextTime()` | `phonograph.ts` | 无任务或已结束返回 -1；`now` 用 `inst.GetTime()` 或所在 scheduler |
| 任务所用的 `scheduler`（引擎全局） | `inst.BindScheduler(world.scheduler)` | `evergreens.ts` | `PrefabEntityManager.spawn` 在 `fn` 之后注入世界 scheduler，物品由 `ItemEntity.BindPerishWorld` 注入；`fn`／构造函数里就要计时的 prefab 先自己调用。改绑时挂起任务保留剩余时间 |
| `inst.OnSave`、`inst.OnLoad` | `this.OnSave = (_inst, data) => …`，同名 `OnLoad` | `archive_pillar.ts` | 还要加：`saveRecord.ts`、`src/save/types.ts`、`src/prefabDefinitions.ts` 的解析和导入转换器 |
| `inst.OnLoadPostPass` | 见示例 | `atrium_gate.ts` | |
| 全局 `POPULATING`（读档时组件 `OnLoad` 调到的回调只摆姿势、不播过渡） | `import { POPULATING } from './prefabInstance'` | `grass.ts`、`berrybush.ts` | `PrefabEntityManager.spawn` 带存档执行 `SetPersistData` 期间为 true |
| `OnLoadPostPass(inst, newents, data)` 的 `newents[GUID]` | 注入的 `world.getEntity(id)`（应用层接 `PrefabEntityManager.get`），在 `DoTaskInTime(0)` 里解析 | `grotto_pool.ts` | 存档 ID 即项目实体 ID |
| `onSpawned`（`POPULATING` 之外的初始化） | 定义的 `onSpawned(inst)` | `monkeypillar.ts` | 位置和存档都就绪后运行 |

## 物理、光、声音、小地图

| Lua | TS | 示例 | 差异 |
| --- | --- | --- | --- |
| `MakeObstaclePhysics(inst, r, h)` 等 | 定义的 `physics: { make: MakeObstaclePhysics, radius, height }` | `monkeypillar.ts` | 实现在 `standardcomponents.ts`，Lua 在函数内加 `blocker`，TS 除 `MakeHeavyObstaclePhysics` 外要另外 `addTag` |
| `MakeWaterObstaclePhysics(inst, r, h, restitution)` | 定义的 `physics: { make: MakeWaterObstaclePhysics, radius, height }`，`fn` 中在 Lua 调用处 `addTag('blocker')` 并 `addComponent(inst, 'waterphysics', WaterPhysics)` | `watertree_pillar.ts` | 碰撞掩码另含 `OBSTACLES`；`WaterPhysics` 只有构造签名，`restitution` 未设置 |
| `inst.Physics:SetCylinder` 等 | `inst.physics` 同名方法 | `atrium_pillar.ts` | `SetCylinder` 实际是 capsule 近似 |
| `MiniMapEntity:SetIcon` | 定义的 `minimapIcon` | `archive_pillar.ts` | |
| `inst.Light` | `inst.light.set({ radius, falloff, intensity, colour })` | `atrium_gate.ts` | 项目单位，见示例换算 |
| `inst.entity:AddSoundEmitter()`、`inst.SoundEmitter:PlaySound(path, name)` 等 | `inst.AddSoundEmitter()`；之后 prefab 和状态图都调用 `inst.SoundEmitter` 同名方法，状态图接口声明 `SoundEmitter: Pick<SoundEmitter, ...>` | `nightmarerock.ts`、`SGmole.ts` | 路径写源码原文；其余见 [sound](sound.md) |
| `inst:Hide()`、`inst:Show()` | `inst.Hide()`、`inst.Show()`（`PrefabInstance`） | `SGnightmarerock.ts` | 只停止绘制实体 |
| `MakeSnowCovered` | `setSymbolOverride('snow', 'snow.zip', 'snow')` + `setSymbolHidden` 跟雪量；植物用 `snowCovered: true` | `monkeypillar.ts`、`berrybush.ts` | `buildArchives` 要加 `snow.zip`，`hiddenSymbols: ['snow']` |

| `inst.components.inspectable`、`GetDescription(viewer, inst, status)` | `addComponent(inst, 'inspectable', Inspectable)`；`getstatus` 返回 Lua 的状态键 | `archive_props.ts` | 物品默认都有；文本来自 `componets/src/strings.json`（`import-speech.py` 由 `chinese_s.po` 生成），只含 GENERIC 和 WORTOX |
| `inst.components.talker:Say(text)` | 玩家的 `components.talker.Say(text)` | `actionfns.ts` | 只支持单行；推 `ontalk`／`donetalking`，头顶文字由 `createFollowText` 显示 |

## 未实现

遇到时跳过并在汇报中写明，或按任务需要在所属包补上。

| Lua | 现状 |
| --- | --- |
| `SetAddColour` | 没有对应声明 |
| 整个实体的 `SetBloomEffectHandle` | 没有渲染路径，只有按符号的 `SetSymbolBloom` 近似 |
| `SetLayer(LAYER_BELOW_GROUND)` 的其他排序（`BOAT_TRAIL`、`BOAT_LIP`） | 没有对应声明；水下的 `UNDERWATER` 见上表 |
| `SetOceanBlendParams` | 没有对应声明（海洋颜色对特效的染色） |

# Lua → TS API map

查“这句 Lua 该怎么写”。只收现有代码用到的写法，每行的示例在 `packages/prefab/src`。规则和归属见 [display-declarations](display-declarations.md)、[instance-ownership](instance-ownership.md)。新增写法或实现了“未实现”项时，同一改动里更新本表。

`sprite` 指 `inst.sprite`（`SpriteState`）。它只声明，由 display 绘制。

## 实体与生命周期

| Lua | TS | 示例 | 差异 |
| --- | --- | --- | --- |
| `Prefab(name, fn, assets)` | `PrefabEntityDefinition`：`fn`、`assets` | `atrium_pillar.ts` | 只由 `PrefabEntityManager` 管理 |
| `CreateEntity()` | `new PrefabInstance(id, new SpriteState(clip), transform)` | `atrium_pillar.ts` | 静态实体用 `Transform.stationary()` |
| `Transform:SetPosition` | `inst.setPosition(x, y, z)`、`copyPosition` | `atrium_pillar.ts` | 位置不是信号 |
| `Transform:SetScale`、`SetRotation` | `inst.setScale`、`inst.setRotation(degrees)` | `moontree.ts`、`lightflier.ts` | |
| `inst:Remove()` | `inst.remove()` | `vault_pillar.ts` | |
| `inst.OnRemoveEntity` | `inst.onRemove(fn)` | `vault_pillar.ts` | 返回取消函数 |
| `inst.persists = false` | `inst.persists = false` | `atrium_gate.ts` | |
| `OnEntitySleep`、`OnEntityWake` | `watchSignal(inst.status, …)` + `createEffect`，比较 `asleep`／`active` | `monkeypillar.ts` | |
| `SpawnPrefab(id)` | `world.spawnPrefab(id, position)` | `vault_pillar.ts` | 注入，不是全局函数 |
| `inst.entity:AddChild`（非存档子实体） | `child.entityParent = inst`，并 `inst.onRemove(() => child.remove())` | `vault_pillar.ts` | 子实体定义 `targetable: false` |
| `inst:AddTag`、`RemoveTag`、`HasTag` | `addTag`、`removeTag`、`hasTag` | `atrium_pillar.ts` | 含 `Make*` 和组件构造函数加的标签 |

## 动画

| Lua | TS | 示例 | 差异 |
| --- | --- | --- | --- |
| `SetBank`、`SetBuild`（固定） | 定义的 `assets: { animationArchive, buildArchives, bank }` | `atrium_pillar.ts` | |
| `SetBank`、`SetBuild`（按实例，构造或读档时定） | 定义的 `instanceAssets(inst)` | `archive_pillar.ts` | |
| `SetBank`、`SetBuild`（运行中切换） | `sprite.setArtSource(...)` | `fence.ts` | |
| 构造函数里 `PlayAnimation(x, true)` | `new SpriteState({ name: x })` | `atrium_pillar.ts` | |
| 构造函数里 `PlayAnimation(x)` | `new SpriteState({ name: x, held: true })`，或构造后 `sprite.playOnce(x)` | `atrium_gate.ts`、`vault_pillar.ts` | |
| `PlayAnimation(x, true)` | `sprite.start(x)` | `mushtree.ts` | 循环方式按 Lua，不为实例化改动 |
| `PlayAnimation(x)` | `sprite.playOnce(x, complete?)` | `monkeypillar.ts` | 没有绘制时立即结算，`complete` 同步执行 |
| `PushAnimation(x, loop)` | `sprite.pushAnimation(x, loop)` | `atrium_gate.ts` | TS 默认 `loop = false`。Lua 不传 `loop` 时的行为由引擎决定，脚本里查不到（见下方说明），要显式传 |
| 不播放动画（只有 bank、build） | `{ none: true }` 或 `sprite.clearAnimation()` | `fireflies.ts` | 不绘制，直到有 clip |
| `SetPercent(x, p)` | `sprite.setPercent(x, p)` | `winterometer.ts` | |
| `SetFrame(n)` | `sprite.setFrame(n)`；随机帧用 `sprite.setFrameAt(fraction)` | `monkeypillar.ts` | `setFrameAt` 取 0–1 比例，未加载时也能声明 |
| `SetDeltaTimeMultiplier` | `sprite.setPlaybackRate(rate)` | `player.ts` | |
| `GetCurrentAnimationLength`、`GetCurrentAnimationNumFrames` | `sprite.currentAnimationLength`、`sprite.numFrames` | `moonbaseFx.ts`、`cactus.ts` | **未绘制时为 0**，业务计时不能依赖 |
| `ListenForEvent("animover", fn)` | `playOnce` 的 `complete` | `monkeypillar.ts` | 未绘制时结算，见上；需要等重新绘制时跟 `sprite.art` |
| 循环动画批量绘制 | `assetOptions.instancedAnimations`、`staticBillboard` | `pillar.ts` | 只是绘制方式，非 Lua 调用 |

**`PushAnimation` 不传 `loop`：** 源脚本有 435 处不传，1033 处显式传 `false`，`pillar.lua` 的 `doshake` 也是 `hit` 后不传 `loop` 回到循环的 `idle`，这些都提示默认可能是循环，但引擎实现不在脚本里，尚未证实。移植时先看该动画在上下文里是否应循环，再显式传值，并在汇报里写明。

## 外观与层级

| Lua | TS | 示例 | 差异 |
| --- | --- | --- | --- |
| `OverrideSymbol`（prefab 自身） | `sprite.setSymbolOverride(symbol, archive, source)` | `monkeypillar.ts` | 写入 sprite json，跨休眠保留 |
| `OverrideSymbol`、`Show`、`Hide` 等（共用 `AnimState`） | `AnimState` 同名方法 + `sprite.setAnimState(anim.json, art)` | `equipmentVisual.ts` | 只声明一次，不回写快照 |
| 装备改写 `owner.AnimState` | `EquipmentAnimState` 插槽（`declareAnimState`） | `equipmentVisual.ts` | 分层，不是后写者生效 |
| `HideSymbol`、`ShowSymbol` | `sprite.setSymbolHidden(symbol, hidden)` | `monkeypillar.ts` | |
| `Hide(layer)`、`Show(layer)` | `sprite.hideLayer`、`sprite.showLayer` | `display/src/spriteState.ts` | |
| `SetMultColour` | `sprite.setColour(rgba)` | `wallPlacement.ts` | |
| `SetLightOverride` | `sprite.setLightOverride(value)` | `deployPlacer.ts` | |
| `SetSymbolBloom` | `AnimState.SetSymbolBloom(symbol)` | `alterguardian_hat_equipped.ts` | 局部光晕近似 |
| `SetOrientation(OnGround)` | `sprite.setGround(order)` | `atrium_gate.ts` | |
| `SetLayer(LAYER_BACKGROUND)` + `SetSortOrder` | `sprite.setGround(order, false)`、`setMeshOrder` | `molehill.ts`、`atrium_gate.ts` | order 是项目的渲染顺序，不是 Lua 的值 |
| `SetFinalOffset`（正值） | `sprite.setDepthOffset(true)` | `world_fx.ts` | 不区分具体数值 |
| `SetFinalOffset`（符号跟随者） | `attachFx` 的 `finalOffset` | `display/src/fxAttachments.ts` | 负值在宿主后，正值在宿主前 |
| `Follower:FollowSymbol` | `sprite.followSymbol`、`attachFx` | `display/src/spriteState.ts` | |
| `SetFourFaced`、`SetEightFaced` | `sprite.setFacing`、`setFacingRotation` | `lightflier.ts` | |
| `SetSkin`、皮肤 | `sprite.setSkinSource`，换肤写 `inst.skinId` | `wormhole.ts` | 没有源皮肤就不做 |

## 组件、事件与存档

| Lua | TS | 示例 | 差异 |
| --- | --- | --- | --- |
| `inst:AddComponent("x")` | `Object.assign(this.components, { x: new X(this) })` | `monkeypillar.ts` | 查有没有实现：`dst-lua-inventory.py` |
| 组件回调（`SetOnFinishCallback` 等） | 同名方法 | `chesspieces.ts` | 回调写在所属 prefab 模块 |
| `inst:ListenForEvent`、`PushEvent`、`RemoveEventCallback` | 同名方法 | `mushroom_light.ts` | `ListenForEvent` 返回取消函数，不用 `model` 事件 |
| `inst:WatchWorldState("snowlevel", fn)` | `world.getWatchWorldContent(WorldContentKey.SnowLevel, cleanup)` + effect | `monkeypillar.ts` | 也有注入的世界信号；按相邻 prefab 选用 |
| `inst:DoTaskInTime(t, fn)` | `world.scheduler.schedule(t, fn)` | `pigking.ts` | 返回取消函数，移除时要取消 |
| `inst:DoPeriodicTask(t, fn)` | 回调里再次 `schedule` | `monkeypillar.ts` | |
| `inst.OnSave`、`inst.OnLoad` | `this.OnSave = (_inst, data) => …`，同名 `OnLoad` | `archive_pillar.ts` | 还要加：`saveRecord.ts`、`src/save/types.ts`、`src/prefabDefinitions.ts` 的解析和导入转换器 |
| `inst.OnLoadPostPass` | 见示例 | `atrium_gate.ts` | |
| `onSpawned`（`POPULATING` 之外的初始化） | 定义的 `onSpawned(inst)` | `monkeypillar.ts` | 位置和存档都就绪后运行 |

## 物理、光、声音、小地图

| Lua | TS | 示例 | 差异 |
| --- | --- | --- | --- |
| `MakeObstaclePhysics(inst, r, h)` 等 | 定义的 `physics: { make: MakeObstaclePhysics, radius, height }` | `monkeypillar.ts` | 实现在 `standardcomponents.ts`，Lua 在函数内加 `blocker`，TS 除 `MakeHeavyObstaclePhysics` 外要另外 `addTag` |
| `inst.Physics:SetCylinder` 等 | `inst.physics` 同名方法 | `atrium_pillar.ts` | `SetCylinder` 实际是 capsule 近似 |
| `MiniMapEntity:SetIcon` | 定义的 `minimapIcon` | `archive_pillar.ts` | |
| `inst.Light` | `inst.light.set({ radius, falloff, intensity, colour })` | `atrium_gate.ts` | 项目单位，见示例换算 |
| `SoundEmitter` | 见 [sound](sound.md) | `player.ts` | |
| `MakeSnowCovered` | `setSymbolOverride('snow', 'snow.zip', 'snow')` + `setSymbolHidden` 跟雪量；植物用 `snowCovered: true` | `monkeypillar.ts`、`berrybush.ts` | `buildArchives` 要加 `snow.zip`，`hiddenSymbols: ['snow']` |

## 未实现

遇到时跳过并在汇报中写明，或按任务需要在所属包补上。

| Lua | 现状 |
| --- | --- |
| `SetAddColour` | 没有对应声明 |
| 整个实体的 `SetBloomEffectHandle` | 没有渲染路径，只有按符号的 `SetSymbolBloom` 近似 |
| `SetLayer(LAYER_BELOW_GROUND)` | 没有对应声明；`setGround` 只覆盖背景层 |
| 独立实体的 `SetFinalOffset`（负值） | 没有对应声明；只有跟随者支持 |

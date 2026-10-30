# @dontstarve-web/prefab

DST 场景预制体。该包基于 `@dontstarve-web/animation` 组合具体资源，当前提供：

`skinId` 保存在 `SpriteJson.skinId` 中；`PrefabInstance.skinId` 的 getter / setter 读写同一份声明，修改时发布 sprite signal。prefab 用 `sprite.setSkinSource()` 声明源皮肤 ID 到 archive 的映射、共享资源所有者及符号／附加动画 bank 配置。`PrefabDisplay` 在收到声明后查询共享缓存，缺失的 build／animation 由 display 异步加载；完成后按当前 json 应用，过期请求只留下缓存。直接设置 `instance.skinId` 即可换皮，设为 `undefined` 恢复基础外观，保留实体、sprite 控制器、动画进度及完成回调。休眠不为换皮加载资源，唤醒后应用最新声明。

- `createWilsonPlayer` / `createWilsonPlayerPrefab`
- `PigKingManager`（`pigking`）
- `placeStaticLayout`（`staticLayout`）：`default_pigking` 静态布局的地皮与岩石坐标，由地图生成层登记；`NightmareRockManager`（`nightmarerock`）对应 `sanityrock` / `insanityrock`。
- `createMoonTreeManager`（逐棵月树与幼苗，不生成森林）
- `TorchController`：`torch.lua` 的装备点燃、卸下熄灭、燃料消耗及耗尽移除；燃料通过调用方的权威状态读写接口保存，独立的只读 `burning` signal 发布燃烧状态，照明通过同步订阅更新。signal 原语来自公共包 `@dontstarve-web/signals`。
- `@dontstarve-web/animation/residentSprite` 的 `ResidentSprite` / `ResidentSpriteController`：固定实体的 visual 驻留封装，保留根节点与动画请求；`ResidentEntity` 记录稳定的身份和脚点。常青树、桦树、月树和蘑菇树通过 `PrefabInstance` + `PrefabDisplay` 与 `watchTileActivity()` 加载／释放 visual，不重建实体或 Workable。
- `AnimatedBuildingPlacement`，以及基于它的 `CookPotPlacement`、`ResearchLabPlacement`、`TreasureChestPlacement`（sprite 通过 `ResidentSpriteController` 驻留，离开 tickingarea 时交还共享 source，见 [tile 生命周期](../../docs/tile-lifecycle.md)）
- `WallsPlacement`：`prefabs/walls.lua` 的 9 种墙（石、档案馆石、木、草、铥、档案馆铥、月岩、绝望石、废料），
  含各自的 `wall_*_item` 部署物 ID。

`TorchController.onFrame(dt)` 累计实际时间，每 60 个燃烧帧调用一次 `update()`；`flushFuel()` 在保存、转移及生命周期停止前结算不足 60 帧的时间。

`TorchController.onequip(slotSignal)` 绑定调用方提供的槽位；`onunequip()` 停止燃烧并解除绑定，不改变槽位值。`extinguish()` 仅在绑定槽位仍保存同一次装备实例时清空它；地面火把没有绑定槽位。

`TorchController.OnPutInInventory()` 恢复闲置状态并停止火焰，保留 fuel；`OnExtinguish()` 处理未持有且未耗尽的地面火把。`createTorchGroundFactory()` 将成功拾取和外部熄灭事件接入这些回调，管理独立地面照明、剩余燃料及熄灭弹跳。声音通过共享 `PlaySound()` / `PreloadSounds()` 播放，地面声音在拾取或移除时释放，玩家拥有的一次性音效允许自然播放结束。地面 lit 状态及 fuel 可保存和恢复，换肤保持状态，恢复不重播点燃声。

`CookPotPlacement` 使用 DST 预制体 ID `cookpot` 和 `anim/cook_pot.zip`，默认显示
`idle_empty`，放置时播放 `place` 后回到 `idle_empty`。可通过包主入口或
`@dontstarve-web/prefab/cook_pot` 导入。应用已接入制作放置、
`c_spawn("cookpot")` 和存档恢复；支持 8 个皮肤 ID。靠近后点击锅会循环播放
`cooking_pre_loop`，并在锅右侧显示 4 个竖向的 `PreparedFoodSlot`，每格最多 1 个
物品，背景取自 `images/hud2.xml` 的 `preparedfood_slot.tex`。再次点击或走远会关闭
面板并回到 `idle_empty`；槽位内容随存档保存和恢复。

`ResearchLabPlacement` 支持 `researchlab` / `researchlab2` / `researchlab3` /
`researchlab4` 的全部 37 个皮肤 ID。制作时选择的皮肤用于预览和放置，靠近时的
`proximity_loop` 及存档恢复也保留皮肤。`researchlab4` 按 DST 源码仅替换
`machine_hat`，其余部件使用原始 build；科学机器和炼金引擎保留源码指定的基础特效
symbol，炼金打印舱的 `researchlab2_pod_fx` 动画层合并到同一帧几何体中。

四种科技建筑按 `scienceprototyper.lua` / `magicprototyper.lua` 的 workable 回调
接入 `onhit` 和 `onhammered`：4 次成功锤击后掉落配方材料（50%，逐项向上取整），
生成原版 `structure_collapse_fx.zip` 的 `collapse_small` 木质坍塌效果并移除实体。
掉落通过 `WorldContext.dropLoot` 交给应用的地面物品管理器，以 `flingLoot()`
逐件同步生成：实体与 display 立即存在并写入存档，美术由 display 加载后绘制。`LootFling` 按 `lootdropper.lua:FlingItem()` 的随机方向、水平 `0–2`、
向上 `8±4` 和物品/建筑碰撞半径初始化，场景长度换算为 `TILE_SIZE / 4`。
简化轨迹负责回落、轻微弹跳和停稳；抛起高度只影响 visual，地面脚点用于排序、
拾取和存档。飞行中保存只保存当前地面位置，读档不重播散射。短暂坍塌特效由
`AnimatedBuildingPlacement` 更新、排序和释放，不写入存档。皮肤切换保留剩余锤击次数，
读档则按 Lua 默认恢复 4 次。其他建筑继续使用原有受击反馈。

皮肤 build `.zip` 与贴图 `.dyn` 保留在 `public/dst/data/anim/dynamic/` 下。
build 从 DST `databundles/anim_dynamic.zip` 提取，`.dyn` 文件原样复制，运行时解码。
可通过 `python3 packages/prefab/scripts/import-building-skins.py` 重新同步，或用
`--source <DST data 目录>` 指定来源。`COOK_POT_SKIN_ARCHIVES` 和
`RESEARCH_LAB_SKIN_ARCHIVES` 导出对应的皮肤资源映射。

`TreasureChestPlacement` 会按 DST `treasurechest.lua` 的状态切换：点击关闭的箱子播放
`open` 并停留在打开帧，再次点击播放 `close`，完成后回到 `closed`。
`treasurechest.ts` 的 `onopen` / `onclose` 直接调用通用 `PlaySound()`，分别播放
`dontstarve/wilson/chest_open` / `chest_close`；`icebox.ts` 同样播放
`dontstarve/common/icebox_open` / `icebox_close`。创建实例时预加载共享音频，
点击开关及走远自动关闭均在动画开始时播放一次，恢复存档时不重放开关声。
应用的箱子面板跟随玩家头顶，背景使用 `anim/ui_chest_3x3.zip`，打开和关闭时
分别播放背景的 `open` / `close`，关闭动画完成后才隐藏面板。
制作时选择的箱子皮肤会映射到 `${import.meta.env.BASE_URL}dst/data/anim/dynamic/`
下对应的 DST build，并在预览、放置及后续开关动画中保持不变。

`PigKingManager` 对应 `pigking.lua`：每个猪王是 `PrefabInstance` + `PrefabDisplay`（billboard 由 display 订阅相机朝向，visual 随 tile 驻留），附障碍物碰撞体、地图图标、`trader` 组件、`SGpigking` 状态机（经自有 `Cycle` signal 昼夜睡觉、金块交易、拒绝），由场景注册表的 `restore` / `debugSpawn` / `exportRecords` 创建与保存，不创建任何地皮。
猪王周围的地皮和岩石属于地图生成层（原版 `default_pigking.lua` 静态布局），由
`scripts/import-static-layouts.py` 生成的 `staticLayouts.json` 驱动：`placeStaticLayout('default_pigking', feet, 'pigking')`
返回 40 块 `GRASS`、12 块 `WOODFLOOR` 的格子中心和 8 块岩石的位置，主场景把所有格子一次登记到 `TurfMap.setOriginalTiles`；存档覆盖的有效地皮未变时不重建。
`TurfMap`（`@dontstarve-web/prefab/turfMap`）提供按格查询、挖地、稀疏存档和
`createVisual(assetBaseUrl)`。主场景将猪王木地板格登记到该地图，由统一地皮层绘制。`groundTiles.json` 从 `tiledefs.lua` 提取 ID、atlas/noise 路径和
绘制顺序；`pnpm --filter @dontstarve-web/prefab ground-tiles:import` 导入原版资产，
`ground-tiles:check` 校验源字节和定义。`groundTiles.ts` 根据八邻格选择 48 个源 atlas
图块，并按 `ground.ksh` 的方式将 atlas RGBA 与世界坐标噪声相乘。内部同种格用完整
图块，交界使用边、外角和内角；挖地同步刷新相邻掩码，存档只记录地皮状态。

基础 turf 与木地板均不写入深度缓冲，避免裁掉动画图像延伸到脚点下方的部分；
两者保持相同地面高度，按 `renderOrder` 的 `-2`、`-1` 顺序绘制。
应用从存档中的每个 `pigking` 记录恢复猪王，并按其位置登记木地板，无需单独保存固定地皮布局。

调用方负责传入 `${import.meta.env.BASE_URL}dst/data/anim` 形式的动画资源根路径；prefab 包不依赖应用的 Vite base 配置。

月树默认有 500 个实体记录，visual 按所在 tile 的 tickingarea 驻留；地图分布沿用原有的
1000 × 1000 区域和出生点空地。月树通过 `createSharedArchiveSprite()` 的预加载入口（`preloadSharedArchiveSprite()`，先加载一次再同步创建）使用共享帧缓存；`sway1_loop_*` 待机交给 `InstancedArchiveSprites`，同积雪状态的月树共享合成图集，砍伐、倒下、树桩和燃烧后的 `burnt_*` 继续用共享帧。积雪层由 `snow.zip` 的 `snow` 符号按 `SnowLevel ≥ 0.015` 通过 `setSymbolHidden()` 切换。所有实体保留稳定根节点、组件与逻辑动画，活动实体持有实际 visual。tile effect 更新活动集合和驻留，无需逐帧扫描全部实体；每帧调用 `update(dt)` 和 `setNormals(cameraQuaternion)`；
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

`createWilsonPlayer()` / `createWilsonPlayerPrefab()` 同步返回玩家模型／实例和刚体。玩家只声明动画 archive、bank、build 和道具 fallback；`PrefabDisplay` 通过 `SpriteResources` 加载并应用当前声明，加载完成不回写玩家逻辑。需要等到可绘制时，由应用调用 `await display.artLoaded()`。幽灵／复活、读书、工具动作和表情的时长来自导入的 `animationTimings.json`，不等待美术；读书／工具破损 FX 的定时移除也独立于资源加载。用 `python3 packages/prefab/scripts/import-animation-timings.py --check` 校验时长。

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
生成和移除 `campfirefire`（`campfirefire.ts`，`FX`、`HASHEATER`、`persists = false`，
`anim/campfire_fire.zip`）：它以 `attachFx` 的 `composite` 跟随火坑的 `firefx` 符号，偏移在符号空间内，
帧合入火坑同一 `BufferGeometry` 的该符号层。`firefx` 组件（`packages/componets/src/firefx.ts`）按
等级播放 `level1`–`level4`、调整 `firefx_light` 子实体的半径／亮度并按 `OnUpdate` 闪烁，管理
`campfire` 循环声与 `fireBurstSmall/Large`、`fireOut`；光源挂在火坑上。各皮肤的 `SetFXOffset`
与换肤后的 `restart_firepit` 已接入。保存 `firepit.fueled.fuel`（满燃料时按 Lua 省略）与
`queued_charcoal`；燃烧中的火坑不按结构燃烧存为 `burnt`。可燃物品的 `fuel` 组件、雨天加速消耗、
`heater` 供热、烹饪、作祟和火鸟皮肤加燃料特效尚未移植。

`HAT_CRAFTING_DEFINITIONS` 保留 52 条原始配方及科技、角色、技能、制作站
元数据。`HAT_RECIPES` 提供现有 InventoryStore 可以执行的 51 条背包配方；
木雕帽需持有 Lucy，但不消耗它。气球帽需要理智值，当前没有对应的权威状态与
扣减接口，因此保留原始定义并锁定 UI 制作；可以用 `c_give("balloonhat")`
检查装备。掉落帽子没有新增配方。科技和角色限制仍依照当前合成系统的行为，
当前未实现解锁系统、装备耐久和帽子战斗能力；启迪之冠提供上述照明与动态外观。

`python3 packages/prefab/scripts/import-hats.py` 可重新生成帽子目录并镜像资产，
`--source` 可指定 DST data 根目录，`--check` 校验目录与所有镜像文件。

`createHatGroundFactory(context)` 把落地帽子创建为 `createPrefabEntity()` 实体，使用独立的落地 `anim` 动画，遵循
`hats.lua` 的 `SetBank(name.."hat")` / `SetBuild("hat_"..name)` / `PlayAnimation("anim")`。
sprite 来自按帽子 archive 与皮肤共享的 `createAnimatedSpriteSource()`，由 `PrefabDisplay` 绘制；
落地／读档后经 `bindResidentGroundItem()` 绑定 tile 活动，与目录物品相同。
落地帽子按实体的地面接触点参与遮挡排序，点击合并 Mesh 可拾取，存档保存真实落点。
兔子帽按 `rabbit_custom_init` 以 `rabbit_build` 为 build，并以 sprite 来源的 `overrideBuilds: { hat_rabbit: 'hat_rabbit.zip' }` 声明帽子部件，由 display 随来源一起加载。

`@dontstarve-web/prefab/groundItems` 提供 `GROUND_ITEM_DEFINITIONS`、
`GroundItemAssets` 和 `createResidentGroundItem({ assets, tickingarea? }, { itemId, skinId?, sprite? })`。
`sprite` 是物品自己的 sprite json（`ItemEntity.sprite`，即 inst.AnimState）：传入时 visual 绘制它并保留其中的皮肤，不传时 visual 使用自己的 sprite 和 `skinId`。
地面工厂的 `create(definition, entity)` 总是传入 `entity.sprite`，所以物品在地上、背包、装备栏和存档中的皮肤都来自同一份 `sprite.skinId`。
同步返回 `{ visual, instance, display }`，prefab 通过 `instance.sprite` 声明动画与外观，
由 `PrefabDisplay` 加载美术、创建和释放 sprite（需要等待绘制时用 `display.artLoaded()`）；落地／读档后绑定 tile，休眠时保留稳定模型、身份与组件。
其他 sprite 来源（如 factory 路径的落地帽子）用 `groundItemLifecycle.ts` 的 `bindResidentGroundItem(context, instance, display)` 获得同一生命周期。
通用资源加载、动画选择、符号覆盖、模型创建和逐帧绘制由
`@dontstarve-web/animation/archiveSprite` 提供。`GroundItemAssets` 继承其共享缓存，
保留 `ground:` 材质名称；prefab 层负责物品定义、皮肤校验、实体物品信息和库存事件。
目录包含 221 种材料、工具、提灯、荧光果、唤星者魔杖、唤月者魔杖、清洁扫把、肉类、蔬菜、墙体物品和普通烹饪食物，以及 94 个皮肤 ID。
初始背包里的物品均已接入地面动画；未进入目录的其他物品仍使用图标回退。
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
提灯通过下述专用工厂提供亮灯状态与局部光源描述。

提灯由 `@dontstarve-web/prefab/lantern` 提供。物品 ID 是 `lantern`，源代码为
`prefabs/mininglantern.lua`。地面使用 `lantern.zip` 的 bank/build `lantern`，
亮灯播放 `idle_on`，熄灭播放 `idle_off`；手持使用 `swap_lantern.zip` 的
`swap_lantern` 和 `lantern_overlay` 符号，主体与覆盖层合入 Wilson 同一帧的 Mesh。
12 个皮肤 ID 使用目录中的原始 build 和别名，缺少的手持符号回退到基础手持 build。

```ts
const assets = new GroundItemAssets();
const lamp = createLanternGroundSprite({ assets, tickingarea }); // display 随后加载美术
const item = new ItemEntity({ itemId: 'lantern', count: 1 });
configureLanternEntity(item);
lamp.bindEntity!(item);
scene.add(lamp.model); // 位置由调用方设置，ondropped 开灯
lamp.model.dispatchEvent({ type: 'ondropped' });
lamp.model.dispatchEvent({ type: 'onputininventory' }); // 关闭地面光源
lamp.model.dispatchEvent({ type: 'ondropped' }); // 再次放到地面，恢复灯光
lamp.light.setLit(false);
lamp.light.setFuelPercent(0.5);
lamp.light.setLit(true);
lamp.dispose();
item.destroy();
assets.dispose();

await player.userData.animationController.setCarryItem('lantern', skinId);
player.userData.animationController.setLanternFuelPercent(0.5);
await player.userData.animationController.setCarryItem(null); // 收回背包并关闭手持光源
```

地面物品的库存事件使用实体自己的 `THREE.Object3D` 事件系统。各 prefab TS 通过
`listenInventoryEvents(model, { ondropped, onputininventory, onload })` 注册处理函数，
该函数由 `@dontstarve-web/prefab/inventoryEvents` 导出，并返回取消监听的函数；
prefab 的 `dispose()` 调用它清理监听。`ondropped` 在成功从库存移到地面后触发，
`onputininventory` 在成功拾取或虫网捕获后、移除地面模型前触发；失败的库存操作
不触发这两个事件。`onload` 用于存档恢复或换肤后的地面初始化，不重放掉落效果。
应用的 `GroundItemManager` 负责按创建器注册表创建实例、设置落点和分发事件；
灯光、活动、动画和 Bernie 形态的处理保留在各 prefab 中。

`GroundItemManager` 在 `animationBaseUrl` 后接收必填的 `player: THREE.Object3D`。
地面拾取与木箱共用 `@dontstarve-web/prefab/playerProximity` 的水平距离判断：
进入距离为 9，退出距离为 10；每帧及拾取前更新状态，超过范围时不修改库存，
也不触发 `onputininventory`。普通物品、帽子、Bernie 和图标回退均遵守该规则；
虫网继续在捕获动作中检查自身距离。`ondropped` 仍在成功丢弃后触发。

每个 prefab TS 同时导出 `createXXXGroundFactory(context)`，在自己的文件中绑定
`createXXXGroundSprite`、声明 `itemIds` 和虫网捕获策略，并管理专用资产缓存。
`GroundPrefabRegistry` 统一装配这些模块，先注册通用物品和帽子，再按相同 ID
注册特殊 prefab；共享动画/build 缓存由注册表统一释放。应用的管理器只传入
资源路径、世界上下文和附近实体查询，不再逐个绑定创建器或管理 prefab 缓存。
`createBernieGroundSprite`、`createLanternGroundSprite`、`createLightbulbGroundSprite`、
`createButterflyGroundSprite` 和 `createFirefliesGroundSprite` 的实现及库存事件均在
对应 prefab TS 中。萤火虫的旧入口 `FirefliesAssets.create(world)` 委托给同文件的
`createFirefliesGroundSprite(assets, world)`。需要位置的地面 visual 提供
`bindTransform(entity.transform)`，由 GroundItemManager 在成功交接实体后、
分发库存事件前调用。蝴蝶和萤火虫在绑定时建立控制器，移动和距离判断直接
使用实体坐标；准备资源期间不建立另一份实体状态。独立使用这些 visual 时也
需要先绑定 Transform，再调用 update 或分发 onload/ondropped。

萤火虫通过 `createSharedArchiveSprite()` 创建：同一个 `FirefliesAssets` 持有一个
`ArchiveSpriteAssets`，`swarm_loop` 预合成完整帧后实例化，`swarm_pre` / `swarm_pst`
仍使用共享帧几何。虫群的播放和完成回调独立；休眠释放实体视觉并退出实例批次，唤醒时
重新绑定当前逻辑动画，异步创建的过期结果立即释放。源 bloom 效果沿用共享 lightmap 中的
`lightOverride`，实例属性传递各实体的覆盖值，发光半径和淡入淡出仍由原控制器负责。
昼夜与位置监听在休眠时保持门控；`tickingarea` 恢复为 true 后，显隐 effect 先检查同步后的昼夜，
白天立即清除旧光照、淡变与延迟任务并隐藏虫群、禁用 NET。活动区进入白天或白天丢弃也立即隐藏。
萤火虫的鼠标交互还要求玩家装备 `bugnet`：prefab 私有监听注入的手部装备 signal，空手或其他工具时
给逻辑实体和模型加上 `NOCLICK`；装备虫网后仅在原本可点击时移除。换装备不改变光源、动画或 `NET`
工作状态，休眠暂停装备监听，唤醒重新读取，永久移除时释放监听。源 `firefly`、`cattoyairborne`、`flying`、
`NOBLOCK` 标签也应用在逻辑实体上。

`LootFling` 接收实体的 `transform`，直接推进其中的地面坐标；`position` getter
返回 Vector3 显示投影，`height` 是视觉弹跳高度。模型仅从实体同步位置。

`LanternLightController` 按源 Lua 在燃料比例 0～1 时使用半径 3～5（换算为场景的
9～15 世界单位）、强度 0.4～0.6、Falloff 0.9，以及 RGB `(180,195,150)/255`；
零燃料时关闭光源。光源声明在 `lanternlight` 光源实体的 `instance.light` 上，
由其 display 列入光源列表，应用的局部光照渲染器只读取该列表。

应用支持把提灯拖到手部装备、Shift+右键丢到地面，以及点击地面提灯拾回背包。
地面模型移出场景后不再参与光照；失败的扣减或拾取保留原有物品状态。
可以用控制台命令 `c_give("lantern")` 获取提灯，现有制作配方也会产出该物品。
地面存档仍保存物品、皮肤及真实落点，恢复后默认点亮。

当前背包没有逐件燃料状态，因此应用使用满燃料，不自动耗油或保存开关／燃料比例；
Prefab API 可由后续权威燃料状态驱动。声音、单独的粒子特效和地面开关交互尚未接入。

荧光果由 `@dontstarve-web/prefab/lightbulb` 的 `createLightbulbGroundSprite(assets)`
提供。使用 `lightbulb.lua` 指定的 `anim/bulb.zip`、bank/build `bulb` 和 `idle`
动画，默认放在地上发光。`setLit(false)` 关闭局部光源，`dispose()` 同时移除光源和模型。
它的原版半径为 0.5，换算为场景的 1.5 世界单位；强度 0.5、Falloff 0.7，
RGB `(237,237,209)/255`。范围不随掉落堆叠数量增加，也没有火把的额外 50% 倍率。

应用支持 `c_give("lightbulb")` 获取荧光果，Shift+右键丢一颗到地面发光；
点击拾回背包后该地面光源消失，失败的拾取会保持发光。存档恢复的荧光果也会发光。
图标从真实 inventory atlas 读取，地面模型使用原始动画，不使用图标回退。
本次提供局部照明，尚未接入原版 Bloom 后处理、腐坏和食用效果。

唤星者魔杖由 `@dontstarve-web/prefab/staff` 提供，装备 API 为
`await controller.setCarryItem('yellowstaff', skinId)`。手持使用 `swap_staffs.zip`
的 `swap_yellowstaff`，地面使用 `staffs.zip` 的 bank/build `staffs`、`yellowstaff`
动画；基础外观和 4 个皮肤均使用原始资源。

应用中用 `c_give("yellowstaff")` 获取魔杖，拖入手部装备栏后右键地面施法。
`player_staff.zip` 播放 `staff_pre → staff`，第 13 帧调用
`PlaySound('dontstarve/common/staffteleport')`，第 53 帧生成矮星并扣一次耐久与 20 理智；重复点击不重复提交，
施法过程中停止移动，卸下魔杖或开始其他动作会取消尚未提交的召唤。

`getLightStaffController(entity, world)` 在真实物品实体上配置 `SpellCaster`，按法杖自身 ID 选择 `stafflight` / `staffcoldlight`，黄／蓝法杖分别为 20／50 次。`onequip(slotSignal)` 绑定装备生命周期，卸下只解除绑定，耗尽通过实体的库存 owner 移除。`SpellCastActionController` 读取组件和能力标签、共享鼠标动作选择器及真实 `BufferedAction.invobject`，不包含法杖 ID、星体 Manager 或法术函数；异步准备完成后进入状态图，过远先接近，尚未提交的装备替换使旧动作失效。第 53 帧释放临时光效的取消所有权，剩余光效自然结束；第 69 帧解除 busy 并恢复世界输入。

`@dontstarve-web/prefab/stafflight` 的 `DwarfStarManager` 管理独立的矮星
（源 prefab ID `stafflight`）。`star_hot.zip` 播放 `appear → idle_loop → disappear`，
局部光源每 20 秒脉动一次，半径为 33～36 世界单位。矮星固定在右键 raycaster
命中的地面点，持续 24 分钟（1440 秒），到期播放
消失动画并在 1 秒后移除；存档保存各自的落点和剩余寿命，恢复时继续计时。
`spawn(position, saved?)` 同步创建矮星，施法提交帧与读档都用它，美术由 display 通过 `SpriteResources` 加载；`update(dt, cameraQuaternion)`
更新动画与光照，`exportRecords()` 返回可保存记录，`dispose()` 释放共享精灵资源并停止所属声音。

矮星音频随场景启动时的 `PrewarmSounds()` 一起解码：出现时播放 `dontstarve/common/staff_star_create`，
每颗矮星独立循环 `dontstarve/common/staff_star_LP`，消失动画结束时停止；
移除及 `dispose()` 会停止并断开所属矮星的音源。恢复存档时只接续循环声。
音频由 vgmstream 从 `sound/common.fsb` 的流 273（`staff_star_create`）和
274（`staff_star_fireLP`）提取，保留源 bank 的目录，导出为 `sound/common.fsb-273.wav`、
`sound/common.fsb-274.wav`；声音在用户交互后启用。提取方法见根目录 `AGENTS.md`。

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

`AnimatedBuildingPlacement.reskinTargets` 保留实体根节点、开关状态和容器引用；
地面物品保留数量、实体 ID 和真实落点，拾回时携带新皮肤。换肤后的皮肤进入现有
存档字段；取消、目标移除或资源加载失败不会提交变化。场景退出调用控制器和
特效的 `dispose()`，并用 `DisposeSounds()` 释放共享声音。

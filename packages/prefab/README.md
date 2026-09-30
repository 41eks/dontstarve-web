# @three-roaming/prefab

DST 场景预制体。该包基于 `@three-roaming/animation` 组合具体资源，当前提供：

- `createWilsonPlayer` / `createWilsonPlayerPrefab`
- `createPigKing`
- `createPigKingSetPiece`：猪王及周围 3 × 3 的 `turf_woodfloor` 地皮。
- `createMoonTreeForest`
- `ProximityEntities`：保留实体位置，仅创建玩家 XZ 距离加载半径内的模型，离开后移除并释放模型。
- `AnimatedBuildingPlacement`，以及基于它的 `CookPotPlacement`、`ResearchLabPlacement`、`TreasureChestPlacement` 与 `WallStonePlacement`

`CookPotPlacement` 使用 DST 预制体 ID `cookpot` 和 `anim/cook_pot.zip`，默认显示
`idle_empty`，放置时播放 `place` 后回到 `idle_empty`。可通过包主入口或
`@three-roaming/prefab/cook_pot` 导入。应用已接入制作放置、
`c_spawn("cookpot")` 和存档恢复；支持 8 个皮肤 ID。靠近后点击锅会循环播放
`cooking_pre_loop`，并在锅右侧显示 4 个竖向的 `PreparedFoodSlot`，每格最多 1 个
物品，背景取自 `images/hud2.xml` 的 `preparedfood_slot.tex`。再次点击或走远会关闭
面板并回到 `idle_empty`；槽位内容随存档保存和恢复。

`ResearchLabPlacement` 支持 `researchlab` / `researchlab2` / `researchlab3` /
`researchlab4` 的全部 37 个皮肤 ID。制作时选择的皮肤用于预览和放置，靠近时的
`proximity_loop` 及存档恢复也保留皮肤。`researchlab4` 按 DST 源码仅替换
`machine_hat`，其余部件使用原始 build；科学机器和炼金引擎保留源码指定的基础特效
symbol，炼金打印舱的 `researchlab2_pod_fx` 动画层合并到同一帧几何体中。

皮肤 build `.zip` 与贴图 `.dyn` 保留在 `public/dst/data/anim/dynamic/` 下。
build 从 DST `databundles/anim_dynamic.zip` 提取，`.dyn` 文件原样复制，运行时解码。
可通过 `python3 packages/prefab/scripts/import-building-skins.py` 重新同步，或用
`--source <DST data 目录>` 指定来源。`COOK_POT_SKIN_ARCHIVES` 和
`RESEARCH_LAB_SKIN_ARCHIVES` 导出对应的皮肤资源映射。

`TreasureChestPlacement` 会按 DST `treasurechest.lua` 的状态切换：点击关闭的箱子播放
`open` 并停留在打开帧，再次点击播放 `close`，完成后回到 `closed`。
应用的箱子面板跟随玩家头顶，背景使用 `anim/ui_chest_3x3.zip`，打开和关闭时
分别播放背景的 `open` / `close`，关闭动画完成后才隐藏面板。
制作时选择的箱子皮肤会映射到 `${import.meta.env.BASE_URL}dst/data/anim/dynamic/`
下对应的 DST build，并在预览、放置及后续开关动画中保持不变。

`createPigKing` 只创建猪王的模型、碰撞体和动画交互。`createPigKingSetPiece`
通过包主入口或 `@three-roaming/prefab/setpieces/pigking` 导入，接收 DST data 根路径
和可选的猪王脚点位置，返回包含猪王及木地板地皮的 `group`、`pigKing`、`turf`、
`footPosition` 和九块地皮的坐标。木地板对齐地图格，覆盖猪王所在格及周围八格；
使用原始 `levels/textures/noise_woodfloor.tex`，不再使用独立的 PNG 装饰地板。
应用从存档中的每个 `pigking` 记录恢复整个 set piece，无需单独保存固定地皮布局。

调用方负责传入 `${import.meta.env.BASE_URL}dst/data/anim` 形式的动画资源根路径，
set piece 则传入 `${import.meta.env.BASE_URL}dst/data`；prefab 包不依赖应用的 Vite base 配置。

月树默认有 500 个实体记录，加载半径为 10 格（`10 * TILE_SIZE = 120` 个世界单位）；地图分布沿用原有的
1000 × 1000 区域和出生点空地。月树使用通用动画精灵，共享一次加载的动画资源和
贴图，仅附近实体持有独立模型、几何体和动画控制器。每帧在玩家位置更新后调用
`updateNearby(player.position)`、`update(dt)` 和 `setNormals(cameraQuaternion)`；
将 `activeEntities` 的模型及其 `position` 脚点加入动态精灵的深度排序。
`dispose()` 会释放全部模型及共享资源。

应用通过 `positions` 选项传入 `src/moonTreePositions.ts` 中的 500 个固定随机坐标，
每次进入页面使用同一组初始位置。显式位置优先于 `count`、`areaSize`、
`exclusionRadiusSquared` 和 `random`；Prefab 会复制坐标，避免修改调用方的数据。

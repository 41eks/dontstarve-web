# @three-roaming/prefab

DST 场景预制体。该包基于 `@three-roaming/animation` 组合具体资源，当前提供：

- `createWilsonPlayer` / `createWilsonPlayerPrefab`
- `createPigKing`
- `createMoonTreeForest`
- `ProximityEntities`：保留实体位置，仅创建玩家 XZ 距离加载半径内的模型，离开后移除并释放模型。
- `AnimatedBuildingPlacement`，以及基于它的 `ResearchLabPlacement`、`TreasureChestPlacement` 与 `WallStonePlacement`

`TreasureChestPlacement` 会按 DST `treasurechest.lua` 的状态切换：点击关闭的箱子播放
`open` 并停留在打开帧，再次点击播放 `close`，完成后回到 `closed`。
制作时选择的箱子皮肤会映射到 `${import.meta.env.BASE_URL}dst/data/anim/dynamic/`
下对应的 DST build，并在预览、放置及后续开关动画中保持不变。

调用方负责传入 `${import.meta.env.BASE_URL}dst/data/anim` 形式的动画资源根路径；
Pig King 的地板纹理 URL 也由调用方传入。这样 prefab 包不依赖应用的 Vite base 配置。

月树默认有 500 个实体记录，加载半径为 10 格（`10 * TILE_SIZE = 120` 个世界单位）；地图分布沿用原有的
1000 × 1000 区域和出生点空地。月树使用通用动画精灵，共享一次加载的动画资源和
贴图，仅附近实体持有独立模型、几何体和动画控制器。每帧在玩家位置更新后调用
`updateNearby(player.position)`、`update(dt)` 和 `setNormals(cameraQuaternion)`；
将 `activeEntities` 的模型及其 `position` 脚点加入动态精灵的深度排序。
`dispose()` 会释放全部模型及共享资源。

应用通过 `positions` 选项传入 `src/moonTreePositions.ts` 中的 500 个固定随机坐标，
每次进入页面使用同一组初始位置。显式位置优先于 `count`、`areaSize`、
`exclusionRadiusSquared` 和 `random`；Prefab 会复制坐标，避免修改调用方的数据。

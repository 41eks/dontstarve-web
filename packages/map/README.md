# 地图图标与地皮绘制

本包同时负责游戏内小地图的实体订阅与图标资源。`PrefabInstance.minimap` 通过 `MiniMapState` 声明设置，并提供实体拥有的 `tileTracker`；`watchMiniMapEntity()` 订阅声明、生命周期和 tile key，`miniMapEntities()` 提供稳定的图标记录及实体脚点引用。库存物品的地图声明接入相同通知链。UI 打开时通过 `subscribeMiniMapEntities()` 同步一次，此后仅响应单个图标的变化；关闭时解除 DOM 订阅，重新打开时补齐变化，不使用定时采样或地图帧循环。格内移动不更新坐标，跨格通知时读取实体位置；拥有者在移动后调用 tracker 的 `moved()`，掉落、传送等位置跳变调用 `sync()`。休眠保留记录，永久移除清理订阅。`MinimapIcons.prewarm()` 在加载页加载原版两个公共图集，将每张完整图集各转成一张 PNG 并预解码，建立图标名到 index 和裁切矩形的映射，运行时同步读取区域。UI 负责 CSS 背景裁切节点、布局和交互；`packages/display` 不承担地图职责。

`MiniMapRenderer`（`src/miniMapRenderer.ts`）对应原生 `MiniMapRenderer`：每种地皮一个渲染层（`MapLayerManager:CreateRenderLayer`），按 `minimap.ksh` 把 `map_edge` 遮罩图集乘以世界坐标噪声，在一张视口大小的 WebGL 画布中绘制。只有视图变化或地图打开期间的地皮改动才绘制一帧；地皮改动只重建所触及分块的几何，分块只用于裁剪和增量更新，同一帧内绘制，没有拼接边。开放海洋仍是预渲染的无缝底板 `public/minimap/ocean.png`。

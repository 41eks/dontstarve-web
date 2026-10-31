# 世界地皮与地图图标

游戏地图由 `packages/ui` 在主线程中维护：地皮由 `packages/map` 的 `MiniMapRenderer` 画在一张视口大小的 WebGL 画布上，实体图标由其上方一张视口大小的 Canvas 2D 画布绘制。没有地图 Worker，也没有持续的地图渲染循环。

全屏装饰背景对应 `widgets/mapwidget.lua:24` 的 `Image("images/hud.xml", "map.tex")`：`hud.xml` 把 `map.tex` 映射到 `images/hud.tex` 的一块图集区域，二者均从原始 `databundles/images.zip` 读取。`DstMinimapElement` 通过共享 `createAtlasImage()` 绘制该区域，横纵方向分别拉伸到视口边缘，对应中点注册／锚定及 `SCALEMODE_FILLSCREEN`；横屏、竖屏均不保留原图宽高比或留边。背景固定在屏幕上，不随地图平移、缩放或转向。解码器把源预乘纹理恢复为普通 RGBA，浏览器以标准 alpha 合成背景，对应 Lua 的 Premultiplied 绘制。

地图视口位于装饰背景之上，使用 `mix-blend-mode: plus-lighter` 对应 `MapWidget.img` 的 `BLENDMODE.Additive`，地图根节点隔离混合范围，按钮另放上层。`prepareTerrain()` 同时等待 HUD 背景和地皮就绪；关闭／重开地图复用同一图集资源。`screens/mapscreen.lua` 在键鼠模式隐藏 `cursor02.tex` 中央准星，当前键鼠界面沿用这一分支。既有地图操作和调试命令的语法、参数及支持 ID 不变。

地图层的 `z-index` 为 60，覆盖物品栏、右侧 backpack 和其他容器面板（55）；不切换这些面板的显隐或关闭容器，退出地图后直接露出原状态。地图／旋转控制位于 70；暂停按钮按 `screens/mapscreen.lua:35` 的 `pauseBtn:Hide()` 在地图打开时隐藏，关闭时恢复，左右旋转按钮保留原来的网格位置。该行为由 `isOpen` 决定，地图动作解除自动暂停后仍保持地图遮挡。

`src/main.ts` 只注入 `TurfMap` 和格子尺寸。`TurfMap` 拥有地皮、八邻格变体、海洋及变更通知，并按地皮提供 `MapLayerManager:CreateRenderLayer` 的输入：共用的 `map_edge` 图集像素（同一路径只解码一次）、48 个遮罩的纹理矩形和该地皮的 `mini_*` 噪声。`MiniMapRenderer` 对应原生 `MiniMapRenderer`：每种陆地地皮一个 `RawShaderMaterial`，片元着色器照搬 `minimap.ksh`（图集 RGB 乘以世界坐标噪声 RGB，保留图集 alpha），按源图层顺序叠加；没有已加载美术的陆地格画成灰色，位于所有图层下方。几何复用世界地面的 `tileLayerQuads()`，因此小地图与地面的边缘变体一致。纹理不做颜色空间转换，与原先逐字节相乘的合成结果一致；图集不生成 mipmap，避免相邻遮罩渗色，噪声生成 mipmap。噪声周期沿用世界地面的 8 格；`NOISE_REPEAT_SIZE` 由引擎设置，Lua 与可执行文件的明文字符串中都查不到该值，尚未核实。

海洋是底图：`packages/ui/scripts/render-minimap-ocean.mjs`（`--check` 校验）把 `minimap_paper.tex` 乘以 `EDGE_COLOR0` 渲染成无缝不透明的 `public/minimap/ocean.png`。渲染器把它作为一张覆盖地皮范围及 10% margin 的平铺四边形（每次重复 32 格）画在陆地图层下方；海洋格不出陆地几何，海岸只有陆地遮罩自带的柔边。不将角色、建筑、昼夜光照或后处理烘焙到地图。

世界载入时，猪王布局通过 `TurfMap.setOriginalTiles()` 一次登记所有原始地皮；先保留存档覆盖，再比较有效格子，只有实际变化才重建并通知地图。完整导入存档已有最终地皮，因此这一步不重建世界或底图。水平地块的几何直接分配类型化顶点、UV 和索引数组并写入向上法线，省去临时数字数组及逐三角形法线计算；裁剪和八邻格遮罩规则保持一致。

`DstMinimapElement.prepareTerrain()` 等待地皮图层纹理、海洋底板和全部分块几何建好（建几何时每 8 ms 让出主线程）。`src/main.ts` 的 `gameReady` 先等待这一步，再启动场景循环和首次渲染，因此加载页关闭前地图已可绘制。图标只在打开地图后加载和采样。

几何按 32×32 格分块，分块只用于视口裁剪和增量更新：同一帧内所有分块画进同一个缓冲区，相邻四边形共用顶点，不存在拼接边。只有地图打开时的视图变化（平移、缩放、转向、窗口与 DPR）或地皮改动才在下一个动画帧绘制一帧，同一帧内的多次请求合并。地皮改动按通知的范围外扩一格（八邻格变体）把分块标脏，地图关闭时只标记；绘制前只重建可见的脏分块。画布尺寸等于视口乘以 DPR，与世界大小无关。重新绑定、移除或显式销毁时释放几何、材质、纹理和 WebGL 上下文，不注册页面离开清理。

陆地判定不读取像素：悬停和右键时把屏幕坐标转为世界坐标，查询该格地皮，非空、非虚空且非海洋即为陆地。根节点据此切换 `minimap--land`，显示十字光标；海洋处隐藏光标，左键拖动时显示抓取光标，定位按钮保留普通按钮光标。视图变化后按最后的指针位置重新判定。这只是可见陆地的范围，不代表传送动作许可。

`MinimapIconView` 将所有图标绘制到一张视口大小的 Canvas 2D 画布，使用共享已解码图集及其裁切矩形。位置通过 `MinimapView.worldToScreen()` 投影，图标始终直立并保持源宽高比；默认 zoom=3 时宽 32 CSS 像素，之后宽高乘以 `3 / zoom`，与地皮按同一比例缩放；画布分辨率按 DPR 设置。屏外图标不提交绘制，部分进入视口的图标保留。按源 priority 稳定排序，负优先级也位于地形上方；相同优先级保留注册顺序。只有成员或优先级变化才重新排序。视图或实体通知把图标画布标脏，多次通知合并到下一个 RAF；地图静止、关闭后没有图标帧循环。关闭取消待绘制帧，重开复用图集和图标记录；显式销毁释放画布缓冲区及记录。

世界 prefab 在 `PrefabInstance.minimap`（`MiniMapState`）声明图标、优先级、启用状态和原版缓存／迷雾标志，只读 `json` signal 保存这些设置，同时向 map 提供自己拥有的 `tileTracker`。`packages/map/src/minimapEntities.ts` 为每个逻辑实体建立自己的 `watchSignal` 桥接，通过 `createEffect` 订阅声明、生命周期和 tracker 的 tile key，汇入 `miniMapEntities()`；位置直接引用实体已有的脚点 `Vector3`，不复制、不写入 signal。没有图标的 prefab 不创建地图所需的 tracker 和 tile 订阅。休眠和世界 visual 的替换／释放保留地图图标，实体永久移除时注销并释放订阅。manager 和场景实体注册表不再汇总图标；库存物品的 `MiniMapEntity` 同样声明 `MiniMapState` 并提供自己的 tracker，由 inventoryitem 的所有权控制启用状态，两类图标统一由 map 发布变化。

`packages/map/src/minimapIcons.ts` 的 `MinimapIcons.prewarm()` 在加载页读取两个共用图集 `minimap/minimap_data1.xml` / `minimap_data2.xml` 及对应 TEX，将每张完整图集转换为一个 PNG Blob URL 并保留预解码的共享 Image，建立 `图标名 → index → 图集 URL 与裁切矩形` 映射。同一图集中的全部图标共用图片和 URL，不逐图标裁切或编码。资源位于原版 `data/minimap/`，不在各 prefab 的动画 ZIP 中。`packages/display` 不参与地图订阅或图标资源加载。小地图 UI 只读取预热结果，通过 `drawImage()` 裁切共享 Image；不逐图标创建 DOM 节点或独立图片。打开时同步一次当前实体列表和位置，之后通过 `subscribeMiniMapEntities()` 接收单个实体的变化，不使用定时采样或新增帧循环。位置沿用 tracker 的通知粒度：拥有者在移动后调用 `moved()`（默认累计 60 次检查一次），掉落或传送后调用 `sync()`；只有 tile key 变化才通知地图，格内移动不更新采样坐标，重新打开时按当前位置同步。声明、启用状态和优先级变化独立更新相应图标记录。关闭地图解除实体订阅，保留图集和图标记录，重新打开时补齐关闭期间的变化。显式销毁或重新绑定地图时统一释放图片 URL 和订阅。

视口缩放沿用 MapScreen 的 0.1 秒插值，`zoom` 范围 1～20、默认 3，数值越小地图越大。输入起点和插值进度均采样 `performance.now()`，避免 RAF 帧时间戳早于输入导致负进度。连续输入从当前视口续接，光标下世界坐标保持锚定。只有缩放插值期间申请动画帧，关闭地图取消插值并解除图标实体订阅。

右键点在陆地格上时，地图调用 `screenToWorld()` 转为 `Vector3`，发送可取消的 `game:map-action-request`；`src/main.ts` 将位置交给 `WortoxPlayer`，由现有 `BlinkActionController` 校验角色和真实陆地并缓冲 `BLINK_MAP`。动作没有普通跳跃的距离／寻路要求；预备动画结束通过缓冲动作再次验证落点，随后复用入场与出场状态。按项目要求，地图跳跃跳过距离计费、库存灵魂检查及消耗，不调用普通跳跃的回声结算，不增加或结束其计数与计时器。实际传送后调用地图中心重置和镜头 `snap()`；地图动作不使用普通地面跳跃的地面目标 blocker 校验，当前裸海面和虚空仍不可落地。

动作被接受后，处理方通过请求事件的 `preventDefault()` 确认；地图保持打开，将自己的 `autopaused` 改为 `false`，通过 `game:map-state` 发布 `{ isOpen, autopaused }`。应用只在地图暂停原因发生变化时增减 `SetAutopaused` 的计数，不释放其他原因的暂停。地图打开期间继续屏蔽键盘移动。应用同时把 `isOpen` 传给世界光标的 `setWorldCovered()`：覆盖期间立即隐藏提示，逐帧刷新和显式提示更新都跳过 DOM 命中测试及世界动作查询；保留已有提示状态，关闭后立即重新命中并刷新。该状态独立于 `autopaused`，地图动作解除暂停后仍保持覆盖。连续地图动作和关闭地图不重复解除暂停，重新打开会重新登记地图暂停；请求未被接受时保留暂停。该行为对应 `MapScreen:OnControl()` 的 `SetAutopaused(false)` 及 `BLINK_MAP` 未设置 `closes_map`。

验证覆盖完整范围和空洞、按格的陆地光标与右键动作、拖动、地皮修改后只重建所触及的分块并重画、地皮素材与海洋底板、图标缩放与直立方向、DPR 与窗口调整、共享资源保留、绑定中断与资源释放、加载页等待、完整洞穴存档导出与重载。

## Lua 与原生投影依据

源码根目录为 `/data/copy/AssetArchive-Dev/data/DST/data/databundles/scripts_unpacked/scripts`：

- `widgets/mapwidget.lua:59` / `:67`：放大减小 `zoom`，缩小增大 `zoom`，限制 1～20；`:111` 的拖动系数为 `2/9`；`:129` 打开地图只重置偏移。
- `screens/mapscreen.lua:168`：光标锚定使用 `9 * zoom / delta` 换算偏移；`:1256` 的插值时长为 0.1 秒，键鼠每次缩放控制使目标增加 `target * sensitivity * direction / 60`。
- `playerprofile.lua:690`：默认地图缩放灵敏度为 15。浏览器将滚轮事件映射为一次缩放控制，向上取负方向、向下取正方向，零增量不操作。
- `prefabs/minimap.lua` 调用 `AddMiniMap()` 创建原生渲染器；Lua 的 `GetZoom()`、`WorldPosToMapPos()` 等直接转发给它，不在 Lua 中定义初始数值或投影矩阵。

为核对这部分，读取本地 `bin64/dontstarve_steam_x64.exe`，未修改或执行该程序。该文件 SHA-256 为 `824f43d32c463c7cd217f3fc81aeddf02e682b1d5c57e31f1ee8f1818ba4c105`。以下地址均为该版本的 RVA，可通过 `llvm-objdump -d --start-address=0x1400da760 --stop-address=0x1400da830 <exe>` 等命令复核：

- 组件初始化 `0x3CD87` 调用渲染器构造函数 `0xDA760`；`0xDA805` 在 `this + 0x70` 写入 `0x40400000`，即初始 `zoom = 3`。`GetZoom` 的实现 `0xD52D0` 读取同一字段。
- Lua `WorldPosToMapPos` 绑定 `0x733C0` 调用 `0xD7720`。`0xD7814` / `0xD7819` 读取该字段并除以常量 9（常量 RVA `0x52B888`），构造半宽为 `renderWidth * zoom / 9`、半高同理的正交投影。因此屏幕比例为每 DST 单位 `9 / (2 * zoom)` 像素，与 Lua 的拖动和光标偏移系数一致。

原生比例换算为项目单位是 `9 / (2 * WORLD_SCALE * zoom)`，其中 `WORLD_SCALE = TILE_SIZE / 4 = 3`。当前按地图尺寸需求调整绝对比例：`boundsSize = worldSize * (1 + 2 * 0.1)`，即地图每侧保留地皮范围边长 10% 的 margin；`MinimapView.scale = 1.5 * max(width, height) / boundsSize * 20 / zoom`。最远档 `zoom=20` 时，地图加 margin 构成的有限方形边长为窗口长边的 1.5 倍。中心限制按相机旋转后的视口半宽／半高计算，而不是只夹紧地图中心；平移、缩放、转向、定位和窗口调整后，视口四角都保持在该方形内。横屏和竖屏使用同一规则。地图不绘制世界边框。

初始 `zoom=3`、1～20 范围、反比例缩放及输入插值沿用源实现。打开时居中玩家，重新打开保留已有缩放并重置偏移。

常青树、桦树和月树在各自 `PrefabInstance.minimap` 声明图标，由 `packages/map` 订阅；模型卸载不移除图标，永久移除时注销。图标分别使用 `evergreen`、`tree_leaf`、`moon_tree` 的 `.png`、`_stump.png` 和 `_burnt.png`，按 Lua 设置优先级 `-1`。蘑菇树沿用原版对应图标和默认优先级；月树幼苗按 `planted_tree.lua` 不声明地图图标。`import-minimap-icons.py --check` 同时核对这些图标存在于原版图集。

## 2026-10-31 缩放性能

`Trace-20261031T195544.json.gz` 中滚轮事件通常约 0.1 ms；主要开销在 PrePaint（累计约 7.9 秒）和 Layerize（约 5.9 秒）。原 DOM 图标使用百分比定位，缩放时改变父容器宽高，即使背景共用图集仍会触发子元素布局、预绘制和合成更新。本机 1920×1080、Master 存档的 3,143 个树图标、160 帧相同缩放轨迹对照中，DOM 帧间隔中位数约 51 ms、P95 约 75 ms；仅屏外 DOM 裁剪后 P95 仍约 61 ms；Canvas 2D 最终实现（图标随地皮缩放且保持直立）中位数约 16.6 ms、重复测量 P95 约 17～23 ms。这些数值来自本机无头浏览器，不代表用户设备帧率。

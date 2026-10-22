# 世界地皮整图与 DOM 地图

游戏地图由 `packages/ui` 在主线程中维护：一张地面 PNG 与独立实体图标共用世界坐标容器。DOM 中没有地图 Canvas；底图由临时 `OffscreenCanvas` 直接合成像素，不使用 WebGL 渲染器，地图没有持续渲染循环或地图 Worker（地图没有海洋计算）。

`src/main.ts` 只注入 `TurfMap` 和格子尺寸。`TurfMap` 拥有地皮、八邻格变体、海洋及变更通知。`MinimapGroundImage` 负责图片生成、分辨率、解码、替换和生命周期，并通过不缓存总览的 `MinimapTerrainLayer`（`prepareInputs()` / `paintCells()`）按 32×32 格分块合成：再按源图层顺序绘制 `mini_*` 遮罩乘以世界坐标噪声的每格像素。海洋是底图：`packages/ui/scripts/render-minimap-ocean.mjs`（`--check` 校验）把 `minimap_paper.tex` 乘以 `EDGE_COLOR0` 渲染成无缝不透明的 `public/minimap/ocean.png`，`MinimapDomRenderer` 以 CSS 背景平铺（每张 32 格）铺满地皮范围及 10% margin，位于地面图下方；地面图的海洋格保持透明，运行时不再计算海岸线、阴影和海洋 Worker，海岸只有陆地遮罩自带的柔边。每个输出像素对应一个源纹素，不做相机重采样，因此保持原版地图的清晰边缘。图片左上为最小世界 X/Z；不将角色、建筑、昼夜光照或后处理烘焙到底图。


`createMinimapTilePainter()` 为每种地皮和每个分辨率持有一张 16×8 槽的 `OffscreenCanvas` 图集，按边缘变体与世界坐标的 8×8 噪声相位缓存最多 128 个预合成地皮块。首次命中某个组合时按原版 shader 的 RGB 相乘、保留遮罩 alpha 规则合成，上传到图集一次；后续直接通过 `drawImage()` 的源矩形绘制，缓存命中不再调用 `putImageData()`。缓存按最近使用顺序维护，满额时复用最久未使用的槽位，整块像素替换会清除旧轮廓的透明区域。返回的图集区域只供当前同步绘制使用，不跨任务保留；地皮更新与分块重绘继续复用同一个 painter，图层销毁时统一释放图集、遮罩和噪声缓存。已复制到地图块的像素不受槽位替换或图集释放影响。

图集和整图捕获用的分块在首次创建 2D context 时设置 `willReadFrequently: true`，让像素合成及 alpha 轮廓读取使用 CPU 画布，避免每块 `getImageData()` 都等待 GPU 并下载像素。独立对比页的总览／细节显示画布仍沿用默认路径。轮廓阈值、分辨率和地皮遮罩不变。

世界载入时，猪王布局通过 `TurfMap.setOriginalTiles()` 一次登记所有原始地皮；先保留存档覆盖，再比较有效格子，只有实际变化才重建并通知地图。完整导入存档已有最终地皮，因此这一步不重建世界或底图。水平地块的几何直接分配类型化顶点、UV 和索引数组并写入向上法线，省去临时数字数组及逐三角形法线计算；裁剪和八邻格遮罩规则保持一致。

`DstMinimapElement.prepareTerrain()` 等待整图合成、PNG 编码和图片解码。`src/main.ts` 的 `gameReady` 先等待这一步，再启动场景循环和首次渲染，因此加载页关闭前已有可用底图。图标只在打开地图后加载和采样。

每格像素数取 `ceil(1.5 * max(viewportWidth, viewportHeight) * DPR * 20 / 3 / 1.2 * 0.75 / 格数)`，以默认 `zoom=3` 的显示密度的 75% 采样，上限 32（源素材精度）且图片边长不超过 8192，因此边长是格数的整数倍。75% 系数应用于线性目标采样密度，之后才按每格整数像素及资源上限取整，最终图片边长不保证恰好缩小 25%；原先受资源上限限制的图片可能保持原尺寸。分块逐块合成并让出主线程，再写入同一张画布、编码并解码，DOM 仍只显示一个地皮 `<img>`。单份整图 RGBA 最多 256 MiB；这不是生成期间的总内存上限，编码画布、PNG 和新旧解码图片还有临时开销。世界坐标范围不决定像素数量，完整洞穴不会创建一张 25280×25280 的画布。

地皮变化合并到后续任务，等地皮更新完成后重新合成整张底图。窗口扩大时提升分辨率；缩放、平移、转向和窗口缩小复用已有图片，最大放大时可能模糊。旧图片保留到新图片解码完成，过期结果丢弃并释放 URL。再次调用准备会等待最新地皮和所请求分辨率；关闭地图保留图片，重新绑定、移除或显式销毁时清理订阅、任务、对象 URL 和 DOM 节点。地皮变化或销毁会中断过期整图的后续块；不注册页面离开清理。

`MinimapDomView` 为游戏和独立对比页提供同一套视口变换。平移只修改世界容器的 CSS 矩阵，不遍历图标。图标保持 32 CSS 像素屏幕宽度和朝向；缩放或相机转向只修改图标层 ShadowRoot 内的一条共享反向变换样式。浏览器仍需计算图标样式，不能将常数次 JS 写入等同于常数渲染成本。

陆地图生成时，每块像素的 alpha 以 128 为阈值提取轮廓，合并连续直线段，保留岛屿、内部孔洞及只在角点接触的独立区域；阈值以下的柔边不进入命中区。轮廓合为一个透明 SVG path，以 `fill-rule="evenodd"` 保留孔洞，通过 `pointer-events: fill` 交给浏览器命中。SVG 与陆地图具有相同的原点、尺寸和父容器变换，拖动、缩放、转向及 DPR 变化后仍对齐。陆地显示十字光标，海洋／透明处隐藏光标；左键拖动时显示抓取光标，定位按钮保留普通按钮光标。悬停不读取像素、不转换世界坐标，也不查询 `TurfMap`；这只是可见陆地的命中范围，不代表传送动作许可。地皮或分辨率变化后，待新图解码完成，在同一同步任务替换图片与轮廓；旧图与旧轮廓保留到替换时，销毁时一并释放。

图标读取 `MiniMapEntity` 的实时位置、启用状态和优先级，按实体身份复用节点。打开时立即采样，此后每 100ms 采样一次；仅变化的坐标、图标或顺序写入节点。图标从源 `minimap_data1.xml` / `minimap_data2.xml` 解析，按名称复用解码图片和 URL。

视口缩放沿用 MapScreen 的 0.1 秒插值，`zoom` 范围 1～20、默认 3，数值越小地图越大。输入起点和插值进度均采样 `performance.now()`，避免 RAF 帧时间戳早于输入导致负进度。连续输入从当前视口续接，光标下世界坐标保持锚定。只有缩放插值期间申请动画帧，关闭地图取消插值与实体采样。

右键原生命中的陆地轮廓时，地图才调用 `screenToWorld()` 转为 `Vector3`，发送可取消的 `game:map-action-request`；`src/main.ts` 将位置交给 `WortoxPlayer`，由现有 `BlinkActionController` 校验角色和真实陆地并缓冲 `BLINK_MAP`。动作没有普通跳跃的距离／寻路要求；预备动画结束通过缓冲动作再次验证落点，随后复用入场与出场状态。按项目要求，地图跳跃跳过距离计费、库存灵魂检查及消耗，不调用普通跳跃的回声结算，不增加或结束其计数与计时器。实际传送后调用地图中心重置和镜头 `snap()`；地图动作不使用普通地面跳跃的地面目标 blocker 校验，当前裸海面和虚空仍不可落地。

动作被接受后，处理方通过请求事件的 `preventDefault()` 确认；地图保持打开，将自己的 `autopaused` 改为 `false`，通过 `game:map-state` 发布 `{ isOpen, autopaused }`。应用只在地图暂停原因发生变化时增减 `SetAutopaused` 的计数，不释放其他原因的暂停。地图打开期间继续屏蔽键盘移动。应用同时把 `isOpen` 传给世界光标的 `setWorldCovered()`：覆盖期间立即隐藏提示，逐帧刷新和显式提示更新都跳过 DOM 命中测试及世界动作查询；保留已有提示状态，关闭后立即重新命中并刷新。该状态独立于 `autopaused`，地图动作解除暂停后仍保持覆盖。连续地图动作和关闭地图不重复解除暂停，重新打开会重新登记地图暂停；请求未被接受时保留暂停。该行为对应 `MapScreen:OnControl()` 的 `SetAutopaused(false)` 及 `BLINK_MAP` 未设置 `closes_map`。

`packages/map` 是旧地图素材和绘制方式的独立对比页，使用同一个 `MinimapTerrainLayer` 的总览／细节分块路径。

验证覆盖完整范围和空洞、alpha 轮廓的孔洞与角点、浏览器陆地／海洋命中与拖动、地皮修改后图片和命中区替换、地皮素材与海洋、图标交互、DPR 与窗口调整、共享资源保留、绑定中断与 URL 释放、加载页等待、完整洞穴存档导出与重载。

## Lua 与原生投影依据

源码根目录为 `/data/copy/AssetArchive-Dev/data/DST/data/databundles/scripts_unpacked/scripts`：

- `widgets/mapwidget.lua:59` / `:67`：放大减小 `zoom`，缩小增大 `zoom`，限制 1～20；`:111` 的拖动系数为 `2/9`；`:129` 打开地图只重置偏移。
- `screens/mapscreen.lua:168`：光标锚定使用 `9 * zoom / delta` 换算偏移；`:1256` 的插值时长为 0.1 秒，键鼠每次缩放控制使目标增加 `target * sensitivity * direction / 60`。
- `playerprofile.lua:690`：默认地图缩放灵敏度为 15。浏览器将滚轮事件映射为一次缩放控制，向上取负方向、向下取正方向，零增量不操作。
- `prefabs/minimap.lua` 调用 `AddMiniMap()` 创建原生渲染器；Lua 的 `GetZoom()`、`WorldPosToMapPos()` 等直接转发给它，不在 Lua 中定义初始数值或投影矩阵。

为核对这部分，读取本地 `bin64/dontstarve_steam_x64.exe`，未修改或执行该程序。该文件 SHA-256 为 `824f43d32c463c7cd217f3fc81aeddf02e682b1d5c57e31f1ee8f1818ba4c105`。以下地址均为该版本的 RVA，可通过 `llvm-objdump -d --start-address=0x1400da760 --stop-address=0x1400da830 <exe>` 等命令复核：

- 组件初始化 `0x3CD87` 调用渲染器构造函数 `0xDA760`；`0xDA805` 在 `this + 0x70` 写入 `0x40400000`，即初始 `zoom = 3`。`GetZoom` 的实现 `0xD52D0` 读取同一字段。
- Lua `WorldPosToMapPos` 绑定 `0x733C0` 调用 `0xD7720`。`0xD7814` / `0xD7819` 读取该字段并除以常量 9（常量 RVA `0x52B888`），构造半宽为 `renderWidth * zoom / 9`、半高同理的正交投影。因此屏幕比例为每 DST 单位 `9 / (2 * zoom)` 像素，与 Lua 的拖动和光标偏移系数一致。

原生比例换算为项目单位是 `9 / (2 * WORLD_SCALE * zoom)`，其中 `WORLD_SCALE = TILE_SIZE / 4 = 3`。当前按地图尺寸需求调整绝对比例：`boundsSize = worldSize * (1 + 2 * 0.1)`，即地图每侧保留地皮范围边长 10% 的 margin；`MinimapView.scale = 1.5 * max(width, height) / boundsSize * 20 / zoom`。最远档 `zoom=20` 时，地图加 margin 构成的有限方形边长为窗口长边的 1.5 倍。中心限制按相机旋转后的视口半宽／半高计算，而不是只夹紧地图中心；平移、缩放、转向、定位和窗口调整后，视口四角都保持在该方形内。横屏和竖屏使用同一规则。DOM 地图和独立对比页均不绘制世界边框。

初始 `zoom=3`、1～20 范围、反比例缩放及输入插值沿用源实现。打开时居中玩家，重新打开保留已有缩放并重置偏移。

常青树、桦树和月树由各自逻辑树持有 `MiniMapEntity`，通过实体注册表汇入地图；模型卸载不移除图标，永久移除时销毁。图标分别使用 `evergreen`、`tree_leaf`、`moon_tree` 的 `.png`、`_stump.png` 和 `_burnt.png`，按 Lua 设置优先级 `-1`。蘑菇树沿用原版对应图标和默认优先级；月树幼苗按 `planted_tree.lua` 不创建地图图标。`import-minimap-icons.py --check` 同时核对这些图标存在于原版图集。

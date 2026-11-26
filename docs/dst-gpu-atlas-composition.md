# 实例化精灵的 GPU 图集合成

开发约束见 [AGENTS.md](../AGENTS.md)。本文记录实例化渲染为什么在 GPU 上合成图集、参考了 Spine 运行时的哪些做法、没有采纳哪些，以及实现与测试要点。卡顿的测量过程和结果见 [tile lifecycle 中的"首次遍历地图的卡顿"](tile-lifecycle.md)。

## 问题

[instancedArchiveSprites.ts](../packages/animation/src/instancedArchiveSprites.ts) 要把"动画 × 外观"的每一帧预先合成成单个四边形，才能让实例共享一张贴图和一个单四边形几何。外观由 build、皮肤、符号覆盖和隐藏符号决定，所以必须在运行时合成，不能像普通图集那样离线打包。

原先的合成走 CPU 的 2D canvas：先把整张源贴图 `putImageData` 解码成 canvas，再逐帧 `drawImage`。真机上单次合成 40～300ms，发生在玩家第一次看到新外观的那一帧。

## 参考：Spine three.js 运行时

源码核对基于 [spine-runtimes 的 `4.3` 分支，提交 `9f7d44b725df`](https://github.com/EsotericSoftware/spine-runtimes/tree/9f7d44b725df0766b3995093cea8e7342faf9367)，范围为 `spine-ts/spine-threejs`、`spine-ts/spine-core` 与 `spine-ts/spine-webgl`。已借鉴缓冲复用、连续材质组和资源恢复的职责划分；GPU 图集合成本身是本项目为 DST 预录帧设计的路径。

| Spine 的做法 | 位置 | 对本项目的意义 |
| --- | --- | --- |
| 图集页离线打包，运行时直接把页面图片包成 `THREE.Texture`／`CanvasTexture` 上传，没有任何运行时 CPU 合成 | `ThreeJsTexture.ts` | 方向：不要让像素经过 CPU 的 2D canvas。我们的外观是运行时才确定的，所以不能照搬离线打包，只能把合成搬到 GPU |
| 预乘 alpha 贯穿：`texture.premultiplyAlpha = !pma`，材质用 `premultipliedAlpha: true` 和预乘混合 | `ThreeJsTexture.ts`、`SkeletonMesh.ts` | **采纳**：合成时各零件用预乘混合累积，避免半透明边缘出现暗边 |
| 去掉 `premultiplied_alpha_fragment` 与 `colorspace_fragment`，贴图不设颜色空间，整条链路在原始值上混合 | `MeshBatcher.ts` | **未采纳**，见下文"没有采纳的部分" |
| 每个 skeleton 复用一组有容量上限的动态网格，按"贴图 × 混合模式"的连续材质组绘制，保持插槽顺序 | `MeshBatcher.ts`（`findMaterialGroup`、`addMaterialGroup`）、`SkeletonMesh.ts`（`nextBatch`） | **采纳**：合成保留源图层顺序，临时网格跨帧／页复用；实例批次按容量从场景的空闲池复用 |
| 预分配顶点／索引数组，`begin()` 重置有效长度，`end()` 用 `addUpdateRange()` 和 `drawRange` 提交有效区间；容量不足时换下一批 | `MeshBatcher.ts`、`PolygonBatcher.ts` | **采纳**：合成任务按容量复用 geometry、数组和材质，预建索引、只上传有效区间；不替换普通精灵已有的不可变共享帧缓存 |
| Worker 分支用 `createImageBitmap(..., { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })`，浏览器主线程分支使用 `Image` | `AssetManagerBase.ts`（`loadTexture`） | 本项目的源贴图是 KTEX，已在 Worker 里解码成 `Uint8Array`（`texture.worker.ts`），继续使用现有解码路径 |
| 同路径加载共用 Promise，纹理／atlas 的释放包装使用共享缓存的引用计数 | `AssetManagerBase.ts`（`reuseAssets`、`disposeAssetInternal`、`createTexture`） | 本项目已按 URL 共享解码请求，由 `ArchiveSpriteAssets` 统一拥有 GPU 资源；保留当前所有权，跨 owner 共享 GPU 纹理时才需要另行设计引用计数 |
| GPU 资源登记为 `Restorable`，上下文恢复后重新上传纹理和重建 buffer，释放时注销 | `spine-webgl/WebGL.ts`、`GLTexture.ts`、`Mesh.ts` | **采纳职责划分**：由现有资源所有者监听上下文丢失／恢复、取消旧任务并重排当前外观；render target 图集由源数据重新合成 |

关键源码：[MeshBatcher.ts](https://github.com/EsotericSoftware/spine-runtimes/blob/9f7d44b725df0766b3995093cea8e7342faf9367/spine-ts/spine-threejs/src/MeshBatcher.ts)、[SkeletonMesh.ts](https://github.com/EsotericSoftware/spine-runtimes/blob/9f7d44b725df0766b3995093cea8e7342faf9367/spine-ts/spine-threejs/src/SkeletonMesh.ts)、[AssetManagerBase.ts](https://github.com/EsotericSoftware/spine-runtimes/blob/9f7d44b725df0766b3995093cea8e7342faf9367/spine-ts/spine-core/src/AssetManagerBase.ts)、[WebGL.ts](https://github.com/EsotericSoftware/spine-runtimes/blob/9f7d44b725df0766b3995093cea8e7342faf9367/spine-ts/spine-webgl/src/WebGL.ts)。

## 实现

入口为 [rgbaSpriteAtlas.ts](../packages/animation/src/rgbaSpriteAtlas.ts) 的 `createResolvedRgbaSpriteAtlasComposer(animation, frames, maxTextureSize, renderer?)`。传入渲染器且支持浮点渲染时走 GPU 路径，否则走 CPU 路径。同步入口 `composeResolvedRgbaSpriteAtlases` 与 `composeRgbaSpriteAtlas` 不变，仍返回 canvas 图集。

### 页布局

`layoutAtlasPage` 为两条路径共用：为每帧计算像素尺寸和在网格页中的格子（`atlasX`、`atlasY`），并返回页尺寸；`atlasResult` 统一生成 `RgbaSpriteAtlas` 与每帧的 UV。两条路径因此产出相同的帧布局，实例化批次不区分图集来自哪条路径。

### GPU 页合成（`composeGpuPageSteps`）

每个图集页分以下步骤，每步之间 `yield`，由合成器按预算推进：

1. **上传源贴图。** 对页内用到、当前任务尚未上传的每张源贴图调用 `renderer.initTexture`，每张一步；它是不可再切的主线程调用，同一任务的其他页复用上传结果。
2. **清除累积目标。** 累积目标为 `HalfFloatType` 的 `WebGLRenderTarget`，不带深度，最近邻采样。
3. **逐帧绘制。** `GpuAtlasScratch` 在同一任务内跨帧和跨页复用 geometry、顶点／UV 数组和预建索引。零件材质与全屏 resolve 通道属于每个渲染器一份的 `GpuAtlasMaterials`，所有任务共用且不释放：Three.js 在程序的最后一个材质释放时删除该程序，按任务创建／释放材质会让每个新外观重新编译两个着色器，在 Windows ANGLE 上即 GPU 进程内的 D3D 编译；进入新区域时大量外观同时合成，曾与纹理上传叠加导致 GPU 进程崩溃。任务在多帧间交错推进，因此 `map` 与页尺寸 `size` 只在同步绘制前写入当前任务的值，绘制后清空，不让共享材质持有任何任务的源贴图或目标。容量不足时按二次幂扩展（不超过现有 16 位索引限制），扩展前释放旧 GPU 缓冲；每帧重建连续 groups，更新 `drawRange`，只提交有效写入区间并合并未消费更新。每帧把各零件按源 z 顺序画成带 UV 的四边形：
   - 顶点位置为零件变换后的页内像素坐标，公式与原 canvas 的 `setTransform` 一致：`(a·x + c·y + tx − minX)·scale + atlasX`，`y` 同理。
   - UV 取 `bbx／canvasWidth`、`bby／canvasHeight` 一类的归一化矩形，与普通精灵网格采样的范围一致；源贴图 `flipY = false`，行从上到下存放，所以 `v` 直接取行号除以高度。
   - 同一帧内连续使用同一源贴图的零件合成一个几何组，不同贴图交错时分成多组，保持图层顺序。
   - 着色器以 `CustomBlending`（`ONE`、`ONE_MINUS_SRC_ALPHA`）输出预乘颜色 `(rgb·a, a)`，关闭深度测试与写入，`DoubleSide`，用顶点着色器按页尺寸把像素坐标映射到裁剪空间，不依赖相机。
4. **取消预乘并输出。** 一个全屏通道读取累积目标，输出 `rgb／a`（`a = 0` 时输出 0），写入最终目标。

最终目标是 `colorSpace = SRGBColorSpace` 的 `UnsignedByte` 渲染目标，因此以 `SRGB8_ALPHA8` 存储。源贴图同为 sRGB，采样时由硬件解码到线性，各零件在线性空间混合，写入最终目标时硬件再编码回 sRGB。这与原 `CanvasTexture`（sRGB，直通 alpha）的使用方式一致，**实例化材质、`dstLighting` 和深度预通道不需要修改**。

### 渲染器状态与统计

`withRendererState` 在每次合成绘制前后保存并恢复渲染目标、活动立方体面与 mipmap 级、`autoClear`、清除色与透明度，以及 `info.render` 的 calls／triangles／lines／points 和 `info.autoReset`。合成不计入外部 draw call 统计。**不能回退 `info.render.frame`**：Three.js 的 `WebGLObjects` 用这个内部帧编号判断 geometry 本次渲染是否已上传；回退编号会使复用缓冲的后续帧跳过上传，表现为荧光花等动画只有首帧有内容、随后闪烁。

### 生命周期

合成任务的 `cancel()` 显式关闭生成器，释放当前页的累积目标、未交付的最终目标及之前已完成但尚未交付的页；异常走相同的 `finally` 清理。任务结束时统一释放 `GpuAtlasScratch` 的几何体；共享材质随渲染器保留，上下文恢复后由 Three.js 重新编译。正常完成后，页的所有权交给调用方，后续 `cancel()` 不再释放这些页；最终纹理监听 `dispose` 并释放 render target，因此 `InstancedArchiveSprites` 统一调用 `atlas.texture.dispose()` 即可。已取消的任务不可继续推进。

### 回退

`canComposeAtlasOnGpu` 要求 `EXT_color_buffer_float` 或 `EXT_color_buffer_half_float`。缺少时回退到 CPU 路径：源贴图按行块（约 52 万像素）分步解码，解码结果缓存在模块级 `WeakMap` 中，按源贴图复用，不再每次合成重复解码。

### 分帧推进

外观首次请求只快照 animation／build／skin／符号覆盖／隐藏配置，不同步解析整个动画，也不让缓存闭包保留首个请求实体的私有材质或控制器。合成器按源帧懒解析、计算边界及密度，每帧后 `yield`，全部帧布局完成后仍统一使用全 clip 的边界和像素网格。解析结果缓存供上下文恢复复用。

合成器的 `step(budgetMs)` 每次至少推进一步，超过预算后停止，剩余留到下一帧。`InstancedArchiveSprites` 在外观第一次 `show` 时入队，每帧用 `COMPOSE_BUDGET_MS` 推进；尚未完成的外观沿用上一个已完成的外观绘制；加载界面的 `prewarm` 不受预算限制。详见 tile lifecycle 一节。

## 没有采纳的部分

Spine 去掉 `premultiplied_alpha_fragment` 与 `colorspace_fragment`，让预乘贴图在原始值上直接混合并输出。本项目没有照做：

- 实例化材质输出进入 `dstLighting` 的线性渲染目标，之后才统一编码；去掉颜色空间转换会让实例化精灵与普通精灵的色彩不一致，并影响深度预通道的 alpha 测试。
- 这样做的代价是多一个全屏取消预乘通道（每页平均约 4ms，最大约 9ms）。
- 若以后要去掉这个通道，需要同时修改实例化材质与光照输出路径，并重新验证所有实例化对比测试。目前该通道不是瓶颈，不建议为此改动。

## 已知限制

- 源贴图首次 `initTexture` 仍是一次主线程调用，最大约 10ms。
- 图集页的半浮点累积目标在合成期间占用显存，页尺寸最大 `min(4096, maxTextureSize)`，合成完成立即释放。
- 合成后的页按"帧数 × 单帧尺寸"增长，零件跨帧复用的好处全部失去。长循环的大幅美术不适合实例化：`oceanvine_deco` 的 6 个 72 帧循环合成后约 5.7 GB，导致加载时 GPU 进程内存不足，见 [GPU 进程 OOM 案例](gpu-process-oom.md)。
- 重采样质量与 canvas 的 `imageSmoothingQuality = 'high'` 不同：GPU 使用源贴图自身的线性过滤，没有 mipmap。当前对比测试的平均误差仍小于 2，但缩放比例明显小于 1 的动画需要重新核对。

## 实例批次复用与上下文恢复

每个场景保留活动页批次和空闲批次池。外观切换或离屏使某页不再绘制时，将其批次计数归零、从场景摘除并放回池中，避免 Three.js 继续遍历／准备零实例网格；没有活动页时隐藏批次组锚点，后续可见实体的注册会重新驱动 pass。新页选择容量足够的最小空闲批次，替换图集与源颜色，复用 geometry、实例属性及深度／颜色材质。只有没有足够容量的空闲批次时才创建新批次，增长前的旧批次也归池；单实体移除不释放共享批次，资源所有者销毁时统一释放活动及空闲批次。

`InstancedArchiveSprites` 首次使用时绑定 renderer 的上下文事件。丢失时取消未完成任务、释放旧页和批次，清除完成外观引用并只为当前实体请求的外观重新排队；丢失期间停止合成和实例更新。Three.js 完成恢复后，后续渲染按原预算重新合成，`flush()`／预热可显式完成。源帧数据、实体身份、脚点、当前动画和帧、私有颜色及组件状态保持原所有者，不创建新的领域实体。绑定到另一个 renderer 时也先使旧 GPU 图集失效；显式资源销毁时解除上下文监听。

结构性验证已确认跨页缓冲复用及外观间批次复用；尚未重新测量真机首次遍历地图的整体耗时，不能从分配次数减少推算帧率提升。单次贴图上传、shader 编译和 resolve 仍可能超出软预算，继续通过 `step:next` 的最大单步时间定位。

普通动态 sprite 的 `SpriteFrameRenderer` 已按容量复用缓冲，普通共享帧已通过 `FrameGeometryCache` 换帧复用，不能将 Spine 每次更新重写骨骼网格的方式整体套用到这些路径。其 `addUpdateRange()` 思路可用于仍需重写的私有缓冲；多个未消费更新区间必须保留，不能因后一次写入丢弃前一次更新。

## 按零件实例化（零件表）

合成页的成本是"帧数 × 整个 clip 的格子"，帧多、格子大的外观每个实体要几十到上百 MB（见 `analysis/instanced-mesh-vram-n100.md`：Caves 中常青树三个摇摆循环共 411 MB）。零件表让这类外观不经合成，直接从 build 图集逐零件绘制：

- [instancedPartTable.ts](../packages/animation/src/instancedPartTable.ts) 的 `createInstancedPartTable(animation, resolve)` 用与普通合并帧几何相同的 `ResolvedSprite`（零件矩阵、图片位置、UV）生成一张 RGBA32F `DataTexture`：每个（帧, 槽）一行 3 个纹素，依次是单位四边形的 2×2 矩阵、平移／贴图号／符号光照覆盖、UV 矩形，每行 48 字节。槽数取各帧零件数的最大值，零件少的帧把多余的槽填 0（退化四边形，不产生片元）。所有帧共用整个 clip 的包围矩形，与合成页的帧一致，裁剪不因换帧重算。零件引用超过 4 张贴图（`MAX_PART_TEXTURES`）或某个零件没有贴图时返回 `undefined`，由调用方继续合成。表还记下合成这个外观要占的字节（`composedBytes`：帧数 × 按源纹素密度取整的整 clip 格子加 2 纹素边框 × 4）。
- [instancedPartMaterial.ts](../packages/animation/src/instancedPartMaterial.ts) 的 `InstancedPartMaterial` 仍是透明、不写深度的 `MeshBasicMaterial`，世界光照和海面着色按原方式修补。每个实例是一个实体的一个槽（实例号 = 实体 × 槽数 + 槽）：顶点着色器用 `texelFetch` 取该槽在实例当前帧（`partFrame` 属性）的一行，放置四边形并给出 UV；片元着色器按贴图号在 `map`／`partMap1..3` 中采样，BC 预乘页按 `PREMULTIPLIED_SRGB_TEXEL` 解码。程序固定编译 4 个分支，换表不重新编译（世界光照修补材质时只取一次缓存键）。
- `InstancedSpriteBatches` 的段键改为 `BatchPage`（合成页或零件表）。零件表批次的实例数为实体数 × 槽数，实体的矩阵、颜色、透明度、光照、侵蚀和海面参数写到它的每个槽，零件位置由表决定；换帧只写各槽的 `partFrame`。空闲批次只在同类之间复用，复用时重写全部实例。
- 绘制顺序：实例按"实体由远到近、槽按源 z 顺序"排列，GPU 按实例顺序混合，与普通 billboard 的零件顺序一致。与合成页相比，零件直接采样源图集，只经一次过滤；同一合成夹具下两者的平均误差约 0.5／255，差异集中在不透明零件相互重叠的边缘（合成把零件对齐到格子）。
- 分流：`InstancedSpriteAtlases.step()` 轮到一个新外观时先生成它的零件表（合成本来就要解析每一帧，解析结果缓存在外观上，合成时复用）。`composedBytes` 达到 16 MB（`PART_TABLE_COMPOSED_BYTES`）的外观直接以零件表绘制，不创建合成器；其余丢弃零件表（它从未上传）后照常合成。外观的 `locations` 统一给出每帧的 `BatchPage` 与帧（合成页的格子或零件表的帧），绘制、裁剪（`SpriteFrameBounds`）和批次不区分两者；零件表与合成页一起参与闲置释放、上下文丢失时的失效和释放。
- 效果（`analysis/instanced-mesh-vram-n100.md`，n100）：Master 的合成页从 407 MB 降到 91 MB，Caves 从 799 MB 降到 28 MB；改走零件表的 3／11 个外观原本要 308 MB／739 MB 合成页，零件表合计 260 KB／340 KB。GPU 进程 RSS 峰值从 1.39／2.08 GB 降到 0.76／0.71 GB。

## 合成外观的释放

`InstancedSpriteAtlases` 按外观 key 缓存合成页。外观在有实体显示（`entry.appearance`）或仍在绘制（`entry.ready`）时算作在用，在用的外观不释放。

- **一闪而过的状态不合成：** 合成按首次请求顺序排队；轮到时已没有实体显示或绘制它（例如生成过程中先显示、同一帧又换掉的外观），就直接出队，不创建合成器。再次显示会重新排队。
- **没人用的合成页按预算释放：** 实例批次每秒检查一次。连续 10 秒（`RELEASE_UNUSED_AFTER_MS`）无人使用、且全部闲置外观的合成页合计超过 256 MB（`UNUSED_PAGE_BUDGET_BYTES`）时，从闲置最久的开始释放，直到闲置页回到预算内；没有页的闲置记录 10 秒后直接删除。释放后再显示的外观在重新合成完成前不绘制，所以不在实体刚睡眠时立即释放。
- 效果（`scripts/instanced-atlas-memory.mjs`，默认 Caves 存档）：常青树三种积雪状态各合成一份 `sway1_loop_tall` 的情况消失，合成页从 2265 MB 降到 799 MB，146 个只在生成过程中出现过的外观不再合成；稳定后合成队列为空，说明在用的外观都已绘制。

## 源图集内存

build 图集由 worker 读出，同时生成每纹素 1 bit 的拾取覆盖掩码（`alphaMask.ts`）。主 renderer 支持 `WEBGL_compressed_texture_s3tc`／`_srgb` 且能走 GPU 合成时（`atlasFormat.ts` 的 `configureAtlasCompression()`，在 `src/universal.ts` 创建 renderer 后调用），场景 sprite 的 build（`ArchiveSpriteAssets`、符号／build 覆盖、预加载）把 DXT1/3/5 页保留为 BC 块，以 `CompressedTexture` 原样上传，显存为 RGBA 的 1/8（DXT1）或 1/4（DXT3/5）；其余页（非 BC、宽高不是 4 的倍数）和 UI 读取的 build 仍解码为 RGBA，两种形式分开缓存。BC 块在 worker 中按块行与块内 4 行翻转成与解码 RGBA 相同的布局，alpha 只解 alpha 通道。DXT3/5 的颜色是预乘的：这些页不走采样器的 sRGB 解码，按线性格式上传，由 `AtlasSpriteMaterial`（编译钩子是方法，克隆的着色／bloom 材质同样生效）和 GPU 合成的部件着色器先除以 alpha 再做 sRGB 解码；过滤因此在预乘空间进行，缩小采样时边缘比 RGBA 路径少一圈透明黑色的混入。压缩页没有 RGBA，CPU 合成回退不会用到它们。`createAtlasTexture()` 为每个图集按过滤方式共享一个 Three.js `Source`，同一图集的所有纹理在 renderer 内只有一份 GPU 拷贝，引用计数和释放仍由 Three.js 与各所有者的 `dispose()` 负责。带数据的上传完成后（`onUpdate`）丢弃 CPU 端 RGBA 或 BC 块，只保留覆盖掩码供 `spriteRaycast.ts` 拾取；无法从动画包重新解码（非 loader 加载）或没有 alpha 的图集保留 RGBA。

之后需要新的 GPU 拷贝时（上下文恢复、新的过滤方式），Three.js 以 `dataReady = false` 分配空纹理并调用 `onUpdate`，由 loader 按记录的动画包和形式重新读取该页（同一 build 的多页共享一次读取），完成后标记共享该 `Source` 的全部纹理更新，上传后再次释放。期间普通 sprite 暂时透明；GPU 合成通过 `prepareAtlasTexture()` 等待像素就绪，CPU 回退通过 `atlasTexturePixels()` 取像素，合成器在等待时让出本帧，不会把空白源合成进缓存页。同步的 `composeResolvedRgbaSpriteAtlases()`／`composeRgbaSpriteAtlas()` 遇到已释放图集直接报错；UI 中 CPU 绘制的 build（世界时钟、理智暗角）用 `atlasPixels()` 读取，这些 build 不经 `createAtlasTexture()` 上传，RGBA 不会被释放。`atlasReloadsSettled()` 供测试等待重新解码完成。build 图集只由一个 renderer 绘制。

一直没有上传的页不会触发上传后的释放：远处或睡眠实体的美术加载后可能长时间不绘制。页的第一个纹理创建后 30 秒（`RELEASE_UNDRAWN_ATLAS_MS`）仍未上传，就同样释放 RGBA 或 BC 块（需要能重新读取且有 alpha 掩码）；首次上传时走上面的重新读取流程，读取完成前该页透明。加载时视野内的美术在预热中已上传，不受影响。

地形层、悬崖和海面的 KTEX 在构建地形时每批解码至多四张，上传后再开始下一批。场景预热与地形共用上传入口，每帧按 16 MiB 和 8 ms 的软预算让出加载画面，超预算的单张纹理单独上传。GPU 独占的 KTEX 像素和 CPU 读取者分别解码，上传后清除像素引用，支持 `ArrayBuffer.transfer()` 时同时释放原缓冲区。上下文恢复触发重新解码时，预热等待原像素回填并再次上传。

## 测试

- 单元测试 `packages/animation/tests/rgbaSpriteAtlas.test.ts`：分步合成器逐帧推进，结果与同步合成一致（CPU 路径）。`rgbaSpriteAtlasLifecycle.test.ts` 验证懒解析、跨页几何／索引复用、交错材质组、有效区间、渲染器统计与状态保持，多页中途取消／绘制失败时的资源释放，以及交错任务共用同一组不释放的合成材质且各自绘制时读到自己的贴图与页尺寸。`atlasRelease.test.ts` 验证源图集共享 `Source`、上传后释放 RGBA、释放后 alpha 拾取不变，以及无数据 GPU 拷贝触发的重新解码与再次释放；压缩 build 的同一流程（上传 BC 块、释放、只靠 alpha 拾取、重新读回 BC 块）以及克隆材质保留预乘解码。`parseKtex.test.ts` 验证 BC1–3 块翻转后解码与 RGBA 路径逐像素一致、alpha-only 解码与 RGBA 的 alpha 一致。
- 浏览器测试 `packages/ui/tests/tree-sprite.spec.ts` 与 `trees.spec.ts`：实例化的杂木与桦树帧与普通渲染逐像素对比（平均误差小于 2），覆盖层顺序、符号覆盖、隐藏符号、着色保持私有、砍伐后恢复以及 draw call 数。`tree-sprite.spec.ts` 中常青树 `sway1_loop_tall`（合成要 200 MB 以上）经零件表绘制，两帧与普通 sprite 对比（当前平均误差为 0），并确认它由一个零件批次绘制。单元测试 `instancedArchiveSprites.test.ts` 覆盖分流：大外观不合成、按槽绘制，小外观仍合成。测试夹具在对比前调用 `flush(renderer)`，保证新外观已合成完。
- 这些测试环境支持浮点渲染，实例化对比走 GPU 路径；CPU 单测使用模拟 canvas 验证布局与分步调用。当前尚无同一像素夹具强制走 GPU／CPU 两路的直接对比，不能将已有测试视为两路逐像素一致的证明。
- 浏览器测试 `packages/ui/tests/atlas-lifecycle.spec.ts` 使用真实荧光花：多个动画帧均有绘制内容、脚点位置保留、前景误差受控，`idle → off → idle` 复用同一实例批次；首次绘制后源图集 RGBA 已释放；真实 `WEBGL_lose_context` 丢失／恢复后，首次绘制触发重新解码，等待 `atlasReloadsSettled()` 后图集重建，图像与恢复前一致。恢复调用放在丢失事件完成派发后的宏任务中。实体移出视野后空闲网格退出场景，回到视野时仍复用原批次且图像一致。
- 后续可补强制 CPU／GPU 的同夹具像素对照与缩小采样质量验证；保留原有普通 sprite 对照，不以全画面平均值代替前景与边缘检查。

## 性能埋点

[spritePerf.ts](../packages/animation/src/spritePerf.ts) 默认关闭，URL 加 `?perf` 启用，控制台读取 `__spritePerf.summary()`。普通模式增量累计 count／total／max，不调用 `performance.measure()` 或逐次输出慢帧警告，避免诊断本身占用渲染热路径；`?perf=trace` 才为每次调用生成 User Timing 标记。明细最多保留 4096 条、按时间返回；准备阶段与慢渲染保留明细，普通快速 `render` 每 60 次采样一条，汇总仍覆盖全部调用。开始同一采样区间前调用 `__spritePerf.clear()`；异步 `preload` 是包含等待的墙钟时间，嵌套阶段不能相加，`render.count` 是 manager pass 调用数而非游戏帧数。GPU 路径的阶段为 `step:gpu-upload`、`step:gpu-frame`、`step:gpu-resolve`；合成器每次推进的单步为 `step:next`；游戏中的分步合成为 `compose`，加载界面为 `compose:prewarm`，`flush` 为 `compose:flush`。同一场景的前后对比见 tile lifecycle 文档。

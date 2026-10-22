# 实例化精灵的 GPU 图集合成

开发约束见 [AGENTS.md](../AGENTS.md)。本文记录实例化渲染为什么在 GPU 上合成图集、参考了 Spine 运行时的哪些做法、没有采纳哪些，以及实现与测试要点。卡顿的测量过程和结果见 [tile lifecycle 中的"首次遍历地图的卡顿"](tile-lifecycle.md)。

## 问题

[instancedArchiveSprites.ts](../packages/animation/src/instancedArchiveSprites.ts) 要把"动画 × 外观"的每一帧预先合成成单个四边形，才能让实例共享一张贴图和一个单四边形几何。外观由 build、皮肤、符号覆盖和隐藏符号决定，所以必须在运行时合成，不能像普通图集那样离线打包。

原先的合成走 CPU 的 2D canvas：先把整张源贴图 `putImageData` 解码成 canvas，再逐帧 `drawImage`。真机上单次合成 40～300ms，发生在玩家第一次看到新外观的那一帧。

## 参考：Spine three.js 运行时

参考 [spine-runtimes](https://github.com/EsotericSoftware/spine-runtimes) 的 `spine-ts/spine-threejs` 与 `spine-ts/spine-core`。

| Spine 的做法 | 位置 | 对本项目的意义 |
| --- | --- | --- |
| 图集页离线打包，运行时直接把页面图片包成 `THREE.Texture`／`CanvasTexture` 上传，没有任何运行时 CPU 合成 | `ThreeJsTexture.ts` | 方向：不要让像素经过 CPU 的 2D canvas。我们的外观是运行时才确定的，所以不能照搬离线打包，只能把合成搬到 GPU |
| 预乘 alpha 贯穿：`texture.premultiplyAlpha = !pma`，材质用 `premultipliedAlpha: true` 和预乘混合 | `ThreeJsTexture.ts`、`SkeletonMesh.ts` | **采纳**：合成时各零件用预乘混合累积，避免半透明边缘出现暗边 |
| 去掉 `premultiplied_alpha_fragment` 与 `colorspace_fragment`，贴图不设颜色空间，整条链路在原始值上混合 | `MeshBatcher.ts` | **未采纳**，见下文"没有采纳的部分" |
| 一个动态网格，按"贴图 × 混合模式"的连续材质组绘制，保持插槽顺序 | `MeshBatcher.ts`（`findMaterialGroup`、`addMaterialGroup`） | **采纳**：合成时连续使用同一源贴图的零件合并为一次绘制，不同贴图交错时仍保持 z 顺序 |
| 用 `createImageBitmap(..., { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })` 解码，不占主线程 | `AssetManagerBase.ts` | 本项目的源贴图是 KTEX，已经在 Worker 里解码成 `Uint8Array`（`texture.worker.ts`），不适用 |
| 同路径加载共用一个 Promise，释放时仅在无人使用时才真正释放 | `AssetManagerBase.ts` | `textureLoader.ts` 已按 URL 缓存在途请求，无需改动 |

## 实现

入口为 [rgbaSpriteAtlas.ts](../packages/animation/src/rgbaSpriteAtlas.ts) 的 `createResolvedRgbaSpriteAtlasComposer(animation, frames, maxTextureSize, renderer?)`。传入渲染器且支持浮点渲染时走 GPU 路径，否则走 CPU 路径。同步入口 `composeResolvedRgbaSpriteAtlases` 与 `composeRgbaSpriteAtlas` 不变，仍返回 canvas 图集。

### 页布局

`layoutAtlasPage` 为两条路径共用：为每帧计算像素尺寸和在网格页中的格子（`atlasX`、`atlasY`），并返回页尺寸；`atlasResult` 统一生成 `RgbaSpriteAtlas` 与每帧的 UV。两条路径因此产出相同的帧布局，实例化批次不区分图集来自哪条路径。

### GPU 页合成（`composeGpuPageSteps`）

每个图集页分以下步骤，每步之间 `yield`，由合成器按预算推进：

1. **上传源贴图。** 对页内用到的每张源贴图调用 `renderer.initTexture`，每张一步；它是不可再切的主线程调用。
2. **清除累积目标。** 累积目标为 `HalfFloatType` 的 `WebGLRenderTarget`，不带深度，最近邻采样。
3. **逐帧绘制。** 每帧把各零件按源 z 顺序画成带 UV 的四边形：
   - 顶点位置为零件变换后的页内像素坐标，公式与原 canvas 的 `setTransform` 一致：`(a·x + c·y + tx − minX)·scale + atlasX`，`y` 同理。
   - UV 取 `bbx／canvasWidth`、`bby／canvasHeight` 一类的归一化矩形，与普通精灵网格采样的范围一致；源贴图 `flipY = false`，行从上到下存放，所以 `v` 直接取行号除以高度。
   - 同一帧内连续使用同一源贴图的零件合成一个几何组，不同贴图交错时分成多组，保持图层顺序。
   - 着色器以 `CustomBlending`（`ONE`、`ONE_MINUS_SRC_ALPHA`）输出预乘颜色 `(rgb·a, a)`，关闭深度测试与写入，`DoubleSide`，用顶点着色器按页尺寸把像素坐标映射到裁剪空间，不依赖相机。
4. **取消预乘并输出。** 一个全屏通道读取累积目标，输出 `rgb／a`（`a = 0` 时输出 0），写入最终目标。

最终目标是 `colorSpace = SRGBColorSpace` 的 `UnsignedByte` 渲染目标，因此以 `SRGB8_ALPHA8` 存储。源贴图同为 sRGB，采样时由硬件解码到线性，各零件在线性空间混合，写入最终目标时硬件再编码回 sRGB。这与原 `CanvasTexture`（sRGB，直通 alpha）的使用方式一致，**实例化材质、`dstLighting` 和深度预通道不需要修改**。

### 渲染器状态与统计

`withRendererState` 在每次合成绘制前后保存并恢复渲染目标、活动立方体面与 mipmap 级、`autoClear`、清除色与透明度，以及 `info.render` 的计数和 `info.autoReset`。合成发生在场景绘制前的 pass 里，不能改变外部状态，也不能计入测试用的 draw call 统计。

### 生命周期

累积目标、临时材质、几何体与全屏通道在完成后（含异常路径）释放。最终目标的 `texture` 上监听 `dispose` 事件并释放目标，因此 `InstancedArchiveSprites` 释放图集时调用 `atlas.texture.dispose()` 即可。

### 回退

`canComposeAtlasOnGpu` 要求 `EXT_color_buffer_float` 或 `EXT_color_buffer_half_float`。缺少时回退到 CPU 路径：源贴图按行块（约 52 万像素）分步解码，解码结果缓存在模块级 `WeakMap` 中，按源贴图复用，不再每次合成重复解码。

### 分帧推进

合成器的 `step(budgetMs)` 每次至少推进一步，超过预算后停止，剩余留到下一帧。`InstancedArchiveSprites` 在外观第一次 `show` 时入队，每帧用 `COMPOSE_BUDGET_MS` 推进；尚未完成的外观沿用上一个已完成的外观绘制；加载界面的 `prewarm` 不受预算限制。详见 tile lifecycle 一节。

## 没有采纳的部分

Spine 去掉 `premultiplied_alpha_fragment` 与 `colorspace_fragment`，让预乘贴图在原始值上直接混合并输出。本项目没有照做：

- 实例化材质输出进入 `dstLighting` 的线性渲染目标，之后才统一编码；去掉颜色空间转换会让实例化精灵与普通精灵的色彩不一致，并影响深度预通道的 alpha 测试。
- 这样做的代价是多一个全屏取消预乘通道（每页平均约 4ms，最大约 9ms）。
- 若以后要去掉这个通道，需要同时修改实例化材质与光照输出路径，并重新验证所有实例化对比测试。目前该通道不是瓶颈，不建议为此改动。

## 已知限制

- 渲染目标在 WebGL 上下文丢失后内容不会自动恢复；原 `CanvasTexture` 会自动重新上传。尚未实现丢失后重新合成。
- 源贴图首次 `initTexture` 仍是一次主线程调用，最大约 10ms。
- 图集页的半浮点累积目标在合成期间占用显存，页尺寸最大 `min(4096, maxTextureSize)`，合成完成立即释放。
- 重采样质量与 canvas 的 `imageSmoothingQuality = 'high'` 不同：GPU 使用源贴图自身的线性过滤，没有 mipmap。当前对比测试的平均误差仍小于 2，但缩放比例明显小于 1 的动画需要重新核对。

## 测试

- 单元测试 `packages/animation/tests/rgbaSpriteAtlas.test.ts`：分步合成器逐帧推进，结果与同步合成一致（CPU 路径）。
- 浏览器测试 `packages/ui/tests/tree-sprite.spec.ts` 与 `trees.spec.ts`：实例化的杂木与桦树帧与普通渲染逐像素对比（平均误差小于 2），覆盖层顺序、符号覆盖、隐藏符号、着色保持私有、砍伐后恢复以及 draw call 数。测试夹具在对比前调用 `flush(renderer)`，保证新外观已合成完。
- 这些测试环境支持浮点渲染，走的是 GPU 路径；不支持的环境走回退路径，两者的合成结果应一致。

## 性能埋点

[spritePerf.ts](../packages/animation/src/spritePerf.ts) 默认关闭，URL 加 `?perf` 启用，控制台读取 `__spritePerf.summary()`。GPU 路径的阶段为 `step:gpu-upload`、`step:gpu-frame`、`step:gpu-resolve`；合成器每次推进的单步为 `step:next`；游戏中的分步合成为 `compose`，加载界面为 `compose:prewarm`，`flush` 为 `compose:flush`。同一场景的前后对比见 tile lifecycle 文档。

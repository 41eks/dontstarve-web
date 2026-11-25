# 案例：加载时 GPU 进程内存不足（oceanvine_deco 的实例化合成）

开发约束见 [AGENTS.md](../AGENTS.md)。本文记录 2026 年 11 月 21–22 日排查"录制时浏览器崩溃、canvas 黑屏"的过程：用到的证据、被排除的假设、根因、修复和遗留问题。实例化图集合成本身的设计见 [GPU 图集合成](dst-gpu-atlas-composition.md)。

## 现象

- 一台 Windows 笔记本（NVIDIA RTX 2070 Max-Q 8 GB + Intel UHD，Chrome 走 ANGLE D3D11）上，游戏运行或加载时 GPU 进程崩溃，两个 WebGL canvas 和约 20 个 2D canvas 同时丢失上下文。
- 线上（GitHub Pages）加载时报 `Unable to start the game TypeError: Cannot read properties of null (reading 'precision')`：上下文丢失后预热仍在调用 `renderer.compile`，three.js 从丢失的上下文读到 `null` 的 shader 精度。
- 运行中丢失上下文后，即使 `webglcontextrestored` 已触发、页面恢复到 60 fps，画面仍是黑的（另一个问题，见"遗留问题"）。

## 证据

| 来源 | 结论 |
| --- | --- |
| `chrome://gpu` 导出的 Log Messages | `GpuProcessHost: The GPU process died due to out of memory.` 在 11-21 17:43 到 11-22 中午出现二十多次：GPU 进程自身内存不足，不是驱动超时（TDR） |
| DevTools 性能 trace | GPU 进程在一个 GPUTask 中途停止；之前约 1 秒里主线程忙于 `getProgramInfoLog`，调用栈全部来自 `rgbaSpriteAtlas.ts` 的 GPU 合成 |
| 堆快照（`scripts/heap-snapshot-analyze.mjs`） | 渲染进程约 2 GB（JS 对象约 1.1 GB，ArrayBuffer 约 0.9 GB，主要是加载器缓存和拾取 alpha 掩码）；与 GPU 进程内存无关 |
| 本地 WebGL 分配统计（见"测量方法"） | 加载默认 Cluster_1 Master 存档时，WebGL 分配在预热期间约 1 秒内从 0.3 GB 涨到 **6.4 GB**；本机 headless Chrome 每次都在这时丢失上下文 |

峰值时刻的分配按纹理尺寸分成六组：36、36、36、24、24、15 张 SRGB8_A8 页，每张三四千像素见方。按外观 key 归属，它们正是 `oceanvine_deco` 的 `idle_1`～`idle_6`，同一个 build，合计约 5.7 GB，占峰值的 84%。

## 根因

同一套藤蔓美术，源图集 `waterforest_vines.zip` 的 `atlas-0.tex` 是 5.6 MB 的 DXT5；预合成成实例化图集后约 5.7 GB，相差约 1000 倍：

1. **实例化要求每个实体每帧只画一个四边形。** 每一帧都要预合成为一整张图，源图集里零件跨帧复用的好处全部失去。
2. **单帧画面很大。** 合成器对整段动画统一使用全 clip 的边界和像素网格，大幅摆动的藤蔓每帧格子约 1400×2800 像素，RGBA8 约 16 MB；4096 的页只装得下 2 帧。
3. **帧数多，循环多。** 每个循环 72 帧，约 1.1 GB；6 个循环约 5.7 GB。66 根藤蔓随机分到 6 个循环，存档里全部出现。
4. **全部同时驻留。** 预热在游戏开始前合成所有已请求的外观，包括视野外的实体；合成页进缓存不释放。合成期间每页还要一张每像素 8 字节的半浮点累积目标，GPU 进程实际内存约为 WebGL 请求量的 2.2 倍（本机 SwiftShader 实测）。

一个外观的合成成本应与共享它的实体数一起看：藤蔓平均 11 个实体共享约 1 GB；常青树的 `sway1_loop_tall` 约 222–443 MB，却被几百棵树共享。

## 排除的假设

- **shader 反复编译。** 每个合成任务新建、用完释放材质，three.js 随之删除程序，每个新外观都重新编译两个着色器。这是真实问题，已修（`f68077e8`，每个渲染器共享一组合成材质），但它占用的是 GPU 时间，不是内存。
- **加载预热一次性压满 GPU。** 预热原先在一个任务里合成全部图集；已改为每帧 8 ms 分片（`6b6a4ce0`）。它降低的是单次提交量，不改变合成后的总量。
- **渲染进程内存 / 动画包 worker 并发。** 按进程拆分 RSS：渲染进程在修复前后都约 3.4–3.6 GB。给动画包 worker 加并发上限（分支 `archive-limit`，未合并）没有降低 RSS 峰值。它还让预热时多数实体的美术尚未到达：加载页撤掉时只合成了 12 页（不限并发时 328 页），实体在开局后陆续出现。合成只是被推迟到运行时，总量不变。
- **外观 key 重复导致重复合成。** 258 个不同的 key 来自 5379 次请求，共享正常；同尺寸的几十页来自同一个外观被切成几十页。

## 修复

- **`916341e7`：** `oceanvine_deco` 不再声明 `instancedAnimations`，由普通 sprite 直接画共享源图集的零件；66 根藤蔓多出几十次绘制调用。
- **`6b6a4ce0`：** 加载预热经过 `prewarmThroughContextLoss`，上下文丢失后等待恢复并重新预热，不再判定启动失败。

同一份存档的 A/B（本机 headless Chrome，交替各跑两次）：

| | 修复前（main） | 修复后 |
| --- | --- | --- |
| WebGL 分配峰值 | 6.4 GB | 1.6 GB |
| 加载时丢失上下文 | 每次 | 无 |
| 加载耗时 | 50–128 s（丢失后重新预热） | 约 21 s |
| 合成页总量（RGBA8） | 6.8 GB / 328 页 | 937 MB / 260 页 |

以上是本机测量，尚未在出问题的那台笔记本上复测。验证方法：部署后在那台机器上加载同一存档并走动，再导出 `chrome://gpu`，确认没有新的 out of memory 记录。另外，藤蔓 11-16 起就走实例化，OOM 记录从 11-21 才开始，中间放大它的变化（GPU 合成路径、预热合成全部外观等）没有逐个核对。

## 测量方法

- **GPU 进程退出原因：** 在出问题的机器上打开 `chrome://gpu`，导出后查 Log Messages 的 `GpuProcessHost` 行。
- **WebGL 分配统计：** Playwright 的 `addInitScript` 在页面启动前包装 `WebGL2RenderingContext.prototype` 的 `texImage2D`、`texStorage2D`、`compressedTexImage2D`、`texImage3D`、`renderbufferStorage(Multisample)`、`bufferData` 及对应的 `delete*`，按当前绑定的对象记录字节数，每 50 ms 采样总量并在刷新峰值时保存按"尺寸 + 格式"分组的快照。统计的是页面向 WebGL 请求的量，不含驱动和 ANGLE 的额外副本。
- **合成外观归属：** 在 `main.ts` 加载前包装 `InstancedSpriteAtlases.prototype.request` 和 `step`，记录每个 key 的动画名、帧数和合成出的页尺寸。
- **实例化显存统计（已入库）：** `node scripts/instanced-atlas-memory.mjs [--save Cluster_1/Caves.json]... [--top N] [--report FILE.md] [--json]` 启动 vite 测试服务，用 headless Chromium 加载存档，列出每个实例化外观（build／clip）的合成页、当前使用实体数、每帧零件数和按零件实例化的零件表估算，按 build 汇总，记录加载期合成页总量时间线及峰值；Linux 上同时按 0.5 秒采样 GPU 进程和渲染进程 RSS。稳定后先做一次完整 GC，再请求 Chrome memory-infra 转储，按分配器拆分渲染进程（V8 主线程堆、ArrayBuffer 分区、Blink buffer 分区、已解码图片、2D canvas、malloc、共享内存等），并记录 GC 之后的 RSS。采样窗口里的 RSS 含未回收的垃圾，前后对比用 GC 之后的数字。n100 上的结果见 [analysis/instanced-mesh-vram-n100.md](../analysis/instanced-mesh-vram-n100.md)。
- **按进程拆分 RSS：** 后台运行 Playwright，每 0.5 秒按 Chrome 子进程的 `--type=` 汇总 `/proc` RSS 峰值（renderer、gpu-process 等）。
- **大堆快照：** `node scripts/heap-snapshot-analyze.mjs FILE --buffers --caches --atlases`。`--atlases` 列出动画包缓存中仍持有 RGBA 或 BC 块的 build 页（新版 Chrome 的上下文节点名带 `/ scope @…` 后缀，缓存键是拼接字符串，两者都已处理）。

### 渲染进程（2026-11-25，Caves，本机）

加载完成后完整 GC，渲染进程 RSS 约 2.2 GB，私有内存约 1.9 GB。其中 V8 主线程堆约 590 MB（按实体平摊，约 1.16 万个实体），ArrayBuffer 分区约 755 MB（在用约 430 MB，其余是加载峰值时释放但未归还系统的空间），Blink buffer 分区约 358 MB（来源未查），已解码图片约 178 MB（UI 图集整页当 CSS sprite），2D canvas 约 84 MB。

在用的 ArrayBuffer 主要是三处 CPU 副本，已处理两处：

- **地面与天气纹理（约 177 MB）：** `textureLoader.ts` 的缓存永久持有解码结果，地面 `DataTexture` 也引用同一份像素。现在 `loadKtexDataTexture()` 按文件和采样方式共享一个 Source，上传后丢弃像素，之后需要新的 GPU 拷贝时（上下文恢复等）重新解码；`loadKtexTexture()` 的缓存只合并进行中的请求。小地图改为直接视图引用解码结果，不再复制一份。
- **从未绘制的 build 页（约 99 MB，120 页）：** 远处实体的美术加载后一直没有上传，原有的"上传后释放"不会触发。现在纹理创建后 30 秒（`RELEASE_UNDRAWN_ATLAS_MS`）仍未上传就释放，首次上传时从动画包重新读取。
- **UI 图集的 KTEX（约 76 MB）：** 仍保留。按元素裁图、物品图标（`iconSprites.ts`）、表情轮盘和小地图图标都从它同步解出单个元素；要释放它，这些读取需要改为异步并能从图片包重新读取。

效果（同一台机器、同一存档，`instanced-atlas-memory.mjs --settle 40000`，GC 之后）：RSS 2232 MB → 1978 MB，私有内存 1898 MB → 1643 MB，ArrayBuffer 分区 755 MB → 497 MB。加载峰值（约 3.1–3.2 GB）基本不变。

UI 图片与 canvas 的处理：

- **按元素裁图（已解码图片 178 MB → 58 MB）：** 物品栏、制作栏、小地图边框和调试控制台原来把整张图集页（2048² 解码后 16.8 MB）当 CSS sprite，约 3000 个图标让 10 页常驻解码缓存。`atlasImage.ts` 现在为每个元素从页的 KTEX 解出它自己的纹素（BC 页只解对应的块），编码成一张小图；`crafting-background.ts` 按块各取一张图。
- **UI 动画直接按零件绘制（canvas 84 MB → 28 MB）：** `AnimatedBackground`（保存指示、箱子面板、新鲜度／潮湿度条）原来把每个 clip 的全部帧合成进 CPU 图集并永久缓存，`saving.zip` 的 0.5 MB 美术合成后约 50 MB。现在与状态徽章一样，每帧用 `ui-anim.ts` 的 `drawFrame` 从 build 图集逐零件绘制；`drawFrame` 按图集与画布的比例换算源矩形，降采样的 build 也能正确取图。与原合成路径逐帧对比，平均误差 0.1–0.5／255。
- **主菜单图集（约 10 MB）：** `AtlasSprite.tsx` 的模块级缓存在进入游戏后仍持有菜单与世界生成页的图集 canvas；现在按挂载计数，最后一个卸载后释放。

效果（本机，Caves，GC 之后）：RSS 1978 MB → 1786 MB，共享内存 226 MB → 106 MB。私有内存只降了约 30 MB（1643 MB → 1612 MB）：解码图片与 canvas 的大部分不计入私有内存。

这些 Playwright 诊断脚本没有进入仓库；把 WebGL 分配统计做成加载性能用例（断言峰值上限、不丢失上下文）是遗留项之一。

## 遗留问题

- **仍然偏大的合成外观：** `idle_fruit`（97 帧，317 MB）、`sway1_loop_tall`（79 帧，222 MB）。它们被大量实体共享，处理方向是降低合成分辨率、只合成可见外观，或改为按零件实例化（每个实例一个零件，直接采样源图集，不再预合成）。没人用的外观（积雪变体、生成过程中出现过的状态）现在按预算释放、不再合成，见 [GPU 图集合成](dst-gpu-atlas-composition.md#合成外观的释放)；仍在显示的大外观本身还在。
- **未归属的常驻纹理：** 加载后有 84 张 1024² 的 SRGB8_A8 纹理，约 408 MB。
- **光照 shader 重复注入：** `chrome://gpu` 日志反复出现 `'dstLightmap' : redefinition`、`'vDstWorldXZ' : redefinition`，相关材质编译失败。
- **开局完整性没有保证：** `restoreAll` 不等美术，预热前美术是否到齐取决于加载速度。
- **运行中丢失上下文后黑屏：** 上下文恢复后画面仍黑，原因未查。
- **防回归：** 新增实例化 prefab 前应估算"帧数 × 单帧尺寸 × 外观数"，并与共享的实体数比较；长循环的大幅美术默认不进实例批次。

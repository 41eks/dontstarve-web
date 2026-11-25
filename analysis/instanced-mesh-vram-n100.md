# InstancedMesh 帧率与内存分析

由 `node scripts/instanced-atlas-memory.mjs --save Cluster_1/Master.json --save Cluster_1/Caves.json --top 30 --report analysis/instanced-mesh-vram-n100.md` 生成。

## 结论（2026-11-25，n100，按零件实例化之后）

数字都来自本报告后面的表格。“之前”是同一台机器、同一命令在按零件实例化之前的结果。页面侧是向 WebGL 请求的字节；GPU 进程 RSS 是 SwiftShader 下的实际内存，包含全部 WebGL 资源，不只是实例化部分。

1. **合成页达到 16 MB 的外观改为按零件表绘制后，实例化的显存降到原来的 4–22%。**

   | 存档 | 合成页（稳定后） | GPU 进程 RSS 峰值 | 加载 |
   | --- | --- | --- | --- |
   | Master | 407.0 MB → 91.0 MB（另有零件表 260 KB） | 1391.8 MB → 756.1 MB | 26.5 s → 21.6 s |
   | Caves | 798.9 MB → 27.9 MB（另有零件表 340 KB） | 2080.3 MB → 705.3 MB | 27.2 s → 16.5 s |

2. **改走零件表的正是之前占用最大的那些外观。** Master 有 3 个（`moon_tree`、`horrorfuel`、`reeds`），代替了 308 MB 合成页；Caves 有 11 个（常青树三个摇摆循环、`bulb_plant_*`、瀑布蒸汽、`horrorfuel`、`grass1 / idle`），代替了 739 MB。零件表合计只有 260 KB 和 340 KB。
3. **剩下的合成页都是小外观。** 现在最大的是 `nightmarefuel / idle_loop`（14.7 MB），低于阈值，仍按合成绘制。合成时临时目标的峰值从 119 MB 降到 29 MB。
4. **渲染进程没有变小。** 它的峰值仍为 3.1–3.3 GB（JS 堆和 ArrayBuffer），与之前相同，现在比 GPU 进程大得多。在 7.5 GB 的机器上，下一步要压的是这一部分。
5. 帧率在 SwiftShader 下只有 5–6 FPS，主要反映软件光栅化，不能代表实际 GPU，也没有可以对比的之前数据。

## 环境

- 主机：atrium，Intel(R) N100 × 4，内存 7.5 GB，linux 7.0.2-arch1-1
- 浏览器：headless Chromium 153.0.8010.12，GL：ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)
- 报告生成时间（UTC）：2026-11-25T12:08:29.072Z
- 使用 Vite 测试服务。加载存档后原地采样 15.0 s，按游戏场景的渲染调用次数计算 FPS。
- 合成页按 WebGL RGBA8 每纹素 4 字节估算。浏览器进程 RSS 是驻留系统内存，单独列出。
- “零件表”：合成页达到 16 MB（`PART_TABLE_COMPOSED_BYTES`）的外观改为按零件实例化，每帧每个零件槽一行 48 字节（矩阵、UV 矩形、页号）；其余外观的零件表是估算值。

## 概览

| 存档 | 加载 | 分辨率 | 帧数／采样时长 | 平均 FPS | P95 帧时 | 合成页与零件表（稳定后） | 零件表（代替的合成页） | 峰值 | 合成中临时目标 | 实例属性 | GPU 进程 RSS 峰值／稳定 | 渲染进程 RSS 峰值／稳定 | 问题 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Cluster_1/Master.json | 21.6 s | 1280 × 720 | 77／15.0 s | 5.1 | 280.5 ms | 91.0 MB，84 页，84 个外观 | 3 个，260.3 KB（308.1 MB） | 91.0 MB（21.8 s） | 29.4 MB | 15.3 KB | 756.1 MB（31.1 s）／730.3 MB | 3102.1 MB（31.1 s）／2327.5 MB | 无 |
| Cluster_1/Caves.json | 16.5 s | 1280 × 720 | 87／15.4 s | 5.7 | 188.6 ms | 27.9 MB，46 页，46 个外观 | 11 个，340.2 KB（739.0 MB） | 27.9 MB（17.4 s） | 29.4 MB | 32.1 KB | 705.3 MB（32.1 s）／704.7 MB | 3325.5 MB（32.1 s）／3259.0 MB | 无 |

## Cluster_1/Master.json

稳定后：84 个外观有合成页，3 个按零件表绘制，另有 166 个只出现过、两者都没有；合成队列剩余 0 个；实例化通道保留 219 个实体，当前绘制 114 个实例。

### 按 build 汇总

| build | 合成页 | 页数 | 外观数 | 使用实体 | 零件表估算 |
| --- | --- | --- | --- | --- | --- |
| nightmarefuel | 14.7 MB | 1 | 1 | 1 | 16.3 KB |
| star_trap | 14.4 MB | 1 | 1 | 2 | 6.7 KB |
| guano | 11.5 MB | 1 | 1 | 1 | 0.8 KB |
| chester_eyebone_build | 10.0 MB | 1 | 1 | 1 | 9.6 KB |
| shadowheart | 8.5 MB | 1 | 1 | 2 | 6.6 KB |
| moon_fissure_fx | 3.1 MB | 1 | 1 | 11 | 4.7 KB |
| grass1 | 2.4 MB | 3 | 3 | 26 | 0.7 KB |
| malbatross_beak | 1.3 MB | 1 | 1 | 2 | 0.2 KB |
| phonograph | 1.2 MB | 1 | 1 | 1 | 1.3 KB |
| goldenaxe_invisible | 961.9 KB | 2 | 2 | 2 | 0.4 KB |
| sapling | 922.7 KB | 2 | 2 | 5 | 0.3 KB |
| terrarium | 820.9 KB | 1 | 1 | 1 | 1.3 KB |
| goldenhoe | 788.8 KB | 1 | 1 | 1 | 0.1 KB |
| bird_eggs | 770.0 KB | 1 | 1 | 2 | 0.2 KB |
| oar_driftwood | 761.9 KB | 1 | 1 | 2 | 0.2 KB |
| gems | 742.2 KB | 4 | 4 | 11 | 0.4 KB |
| shovel_victorian | 656.3 KB | 1 | 1 | 1 | 0.3 KB |
| twigs | 646.0 KB | 1 | 1 | 3 | 0.2 KB |
| cutgrass | 593.9 KB | 1 | 1 | 4 | 0.2 KB |
| starstaff_relic+staffs | 591.3 KB | 2 | 2 | 2 | 0.4 KB |
| goldenpitchfork | 587.3 KB | 1 | 1 | 1 | 0.3 KB |
| dragon_scales | 569.8 KB | 1 | 1 | 1 | 0.2 KB |
| cookiecuttershell | 565.7 KB | 1 | 1 | 1 | 0.2 KB |
| goldenshovel | 531.6 KB | 1 | 1 | 4 | 0.3 KB |
| slurtle_shellpieces | 506.8 KB | 1 | 1 | 1 | 0.2 KB |
| livinglog | 500.5 KB | 1 | 1 | 1 | 0.2 KB |
| turf | 497.3 KB | 1 | 1 | 1 | 0.2 KB |
| turf_moon | 497.3 KB | 1 | 1 | 2 | 0.2 KB |
| slurtle_slime | 495.2 KB | 1 | 1 | 1 | 0.2 KB |
| salt | 472.9 KB | 1 | 1 | 1 | 0.2 KB |

### 按零件表绘制的外观

| 零件表 | 代替的合成页 | 帧数 | 零件槽 | 使用实体 | build／clip |
| --- | --- | --- | --- | --- | --- |
| 118.5 KB | 207.8 MB | 79 | 32 | 2 | moon_tree／sway1_loop_tall |
| 74.8 KB | 68.6 MB | 84 | 19 | 2 | horrorfuel／idle_loop |
| 66.9 KB | 31.7 MB | 84 | 17 | 4 | reeds／idle |

### 外观（按合成页大小）

| 合成页 | 占比 | 页数 | 最大页 | 帧数 | 使用实体 | 每实体 | 每帧零件 | 零件表估算 | build／clip |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 14.7 MB | 16.1% | 1 | 4064x948 | 87 | 1 | 14.7 MB | 4 | 16.3 KB | nightmarefuel／idle_loop |
| 14.4 MB | 15.9% | 1 | 3939x960 | 71 | 2 | 7.2 MB | 2 | 6.7 KB | star_trap／inactive |
| 11.5 MB | 12.6% | 1 | 3962x760 | 16 | 1 | 11.5 MB | 1 | 0.8 KB | guano／dump |
| 10.0 MB | 11.0% | 1 | 4025x654 | 98 | 1 | 10.0 MB | 3 | 9.6 KB | chester_eyebone_build／idle_loop |
| 8.5 MB | 9.3% | 1 | 4035x550 | 20 | 2 | 4.2 MB | 7 | 6.6 KB | shadowheart／idle |
| 3.1 MB | 3.4% | 1 | 3800x213 | 20 | 11 | 287.4 KB | 5 | 4.7 KB | moon_fissure_fx／crack_idle |
| 2.1 MB | 2.3% | 1 | 2544x214 | 12 | 0 | 无人使用 | 1 | 0.6 KB | grass1／dead_to_empty |
| 1.3 MB | 1.4% | 1 | 1140x292 | 4 | 2 | 650.2 KB | 1 | 0.2 KB | malbatross_beak／idle |
| 1.2 MB | 1.4% | 1 | 956x339 | 4 | 1 | 1.2 MB | 7 | 1.3 KB | phonograph／idle |
| 820.9 KB | 0.9% | 1 | 844x249 | 4 | 1 | 820.9 KB | 7 | 1.3 KB | terrarium／idle |
| 788.8 KB | 0.8% | 1 | 795x254 | 3 | 1 | 788.8 KB | 1 | 0.1 KB | goldenhoe／idle |
| 770.0 KB | 0.8% | 1 | 896x220 | 4 | 2 | 385.0 KB | 1 | 0.2 KB | bird_eggs／rotten |
| 761.9 KB | 0.8% | 1 | 1060x184 | 4 | 2 | 380.9 KB | 1 | 0.2 KB | oar_driftwood／idle |
| 656.3 KB | 0.7% | 1 | 840x200 | 6 | 1 | 656.3 KB | 1 | 0.3 KB | shovel_victorian／idle |
| 646.0 KB | 0.7% | 1 | 1088x152 | 4 | 3 | 215.3 KB | 1 | 0.2 KB | twigs／idle |
| 642.0 KB | 0.7% | 1 | 660x249 | 2 | 4 | 160.5 KB | 1 | 0.1 KB | sapling／dropped |
| 593.9 KB | 0.6% | 1 | 884x172 | 4 | 4 | 148.5 KB | 1 | 0.2 KB | cutgrass／idle |
| 587.3 KB | 0.6% | 1 | 840x179 | 6 | 1 | 587.3 KB | 1 | 0.3 KB | goldenpitchfork／idle |
| 569.8 KB | 0.6% | 1 | 1020x143 | 4 | 1 | 569.8 KB | 1 | 0.2 KB | dragon_scales／idle |
| 565.7 KB | 0.6% | 1 | 972x149 | 4 | 1 | 565.7 KB | 1 | 0.2 KB | cookiecuttershell／idle |
| 531.6 KB | 0.6% | 1 | 840x162 | 6 | 4 | 132.9 KB | 1 | 0.3 KB | goldenshovel／idle |
| 506.8 KB | 0.5% | 1 | 816x159 | 4 | 1 | 506.8 KB | 1 | 0.2 KB | slurtle_shellpieces／idle |
| 500.5 KB | 0.5% | 1 | 860x149 | 4 | 1 | 500.5 KB | 1 | 0.2 KB | livinglog／idle |
| 497.3 KB | 0.5% | 1 | 816x156 | 4 | 1 | 497.3 KB | 1 | 0.2 KB | turf／carpet |
| 497.3 KB | 0.5% | 1 | 816x156 | 4 | 2 | 248.6 KB | 1 | 0.2 KB | turf_moon／pebblebeach |
| 495.2 KB | 0.5% | 1 | 912x139 | 4 | 1 | 495.2 KB | 1 | 0.2 KB | slurtle_slime／idle |
| 480.9 KB | 0.5% | 1 | 648x190 | 4 | 1 | 480.9 KB | 1 | 0.2 KB | goldenaxe_invisible／idle |
| 480.9 KB | 0.5% | 1 | 648x190 | 4 | 1 | 480.9 KB | 1 | 0.2 KB | goldenaxe_invisible／idle |
| 472.9 KB | 0.5% | 1 | 776x156 | 4 | 1 | 472.9 KB | 1 | 0.2 KB | salt／idle |
| 465.4 KB | 0.5% | 1 | 876x136 | 4 | 4 | 116.3 KB | 1 | 0.2 KB | nitre／idle |

### 合成页总量时间线（变化点）

| 时间 | 合成页 | 页数 | 排队 |
| --- | --- | --- | --- |
| 12.8 s | 0.0 KB | 0 | 245 |
| 12.8 s | 409.8 KB | 1 | 244 |
| 12.8 s | 3.6 MB | 2 | 242 |
| 12.8 s | 4.3 MB | 6 | 233 |
| 12.8 s | 5.1 MB | 10 | 229 |
| 12.8 s | 6.9 MB | 16 | 223 |
| 12.9 s | 8.8 MB | 21 | 218 |
| 12.9 s | 20.8 MB | 24 | 214 |
| 12.9 s | 23.1 MB | 28 | 208 |
| 12.9 s | 37.7 MB | 29 | 207 |
| 12.9 s | 39.0 MB | 34 | 201 |
| 13.0 s | 42.2 MB | 44 | 189 |
| 13.0 s | 44.0 MB | 49 | 161 |
| 13.0 s | 46.0 MB | 55 | 151 |
| 13.0 s | 48.6 MB | 60 | 144 |
| 13.0 s | 57.1 MB | 62 | 142 |
| 13.0 s | 57.5 MB | 63 | 141 |
| 13.1 s | 67.5 MB | 64 | 140 |
| 13.1 s | 82.0 MB | 65 | 139 |
| 13.1 s | 84.7 MB | 71 | 80 |
| 13.2 s | 86.8 MB | 78 | 5 |
| 13.2 s | 88.9 MB | 83 | 0 |
| 21.8 s | 91.0 MB | 84 | 0 |

## Cluster_1/Caves.json

稳定后：46 个外观有合成页，11 个按零件表绘制，另有 146 个只出现过、两者都没有；合成队列剩余 0 个；实例化通道保留 123 个实体，当前绘制 189 个实例。

### 按 build 汇总

| build | 合成页 | 页数 | 外观数 | 使用实体 | 零件表估算 |
| --- | --- | --- | --- | --- | --- |
| nightmarefuel | 14.7 MB | 1 | 1 | 5 | 16.3 KB |
| greenstaff_clockwork+staffs | 2.5 MB | 8 | 8 | 8 | 1.5 KB |
| swap_cavein_boulder | 1.5 MB | 2 | 2 | 3 | 0.4 KB |
| cave_ferns | 1022.6 KB | 9 | 9 | 12 | 0.4 KB |
| lantern_mystical | 788.2 KB | 1 | 1 | 1 | 0.1 KB |
| nightmaresword | 703.3 KB | 1 | 1 | 1 | 0.3 KB |
| twigs | 646.0 KB | 1 | 1 | 4 | 0.2 KB |
| turf | 549.0 KB | 1 | 1 | 2 | 0.2 KB |
| livinglog | 500.5 KB | 1 | 1 | 2 | 0.2 KB |
| nitre | 465.4 KB | 1 | 1 | 1 | 0.2 KB |
| spoiled_food | 461.1 KB | 1 | 1 | 4 | 0.2 KB |
| flint | 445.3 KB | 1 | 1 | 3 | 0.2 KB |
| dreadstone | 437.1 KB | 1 | 1 | 1 | 0.2 KB |
| wax_paper | 433.7 KB | 1 | 1 | 1 | 0.2 KB |
| log | 406.5 KB | 1 | 1 | 4 | 0.2 KB |
| gems | 355.4 KB | 2 | 2 | 3 | 0.2 KB |
| poop | 274.1 KB | 1 | 1 | 3 | 0.1 KB |
| wall_stone | 216.0 KB | 1 | 1 | 1 | 0.1 KB |
| amulets | 211.2 KB | 1 | 1 | 1 | 0.1 KB |
| rocks | 173.5 KB | 2 | 2 | 5 | 0.1 KB |
| backpack_deerclops | 145.6 KB | 1 | 1 | 1 | 0.0 KB |
| heatrock_fantasy | 144.6 KB | 1 | 1 | 1 | 0.1 KB |
| pinecone | 128.3 KB | 1 | 1 | 2 | 0.0 KB |
| mushrooms | 127.5 KB | 1 | 1 | 2 | 0.1 KB |
| beardhair | 123.9 KB | 1 | 1 | 1 | 0.0 KB |
| charcoal | 110.7 KB | 1 | 1 | 1 | 0.0 KB |
| thulecite_pieces | 106.6 KB | 1 | 1 | 1 | 0.0 KB |
| silk | 103.3 KB | 1 | 1 | 1 | 0.0 KB |
| horrorfuel | 74.8 KB | 0 | 1 | 6 | 74.8 KB |
| grass1 | 66.9 KB | 0 | 1 | 7 | 66.9 KB |

### 按零件表绘制的外观

| 零件表 | 代替的合成页 | 帧数 | 零件槽 | 使用实体 | build／clip |
| --- | --- | --- | --- | --- | --- |
| 22.2 KB | 213.7 MB | 79 | 6 | 1 | evergreen_new／sway1_loop_tall |
| 22.2 KB | 125.7 MB | 79 | 6 | 2 | evergreen_new／sway1_loop_normal |
| 18.8 KB | 71.1 MB | 40 | 10 | 5 | moonglass_bigwaterfall_steam／steam_big |
| 74.8 KB | 68.6 MB | 84 | 19 | 6 | horrorfuel／idle_loop |
| 35.4 KB | 57.0 MB | 84 | 9 | 1 | bulb_plant_double／idle |
| 22.2 KB | 52.2 MB | 79 | 6 | 1 | evergreen_new／sway1_loop_short |
| 35.4 KB | 39.7 MB | 84 | 9 | 2 | bulb_plant_single／idle |
| 23.4 KB | 35.7 MB | 50 | 10 | 1 | bulb_plant_springy／idle |
| 66.9 KB | 29.0 MB | 84 | 17 | 7 | grass1／idle |
| 9.4 KB | 24.8 MB | 40 | 5 | 10 | moonglass_bigwaterfall_steam／steam_small1 |
| 9.4 KB | 21.5 MB | 40 | 5 | 11 | moonglass_bigwaterfall_steam／steam_small2 |

### 外观（按合成页大小）

| 合成页 | 占比 | 页数 | 最大页 | 帧数 | 使用实体 | 每实体 | 每帧零件 | 零件表估算 | build／clip |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 14.7 MB | 52.7% | 1 | 4064x948 | 87 | 5 | 2.9 MB | 4 | 16.3 KB | nightmarefuel／idle_loop |
| 804.8 KB | 2.8% | 1 | 680x303 | 2 | 1 | 804.8 KB | 2 | 0.2 KB | swap_cavein_boulder／idle |
| 788.2 KB | 2.8% | 1 | 708x285 | 3 | 1 | 788.2 KB | 1 | 0.1 KB | lantern_mystical／idle_off |
| 750.7 KB | 2.6% | 1 | 626x307 | 2 | 2 | 375.4 KB | 2 | 0.2 KB | swap_cavein_boulder／idle |
| 703.3 KB | 2.5% | 1 | 726x248 | 6 | 1 | 703.3 KB | 1 | 0.3 KB | nightmaresword／idle |
| 646.0 KB | 2.3% | 1 | 1088x152 | 4 | 4 | 161.5 KB | 1 | 0.2 KB | twigs／idle |
| 549.0 KB | 1.9% | 1 | 884x159 | 4 | 2 | 274.5 KB | 1 | 0.2 KB | turf／sinkhole |
| 500.5 KB | 1.8% | 1 | 860x149 | 4 | 2 | 250.3 KB | 1 | 0.2 KB | livinglog／idle |
| 465.4 KB | 1.6% | 1 | 876x136 | 4 | 1 | 465.4 KB | 1 | 0.2 KB | nitre／idle |
| 461.1 KB | 1.6% | 1 | 952x124 | 4 | 4 | 115.3 KB | 1 | 0.2 KB | spoiled_food／idle |
| 445.3 KB | 1.6% | 1 | 912x125 | 4 | 3 | 148.4 KB | 1 | 0.2 KB | flint／idle |
| 437.1 KB | 1.5% | 1 | 788x142 | 4 | 1 | 437.1 KB | 1 | 0.2 KB | dreadstone／idle |
| 433.7 KB | 1.5% | 1 | 1028x108 | 4 | 1 | 433.7 KB | 1 | 0.2 KB | wax_paper／idle |
| 406.5 KB | 1.4% | 1 | 860x121 | 4 | 4 | 101.6 KB | 1 | 0.2 KB | log／idle |
| 317.6 KB | 1.1% | 1 | 308x264 | 2 | 1 | 317.6 KB | 2 | 0.2 KB | greenstaff_clockwork+staffs／greenstaff |
| 317.6 KB | 1.1% | 1 | 308x264 | 2 | 1 | 317.6 KB | 2 | 0.2 KB | greenstaff_clockwork+staffs／greenstaff |
| 317.6 KB | 1.1% | 1 | 308x264 | 2 | 1 | 317.6 KB | 2 | 0.2 KB | greenstaff_clockwork+staffs／greenstaff |
| 317.6 KB | 1.1% | 1 | 308x264 | 2 | 1 | 317.6 KB | 2 | 0.2 KB | greenstaff_clockwork+staffs／greenstaff |
| 317.6 KB | 1.1% | 1 | 308x264 | 2 | 1 | 317.6 KB | 2 | 0.2 KB | greenstaff_clockwork+staffs／greenstaff |
| 317.6 KB | 1.1% | 1 | 308x264 | 2 | 1 | 317.6 KB | 2 | 0.2 KB | greenstaff_clockwork+staffs／greenstaff |
| 317.6 KB | 1.1% | 1 | 308x264 | 2 | 1 | 317.6 KB | 2 | 0.2 KB | greenstaff_clockwork+staffs／greenstaff |
| 317.6 KB | 1.1% | 1 | 308x264 | 2 | 1 | 317.6 KB | 2 | 0.2 KB | greenstaff_clockwork+staffs／greenstaff |
| 274.1 KB | 1.0% | 1 | 484x145 | 2 | 3 | 91.4 KB | 1 | 0.1 KB | poop／idle |
| 216.0 KB | 0.8% | 1 | 384x144 | 2 | 1 | 216.0 KB | 1 | 0.1 KB | wall_stone／idle |
| 211.2 KB | 0.7% | 1 | 496x109 | 2 | 1 | 211.2 KB | 1 | 0.1 KB | amulets／greenamulet |
| 190.1 KB | 0.7% | 1 | 338x144 | 2 | 2 | 95.1 KB | 1 | 0.1 KB | gems／orangegem_idle |
| 168.1 KB | 0.6% | 1 | 211x204 | 1 | 2 | 84.1 KB | 1 | 0.0 KB | cave_ferns／f2 |
| 165.3 KB | 0.6% | 1 | 328x129 | 2 | 1 | 165.3 KB | 1 | 0.1 KB | gems／purplegem_idle |
| 147.3 KB | 0.5% | 1 | 205x184 | 1 | 1 | 147.3 KB | 1 | 0.0 KB | cave_ferns／f4 |
| 145.6 KB | 0.5% | 1 | 181x206 | 1 | 1 | 145.6 KB | 1 | 0.0 KB | backpack_deerclops／anim |

### 合成页总量时间线（变化点）

| 时间 | 合成页 | 页数 | 排队 |
| --- | --- | --- | --- |
| 10.9 s | 66.7 KB | 0 | 190 |
| 10.9 s | 190.6 KB | 1 | 189 |
| 10.9 s | 813.2 KB | 3 | 185 |
| 10.9 s | 2.1 MB | 6 | 182 |
| 10.9 s | 18.7 MB | 16 | 166 |
| 11.0 s | 20.9 MB | 22 | 153 |
| 11.0 s | 22.6 MB | 25 | 144 |
| 11.0 s | 25.1 MB | 36 | 10 |
| 11.0 s | 26.3 MB | 41 | 5 |
| 11.0 s | 27.8 MB | 46 | 0 |
| 16.3 s | 27.9 MB | 46 | 0 |
| 17.4 s | 27.9 MB | 46 | 0 |

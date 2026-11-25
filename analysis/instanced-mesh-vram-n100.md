# InstancedMesh 显存分析

由 `node scripts/instanced-atlas-memory.mjs --save Cluster_1/Master.json --save Cluster_1/Caves.json --top 30 --report analysis/instanced-mesh-vram-n100.md` 生成。

## 结论（2026-11-25，n100）

以下数字都来自本报告后面的表格。页面侧是向 WebGL 请求的字节；GPU 进程 RSS 是 SwiftShader 下的实际内存，包含全部 WebGL 资源（源图集、地皮、渲染目标等），不只是实例化部分。

1. **两个存档都在 n100（7.5 GB）上加载完成，没有丢失上下文。** 之前同一台机器加载 Master 时 GPU 进程必崩（`oceanvine_deco` 的 5.7 GB 合成页）；现在 GPU 进程峰值为 Master 1.39 GB、Caves 2.08 GB。
2. **实例化的显存几乎全在合成页上。** InstancedMesh 的实例属性只有 4.8–9.1 KB，可以忽略。稳定后的合成页：Master 407 MB（87 个外观、91 页），Caves 799 MB（57 个外观、65 页）。合成最大一页时另需一张临时半浮点目标，最大 119 MB。
3. **占用高度集中在少数大外观上，而且这些外观当前只有一两个实体在用。**
   - Master：`moon_tree / sway1_loop_tall` 211 MB（占 52%），只有 2 棵树在用；`horrorfuel` 69 MB、`reeds` 36 MB。前三项合计 316 MB（78%）。
   - Caves：常青树三个摇摆循环合计 411 MB（51%），共 4 棵树在用；`moonglass_bigwaterfall_steam` 118 MB，`bulb_plant_*` 三个 143 MB，`horrorfuel` 69 MB。这几项合计约 740 MB（93%）。
   - 这些外观的帧多、格子大，"每实体"成本达到几十到上百 MB，实例化省下的 draw call 远不足以抵消。
4. **按零件实例化能把这些大外观的成本降到 KB 级。** 每帧零件数是 4–32 个，零件表估算为 16–119 KB（`moon_tree` 每帧 32 个零件，119 KB；常青树三个循环合计 67 KB），比合成页小三到四个数量级。
5. **闲置释放生效。** Master 有 166 个、Caves 有 146 个外观只在实体初始化时出现过，没有被合成；稳定后合成队列为 0，说明在用的外观都已画出。本次 Master 中 `oceanvine / idle_fruit`（以前测到 302 MB）没有被合成：加载时没有醒着的 `oceanvine` 在用它。
6. **在小内存机器上，渲染进程比 GPU 进程更大。** 渲染进程 RSS 峰值 3.1–3.3 GB（JS 堆加 ArrayBuffer），GPU 进程 1.4–2.1 GB，加上系统已用的约 2.3 GB，Caves 加载峰值接近 7.5 GB 的上限。

建议的优先级：把 `moon_tree`、常青树的摇摆循环和 `horrorfuel`、`bulb_plant_*`、瀑布蒸汽这类"帧多、格子大、在用实体少"的外观改为按零件实例化，或者退回普通 sprite；小外观（几百 KB 以内）维持合成。

## 环境

- 主机：atrium，Intel(R) N100 × 4，内存 7.5 GB，linux 7.0.2-arch1-1
- 浏览器：headless Chromium 153.0.8010.12，GL：ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)
- 加载后继续运行 15.0 s 再读取（闲置外观 10 秒后才可能释放）
- 页面侧数字是向 WebGL 请求的字节（合成页按 RGBA8 每纹素 4 字节），不含驱动副本；GPU 进程 RSS 在 SwiftShader 下就是纹理实际占用的内存。
- “零件表”估算：改为按零件实例化时，每帧每个零件一行 48 字节（矩阵、UV 矩形、页号）。

## 概览

| 存档 | 加载 | 合成页（稳定后） | 合成页峰值 | 合成中临时目标 | 实例属性 | GPU 进程 RSS 峰值／稳定 | 渲染进程 RSS 峰值／稳定 | 问题 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Cluster_1/Master.json | 26.5 s | 407.0 MB，91 页，87 个外观 | 407.0 MB（26.2 s） | 107.8 MB | 9.1 KB | 1391.8 MB（25.7 s）／1129.0 MB | 3121.1 MB（15.6 s）／2865.4 MB | 无 |
| Cluster_1/Caves.json | 27.2 s | 798.9 MB，65 页，57 个外观 | 798.9 MB（30.1 s） | 119.4 MB | 4.8 KB | 2080.3 MB（25.5 s）／1485.8 MB | 3275.9 MB（15.5 s）／2286.1 MB | 无 |

## Cluster_1/Master.json

稳定后：87 个外观有合成页，另有 166 个只出现过、没有合成页；合成队列剩余 0 个；实例化通道保留 219 个实体，当前绘制 78 个实例。

### 按 build 汇总

| build | 合成页 | 页数 | 外观数 | 使用实体 | 零件表估算 |
| --- | --- | --- | --- | --- | --- |
| moon_tree | 211.3 MB | 4 | 1 | 2 | 118.5 KB |
| horrorfuel | 68.6 MB | 2 | 1 | 2 | 52.9 KB |
| reeds | 36.4 MB | 1 | 1 | 4 | 66.9 KB |
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

### 外观（按合成页大小）

| 合成页 | 占比 | 页数 | 最大页 | 帧数 | 使用实体 | 每实体 | 每帧零件 | 零件表估算 | build／clip |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 211.3 MB | 51.9% | 4 | 3525x3928 | 79 | 2 | 105.6 MB | 32 | 118.5 KB | moon_tree／sway1_loop_tall |
| 68.6 MB | 16.9% | 2 | 3618x3905 | 84 | 2 | 34.3 MB | 19 | 52.9 KB | horrorfuel／idle_loop |
| 36.4 MB | 8.9% | 1 | 3904x2442 | 84 | 4 | 9.1 MB | 17 | 66.9 KB | reeds／idle |
| 14.7 MB | 3.6% | 1 | 4064x948 | 87 | 1 | 14.7 MB | 4 | 16.3 KB | nightmarefuel／idle_loop |
| 14.4 MB | 3.5% | 1 | 3939x960 | 71 | 2 | 7.2 MB | 2 | 6.7 KB | star_trap／inactive |
| 11.5 MB | 2.8% | 1 | 3962x760 | 16 | 1 | 11.5 MB | 1 | 0.8 KB | guano／dump |
| 10.0 MB | 2.5% | 1 | 4025x654 | 98 | 1 | 10.0 MB | 3 | 9.6 KB | chester_eyebone_build／idle_loop |
| 8.5 MB | 2.1% | 1 | 4035x550 | 20 | 2 | 4.2 MB | 7 | 6.6 KB | shadowheart／idle |
| 3.1 MB | 0.8% | 1 | 3800x213 | 20 | 11 | 287.4 KB | 5 | 4.7 KB | moon_fissure_fx／crack_idle |
| 2.1 MB | 0.5% | 1 | 2544x214 | 12 | 0 | 无人使用 | 1 | 0.6 KB | grass1／dead_to_empty |
| 1.3 MB | 0.3% | 1 | 1140x292 | 4 | 2 | 650.2 KB | 1 | 0.2 KB | malbatross_beak／idle |
| 1.2 MB | 0.3% | 1 | 956x339 | 4 | 1 | 1.2 MB | 7 | 1.3 KB | phonograph／idle |
| 820.9 KB | 0.2% | 1 | 844x249 | 4 | 1 | 820.9 KB | 7 | 1.3 KB | terrarium／idle |
| 788.8 KB | 0.2% | 1 | 795x254 | 3 | 1 | 788.8 KB | 1 | 0.1 KB | goldenhoe／idle |
| 770.0 KB | 0.2% | 1 | 896x220 | 4 | 2 | 385.0 KB | 1 | 0.2 KB | bird_eggs／rotten |
| 761.9 KB | 0.2% | 1 | 1060x184 | 4 | 2 | 380.9 KB | 1 | 0.2 KB | oar_driftwood／idle |
| 656.3 KB | 0.2% | 1 | 840x200 | 6 | 1 | 656.3 KB | 1 | 0.3 KB | shovel_victorian／idle |
| 646.0 KB | 0.2% | 1 | 1088x152 | 4 | 3 | 215.3 KB | 1 | 0.2 KB | twigs／idle |
| 642.0 KB | 0.2% | 1 | 660x249 | 2 | 4 | 160.5 KB | 1 | 0.1 KB | sapling／dropped |
| 593.9 KB | 0.1% | 1 | 884x172 | 4 | 4 | 148.5 KB | 1 | 0.2 KB | cutgrass／idle |
| 587.3 KB | 0.1% | 1 | 840x179 | 6 | 1 | 587.3 KB | 1 | 0.3 KB | goldenpitchfork／idle |
| 569.8 KB | 0.1% | 1 | 1020x143 | 4 | 1 | 569.8 KB | 1 | 0.2 KB | dragon_scales／idle |
| 565.7 KB | 0.1% | 1 | 972x149 | 4 | 1 | 565.7 KB | 1 | 0.2 KB | cookiecuttershell／idle |
| 531.6 KB | 0.1% | 1 | 840x162 | 6 | 4 | 132.9 KB | 1 | 0.3 KB | goldenshovel／idle |
| 506.8 KB | 0.1% | 1 | 816x159 | 4 | 1 | 506.8 KB | 1 | 0.2 KB | slurtle_shellpieces／idle |
| 500.5 KB | 0.1% | 1 | 860x149 | 4 | 1 | 500.5 KB | 1 | 0.2 KB | livinglog／idle |
| 497.3 KB | 0.1% | 1 | 816x156 | 4 | 1 | 497.3 KB | 1 | 0.2 KB | turf／carpet |
| 497.3 KB | 0.1% | 1 | 816x156 | 4 | 2 | 248.6 KB | 1 | 0.2 KB | turf_moon／pebblebeach |
| 495.2 KB | 0.1% | 1 | 912x139 | 4 | 1 | 495.2 KB | 1 | 0.2 KB | slurtle_slime／idle |
| 480.9 KB | 0.1% | 1 | 648x190 | 4 | 1 | 480.9 KB | 1 | 0.2 KB | goldenaxe_invisible／idle |

### 合成页总量时间线（变化点）

| 时间 | 合成页 | 页数 | 排队 |
| --- | --- | --- | --- |
| 13.5 s | 0.0 KB | 0 | 250 |
| 13.6 s | 211.3 MB | 4 | 243 |
| 13.6 s | 214.8 MB | 6 | 240 |
| 13.7 s | 251.5 MB | 9 | 235 |
| 13.7 s | 252.3 MB | 14 | 226 |
| 13.8 s | 252.6 MB | 16 | 224 |
| 13.8 s | 254.0 MB | 19 | 220 |
| 13.8 s | 254.2 MB | 20 | 219 |
| 13.8 s | 254.9 MB | 22 | 217 |
| 13.9 s | 256.3 MB | 26 | 209 |
| 13.9 s | 256.5 MB | 27 | 208 |
| 13.9 s | 268.0 MB | 28 | 205 |
| 13.9 s | 337.6 MB | 33 | 201 |
| 14.0 s | 338.9 MB | 34 | 195 |
| 14.0 s | 339.0 MB | 35 | 193 |
| 14.0 s | 353.7 MB | 36 | 192 |
| 14.0 s | 354.5 MB | 38 | 189 |
| 14.1 s | 355.0 MB | 42 | 184 |
| 14.1 s | 357.2 MB | 48 | 174 |
| 14.1 s | 358.6 MB | 51 | 166 |
| 14.1 s | 358.7 MB | 53 | 143 |
| 14.1 s | 359.9 MB | 56 | 133 |
| 14.1 s | 360.6 MB | 59 | 119 |
| 14.2 s | 363.3 MB | 63 | 106 |
| 14.2 s | 363.8 MB | 66 | 99 |
| 14.2 s | 364.5 MB | 68 | 97 |
| 14.2 s | 373.4 MB | 71 | 93 |
| 14.3 s | 373.8 MB | 72 | 91 |
| 14.3 s | 383.8 MB | 73 | 87 |
| 14.3 s | 398.2 MB | 74 | 82 |
| 14.3 s | 399.0 MB | 75 | 30 |
| 14.3 s | 400.1 MB | 77 | 27 |
| 14.4 s | 401.6 MB | 80 | 23 |
| 14.4 s | 402.1 MB | 82 | 8 |
| 14.4 s | 402.8 MB | 85 | 5 |
| 14.4 s | 404.6 MB | 89 | 1 |
| 14.4 s | 404.9 MB | 90 | 0 |
| 26.2 s | 407.0 MB | 91 | 0 |

## Cluster_1/Caves.json

稳定后：57 个外观有合成页，另有 146 个只出现过、没有合成页；合成队列剩余 0 个；实例化通道保留 123 个实体，当前绘制 42 个实例。

### 按 build 汇总

| build | 合成页 | 页数 | 外观数 | 使用实体 | 零件表估算 |
| --- | --- | --- | --- | --- | --- |
| evergreen_new | 410.8 MB | 8 | 3 | 4 | 66.7 KB |
| moonglass_bigwaterfall_steam | 117.9 MB | 4 | 3 | 26 | 31.9 KB |
| horrorfuel | 68.6 MB | 2 | 1 | 6 | 52.9 KB |
| bulb_plant_double | 57.3 MB | 2 | 1 | 1 | 35.4 KB |
| bulb_plant_springy | 43.0 MB | 1 | 1 | 1 | 23.4 KB |
| bulb_plant_single | 42.5 MB | 1 | 1 | 2 | 35.4 KB |
| grass1 | 31.2 MB | 1 | 1 | 7 | 66.9 KB |
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

### 外观（按合成页大小）

| 合成页 | 占比 | 页数 | 最大页 | 帧数 | 使用实体 | 每实体 | 每帧零件 | 零件表估算 | build／clip |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 217.1 MB | 27.2% | 4 | 3515x4048 | 79 | 1 | 217.1 MB | 6 | 22.2 KB | evergreen_new／sway1_loop_tall |
| 134.0 MB | 16.8% | 3 | 3773x3880 | 79 | 2 | 67.0 MB | 6 | 22.2 KB | evergreen_new／sway1_loop_normal |
| 71.3 MB | 8.9% | 2 | 3548x3689 | 40 | 5 | 14.3 MB | 10 | 15.9 KB | moonglass_bigwaterfall_steam／steam_big |
| 68.6 MB | 8.6% | 2 | 3618x3905 | 84 | 6 | 11.4 MB | 19 | 52.9 KB | horrorfuel／idle_loop |
| 59.7 MB | 7.5% | 1 | 4095x3822 | 79 | 1 | 59.7 MB | 6 | 22.2 KB | evergreen_new／sway1_loop_short |
| 57.3 MB | 7.2% | 2 | 3730x3832 | 84 | 1 | 57.3 MB | 9 | 35.4 KB | bulb_plant_double／idle |
| 43.0 MB | 5.4% | 1 | 3816x2955 | 50 | 1 | 43.0 MB | 10 | 23.4 KB | bulb_plant_springy／idle |
| 42.5 MB | 5.3% | 1 | 4050x2754 | 84 | 2 | 21.3 MB | 9 | 35.4 KB | bulb_plant_single／idle |
| 31.2 MB | 3.9% | 1 | 4014x2035 | 84 | 7 | 4.5 MB | 17 | 66.9 KB | grass1／idle |
| 25.0 MB | 3.1% | 1 | 3910x1676 | 40 | 11 | 2.3 MB | 5 | 8.0 KB | moonglass_bigwaterfall_steam／steam_small1 |
| 21.6 MB | 2.7% | 1 | 3696x1530 | 40 | 10 | 2.2 MB | 5 | 8.0 KB | moonglass_bigwaterfall_steam／steam_small2 |
| 14.7 MB | 1.8% | 1 | 4064x948 | 87 | 5 | 2.9 MB | 4 | 16.3 KB | nightmarefuel／idle_loop |
| 804.8 KB | 0.1% | 1 | 680x303 | 2 | 1 | 804.8 KB | 2 | 0.2 KB | swap_cavein_boulder／idle |
| 788.2 KB | 0.1% | 1 | 708x285 | 3 | 1 | 788.2 KB | 1 | 0.1 KB | lantern_mystical／idle_off |
| 750.7 KB | 0.1% | 1 | 626x307 | 2 | 2 | 375.4 KB | 2 | 0.2 KB | swap_cavein_boulder／idle |
| 703.3 KB | 0.1% | 1 | 726x248 | 6 | 1 | 703.3 KB | 1 | 0.3 KB | nightmaresword／idle |
| 646.0 KB | 0.1% | 1 | 1088x152 | 4 | 4 | 161.5 KB | 1 | 0.2 KB | twigs／idle |
| 549.0 KB | 0.1% | 1 | 884x159 | 4 | 2 | 274.5 KB | 1 | 0.2 KB | turf／sinkhole |
| 500.5 KB | 0.1% | 1 | 860x149 | 4 | 2 | 250.3 KB | 1 | 0.2 KB | livinglog／idle |
| 465.4 KB | 0.1% | 1 | 876x136 | 4 | 1 | 465.4 KB | 1 | 0.2 KB | nitre／idle |
| 461.1 KB | 0.1% | 1 | 952x124 | 4 | 4 | 115.3 KB | 1 | 0.2 KB | spoiled_food／idle |
| 445.3 KB | 0.1% | 1 | 912x125 | 4 | 3 | 148.4 KB | 1 | 0.2 KB | flint／idle |
| 437.1 KB | 0.1% | 1 | 788x142 | 4 | 1 | 437.1 KB | 1 | 0.2 KB | dreadstone／idle |
| 433.7 KB | 0.1% | 1 | 1028x108 | 4 | 1 | 433.7 KB | 1 | 0.2 KB | wax_paper／idle |
| 406.5 KB | 0.0% | 1 | 860x121 | 4 | 4 | 101.6 KB | 1 | 0.2 KB | log／idle |
| 317.6 KB | 0.0% | 1 | 308x264 | 2 | 1 | 317.6 KB | 2 | 0.2 KB | greenstaff_clockwork+staffs／greenstaff |
| 317.6 KB | 0.0% | 1 | 308x264 | 2 | 1 | 317.6 KB | 2 | 0.2 KB | greenstaff_clockwork+staffs／greenstaff |
| 317.6 KB | 0.0% | 1 | 308x264 | 2 | 1 | 317.6 KB | 2 | 0.2 KB | greenstaff_clockwork+staffs／greenstaff |
| 317.6 KB | 0.0% | 1 | 308x264 | 2 | 1 | 317.6 KB | 2 | 0.2 KB | greenstaff_clockwork+staffs／greenstaff |
| 317.6 KB | 0.0% | 1 | 308x264 | 2 | 1 | 317.6 KB | 2 | 0.2 KB | greenstaff_clockwork+staffs／greenstaff |

### 合成页总量时间线（变化点）

| 时间 | 合成页 | 页数 | 排队 |
| --- | --- | --- | --- |
| 10.9 s | 0.0 KB | 0 | 195 |
| 11.0 s | 59.7 MB | 1 | 194 |
| 11.0 s | 276.8 MB | 5 | 191 |
| 11.0 s | 410.8 MB | 8 | 187 |
| 11.0 s | 412.6 MB | 16 | 165 |
| 11.1 s | 482.1 MB | 20 | 159 |
| 11.1 s | 497.6 MB | 24 | 152 |
| 11.1 s | 499.7 MB | 32 | 124 |
| 11.1 s | 500.3 MB | 33 | 113 |
| 11.1 s | 542.8 MB | 34 | 112 |
| 11.1 s | 600.8 MB | 37 | 95 |
| 11.2 s | 601.6 MB | 38 | 66 |
| 11.2 s | 633.0 MB | 41 | 63 |
| 11.2 s | 635.2 MB | 50 | 10 |
| 11.2 s | 637.0 MB | 57 | 3 |
| 11.2 s | 638.0 MB | 60 | 0 |
| 27.2 s | 709.3 MB | 62 | 2 |
| 28.2 s | 755.9 MB | 64 | 0 |
| 30.1 s | 798.9 MB | 65 | 0 |

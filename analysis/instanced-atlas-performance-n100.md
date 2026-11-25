# InstancedMesh 帧率与内存分析

由 `node scripts/instanced-atlas-memory.mjs --port 39469 --hardware --save Cluster_1/Master.json --save Cluster_1/Caves.json --report analysis/ci/instanced-atlas-memory-n100.md --json` 生成。

## 环境

- 主机：atrium，Intel(R) N100 × 4，内存 7.5 GB，linux 7.0.2-arch1-1
- 浏览器：headless Chromium 153.0.8010.12，GL：ANGLE (Intel, Mesa Intel(R) Graphics (ADL-N), OpenGL ES 3.2)
- 报告生成时间（UTC）：2026-11-25T10:38:13.158Z
- 使用 Vite 测试服务。加载存档后原地采样 15.0 s，按游戏场景的渲染调用次数计算 FPS。
- 合成页按 WebGL RGBA8 每纹素 4 字节估算。浏览器进程 RSS 是驻留系统内存，单独列出。
- “零件表”估算：改为按零件实例化时，每帧每个零件一行 48 字节（矩阵、UV 矩形、页号）。

## 概览

| 存档 | 加载 | 分辨率 | 帧数／采样时长 | 平均 FPS | P95 帧时 | 合成页（稳定后） | 合成页峰值 | 合成中临时目标 | 实例属性 | GPU 进程 RSS 峰值／稳定 | 渲染进程 RSS 峰值／稳定 | 问题 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Cluster_1/Master.json | 23.4 s | 1280 × 720 | 842／15.0 s | 56.1 | 21.9 ms | 407.0 MB，91 页，87 个外观 | 407.0 MB（23.9 s） | 107.8 MB | 9.1 KB | 248.3 MB（13.5 s）／180.5 MB | 2947.9 MB（15.0 s）／2443.8 MB | 无 |
| Cluster_1/Caves.json | 19.3 s | 1280 × 720 | 869／15.0 s | 57.9 | 21.2 ms | 798.9 MB，65 页，57 个外观 | 798.9 MB（20.1 s） | 119.4 MB | 4.8 KB | 283.5 MB（12.0 s）／186.0 MB | 2743.4 MB（15.5 s）／2271.4 MB | 无 |

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

### 合成页总量时间线（变化点）

| 时间 | 合成页 | 页数 | 排队 |
| --- | --- | --- | --- |
| 14.6 s | 0.0 KB | 0 | 250 |
| 14.7 s | 3.1 MB | 1 | 249 |
| 14.8 s | 3.5 MB | 2 | 243 |
| 14.9 s | 214.8 MB | 6 | 242 |
| 15.1 s | 251.1 MB | 7 | 241 |
| 15.5 s | 251.3 MB | 8 | 238 |
| 15.5 s | 252.0 MB | 12 | 232 |
| 15.6 s | 252.9 MB | 17 | 227 |
| 16.1 s | 254.0 MB | 19 | 225 |
| 16.2 s | 254.9 MB | 22 | 222 |
| 16.7 s | 255.5 MB | 24 | 220 |
| 16.7 s | 256.5 MB | 27 | 217 |
| 16.8 s | 268.0 MB | 28 | 216 |
| 17.9 s | 337.9 MB | 31 | 214 |
| 17.9 s | 338.7 MB | 33 | 212 |
| 18.2 s | 353.7 MB | 36 | 207 |
| 18.3 s | 354.2 MB | 37 | 206 |
| 18.5 s | 354.5 MB | 38 | 205 |
| 18.6 s | 354.9 MB | 40 | 202 |
| 18.6 s | 355.1 MB | 43 | 198 |
| 18.6 s | 355.6 MB | 44 | 196 |
| 18.8 s | 358.2 MB | 50 | 190 |
| 18.9 s | 358.3 MB | 52 | 170 |
| 19.0 s | 358.8 MB | 54 | 167 |
| 19.1 s | 360.1 MB | 57 | 159 |
| 19.2 s | 361.3 MB | 60 | 153 |
| 19.4 s | 361.5 MB | 61 | 152 |
| 19.5 s | 363.3 MB | 64 | 147 |
| 19.6 s | 364.6 MB | 68 | 143 |
| 19.7 s | 373.5 MB | 70 | 141 |
| 19.8 s | 383.5 MB | 71 | 140 |
| 19.9 s | 397.9 MB | 72 | 139 |
| 20.3 s | 398.8 MB | 74 | 136 |
| 20.5 s | 400.7 MB | 78 | 80 |
| 20.5 s | 401.6 MB | 80 | 75 |
| 20.6 s | 404.0 MB | 88 | 2 |
| 20.6 s | 404.9 MB | 90 | 0 |
| 23.9 s | 407.0 MB | 91 | 0 |

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
| 25.0 MB | 3.1% | 1 | 3910x1676 | 40 | 12 | 2.1 MB | 5 | 8.0 KB | moonglass_bigwaterfall_steam／steam_small1 |
| 21.6 MB | 2.7% | 1 | 3696x1530 | 40 | 9 | 2.4 MB | 5 | 8.0 KB | moonglass_bigwaterfall_steam／steam_small2 |
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

### 合成页总量时间线（变化点）

| 时间 | 合成页 | 页数 | 排队 |
| --- | --- | --- | --- |
| 11.9 s | 0.0 KB | 0 | 195 |
| 12.1 s | 59.7 MB | 1 | 194 |
| 12.2 s | 276.8 MB | 5 | 191 |
| 12.3 s | 411.4 MB | 10 | 188 |
| 12.3 s | 412.0 MB | 12 | 186 |
| 12.4 s | 412.4 MB | 13 | 185 |
| 12.7 s | 481.0 MB | 15 | 184 |
| 12.7 s | 481.4 MB | 16 | 182 |
| 12.8 s | 496.1 MB | 17 | 181 |
| 12.8 s | 497.1 MB | 22 | 172 |
| 12.8 s | 499.4 MB | 30 | 159 |
| 12.9 s | 500.1 MB | 32 | 154 |
| 12.9 s | 542.7 MB | 33 | 153 |
| 13.0 s | 599.9 MB | 35 | 149 |
| 13.0 s | 601.6 MB | 38 | 145 |
| 13.0 s | 633.0 MB | 41 | 142 |
| 13.0 s | 635.2 MB | 50 | 10 |
| 13.1 s | 638.0 MB | 60 | 0 |
| 19.3 s | 709.3 MB | 62 | 2 |
| 19.5 s | 730.9 MB | 63 | 1 |
| 19.5 s | 755.9 MB | 64 | 0 |
| 20.1 s | 798.9 MB | 65 | 0 |

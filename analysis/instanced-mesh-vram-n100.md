# InstancedMesh 帧率与内存分析

由 `node scripts/instanced-atlas-memory.mjs --save Cluster_1/Master.json --save Cluster_1/Caves.json --top 0 --settle 40000 --report analysis/instanced-mesh-vram-n100.md` 生成。

## 结论（2026-11-25，n100，渲染进程内存）

新增的"渲染进程内存（按分配器）"表在加载稳定后先做完整 GC 再取 Chrome memory-infra 转储。下表是同一台机器、同一命令（`--settle 40000`）在本次改动前后的 GC 之后数字。本次改动的内容：地面纹理上传后释放 CPU 像素；纹理创建后 30 秒仍未上传的 build 页释放数据。

| 存档 | 私有内存 | GC 之后 RSS | ArrayBuffer 分区 | 加载峰值 RSS |
| --- | --- | --- | --- | --- |
| Master | 2111 MB → 1768 MB | 2090 MB → 1987 MB | 842 MB → 497 MB | 3316 MB → 3489 MB |
| Caves | 1874 MB → 1636 MB | 2190 MB → 1975 MB | 746 MB → 497 MB | 3263 MB → 3301 MB |

- 稳定后的内存降了 240–340 MB，来自 ArrayBuffer 分区。V8 堆（590–706 MB）、Blink buffer 分区（350–376 MB）、已解码图片（178 MB）和 canvas（84–87 MB）没有变化，是下一步的对象。
- 加载峰值没有下降（Master 的差异在单次测量的波动范围内）：峰值来自加载期间的瞬时解码，本次没有处理。
- Master 的 GC 之后 RSS 只降了约 100 MB，少于私有内存的降幅：释放的分区页不一定立即归还系统。

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
- 报告生成时间（UTC）：2026-11-25T13:16:23.622Z
- 使用 Vite 测试服务。加载存档后原地采样 40.0 s，按游戏场景的渲染调用次数计算 FPS。
- 合成页按 WebGL RGBA8 每纹素 4 字节估算。浏览器进程 RSS 是驻留系统内存，单独列出。
- “零件表”：合成页达到 16 MB（`PART_TABLE_COMPOSED_BYTES`）的外观改为按零件实例化，每帧每个零件槽一行 48 字节（矩阵、UV 矩形、页号）；其余外观的零件表是估算值。

## 概览

| 存档 | 加载 | 分辨率 | 帧数／采样时长 | 平均 FPS | P95 帧时 | 合成页与零件表（稳定后） | 零件表（代替的合成页） | 峰值 | 合成中临时目标 | 实例属性 | GPU 进程 RSS 峰值／稳定 | 渲染进程 RSS 峰值／稳定 | 问题 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Cluster_1/Master.json | 19.6 s | 1280 × 720 | 213／40.0 s | 5.3 | 251.8 ms | 91.0 MB，84 页，84 个外观 | 3 个，260.3 KB（308.1 MB） | 91.0 MB（19.2 s） | 29.4 MB | 15.3 KB | 717.0 MB（19.0 s）／661.7 MB | 3489.1 MB（27.5 s）／1986.4 MB | 无 |
| Cluster_1/Caves.json | 16.2 s | 1280 × 720 | 224／40.2 s | 5.6 | 192.0 ms | 27.9 MB，46 页，46 个外观 | 11 个，340.2 KB（739.0 MB） | 27.9 MB（17.1 s） | 29.4 MB | 32.1 KB | 645.8 MB（38.6 s）／619.6 MB | 3300.6 MB（31.6 s）／2278.2 MB | 无 |

## Cluster_1/Master.json

稳定后：84 个外观有合成页，3 个按零件表绘制，另有 165 个只出现过、两者都没有；合成队列剩余 0 个；实例化通道保留 219 个实体，当前绘制 114 个实例。

### 渲染进程内存（按分配器，稳定后）

完整 GC 之后：RSS 1987.1 MB，私有内存 1768.4 MB。各分配器向系统占用的大小（memory-infra `size`）；ArrayBuffer 分区包含已释放但未归还系统的空间，worker 也在渲染进程内。

| 分配器 | 大小 | memory-infra 路径 |
| --- | --- | --- |
| V8 主线程堆 | 705.5 MB | `v8/main/heap` |
| V8 worker 堆 | 2.1 MB | `v8/workers` |
| ArrayBuffer 分区 | 497.4 MB | `partition_alloc/partitions/array_buffer` |
| Blink buffer 分区 | 376.3 MB | `partition_alloc/partitions/buffer` |
| Blink fast_malloc 分区 | 0.0 KB | `partition_alloc/partitions/fast_malloc` |
| Blink layout 分区 | 0.0 KB | `partition_alloc/partitions/layout` |
| 已解码图片（cc） | 178.3 MB | `cc/image_memory` |
| 2D canvas | 87.3 MB | `canvas` |
| malloc | 172.6 MB | `malloc` |
| 共享内存 | 226.9 MB | `shared_memory` |
| GPU 客户端 | 17.0 MB | `gpu` |
| Blink 资源缓存 | 35.3 MB | `web_cache` |
| Blink GC 堆 | 33.8 MB | `blink_gc` |

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
| nitre | 465.4 KB | 1 | 1 | 4 | 0.2 KB |
| flint | 445.3 KB | 1 | 1 | 8 | 0.2 KB |
| spider_gland | 435.4 KB | 1 | 1 | 2 | 0.2 KB |
| wax_paper | 433.7 KB | 1 | 1 | 2 | 0.2 KB |
| sewing_kit | 429.6 KB | 1 | 1 | 2 | 0.2 KB |
| swap_hammer | 421.4 KB | 1 | 1 | 2 | 0.2 KB |
| moon_fissure | 409.8 KB | 1 | 1 | 11 | 0.9 KB |
| log | 406.5 KB | 1 | 1 | 9 | 0.2 KB |
| blueprint_sketch | 402.2 KB | 1 | 1 | 3 | 0.1 KB |
| glommer_fuel | 399.8 KB | 1 | 1 | 2 | 0.2 KB |
| driftwood_log | 382.4 KB | 1 | 1 | 1 | 0.2 KB |
| palmcone_seed | 378.9 KB | 1 | 1 | 1 | 0.2 KB |
| palmcone_scale | 329.1 KB | 1 | 1 | 3 | 0.2 KB |
| goldenpickaxe | 301.9 KB | 1 | 1 | 3 | 0.0 KB |
| pickaxe | 301.9 KB | 1 | 1 | 1 | 0.0 KB |
| seeds | 301.9 KB | 1 | 1 | 4 | 0.2 KB |
| torch_barber | 282.1 KB | 1 | 1 | 1 | 0.1 KB |
| bone_shards | 274.6 KB | 1 | 1 | 3 | 0.2 KB |
| poop | 274.1 KB | 1 | 1 | 11 | 0.1 KB |
| gold_nugget | 240.2 KB | 1 | 1 | 4 | 0.2 KB |
| boards | 237.2 KB | 1 | 1 | 1 | 0.0 KB |
| staffs | 229.1 KB | 1 | 1 | 1 | 0.2 KB |
| hat_dreadstone_horn | 220.7 KB | 1 | 1 | 1 | 0.0 KB |
| walrus_tusk | 213.2 KB | 1 | 1 | 1 | 0.1 KB |
| amulets | 211.2 KB | 1 | 1 | 2 | 0.1 KB |
| wall_moonrock | 206.7 KB | 1 | 1 | 1 | 0.1 KB |
| cutstone | 205.6 KB | 1 | 1 | 1 | 0.0 KB |
| rocks | 173.5 KB | 2 | 2 | 2 | 0.1 KB |
| trinkets | 156.7 KB | 2 | 2 | 2 | 0.1 KB |
| feather_crow | 148.5 KB | 1 | 1 | 5 | 0.1 KB |
| hounds_tooth | 148.0 KB | 1 | 1 | 2 | 0.1 KB |
| shroom_skin | 147.3 KB | 1 | 1 | 1 | 0.2 KB |
| moonglass | 144.8 KB | 1 | 1 | 1 | 0.1 KB |
| footballhat_combathelm2 | 143.2 KB | 1 | 1 | 1 | 0.0 KB |
| cutreeds | 137.5 KB | 1 | 1 | 3 | 0.0 KB |
| pinecone | 128.3 KB | 1 | 1 | 1 | 0.0 KB |
| beardhair | 123.9 KB | 1 | 1 | 1 | 0.0 KB |
| beefalo_wool | 121.5 KB | 1 | 1 | 2 | 0.0 KB |
| moon_tree | 118.5 KB | 0 | 1 | 2 | 118.5 KB |
| charcoal | 110.7 KB | 1 | 1 | 1 | 0.0 KB |
| horrorfuel | 74.8 KB | 0 | 1 | 2 | 74.8 KB |
| reeds | 66.9 KB | 0 | 1 | 4 | 66.9 KB |
| pan_flute | 56.2 KB | 1 | 1 | 3 | 0.0 KB |
| rock_avocado_fruit_build | 52.4 KB | 1 | 1 | 1 | 0.1 KB |
| cook_pot_food | 51.3 KB | 1 | 1 | 1 | 0.0 KB |
| pig_token | 45.0 KB | 1 | 1 | 1 | 0.2 KB |
| stinger | 33.7 KB | 1 | 1 | 3 | 0.0 KB |

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
| 445.3 KB | 0.5% | 1 | 912x125 | 4 | 8 | 55.7 KB | 1 | 0.2 KB | flint／idle |
| 435.4 KB | 0.5% | 1 | 748x149 | 4 | 2 | 217.7 KB | 1 | 0.2 KB | spider_gland／idle |
| 433.7 KB | 0.5% | 1 | 1028x108 | 4 | 2 | 216.8 KB | 1 | 0.2 KB | wax_paper／idle |
| 429.6 KB | 0.5% | 1 | 780x141 | 4 | 2 | 214.8 KB | 1 | 0.2 KB | sewing_kit／idle |
| 421.4 KB | 0.5% | 1 | 724x149 | 4 | 2 | 210.7 KB | 1 | 0.2 KB | swap_hammer／idle |
| 409.8 KB | 0.4% | 1 | 2440x43 | 20 | 11 | 37.3 KB | 1 | 0.9 KB | moon_fissure／crack_idle |
| 406.5 KB | 0.4% | 1 | 860x121 | 4 | 9 | 45.2 KB | 1 | 0.2 KB | log／idle |
| 402.2 KB | 0.4% | 1 | 792x130 | 3 | 3 | 134.1 KB | 1 | 0.1 KB | blueprint_sketch／idle |
| 399.8 KB | 0.4% | 1 | 832x123 | 4 | 2 | 199.9 KB | 1 | 0.2 KB | glommer_fuel／idle |
| 382.4 KB | 0.4% | 1 | 736x133 | 4 | 1 | 382.4 KB | 1 | 0.2 KB | driftwood_log／idle |
| 378.9 KB | 0.4% | 1 | 688x141 | 4 | 1 | 378.9 KB | 1 | 0.2 KB | palmcone_seed／idle |
| 329.1 KB | 0.4% | 1 | 720x117 | 4 | 3 | 109.7 KB | 1 | 0.2 KB | palmcone_scale／idle |
| 301.9 KB | 0.3% | 1 | 278x278 | 1 | 3 | 100.6 KB | 1 | 0.0 KB | goldenpickaxe／idle |
| 301.9 KB | 0.3% | 1 | 278x278 | 1 | 1 | 301.9 KB | 1 | 0.0 KB | pickaxe／idle |
| 301.9 KB | 0.3% | 1 | 840x92 | 4 | 4 | 75.5 KB | 1 | 0.2 KB | seeds／idle |
| 295.7 KB | 0.3% | 1 | 290x261 | 2 | 1 | 295.7 KB | 2 | 0.2 KB | starstaff_relic+staffs／yellowstaff |
| 295.7 KB | 0.3% | 1 | 290x261 | 2 | 1 | 295.7 KB | 2 | 0.2 KB | starstaff_relic+staffs／yellowstaff |
| 282.1 KB | 0.3% | 1 | 675x107 | 3 | 1 | 282.1 KB | 1 | 0.1 KB | torch_barber／idle |
| 280.8 KB | 0.3% | 1 | 302x238 | 1 | 1 | 280.8 KB | 4 | 0.2 KB | sapling／empty |
| 274.6 KB | 0.3% | 1 | 676x104 | 4 | 3 | 91.5 KB | 1 | 0.2 KB | bone_shards／idle |
| 274.1 KB | 0.3% | 1 | 484x145 | 2 | 11 | 24.9 KB | 1 | 0.1 KB | poop／idle |
| 240.2 KB | 0.3% | 1 | 580x106 | 4 | 4 | 60.0 KB | 1 | 0.2 KB | gold_nugget／idle |
| 237.2 KB | 0.3% | 1 | 345x176 | 1 | 1 | 237.2 KB | 1 | 0.0 KB | boards／idle |
| 229.1 KB | 0.2% | 1 | 230x255 | 2 | 1 | 229.1 KB | 2 | 0.2 KB | staffs／purplestaff |
| 223.9 KB | 0.2% | 1 | 356x161 | 2 | 4 | 56.0 KB | 1 | 0.1 KB | gems／redgem_idle |
| 220.7 KB | 0.2% | 1 | 250x226 | 1 | 1 | 220.7 KB | 1 | 0.0 KB | hat_dreadstone_horn／anim |
| 213.2 KB | 0.2% | 1 | 642x85 | 3 | 1 | 213.2 KB | 1 | 0.1 KB | walrus_tusk／idle |
| 213.0 KB | 0.2% | 1 | 376x145 | 2 | 25 | 8.5 KB | 1 | 0.1 KB | grass1／picked |
| 211.2 KB | 0.2% | 1 | 496x109 | 2 | 2 | 105.6 KB | 1 | 0.1 KB | amulets／redamulet |
| 206.7 KB | 0.2% | 1 | 370x143 | 2 | 1 | 206.7 KB | 1 | 0.1 KB | wall_moonrock／idle |
| 205.6 KB | 0.2% | 1 | 277x190 | 1 | 1 | 205.6 KB | 1 | 0.0 KB | cutstone／idle |
| 190.1 KB | 0.2% | 1 | 338x144 | 2 | 2 | 95.1 KB | 1 | 0.1 KB | gems／orangegem_idle |
| 165.3 KB | 0.2% | 1 | 328x129 | 2 | 1 | 165.3 KB | 1 | 0.1 KB | gems／purplegem_idle |
| 162.9 KB | 0.2% | 1 | 316x132 | 2 | 4 | 40.7 KB | 1 | 0.1 KB | gems／bluegem_idle |
| 148.5 KB | 0.2% | 1 | 442x86 | 2 | 5 | 29.7 KB | 1 | 0.1 KB | feather_crow／idle |
| 148.0 KB | 0.2% | 1 | 354x107 | 3 | 2 | 74.0 KB | 1 | 0.1 KB | hounds_tooth／idle |
| 147.3 KB | 0.2% | 1 | 460x82 | 4 | 1 | 147.3 KB | 1 | 0.2 KB | shroom_skin／idle |
| 144.8 KB | 0.2% | 1 | 334x111 | 2 | 1 | 144.8 KB | 1 | 0.1 KB | moonglass／f3 |
| 143.2 KB | 0.2% | 1 | 206x178 | 1 | 1 | 143.2 KB | 1 | 0.0 KB | footballhat_combathelm2／anim |
| 137.5 KB | 0.1% | 1 | 200x176 | 1 | 3 | 45.8 KB | 1 | 0.0 KB | cutreeds／idle |
| 128.3 KB | 0.1% | 1 | 216x152 | 1 | 1 | 128.3 KB | 1 | 0.0 KB | pinecone／idle |
| 123.9 KB | 0.1% | 1 | 225x141 | 1 | 1 | 123.9 KB | 1 | 0.0 KB | beardhair／idle |
| 121.5 KB | 0.1% | 1 | 213x146 | 1 | 2 | 60.7 KB | 1 | 0.0 KB | beefalo_wool／idle |
| 110.7 KB | 0.1% | 1 | 210x135 | 1 | 1 | 110.7 KB | 1 | 0.0 KB | charcoal／idle |
| 89.4 KB | 0.1% | 1 | 194x118 | 1 | 1 | 89.4 KB | 1 | 0.0 KB | rocks／f1 |
| 86.8 KB | 0.1% | 1 | 167x133 | 1 | 1 | 86.8 KB | 1 | 0.0 KB | trinkets／6 |
| 85.6 KB | 0.1% | 1 | 189x116 | 1 | 1 | 85.6 KB | 1 | 0.0 KB | grass1／idle_dead |
| 84.1 KB | 0.1% | 1 | 194x111 | 1 | 1 | 84.1 KB | 1 | 0.0 KB | rocks／f3 |
| 69.9 KB | 0.1% | 1 | 153x117 | 1 | 1 | 69.9 KB | 1 | 0.0 KB | trinkets／1 |
| 56.2 KB | 0.1% | 1 | 119x121 | 1 | 3 | 18.7 KB | 1 | 0.0 KB | pan_flute／idle |
| 52.4 KB | 0.1% | 1 | 109x123 | 1 | 1 | 52.4 KB | 2 | 0.1 KB | rock_avocado_fruit_build／idle |
| 51.3 KB | 0.1% | 1 | 101x130 | 1 | 1 | 51.3 KB | 1 | 0.0 KB | cook_pot_food／idle |
| 45.0 KB | 0.0% | 1 | 320x36 | 4 | 1 | 45.0 KB | 1 | 0.2 KB | pig_token／idle |
| 33.7 KB | 0.0% | 1 | 127x68 | 1 | 3 | 11.2 KB | 1 | 0.0 KB | stinger／idle |

### 合成页总量时间线（变化点）

| 时间 | 合成页 | 页数 | 排队 |
| --- | --- | --- | --- |
| 12.8 s | 118.5 KB | 0 | 249 |
| 12.9 s | 528.3 KB | 1 | 243 |
| 12.9 s | 3.7 MB | 2 | 241 |
| 12.9 s | 4.7 MB | 8 | 231 |
| 12.9 s | 6.7 MB | 15 | 224 |
| 12.9 s | 20.5 MB | 23 | 216 |
| 12.9 s | 21.6 MB | 26 | 212 |
| 13.0 s | 38.9 MB | 33 | 202 |
| 13.0 s | 40.6 MB | 39 | 194 |
| 13.0 s | 43.4 MB | 48 | 166 |
| 13.0 s | 45.5 MB | 54 | 152 |
| 13.0 s | 48.2 MB | 59 | 145 |
| 13.1 s | 57.1 MB | 62 | 142 |
| 13.1 s | 57.5 MB | 63 | 141 |
| 13.1 s | 67.5 MB | 64 | 140 |
| 13.1 s | 82.0 MB | 65 | 139 |
| 13.2 s | 82.8 MB | 67 | 136 |
| 13.2 s | 85.2 MB | 72 | 78 |
| 13.2 s | 87.7 MB | 80 | 3 |
| 13.2 s | 88.9 MB | 83 | 0 |
| 19.2 s | 91.0 MB | 84 | 0 |

## Cluster_1/Caves.json

稳定后：46 个外观有合成页，11 个按零件表绘制，另有 146 个只出现过、两者都没有；合成队列剩余 0 个；实例化通道保留 123 个实体，当前绘制 189 个实例。

### 渲染进程内存（按分配器，稳定后）

完整 GC 之后：RSS 1974.5 MB，私有内存 1635.6 MB。各分配器向系统占用的大小（memory-infra `size`）；ArrayBuffer 分区包含已释放但未归还系统的空间，worker 也在渲染进程内。

| 分配器 | 大小 | memory-infra 路径 |
| --- | --- | --- |
| V8 主线程堆 | 593.1 MB | `v8/main/heap` |
| V8 worker 堆 | 2.1 MB | `v8/workers` |
| ArrayBuffer 分区 | 497.0 MB | `partition_alloc/partitions/array_buffer` |
| Blink buffer 分区 | 358.1 MB | `partition_alloc/partitions/buffer` |
| Blink fast_malloc 分区 | 0.0 KB | `partition_alloc/partitions/fast_malloc` |
| Blink layout 分区 | 0.0 KB | `partition_alloc/partitions/layout` |
| 已解码图片（cc） | 178.3 MB | `cc/image_memory` |
| 2D canvas | 83.8 MB | `canvas` |
| malloc | 161.9 MB | `malloc` |
| 共享内存 | 228.6 MB | `shared_memory` |
| GPU 客户端 | 17.0 MB | `gpu` |
| Blink 资源缓存 | 35.3 MB | `web_cache` |
| Blink GC 堆 | 35.5 MB | `blink_gc` |

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
| evergreen_new | 66.7 KB | 0 | 3 | 4 | 66.7 KB |
| moonglass_bigwaterfall_steam | 37.5 KB | 0 | 3 | 26 | 37.5 KB |
| bulb_plant_single | 35.4 KB | 0 | 1 | 2 | 35.4 KB |
| bulb_plant_double | 35.4 KB | 0 | 1 | 1 | 35.4 KB |
| bulb_plant_springy | 23.4 KB | 0 | 1 | 1 | 23.4 KB |

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
| 9.4 KB | 24.8 MB | 40 | 5 | 12 | moonglass_bigwaterfall_steam／steam_small1 |
| 9.4 KB | 21.5 MB | 40 | 5 | 9 | moonglass_bigwaterfall_steam／steam_small2 |

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
| 144.6 KB | 0.5% | 1 | 198x187 | 1 | 1 | 144.6 KB | 2 | 0.1 KB | heatrock_fantasy／3 |
| 128.3 KB | 0.4% | 1 | 216x152 | 1 | 2 | 64.1 KB | 1 | 0.0 KB | pinecone／idle |
| 127.5 KB | 0.4% | 1 | 441x74 | 3 | 2 | 63.7 KB | 1 | 0.1 KB | mushrooms／inground |
| 126.3 KB | 0.4% | 1 | 202x160 | 1 | 2 | 63.1 KB | 1 | 0.0 KB | cave_ferns／f5 |
| 123.9 KB | 0.4% | 1 | 225x141 | 1 | 1 | 123.9 KB | 1 | 0.0 KB | beardhair／idle |
| 111.2 KB | 0.4% | 1 | 186x153 | 1 | 1 | 111.2 KB | 1 | 0.0 KB | cave_ferns／f1 |
| 110.7 KB | 0.4% | 1 | 210x135 | 1 | 1 | 110.7 KB | 1 | 0.0 KB | charcoal／idle |
| 108.9 KB | 0.4% | 1 | 170x164 | 1 | 1 | 108.9 KB | 1 | 0.0 KB | cave_ferns／f10 |
| 106.6 KB | 0.4% | 1 | 210x130 | 1 | 1 | 106.6 KB | 1 | 0.0 KB | thulecite_pieces／anim |
| 104.0 KB | 0.4% | 1 | 193x138 | 1 | 1 | 104.0 KB | 1 | 0.0 KB | cave_ferns／f9 |
| 103.3 KB | 0.4% | 1 | 234x113 | 1 | 1 | 103.3 KB | 1 | 0.0 KB | silk／idle |
| 96.5 KB | 0.3% | 1 | 190x130 | 1 | 1 | 96.5 KB | 1 | 0.0 KB | cave_ferns／f6 |
| 89.4 KB | 0.3% | 1 | 194x118 | 1 | 2 | 44.7 KB | 1 | 0.0 KB | rocks／f1 |
| 84.1 KB | 0.3% | 1 | 194x111 | 1 | 3 | 28.0 KB | 1 | 0.0 KB | rocks／f3 |
| 80.4 KB | 0.3% | 1 | 117x176 | 1 | 1 | 80.4 KB | 1 | 0.0 KB | cave_ferns／f7 |
| 79.8 KB | 0.3% | 1 | 140x146 | 1 | 2 | 39.9 KB | 1 | 0.0 KB | cave_ferns／f3 |

### 合成页总量时间线（变化点）

| 时间 | 合成页 | 页数 | 排队 |
| --- | --- | --- | --- |
| 10.6 s | 66.7 KB | 0 | 190 |
| 10.6 s | 301.3 KB | 2 | 188 |
| 10.7 s | 1.2 MB | 4 | 184 |
| 10.7 s | 2.1 MB | 6 | 182 |
| 10.7 s | 17.7 MB | 10 | 176 |
| 10.7 s | 19.9 MB | 19 | 161 |
| 10.7 s | 20.9 MB | 22 | 149 |
| 10.7 s | 23.1 MB | 29 | 140 |
| 10.8 s | 25.2 MB | 37 | 9 |
| 10.8 s | 26.6 MB | 42 | 4 |
| 10.8 s | 27.8 MB | 46 | 0 |
| 16.0 s | 27.9 MB | 46 | 0 |
| 17.1 s | 27.9 MB | 46 | 0 |

# DST 静态布局导入（default_pigking）

DST 的世界生成会把 `map/static_layouts/*.lua` 里的 Tiled 地图摆进世界：`BG_TILES` 图层写地皮，`FG_OBJECTS` 图层放置实体。本项目用脚本把这些源布局转换成数据，由运行时在猪王位置摆放；猪王预制体本身（`pigking.lua`）不创建任何地皮。目前只导入 `default_pigking`。

源码根目录：`/data/copy/AssetArchive-Dev/data/DST/data/databundles/scripts_unpacked/scripts/`。

## 涉及的源文件

| 源文件 | 作用 |
| --- | --- |
| `map/static_layouts/default_pigking.lua` | Tiled 导出的布局：32 × 32 的 `BG_TILES`（`tilewidth = 16`）和 `FG_OBJECTS`（`insanityrock`、`sanityrock`、`pigking`） |
| `map/static_layout.lua` | `ConvertStaticLayoutToLayout`：`GROUND_TYPES` 顺序、地皮取样和对象坐标换算 |
| `map/layouts.lua`（`DefaultPigking`） | 布局的放置参数：`layout_position = CENTER`，未设置 `disable_transform` |
| `map/object_layout.lua`（`ReserveAndPlaceLayout`） | 地皮写入：`SetTile(position[1] + column, position[2] + row, ground_types[value])`，以及随机旋转／翻转 |
| `prefabs/nightmarerock.lua`、`stategraphs/SGnightmarerock.lua` | 布局放置的 `sanityrock` / `insanityrock` |

## 导入命令

需要 `luajit`（用来执行 Lua 布局文件）和 Python 3。

```bash
python3 packages/prefab/scripts/import-static-layouts.py            # 生成 packages/prefab/src/staticLayouts.json
python3 packages/prefab/scripts/import-static-layouts.py --check    # 校验 JSON 与源布局一致，不一致时报错
python3 packages/prefab/scripts/import-static-layouts.py --source /path/to/DST/data
```

等价的包脚本：`pnpm --filter @dontstarve-web/prefab static-layouts:import` / `static-layouts:check`。`--source` 默认是上面的 `.../DST/data`。导入的布局列表在脚本的 `LAYOUTS` 常量里，新增布局时加入文件名（不含 `.lua`）即可。

## 转换规则（与 `static_layout.lua` 一致）

1. **取样**：`tilefactor = ceil(64 / tilewidth)`。`default_pigking` 的 `tilewidth = 16`，所以 `tilefactor = 4`，`BG_TILES` 的 32 × 32 个格子只取每隔 4 格的一个，得到 8 × 8 的 `ground[row][column]`；`0` 表示不写地皮。取样从第 `width * (tilefactor - 1)` 个数据开始，每行取 `1, 1 + tilefactor, …` 列，下一行再跳过 `width * (tilefactor - 1)` 个数据。
2. **地皮名**：取样值是 `GROUND_TYPES` 的 1 起始下标（顺序见 `static_layout.lua`，如 `6 → GRASS`、`9 → WOODFLOOR`），脚本从源文件读取该表并输出 `WORLD_TILES` 名称，不在脚本里写死。
3. **对象坐标**（地皮单位，相对布局中心）：
   `x = (obj.x + obj.width / 2) / 64 − (layout.width / tilefactor) / 2`，`y` 同理使用 `obj.y`、`obj.height`、`layout.height`。
4. **输出**：`packages/prefab/src/staticLayouts.json`，键为布局名：

   ```json
   { "default_pigking": {
       "ground": [[null, null, "GRASS", "…"]],
       "objects": [{ "prefab": "insanityrock", "x": -2.125, "y": 0.125 }]
   } }
   ```

   `objects` 按 prefab、x、y 排序，保证输出稳定。`PrefabSwaps`（活动期间的 prefab 替换）不处理。

当前 `default_pigking` 的结果：8 × 8 的八边形，40 块 `GRASS` 加中央 12 块 `WOODFLOOR`；4 块 `insanityrock` 位于约 ±2.1 格的十字方向，4 块 `sanityrock` 位于约 ±1.1 格的对角方向，`pigking` 在中心（`0, 0`）。

## 运行时摆放

`placeStaticLayout(id, anchor, anchorPrefab)`（`packages/prefab/src/staticLayout.ts`）把 JSON 转成世界坐标，单位为场景单位（一个地皮 `TILE_SIZE = 12`，对应原版 4 单位）：

- 以锚点（猪王位置）最近的**地皮角点**为布局中心，`ground[row][column]` 的格子中心为 `corner + (index − size / 2 + 0.5) × TILE_SIZE`（`column → x`，`row → z`）。
- 对象位置为 `corner + (x, y) × TILE_SIZE`（`y → z`）；与 `anchorPrefab` 同名的对象（猪王）不单独返回，由存档中的猪王记录决定它的位置。
- 主场景（`src/sceneEntities.ts`）对每个猪王调用它，把格子登记到 `TurfMap.setOriginalTile`，不覆盖存档里已挖掘的地皮。

岩石是普通实体：`initial-world.json` 与 `initial-world copy.json` 的 `entities.sanityrock` / `entities.insanityrock` 就是按上面的公式从布局算出的位置（猪王在 `(0, 0, 25)`，角点为 `(0, 24)`），由 `NightmareRockManager` 恢复。需要重新生成这些记录时，用同一公式并保持 `e_<prefab>_<6 位序号>` 的 ID 格式。

## 与原版 worldgen 的差异

- 原版 `ReserveAndPlaceLayout` 会随机 `switch_xy` / `flip_x` / `flip_y`；这里使用作者原朝向。8 × 8 地皮在这些变换下对称，只有岩石的位置会受影响。
- 原版布局中心恰好是地皮角点，猪王也在角点上；初始存档的猪王在 `z = 25`，因此猪王不动，地皮和岩石对齐最近的角点 `z = 24`。
- 原版的 `start_mask` / `fill_mask` / `ReserveSpace`（避开不可通行或已占用区域）没有对应实现：布局直接覆盖存档地图。

## 从完整存档导入局部洞穴地形

完整存档已经保存了布局放置后的地皮，因此局部导入直接读取最终 `map.tiles`，不重新运行静态布局；实体另从白名单内的 `savedata.ents` 分组读取。工具只接受可读的开发版 Lua 世界快照；用字面量解析器读取 table，不执行存档 Lua。压缩的正式版快照暂不支持。

```bash
python3 scripts/import-dst-region.py \
  --shard public/saves/Cluster_58/Caves \
  --output public/saves/Cluster_1/Caves.json --origin-cell 281 392

# 逐格转换结果及来源报告与现有文件必须一致；不写文件
python3 scripts/import-dst-region.py \
  --shard public/saves/Cluster_58/Caves \
  --output public/saves/Cluster_1/Caves.json --origin-cell 281 392 --check
```

参数：`--shard` 指向原版 Caves 目录；先从 `save/shardindex` 找到活动 Session，再选择最新的十位编号世界快照，也可以用 `--snapshot 0000000022` 固定编号。`--template` 默认是项目 `initial-world.json`，只沿用格式、版本及时间戳等外壳信息；角色恢复为满状态的空背包威尔逊，不复制模板世界实体或原版玩家。`--regions` 接受一个或多个拓扑任务名，默认 `BlueForest MoonCaveForest ArchiveMaze CaveExitTask1`，第一项决定玩家出生区域。`--origin-cell COL ROW` 固定源地图中的新原点格，扩展选区时沿用报告中的 `sourceOriginCell`，避免已有地形发生平移；省略时按本次选区包围盒计算原点。

转换按 `topology.ids` 的任务前缀选节点，再用 `nodeidtilemap` 选择对应格子，避免仅按地皮 ID 筛选而漏掉区域内的泥地、岩地和玩家铺设地皮。两张栅格都校验 `VRSN` 版本及 `9 + width × height × 2` 字节长度，按小端 uint16 解码；源地皮 ID 先通过快照的 `world_tile_map` 还原名称，再映射到项目当前 ID。遇到缺失资源的地皮直接报错。

保留源格子的相对位置和朝向，以整个选区包围盒中心附近的整数格作为新原点，一个原版 4 单位地皮对应项目 12 单位。稀疏 `world.map.tiles` 保存选区地皮；`defaultTileId: 1` 表示所有缺失格为 `IMPASSABLE`。原有虚空和 `FAKE_GROUND` 不绘制、不通行，不生成连接桥或填补原版缺口。白名单之外的实体、桥梁、墙、生物、光源及地下环境规则尚未迁移。

实体白名单位于 `scripts/import-dst-region.py` 的 `ENTITY_WHITELIST`，当前包含 `pighead`、`archive_moon_statue`、`cave_exit`、`mushtree_moon`、`mushtree_medium`、`mushtree_tall`、`blue_mushroom` 以及 8 个月亮洞穴水池 prefab（`grotto_pool_big`、`grotto_pool_small`、`grotto_moonglass_1/3/4`、`grotto_waterfall_big`、`grotto_waterfall_small1/2`），每项绑定专用的源状态转换函数。只解析名单内的实体分组，再按源坐标对应的 `nodeidtilemap` 节点筛选区域；位于选区外的同名实体不会导入。筛选不额外要求脚点地皮可通行，以免删除原版悬边位置上的实体。两个 prefab 的原版记录不保存旋转，项目记录使用 `rotationY: 0`。

实体的连续栅格坐标必须使用 `gx = x / 4 + width / 2 + 0.5`、`gz = z / 4 + height / 2 + 0.5`，与 `map/bunch_spawner.lua`、`map/waterlog_worldgen.lua` 的 `checkIfValidGround` 一致；向下取整后查询节点，项目位置为 `((gx - origin_col) × 12, y × 3, (gz - origin_row) × 12)`。这里的半格偏移不能省略，否则所有实体在 X/Z 方向各偏移 6 个项目单位。当前 `(471, 471)` 地图和 `(281, 392)` 原点对应平移 `(-540, 0, -1872)`。猪头布局按 `resurrectionstone.lua` 位于 2×2 木地板外围四边的中点；修正后 31 座月亮雕像的脚点均位于 `ARCHIVE` 地皮，原先部分落在虚空是错误换算造成的。

`pighead` 的 `data.burnt` 转为 `components.building.burnt`，正常状态为 `state: "idle"`；`archive_moon_statue` 的 `data.anim`（1～4）转为 `components.archiveProp.anim`。按 `stickheads.lua`、`archive_props.lua` 和 `workable.lua`，两者不持久化敲击／开采进度；猪头的醒睡状态由世界状态重建。未知状态、无对应支持的皮肤或平台数据报错，避免静默丢失。新增白名单项时必须提供状态转换函数，不能把任意 Lua `data` 直接写入项目组件。

月亮洞穴水池：`grotto_pool_big` 的 `children_ids` / `children_indexes`（1～5）和 `grotto_pool_small` 的 `wf_id`（索引 1）先作为源 GUID 暂存，全部实体转换后由 `link_grotto_pools` 换成项目实体 ID，只保留已导入的子物件，写入 `components.grottoPool.children`；可开采的 `grotto_moonglass_*` / `grotto_waterfall_small*` 把 `workable.workleft`（`maxwork` 必须是 -1）转为 `components.grottoGlass.workleft`，`grotto_waterfall_big` 不接受任何状态。当前 `Cluster_58` 选区含 5 个大池、21 个小池及全部子物件，没有选区外的同名实体。

实体 ID 包含源 Session、prefab 和源 `id`；源记录未保存 `id` 时使用筛选前的原分组序号，因此同一快照重复导入保持 ID 稳定。`Caves.import.json` 记录 `entityWhitelist`、各 prefab 的源数量／导入数量／选区外数量，以及每个实体的源序号、源 ID、源位置和所属节点。当前导入 4 个猪头、31 座月亮雕像和 1 个 `cave_exit`（另 9 个在选区外；其 `worldmigrator` 状态属于尚未接入的分片连接，不导入）；另外 3 个猪头和 3 座雕像位于选区外。

本次 `Cluster_58` 快照 `0000000022` 选中 29 个节点，导出 4,173 格陆地和 136 格 `FAKE_GROUND`。拓扑连接是出口绿地 → 蓝蘑菇林 → 月亮蘑菇林 → 远古档案馆；`CaveExitTask1` 包含 `CaveExitRoom` 和 `RabbitArea`，补入蓝蘑菇林周边楼梯所在的 433 格 `SINKHOLE` 绿地及连接处的 6 格蓝蘑菇地皮。新增区域沿用原点 `(281, 392)`，此前导入的地皮位置、地图尺寸与玩家出生点保持一致。楼梯实体本身仍属于后续实体迁移。结果为 `public/saves/Cluster_1/Caves.json`，来源、SHA-256、源地图尺寸、节点名单、坐标平移和地皮数量写入同目录 `Caves.import.json`。

直接访问页面（部署在子路径时保留该子路径）默认加载 `Cluster_1/Caves.json`，无需 URL 参数；可用 `?save=initial-world.json` 加载原地表存档。`save` 只接受 `public/saves` 下由字母、数字、下划线、连字符组成的相对 JSON 路径。加载器接受 `world.prefab: "cave"`，要求洞穴背景为 `IMPASSABLE`；渲染关闭整片落叶林底面，使用黑色虚空，世界地形与地图界面共用地皮边界。键盘移动、点击寻路及土地分类共用通行判断。`c_save()` 仍下载 `initial-world.json`，保留洞穴类型、虚空背景、稀疏地皮和实体身份／位置／烧毁状态／雕像外形；将下载文件替换到当前所选路径后重载。现有 `c_spawn("pighead")`、`c_spawn("archive_moon_statue")` 的命令支持不变，白名单只控制原存档导入。

验证命令：

```bash
python3 -m unittest discover -s tests -p test_dst_region.py
pnpm --filter @dontstarve-web/animation exec vitest run tests/caveTerrain.test.ts tests/stickheads.test.ts tests/archive_props.test.ts
pnpm --filter @dontstarve-web/ui exec playwright test tests/cave-terrain.spec.ts
```

## 校验

```bash
python3 packages/prefab/scripts/import-static-layouts.py --check
cd packages/animation && npx vitest run tests/pigKing.test.ts tests/nightmareRock.test.ts
cd packages/ui && npx playwright test tests/pigking.spec.ts
```

`pigKing.test.ts` 检查 40 / 12 块地皮、角点对齐和岩石坐标；`pigking.spec.ts` 在真实场景中检查 8 块岩石、草地图层、`c_spawn("insanityrock")` 以及 `c_save()` 后的实体数量和 ID 唯一性。

蘑菇类白名单项：`mushtree_moon`（407 棵）、`mushtree_tall`（321 棵）、`blue_mushroom`（109 个）已导入，选区内没有 `mushtree_medium`（460 棵均在选区外）。蘑菇树的 `growable` / `treestate` / `stump` / `burnt` 转为 `components.growable` / `components.mushtree`，`plantregrowth` 不导入；`blue_mushroom` 的开合姿态由世界时钟重建，仅保存 `rain`。

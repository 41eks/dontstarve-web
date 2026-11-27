# DST 静态布局导入（default_pigking）

DST 的世界生成会把 `map/static_layouts/*.lua` 里的 Tiled 地图摆进世界：`BG_TILES` 图层写地皮，`FG_OBJECTS` 图层放置实体。本项目在存档里完成这一步：从 DST 导入的存档地图已带有 worldgen 写好的地皮；手写的初始存档由脚本把源布局的地皮写进 `world.map.tiles`。运行时不摆放布局，猪王预制体本身（`pigking.lua`）也不创建任何地皮。目前只处理 `default_pigking`。

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
python3 packages/prefab/scripts/import-static-layouts.py            # 把布局地皮写进默认的初始存档
python3 packages/prefab/scripts/import-static-layouts.py --check    # 校验存档已含布局地皮与岩石，不写文件
python3 packages/prefab/scripts/import-static-layouts.py public/saves/initial-world.json   # 只处理指定存档
python3 packages/prefab/scripts/import-static-layouts.py --source /path/to/DST/data
```

等价的包脚本：`pnpm --filter @dontstarve-web/prefab static-layouts:import` / `static-layouts:check`。`--source` 默认是上面的 `.../DST/data`。布局及其锚点 prefab 在脚本的 `LAYOUTS` 常量里（`{'default_pigking': 'pigking'}`）；默认处理的存档在 `DEFAULT_SAVES`，保留每个文件原有的缩进。

## 转换规则（与 `static_layout.lua` 一致）

1. **取样**：`tilefactor = ceil(64 / tilewidth)`。`default_pigking` 的 `tilewidth = 16`，所以 `tilefactor = 4`，`BG_TILES` 的 32 × 32 个格子只取每隔 4 格的一个，得到 8 × 8 的 `ground[row][column]`；`0` 表示不写地皮。取样从第 `width * (tilefactor - 1)` 个数据开始，每行取 `1, 1 + tilefactor, …` 列，下一行再跳过 `width * (tilefactor - 1)` 个数据。
2. **地皮名**：取样值是 `GROUND_TYPES` 的 1 起始下标（顺序见 `static_layout.lua`，如 `6 → GRASS`、`9 → WOODFLOOR`），脚本从源文件读取该表并输出 `WORLD_TILES` 名称，不在脚本里写死。
3. **对象坐标**（地皮单位，相对布局中心）：
   `x = (obj.x + obj.width / 2) / 64 − (layout.width / tilefactor) / 2`，`y` 同理使用 `obj.y`、`obj.height`、`layout.height`。
4. **输出**：每个布局得到 `ground[row][column]`（`WORLD_TILES` 名称或空）和按 prefab、x、y 排序的 `objects`（地皮单位）。`PrefabSwaps`（活动期间的 prefab 替换）不处理。

当前 `default_pigking` 的结果：8 × 8 的八边形，40 块 `GRASS` 加中央 12 块 `WOODFLOOR`；4 块 `insanityrock` 位于约 ±2.1 格的十字方向，4 块 `sanityrock` 位于约 ±1.1 格的对角方向，`pigking` 在中心（`0, 0`）。

## 写入存档

脚本按 `object_layout.lua` `ReserveAndPlaceLayout`（`layout_position = CENTER`）在存档中每个锚点（猪王）处摆放布局，单位为场景单位（一个地皮 `TILE_SIZE = 12`，对应原版 4 单位）：

- 以锚点最近的**地皮角点**为布局中心，`ground[row][column]` 的格子中心为 `corner + (index − size / 2 + 0.5) × TILE_SIZE`（`column → x`，`row → z`），按格写入 `world.map.tiles` 的 `{ col, row, tileId }`。存档已有记录的格子保留原地皮（例如初始存档猪王旁的 `FARMING_SOIL`）。
- 对象位置为 `corner + (x, y) × TILE_SIZE`（`y → z`）；锚点本身不处理。其他对象必须已是存档实体：`initial-world.json` 等的 `entities.sanityrock` / `entities.insanityrock` 就在这些位置（猪王在 `(0, 0, 25)`，角点为 `(0, 24)`），缺少时脚本报错。
- 写入后再运行一次结果不变，`--check` 据此校验。

## 与原版 worldgen 的差异

- 原版 `ReserveAndPlaceLayout` 会随机 `switch_xy` / `flip_x` / `flip_y`；这里使用作者原朝向。8 × 8 地皮在这些变换下对称，只有岩石的位置会受影响。
- 原版布局中心恰好是地皮角点，猪王也在角点上；初始存档的猪王在 `z = 25`，因此猪王不动，地皮和岩石对齐最近的角点 `z = 24`。
- 原版的 `start_mask` / `fill_mask` / `ReserveSpace`（避开不可通行或已占用区域）没有对应实现：布局直接覆盖存档地图。

## 从完整存档导入地表与洞穴地图

`scripts/import-dst-region.py` 读取完整快照中的最终 `map.tiles`，不重新运行静态布局；实体从 `savedata.ents` 的白名单分组读取。只接受可读的开发版 Lua 世界快照，使用字面量解析器读取 table，不执行存档 Lua；压缩的正式版快照暂不支持。

入口脚本只负责读取快照、组装存档外壳和写入／校验输出，转换按职责拆分到同目录模块（经 `runpy` 加载）：`dst-region-tile.py` 负责地皮栅格、底层地皮、坐标投影和出生点；`dst-region-prefab.py` 持有 `ENTITY_WHITELIST` 并完成实体 ID、坐标与子实体链接，各 prefab 的源状态转换器按组件类型位于 `dst-region-prefab-growable.py`（树木生长与腐朽计时器）、`-pickable.py`（采摘、枯萎、发光植物与子实体生成）、`-workable.py`（岩石、海蚀柱、雕像等开采／敲击物件）、`-structure.py`（猪王、洞穴出入口、池塘、石窟池子物件与蛛巢）、`-inventory.py`（萤火虫／蝴蝶堆叠与静态散落物品）和 `-container.py`（箱子）；`dst-region-item.py` 将物品的 `GetSaveRecord` 转为项目的持有记录 `{ id, prefab, skinname?, components }`（组件数据保持 Lua 记录，只保留物品规格具有的组件），由玩家背包和箱子内容物共用；`dst-region-player.py` 负责玩家重置、位置与背包迁移。

```bash
# 同时转换 forest 与 cave，输出两个独立的分片 JSON 和来源报告
uv run scripts/import-dst-region.py \
  --cluster public/saves/Cluster_58 \
  --output public/saves/Cluster_1 --origin-cell 281 392

# 校验两份存档及来源报告，不写文件
uv run scripts/import-dst-region.py \
  --cluster public/saves/Cluster_58 \
  --output public/saves/Cluster_1 --origin-cell 281 392 --check

# 仍支持只转换一张地图，自动按源 map.prefab 判断 forest / cave
uv run scripts/import-dst-region.py \
  --shard public/saves/Cluster_58/Master \
  --output /tmp/Master.json
```

参数：`--cluster` 指向同时包含 `Master` 和 `Caves` 的原版 Cluster 目录，`--output` 为目标目录，分别输出 `Master.json` / `Caves.json` 及对应 `.import.json`。`--shard` 与 `--cluster` 互斥，可指向原版 Master 或 Caves 目录，此时 `--output` 为 JSON 文件路径。每个分片独立从 `save/shardindex` 找到活动 Session，再选择最新的十位编号世界快照，也可用 `--snapshot 0000000022` 固定编号（整簇导入时两份源快照都使用该编号）。所有分片转换成功后才写入目标文件，第二份源存档损坏时不会先覆盖第一份。整簇导入时同一 Session 若同时出现在 `Master` 和 `Caves` 两个物理目录下，只导入含最新快照的那份副本，另一份视为主机迁移 Session 前的残留并跳过（`Cluster_65` 的 `Caves` 目录只留有洞穴建档当天的 `0000000002`、`0000000003`，实际进度在 `Master` 目录的 `0000000140` 起）。`--template` 默认使用项目 `initial-world.json`，只沿用格式、版本及时间戳等外壳信息；角色恢复为满状态的空背包威尔逊，不复制模板世界实体或原版玩家。`--origin-cell COL ROW` 固定源地图的新原点，省略时按全图陆地包围盒中心计算；沿用 `(281, 392)` 可保持此前局部导入的地皮和实体位置。整簇导入时 `--origin-cell` 只作用于洞穴；地表使用独立原点，可用 `--forest-origin-cell COL ROW` 固定。玩家在各自地图陆地重心附近、周围 3 × 3 格均为陆地的位置出生；海洋和 `FAKE_GROUND` 不参与陆地边界、重心和出生点计算，`OCEAN_ICE` 按 Lua 属于陆地。

导入器不再接受 `--regions`，也不通过拓扑节点筛选地皮或实体。遍历完整地皮栅格，保留无节点（`nodeidtilemap = 0`）的有效地皮；完整源栅格和外围虚空均包含在项目地图范围内。地表海洋格允许保留已移除拓扑节点的编号，来源报告记录为 `unassignedNodeIds`，这些实体的 `sourceNode` 为 `null`；其他未知节点仍报错。两张栅格都校验 `VRSN` 版本及 `9 + width × height × 2` 字节长度，按小端 uint16 解码。地皮 ID 经快照的 `world_tile_map` 还原名称，再映射到当前项目 ID；缺失资源直接报错。海洋各类型使用原 ID 和 `tiledefs.lua` 调色板，统一由现有海洋渲染通道绘制；海冰使用原版 `ocean_ice` 图集和噪声，保持可站立。`undertile` 的原版压缩字面量会安全解码，保留码头、农田和海冰的底层地皮。`VAULT` 按 `tiledefs.lua` 补入地皮目录及原版资源：不可挖掘，使用 `blocky` atlas、`Ground_noise_vault.tex` 和 `Ground_noise_vault_clean_mini.tex`，不新增地皮物品。

拓扑写入 `world.map.topology`：`nodes` 保留每个节点的中心（`node.x`、`node.y` 按实体位置投影为 X、Z）、`NODE_TYPE` 和 `tags`（世界生成原样保留的少数数字标签也照存）；`nodeIdGrid` 把 `nodeidtilemap` 按项目格坐标（与地皮相同沿 z 镜像）逐行编码为 `[nodeId, count]` 行程，`col`／`row` 为左上格，节点编号从 1 起、0 表示无节点。运行时 `packages/prefab/src/topology.ts` 的 `WorldTopology` 提供 `Map:GetNodeIdAtPoint`，`FindVisualNodeAtPoint` 按 `map.lua` 先判 `IsVisualGroundAtPoint`，再在 0.95／1.25／1.5 个 DST 单位的 3 × 3 采样中取渲染层最高的同类地皮（`_render_layer` 为 `groundTiles.json` 的 `renderOrder + 1`，无地面层的地皮为 0）。玩家的 `areaaware`（`packages/componets/src/areaaware.ts`，`SetUpdateDist(.45)`）移动超过更新距离后重查节点，节点变化时推送 `changearea`；`player_common` 的 `OnChangeArea` 据节点是否带 `lunacyarea` 调用 `sanity:EnableLunacy(..., "lunacyarea")`，所以进入月岛等带 `lunacyarea` 标签的节点时切换为启蒙值，离开后恢复。`Cluster_1` 地表 293 个、洞穴 383 个节点的中心均落回自身节点；地表有 26 个、洞穴有 7 个 `lunacyarea` 节点。

`ROPE_BRIDGE`（洞穴绳桥）按 `tiledefs.lua` 补入地皮目录：陆地、不可挖掘、`isinvisibletile`（`groundTiles.json` 的 `invisible: true`），可通行但不绘制地皮顶面和裙边；`TileGroups.LandTilesWithDefaultFalloff` 不含它，所以两岸陆地朝桥的一侧照常画悬崖，桥格自身不画，`INVISIBLE` 的 `invisible_falloff` 未实现。`Map:IsValidTileForRopeBridgeAtPoint` 只接受虚空，导入器要求桥下的 `undertile` 为空或 `IMPASSABLE`，因此不写 `underTileId`。洞穴世界组件 `ropebridgemanager` 的 `duration` 网格（`ZipAndEncodeSaveData`）按格解码，`{ health, direction, icon_offset }` 写入对应地皮记录的 `ropeBridge: { health, direction: { x, z }, iconOffset? }`；`direction` 与实体位置一样沿 z 镜像（`z` 取反），`icon_offset` 原样保存。`marked_for_delete` 非空（桥正在断裂）、旧格式（只有生命值）、数据落在非 `ROPE_BRIDGE` 格上时报错。运行时洞穴的 `RopeBridgeManager`（`packages/componets/src/ropebridgemanager.ts`）按 `OnLoad` 在每个带数据的桥格中心生成不保存的 `rope_bridge_fx`，按 `SpawnBridgeAnim` 由方向定朝向（x 正 0、x 负 180、z 正 -90、否则 90），`SetIconOffset` 后 `SkipPre` 直接播放 `bridge_idle`；生命值低于 200 时的 `dock_damage`、建桥、断桥和地震未实现。`Cluster_65` 洞穴快照 `0000000140`–`0000000145` 各有 7 格绳桥，已导入 `Cluster_1`。

`RIFT_MOON`（月亮裂隙地面）按 `tiledefs.lua` 补入地皮目录：普通陆地，不可挖掘、`hard`（不可种植），使用 `meteor` atlas、`ground_noise_lunarrift.tex` 和 `Ground_noise_lunarrift_mini.tex`，属于 `LandTilesWithDefaultFalloff`，照常画悬崖。`rift_terraformer.lua` 只把非海洋地皮改成它，并用 `undertile` 记下被替换的地皮，所以导入器把它写成 `underTileId` 并要求存在（没有底层地皮的 `RIFT_MOON` 会被 `retrofitforestmap_anr.lua` 改成 `BEARD_RUG`，不支持）；读档拒绝海洋底层。裂隙扩张、关闭时恢复底层地皮、月亮疯狂（`LUNACY_TILES`）、环境声音和 `on_RIFT_MOON_tile` 事件未实现。`Cluster_65` 最新地表快照 `0000000315` 有 61 格，底层均为 `MARSH`。

一个原版 4 单位地皮对应项目 12 单位。稀疏 `world.map.tiles` 保存所有非 `IMPASSABLE` 格，`defaultTileId: 1` 表示其余位置为虚空；`FAKE_GROUND` 保留但不绘制、不通行，不生成桥或填补缺口。实体连续栅格坐标使用 `gx = x / 4 + width / 2 + 0.5`、`gz = z / 4 + height / 2 + 0.5`，与 `map/bunch_spawner.lua`、`map/waterlog_worldgen.lua` 的 `checkIfValidGround` 一致。项目位置为 `((gx - origin_col) × 12, y × 3, (gz - origin_row) × 12)`；当前 `(471, 471)` 地图和 `(281, 392)` 原点对应平移 `(-540, 0, -1872)`。不能省略半格偏移。

`ENTITY_WHITELIST` 中每项绑定专用的源状态转换函数；此外，导入器读取 groundItems 目录中可显示的散落物品分组，排除鼹鼠、鸟、蝴蝶等活体。其他实体、桥梁、墙、生物及地下环境规则尚未迁移。白名单内的全部记录均导入，包括无节点、虚空、悬边和地图边缘位置，不再因区域归属丢弃。未知状态、无对应支持的皮肤或平台数据仍报错。

`lunarhailbuildup`（`MakeSnowCovered` 的月亮冰雹堆积，`lunarhailbuildup.lua` OnSave 的 `workleft`、`buildupcurrent`）未移植：任何白名单实体上的该字段只校验键名后丢弃，读档后堆积为 0。`Cluster_62` 地表快照 `0000000297`、`0000000298` 中约 3600 个树木、岩石、箱子等实体带有该字段。`chesspiece_malbatross` 的 `inventoryitemmoisture`（`moisture` 0～100、布尔 `wet`）同样未移植，校验后丢弃（`0000000298`–`0000000302`）；散落物品和遗迹家具仍按原规则保留潮湿状态。

当前白名单及状态转换：

- `pigking`：只接受空状态；交易与日夜／状态图状态由现有猪王 prefab 重建。
- `moonbase`：`workable.maxwork/workleft` 保留修复／损坏状态；按 Lua `pickable.caninteractwith` 恢复 `staff` 或旧版 `staffname/staffuse`，转为 `moonbase.staff`，保留支持的法杖皮肤和耐久；`timer` → `moonbase.timer`，保留充能各阶段的剩余时间和暂停状态。采摘状态由持有法杖重建。`Cluster_62` 的 6 份地表快照各有 1 座工作量为 6 的已修复月台，洞穴无源记录。
- `researchlab`、`researchlab2`、`researchlab3`、`researchlab4`：按 `scienceprototyper.lua` / `magicprototyper.lua` 的 OnSave 迁移可选 `burnt`，保留已支持的 `skinname`；workable 默认不保存工作量。当前地表快照有 1 台 `researchlab2` 和 1 台使用 `researchlab3_nature` 皮肤的 `researchlab3`，洞穴无这四类记录。
- `moon_tree`：迁移 `size`、`growable`、树桩／烧毁标记及 `timer.decay` → `moonTreeTimer`，保留剩余时间和暂停状态；当前快照新增 198 棵。`moonbutterfly_sapling`：`timer.grow` → `saplingTimer`，保留幼苗生长计时器，按原版不创建地图图标。
- `deciduoustree`：迁移正常桦树的 `growable`、`build`、`leaf_state`、`target_leaf_state`、`leaveschangetime`、树桩／烧毁标记及 `timer.decay` → `deciduousTimer`。树桩可没有 `target_leaf_state`；腐朽任务由逻辑树持有，模型卸载时保留，保存／读档恢复剩余时间，移除时取消。拒绝尚未移植的 `monster` 敌对分支；自然繁殖 `plantregrowth` 沿用其他树木的现有限制，不迁移。
- `flower`：`anim` → `flower.animation`，支持 `f1`～`f10` 和 `rose`；只在源 `planted = true` 时写入该标记，自然花不改为种植花。只接受未采摘、可交互的持久花。
- `fireflies`、`butterfly`：源 ID／源序号形成稳定实体 ID，输出为各自 prefab ID 下的记录，组件数据保持 Lua 的记录：`stackable: { stack }`（数量 1 时省略）、`inventoryitemmoisture`。蝴蝶只接受存活默认血量、空已知位置和已暂停的地面腐败状态，`perishable: { time, paused: true }` 原样保留；未知组件状态继续报错。当前快照导入 350 群萤火虫，蝴蝶源分组为空。

- `pighead`：`burnt` → `building.burnt`，正常状态 `idle`；`archive_moon_statue`：`anim`（1～4）→ `archiveProp.anim`。两者的 workable 不保存工作量；醒睡状态由世界重建。`cave_exit` 不迁移尚未接入的分片连接 `worldmigrator` 数据。
- `cave_entrance`、`cave_entrance_open`：只接受 `worldmigrator`（开放入口另可有 `worldsettingstimer`、`childspawner`），这些分片连接与蝙蝠状态均未接入，故只保留 ID 与位置（组件为空）；封闭入口重载后恢复满工作量。地表共 9 个封闭、1 个开放入口。
- `mushtree_moon`、`mushtree_medium`、`mushtree_tall`：保留 `growable`、`treestate`、`stump`、`burnt`，树桩 `makestump` 的 `timer.decay` 剩余时间 → `mushtree.decay`（未暂停，只限树桩）；酸雨的 `acidvisualsupdate` 计时校验后丢弃；`evergreen` 保留生长阶段及树桩、烧毁状态，以及 `timer.decay` 的剩余时间／暂停状态；已烧毁树没有源 `growable` 时不伪造阶段，由 prefab 按 Lua 在构造时随机选择 1～3 阶段。已导入腐朽计时器由逻辑树持有，卸载模型时继续计时，保存后重建剩余截止时间，永久移除时取消；`plantregrowth` 未迁移。`blue_mushroom` 保留 `rain`，开合由世界时钟重建；`MakeNoGrowInWinter` 冬季暂停的 `pickable.paused` 保留，`caninteractwith` 丢弃，已采摘状态仍报错。
- `oceantree` → `growable`（`stage` 1～3，`time`、`sleeptime`；`usetimemultiplier` 只接受 `false`）和 `oceantree`（`no_grow`、`buds`／`buds_used`（1～7，最多 7 个）、`supertall_growth_progress`（0～3））。`stump`、`burnt`、`timer`（`enriched_cooldown`，即催长中）和 `supertall_growth_progress` 达到 4（保存于变成 `oceantree_pillar` 的途中）对应的读档分支未移植，遇到时报错；其他字段报错。导入的树读档时处于休眠，所在地块激活后按 `growable` 的 `OnEntityWake`／`LongUpdate` 补算保存的 `sleeptime`，阶段循环（`loopstages`），因此可能变成另一阶段。
- `atrium_fence` 保留 `fenceid`（1～5 的整数）。缺少该字段时读档沿用构造函数的随机形状。未知字段或非法形状报错。开合、供电和升降任务由运行中的世界重建。
- `atrium_overgrowth` → `atriumOvergrowth`：保留 `storyprogress`（1～5 的整数，rune_onsave 只在检查分配后写入）；没有该字段时导入为空状态，其他字段或值报错。`Cluster_62` 洞穴的 4 条记录都没有数据。
- `oceantree_pillar` → `oceantreePillar`：保留 `droppedvines`（源码只写 `true`）；没有该字段时导入为空状态，其他字段或值报错。
- `oceanvine` → `pickable`（`picked`、`time` → `regrowSeconds`、`paused`、`protected_cycles`）。`oceanvine.lua` 的 fn 设 `max_cycles = nil`、`cycles_left = 1`，所以 pickable.lua 的 OnSave 总写 `cycles_left`；藤蔓不会被移栽，周期不会减少，转换器只接受 `cycles_left` 为 1 并交给 fn，同时丢弃默认的 `caninteractwith: true`；`max_cycles` 和其他字段报错。
- `reeds` → `pickable`（`picked`、`time` → `regrowSeconds`、`paused`、`protected_cycles`），与 `lichen` 共用转换器；`reeds.lua` 没有自己的 `OnSave`，`SetUp` 不设 `max_cycles`，源存档没有周期字段；默认的 `caninteractwith: true` 不写入；其他字段报错。`Cluster_62` 地表 58 条记录中 1 条为已采并带再生剩余时间。
- `mast_malbatross` → `mastMalbatross`（`rotation`、`is_sail_raised`；实体记录的 `skinname` 保留在导入记录上，限 `mast_malbatross_tesla`、`mast_malbatross_wagstaff`）和 `upgradeable`（`numupgrades`、`stage`）；`burnt`、`lamp_fuel`、`saved_upgraded_from_item`、`lightningrod`、`lightningrod_chargeleft` 属于未移植的分支，与其他未知字段一样报错。游戏内 `c_save()` 仍按 `onsave` 写 `burnt`（燃烧中时），但读档不恢复烧毁状态。`Cluster_62` 新地表快照 `0000000302` 有 2 条，均为 `rotation = 0`、`is_sail_raised = false`、`upgradeable = { stage = 1, numupgrades = 0 }`；该快照有 `ROPE_BRIDGE` 地皮，尚未重新导入。
- `support_pillar` → `supportPillar`（`reinforced`，1～10 的整数，`OnSave` 只在非 0 时写入）和 `constructionsite`（`materials`，`CONSTRUCTION_PLANS.support_pillar` 只有 `rocks`，1～40 的整数）；`regen` 只属于未移植的 `support_pillar_dreadstone`，与其他未知字段、其他材料一样报错。读档时 `OnLoad` 按石料数重算等级（40 → `idle`，20～39 → `idle_1`，10～19 → `idle_2`，1～9 → `idle_3`，0 → `idle_4`）。`Cluster_65` 洞穴快照 `0000000145` 有 4 条，均为 40 块石料，`reinforced` 为 9、7、5、6。
- `wood_chair` → `building`（`furniture_chairs.lua` `OnSave` 只写 `burnt`，存为 `building.burnt`；正常椅子为空对象）和 `savedrotation`（`rotation`，度数，-180～180 且非 0，`savedrotation.lua` 在 0 时不写）；实体记录的 `skinname` 限 `wood_chair_cawnival`、`_fantasy`、`_hallowed`、`_handmade`、`_rose`、`_western`。其他字段报错。导入记录的 `transform.rotationY` 仍为 0，朝向由 `savedrotation` 在读档后恢复。`Cluster_65` 地表快照 `0000000315` 有 1 条（`rotation = -74.999984741211`），洞穴没有。
- `shadow_forge` → 无组件字段：源记录只有位置（`shadow_forge.lua` 没有 `OnSave`），任何 `data` 字段都报错；`Cluster_65` 的地表与洞穴各有 1 座。
- `oasislake` → `oasislake`（`regrowth`，`OnSave` 只写 `false`，其他值报错）和 `fishable`（`fish`，0～14 的整数，即低于 `OASISLAKE_MAX_FISH`）；其他字段报错。没有 `regrowth` 的记录读档时按 `OnLoad` 置 `regrowth = true`。`Cluster_65` 地表快照 `0000000315` 有 1 条，没有存档数据，导入为空组件。
- `beehive`、`wasphive` → `health`（`health.lua` 的 `health` 记为 `current`，`maximum` 取 200／250；源存档不写 `maxhealth`）和 `childspawner`（`childreninside`：蜂巢 0～7，即春季 `math.ceil(5 * 1.33)`，黄蜂巢 0～5；`emergencychildreninside` 0～8）。外出子实体 `childrenoutside`、`emergencychildrenoutside` 的 GUID 校验后丢弃（`bee`／`killerbee` 未移植），`spawning`、`regening`、`queued_spawn`、`timetonextspawn`、`timetonextregen` 和 `worldsettingstimer` 的 `ChildSpawner_SpawnPeriod`／`ChildSpawner_RegenPeriod` 只驱动未移植的生成逻辑，校验后丢弃；其他字段报错。`Cluster_65` 地表快照 `0000000315` 有 53 个蜂巢、25 个黄蜂巢。
- `oceanvine_deco` 保留 `animnum`（1～6 的整数）；缺失时由构造函数随机决定，其他字段报错。
- `grass`、`sapling`、`cave_fern`、`cave_fern_withered`：迁移 `pickable` 状态；蕨类保留 `anim`（`f1`～`f10`）。草和树苗将 `witherable.withered/restore_cycles/delay_time_remaining/task_time_remaining` 转为现有组件字段；不支持的保护计时器仍报错。枯萎检查通过游戏时间调度器执行，保存和重载保留剩余时间。`houndbone` 保留 `bonetype`（1～3）。
- `flower_cave`、`flower_cave_double`、`flower_cave_triple`：`light_state`、`plantname`、采摘及再生状态、亮灯／充能计时器 → `bulbPlant`。`lightflier_flower` → `lightflierFlower`，保留 `childspawner.childreninside`；外飞子实体 GUID 只在子实体同样导入时链接。`lightflier` 不在白名单中。
- `rock1`、`rock2`、`rock_moon_shell`、`rock_flintless`、`rock_flintless_med`、`rock_flintless_low`、`rock_moon`：按 `rocks.lua` 不保存开采量，只接受空状态或空 workable。`moonglass_rock` 另保留 `rock_type`（1～4）。`pillar_ruins`、`pillar_cave`、`pillar_cave_flintless`、`pillar_cave_rock`、`pillar_algae`、`pillar_atrium` 没有 OnSave，只接受空状态。`moon_fissure` 同样没有 OnSave，`workable` 不开 `savestate`，只接受空状态。`watertree_pillar` → `watertreePillar`：保留 `num_oceantreenuts`（0～2）、`last_ram_time`、`cocoons_to_regrow`、`childspawner.childreninside`（0～1）和 `timer` 的 `regrow_oceantreenut`／`cocoon_regrow_check`；`childspawner.childrenoutside`（未移植的 `grassgator`）、`childspawner` 的生成／再生计时与开关、`worldsettingstimer` 的 `ChildSpawner_SpawnPeriod`／`ChildSpawner_RegenPeriod` 校验后丢弃，外出 `grassgator` 的柱子读档后按 `SetRegenPeriod` 的 120±12 秒重新长出；其他字段报错。`archive_pillar` 保留布尔值 `broken`；缺失时由构造函数按 20% 概率决定。`vault_pillar` 保留 `capped`（1、2）、`broken`（1）和世界生成写入的 `random`（`true`，读档后不再保存）。`monkeypillar` 保留 `pillar_id`（1～4 的数字或字符串）；缺失时读档随机决定。`cave_hole` 保留 `allowspawn`；`objectspawner.objects` 校验后丢弃，洞中物品仍按普通地面物品导入。`cavein_boulder` 保留 `variation`（默认 1）、`raised`／`formed`，接受静止落石的 `submersible.force_no_repositioning: false`，拒绝尚未移植的下落目标和关联状态。
- `grotto_pool_big`、`grotto_pool_small`：子物件源 GUID 转为项目实体 ID，写入 `grottoPool.children`，仅链接已导入的子物件。`grotto_moonglass_1/3/4`、`grotto_waterfall_small1/2` 保留 `workable.workleft`（`maxwork = -1`）；`grotto_waterfall_big` 不接受状态。
- `treasurechest`：源 `container.items`（一基槽位，表或带空洞的字典）→ `container.items`（9 格，同样一基槽位），物品经与玩家背包相同的转换，ID 为 `<箱子 ID>_<槽位>`；未知物品、不能放入容器的物品及无对应字段的组件记入来源报告 `containerItems`。`skinname` 保留在导入记录上（拒绝运行时派生的 `treasurechest_upgraded_*`），`burnt` → `building.burnt`，烧毁箱子不得带内容物。只接受未升级的 `upgradeable`（`numupgrades = 0`）与已运行的 `scenariorunner`；`smart_minisign` 晚于本地源 Lua，附带的 `minisign` 未移植，校验后丢弃。箱子按 `MakeChest` 带 `chest` 标签和 `treasurechest.png` 小地图图标。当前地表快照导入 2 个箱子。
- `icebox`、`saltbox`：两个 prefab 都没有自己的 `OnSave`，`preserver` 也不存档，只迁移 `container.items`（9 格，同样一基槽位，与箱子相同的物品转换）和 `skinname`；其他字段报错。`Cluster_65` 最新地表快照 `0000000315` 导入 1 个冰箱、1 个盐盒，最新洞穴快照 `0000000145` 导入 2 个冰箱。
- `cookpot`：迁移 `container.items`（4 格，`PreparedFoodSlot`）、`stewer.lua` 的 `OnSave` 字段和 `burnt`。有产物时保留 `product`、`done`、`remainingtime`、`ingredient_prefabs`、`chef_id`；`product_spoilage`、`spoiltime` 属于未移植的腐坏，校验后丢弃；没有产物时按源 `OnLoad` 忽略其余字段（收获后的锅只留 `ingredient_prefabs`）。`burnt` → `building.burnt`，烧毁的锅按源没有容器与 stewer。`skinname` 保留在导入记录上（限 `definitions.json` 中的 8 个皮肤）。`Cluster_65` 最新地表快照 `0000000315` 的 4 个锅为 `cookpot_kitchen` 皮肤，其中 1 个保存了已完成的 `jellybean`；最新洞穴快照 `0000000145` 导入 1 个锅。
- `dragonflychest`：`dragonfly_chest.lua` 没有自己的 `OnSave` 且不能燃烧，迁移 `container.items`（12 格，与箱子相同的物品转换）与未升级的 `upgradeable`（`numupgrades = 0`）；升级后的箱子及其运行时派生的 `dragonflychest_upgraded_*` 皮肤未移植，遇到时报错。`skinname` 保留在导入记录上。
- `dragonflyfurnace`：`dragonfurnace.lua` 的普通炉子只迁移 `container.items`（4 格）；`incinerator`、`heater` 不存档，`salad` 属于未移植的 `saladfurnace`，与其他字段一样报错。`skinname` 保留在导入记录上。`Cluster_65` 最新洞穴快照 `0000000145` 导入 1 个。
- `wardrobe`：`wardrobe.lua` 只保存 `burnt`，而本项目的衣柜移植还没有 burnable，故只接受无存档数据的记录；烧毁状态报错而不是静默丢失。`Cluster_65` 最新地表快照 `0000000315` 导入 1 个。
- 世界状态：每份快照的 `world_network_fn` 转换到 `world.systems` 与 `world.elapsedSeconds`，不再使用模板默认值。`clock.cycles` 是已完成天数，`day = cycles + 1`；源时段（`day`／`dusk`／`night`）及其 `remainingtimeinphase / totaltimeinphase` 的进度映射到项目固定的 10/4/2 段，换算为 `elapsedSeconds`，因此读档从同一日、同一时段和进度继续（`seasons.lua` 为季节配置的不同段数未移植）。`mooomphasecycle` → `systems.moon`；`seasons` 的 `season`／`remainingdaysinseason` → `systems.season`；`worldtemperature` 的 `season`／`seasontemperature`／`phasetemperature`／`noisetime`／`daylight` → `systems.worldtemperature`；地表的 `weather` 或洞穴的 `caveweather` 只保留 `moisture`、`moisturefloor`、`moistureceil`、`preciptype`、`peakprecipitationrate`、`snowlevel`；洞穴 `nightmareclock` 的 `lengths`、`phase`、`totaltimeinphase`、`remainingtimeinphase` 原样保留。`seasons` 的随机季节、`weather` 的湿度速率、雷电、湿度和积雪阈值、冬季盛宴等未移植字段校验后丢弃；`fumarolelocaltemperature`、`quaker` 同样校验后丢弃。`Cluster_65` 最新地表快照 `0000000315` 为第 283 日秋季（剩余 18 天）、白天进度 0.267、温度项 50 + 3.72、湿度 2198；最新洞穴快照 `0000000145` 为第 281 日、白天进度 0.336，并带 `nightmareclock` 的 `calm` 阶段。来源摘要写在 `.import.json` 的 `worldSystems`。
- `beefalo`：组件按 `GetPersistData` 各自保存：`health`（源 `health.lua` OnSave 的当前生命值，补上最大值 1000，与本项目 `Health:OnSave` 一致）、`knownlocations`（源坐标按同一平移／Z 轴映射转换，为空时省略）、`periodicspawner.time`（大于 0 时）、`beard`；源不保存朝向，`rotationY` 为 0。只接受野生默认状态：`tendency` 为 `DEFAULT`、无胡萝卜鼠、无服装、饥饿 0、未命名，这些及 `leader`（追随者为未移植的 `babybeefalo`）、`uniqueid`、`brushable` 校验后丢弃。受伤的牛保留其生命值导入（`Cluster_65` 地表 `0000000310` 有 1 头，998.89／1000），生命值须在 (0, 1000] 内。驯化、骑乘和鞍未移植：`domesticated` 为真的牛按野牛导入，`domesticatable`（连同 `rideable.saddle` 里的鞍）、`TENDENCY` 中的 `tendency`、`eater` 和 `beefalometrics` 校验后丢弃（`Cluster_65` 洞穴 `0000000141`、`0000000142`、`0000000144` 中一头带 `saddle_shadow` 的牛）。`babybeefalo`、`beefaloherd` 不在白名单中。当前地表快照导入 68 头。
- `stafflight`、`staffcoldlight`：`timer` 的 `extinguish` 任务原样保留，`initial_time` 不超过 `tuning.lua` 的时长。
- `pond`：`plants` 的偏移保留（X 不变、Z 取反，与世界坐标一致），`childspawner`、`worldsettingstimer`（青蛙生成器，未移植）校验后丢弃，鱼数量取默认；小地图图标 `pond.png`。`lava_pond`：`rocks`（`rocktype`、`offset`）→ `lavaPond.rocks`；小地图图标 `lava_pond.png`。`pond_mos`、`pond_cave` 不在白名单内。
- `hotspring` → `hotspring`（`isbathbombed`）：`hotspring.lua` 的 `OnSave` 只写 `delay_refill`／`glassed`／`isbathbombed`／`empty` 之一，`workable.savestate` 另写 `maxwork`／`workleft`（`TUNING.HOTSPRING_WORK = 6`）。项目只移植了普通与投入浴弹后的状态，因此保留 `isbathbombed: true`；`workable` 校验后丢弃。满月结玻璃、被采空的池子和待补充状态属于未移植分支，遇到时报错。`Cluster_65` 最新地表快照 `0000000315` 有 9 个，均未投入浴弹。

实体 ID 包含源 Session、prefab 和源 `id`；无 `id` 时使用原分组序号，同一快照重复导入保持稳定。`Master.import.json` / `Caves.import.json` 的 `scope: "full-map"` 标记完整转换，记录全部节点、地皮数量、各白名单 prefab 的源数量和导入数量，以及每个实体的源序号、源 ID、源位置和所属节点。无节点或源坐标越界时 `sourceNode` 为 `null`。源文件路径、SHA-256、尺寸、原点和平移同样保留。

`Cluster_58` 的 `0000000022` 快照包含 471 × 471 格和 360 个节点，转换得到 46,224 格陆地、298 格 `FAKE_GROUND`（合计 46,522 条稀疏地皮记录）及 4,640 个白名单实体。所有白名单分组的源数量与导入数量一致。洞穴结果为 `public/saves/Cluster_1/Caves.json`。同簇地表快照为 425 × 425 格、280 个节点，转换得到 48,007 格陆地、120,242 格海洋及 6,895 个白名单实体，保存为默认加载的 `public/saves/Cluster_1/Master.json`。可用 `?save=Cluster_1/Caves.json` 切换洞穴。读档仍校验字节、节点和嵌套深度，上限调整为 32 MiB、2,000,000 个值，以容纳完整地表。`c_spawn` / `c_give` 命令与支持 ID 不变；`c_save()` 无参数，下载 `Cluster_1.zip`，解压到 `public/saves/` 覆盖目录后重载，保留完整地图及实体身份、位置和组件状态。

验证命令：

```bash
python3 -m unittest discover -s tests -p test_dst_region.py
python3 packages/prefab/scripts/import-ground-tiles.py --check
pnpm --filter @dontstarve-web/animation exec vitest run tests/caveTerrain.test.ts tests/grass.test.ts tests/grassInteractions.test.ts tests/sapling.test.ts
pnpm --filter @dontstarve-web/ui exec playwright test tests/cave-terrain.spec.ts
```

## 校验

```bash
python3 packages/prefab/scripts/import-static-layouts.py --check
cd packages/animation && npx vitest run tests/pigKing.test.ts tests/nightmareRock.test.ts
cd packages/ui && npx playwright test tests/pigking.spec.ts
```

`pigKing.test.ts` 检查 40 / 12 块地皮、角点对齐和岩石坐标；`pigking.spec.ts` 在真实场景中检查 8 块岩石、草地图层、`c_spawn("insanityrock")` 以及 `c_save()` 后的实体数量和 ID 唯一性。

### 散落物品静态展示

当前默认存档来源为 `Cluster_65`；保持原点重新生成及校验：

```bash
uv run scripts/import-dst-region.py --cluster public/saves/Cluster_65 --output public/saves/Cluster_1 --origin-cell 214 213 --forest-origin-cell 189 197
uv run scripts/import-dst-region.py --cluster public/saves/Cluster_65 --output public/saves/Cluster_1 --origin-cell 214 213 --forest-origin-cell 189 197 --check
```

`livingtree` 读取独立的 `stump` 和 `burnt` 真值标志，并存入 `components.livingtree`。两标志同时存在时，原版读档会把烧焦树桩换成灰烬。可选的 `lunarhailbuildup` 保留 `workleft`（0–4）和 `buildupcurrent`（0–1）。`workable.savestate` 默认为关闭，转换器接受空工作量表并拒绝未知字段。默认快照的 Master 与 Caves 均无此实体。

`stagehand` 在最新 Master 快照的源和导入数量均为 1，Caves 均为 0。转换器保留记录的身份、地面位置、`skinname` 和 `lunarhailbuildup` 的可选数值字段 `workleft`（0–2）、`buildupcurrent`（0–1）。原版 `workable.savestate` 默认关闭，因此空 `workable` 表按构造默认值恢复。其他组件字段和未知皮肤会报错。

地表检测到 174 种、2,463 个散落物品实体（合计 10,537 件），洞穴 85 种、1,132 个实体（3,417 件）。每份 `.import.json` 的 `groundItemCounts` 记录 `entities`、`quantity` 和 `sourceComponents`；数量按地面实体的 stackable.stack 计算，不遍历玩家库存、容器或包裹内容。`groundItemScope` 明确记录美术范围。

这些记录按 prefab ID 存为 `world.entities.<prefab>[]`：数量是 `stackable: { stack }`（数量 1 时省略），皮肤是记录上的 `skinname`，外观分支是 `groundVariant`。石头／冰块的 anim、月亮碎片的 glassname、贝壳的 variation、稀有蓝图、包裹大小和扑克牌正面映射为白名单外观变体。保留源高度并按现有坐标比例及 Z 轴映射导入；平台坐标仍拒绝。其余源组件只在报告中记录名称，不因美术导入扩展组件实现；已有 prefab 沿用原工厂、组件及交互，仅有美术的 ID 不增加拾取／使用／装备目标、容器或计时器。

所有记录由 `itemPrefabs` 的物品 prefab 在共享 `PrefabEntityManager` 上生成，复用 PrefabInstance/PrefabDisplay 和 tile 活动订阅；休眠释放 visual，保存保留逻辑记录，唤醒恢复外观。新增的 `c_spawn` ID、语法和例子见 [prefab README](../packages/prefab/README.md)。

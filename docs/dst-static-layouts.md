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
- 主场景（`src/sceneEntities.ts`）对每个猪王调用它，把所有布局格子一次登记到 `TurfMap.setOriginalTiles`，不覆盖存档里已挖掘的地皮。只有有效地皮发生变化才统一重建一次并发布变更；完整导入存档已有最终地皮时不重建。

岩石是普通实体：`initial-world.json` 与 `initial-world copy.json` 的 `entities.sanityrock` / `entities.insanityrock` 就是按上面的公式从布局算出的位置（猪王在 `(0, 0, 25)`，角点为 `(0, 24)`），由 `NightmareRockManager` 恢复。需要重新生成这些记录时，用同一公式并保持 `e_<prefab>_<6 位序号>` 的 ID 格式。

## 与原版 worldgen 的差异

- 原版 `ReserveAndPlaceLayout` 会随机 `switch_xy` / `flip_x` / `flip_y`；这里使用作者原朝向。8 × 8 地皮在这些变换下对称，只有岩石的位置会受影响。
- 原版布局中心恰好是地皮角点，猪王也在角点上；初始存档的猪王在 `z = 25`，因此猪王不动，地皮和岩石对齐最近的角点 `z = 24`。
- 原版的 `start_mask` / `fill_mask` / `ReserveSpace`（避开不可通行或已占用区域）没有对应实现：布局直接覆盖存档地图。

## 从完整存档导入地表与洞穴地图

`scripts/import-dst-region.py` 读取完整快照中的最终 `map.tiles`，不重新运行静态布局；实体从 `savedata.ents` 的白名单分组读取。只接受可读的开发版 Lua 世界快照，使用字面量解析器读取 table，不执行存档 Lua；压缩的正式版快照暂不支持。

入口脚本只负责读取快照、组装存档外壳和写入／校验输出，转换按职责拆分到同目录模块（经 `runpy` 加载）：`dst-region-tile.py` 负责地皮栅格、底层地皮、坐标投影和出生点；`dst-region-prefab.py` 持有 `ENTITY_WHITELIST` 并完成实体 ID、坐标与子实体链接，各 prefab 的源状态转换器按组件类型位于 `dst-region-prefab-growable.py`（树木生长与腐朽计时器）、`-pickable.py`（采摘、枯萎、发光植物与子实体生成）、`-workable.py`（岩石、雕像等开采／敲击物件）、`-structure.py`（猪王、洞穴出入口、池塘与石窟池子物件）、`-inventory.py`（萤火虫／蝴蝶堆叠与静态散落物品）和 `-container.py`（箱子）；`dst-region-item.py` 将物品存档记录转为 `InventoryStack`，由玩家背包和箱子内容物共用；`dst-region-player.py` 负责玩家重置、位置与背包迁移。

```bash
# 同时转换 forest 与 cave，输出两个独立的分片 JSON 和来源报告
python3 scripts/import-dst-region.py \
  --cluster public/saves/Cluster_58 \
  --output public/saves/Cluster_1 --origin-cell 281 392

# 校验两份存档及来源报告，不写文件
python3 scripts/import-dst-region.py \
  --cluster public/saves/Cluster_58 \
  --output public/saves/Cluster_1 --origin-cell 281 392 --check

# 仍支持只转换一张地图，自动按源 map.prefab 判断 forest / cave
python3 scripts/import-dst-region.py \
  --shard public/saves/Cluster_58/Master \
  --output /tmp/Master.json
```

参数：`--cluster` 指向同时包含 `Master` 和 `Caves` 的原版 Cluster 目录，`--output` 为目标目录，分别输出 `Master.json` / `Caves.json` 及对应 `.import.json`。`--shard` 与 `--cluster` 互斥，可指向原版 Master 或 Caves 目录，此时 `--output` 为 JSON 文件路径。每个分片独立从 `save/shardindex` 找到活动 Session，再选择最新的十位编号世界快照，也可用 `--snapshot 0000000022` 固定编号（整簇导入时两份源快照都使用该编号）。所有分片转换成功后才写入目标文件，第二份源存档损坏时不会先覆盖第一份。`--template` 默认使用项目 `initial-world.json`，只沿用格式、版本及时间戳等外壳信息；角色恢复为满状态的空背包威尔逊，不复制模板世界实体或原版玩家。`--origin-cell COL ROW` 固定源地图的新原点，省略时按全图陆地包围盒中心计算；沿用 `(281, 392)` 可保持此前局部导入的地皮和实体位置。整簇导入时 `--origin-cell` 只作用于洞穴；地表使用独立原点，可用 `--forest-origin-cell COL ROW` 固定。玩家在各自地图陆地重心附近、周围 3 × 3 格均为陆地的位置出生；海洋和 `FAKE_GROUND` 不参与陆地边界、重心和出生点计算，`OCEAN_ICE` 按 Lua 属于陆地。

导入器不再接受 `--regions`，也不通过拓扑节点筛选地皮或实体。遍历完整地皮栅格，保留无节点（`nodeidtilemap = 0`）的有效地皮；完整源栅格和外围虚空均包含在项目地图范围内。地表海洋格允许保留已移除拓扑节点的编号，来源报告记录为 `unassignedNodeIds`，这些实体的 `sourceNode` 为 `null`；其他未知节点仍报错。两张栅格都校验 `VRSN` 版本及 `9 + width × height × 2` 字节长度，按小端 uint16 解码。地皮 ID 经快照的 `world_tile_map` 还原名称，再映射到当前项目 ID；缺失资源直接报错。海洋各类型使用原 ID 和 `tiledefs.lua` 调色板，统一由现有海洋渲染通道绘制；海冰使用原版 `ocean_ice` 图集和噪声，保持可站立。`undertile` 的原版压缩字面量会安全解码，保留码头、农田和海冰的底层地皮。`VAULT` 按 `tiledefs.lua` 补入地皮目录及原版资源：不可挖掘，使用 `blocky` atlas、`Ground_noise_vault.tex` 和 `Ground_noise_vault_clean_mini.tex`，不新增地皮物品。

一个原版 4 单位地皮对应项目 12 单位。稀疏 `world.map.tiles` 保存所有非 `IMPASSABLE` 格，`defaultTileId: 1` 表示其余位置为虚空；`FAKE_GROUND` 保留但不绘制、不通行，不生成桥或填补缺口。实体连续栅格坐标使用 `gx = x / 4 + width / 2 + 0.5`、`gz = z / 4 + height / 2 + 0.5`，与 `map/bunch_spawner.lua`、`map/waterlog_worldgen.lua` 的 `checkIfValidGround` 一致。项目位置为 `((gx - origin_col) × 12, y × 3, (gz - origin_row) × 12)`；当前 `(471, 471)` 地图和 `(281, 392)` 原点对应平移 `(-540, 0, -1872)`。不能省略半格偏移。

`ENTITY_WHITELIST` 中每项绑定专用的源状态转换函数；此外，导入器读取 groundItems 目录中可显示的散落物品分组，排除鼹鼠、鸟、蝴蝶等活体。其他实体、桥梁、墙、生物及地下环境规则尚未迁移。白名单内的全部记录均导入，包括无节点、虚空、悬边和地图边缘位置，不再因区域归属丢弃。未知状态、无对应支持的皮肤或平台数据仍报错。

当前白名单及状态转换：

- `pigking`：只接受空状态；交易与日夜／状态图状态由现有猪王 prefab 重建。
- `moonbase`：`workable.maxwork/workleft` 保留修复／损坏状态；按 Lua `pickable.caninteractwith` 恢复 `staff` 或旧版 `staffname/staffuse`，转为 `moonbase.staff`，保留支持的法杖皮肤和耐久；`timer` → `moonbase.timer`，保留充能各阶段的剩余时间和暂停状态。采摘状态由持有法杖重建。`Cluster_62` 的 6 份地表快照各有 1 座工作量为 6 的已修复月台，洞穴无源记录。
- `researchlab`、`researchlab2`、`researchlab3`、`researchlab4`：按 `scienceprototyper.lua` / `magicprototyper.lua` 的 OnSave 迁移可选 `burnt`，保留已支持的 `skinname`；workable 默认不保存工作量。当前地表快照有 1 台 `researchlab2` 和 1 台使用 `researchlab3_nature` 皮肤的 `researchlab3`，洞穴无这四类记录。
- `moon_tree`：迁移 `size`、`growable`、树桩／烧毁标记及 `timer.decay` → `moonTreeTimer`，保留剩余时间和暂停状态；当前快照新增 198 棵。`moonbutterfly_sapling`：`timer.grow` → `saplingTimer`，保留幼苗生长计时器，按原版不创建地图图标。
- `deciduoustree`：迁移正常桦树的 `growable`、`build`、`leaf_state`、`target_leaf_state`、`leaveschangetime`、树桩／烧毁标记及 `timer.decay` → `deciduousTimer`。树桩可没有 `target_leaf_state`；腐朽任务由逻辑树持有，模型卸载时保留，保存／读档恢复剩余时间，移除时取消。拒绝尚未移植的 `monster` 敌对分支；自然繁殖 `plantregrowth` 沿用其他树木的现有限制，不迁移。
- `flower`：`anim` → `flower.animation`，支持 `f1`～`f10` 和 `rose`；只在源 `planted = true` 时写入该标记，自然花不改为种植花。只接受未采摘、可交互的持久花。
- `fireflies`、`butterfly`：源 ID／源序号形成稳定实体 ID，输出为现有 `ground_item.components.stack`，同一记录的 `stack.entityId` 与实体 ID 相同；保留 `stackable.stack`，默认数量 1。蝴蝶只接受存活默认血量、空已知位置和已暂停的地面腐败状态，`perishable.time / 1440` → `freshnessPercent`；未知组件状态继续报错。当前快照导入 350 群萤火虫，蝴蝶源分组为空。

- `pighead`：`burnt` → `building.burnt`，正常状态 `idle`；`archive_moon_statue`：`anim`（1～4）→ `archiveProp.anim`。两者的 workable 不保存工作量；醒睡状态由世界重建。`cave_exit` 不迁移尚未接入的分片连接 `worldmigrator` 数据。
- `cave_entrance`、`cave_entrance_open`：只接受 `worldmigrator`（开放入口另可有 `worldsettingstimer`、`childspawner`），这些分片连接与蝙蝠状态均未接入，故只保留 ID 与位置（组件为空）；封闭入口重载后恢复满工作量。地表共 9 个封闭、1 个开放入口。
- `mushtree_moon`、`mushtree_medium`、`mushtree_tall`：保留 `growable`、`treestate`、`stump`、`burnt`；`evergreen` 保留生长阶段及树桩、烧毁状态，以及 `timer.decay` 的剩余时间／暂停状态；已烧毁树没有源 `growable` 时不伪造阶段，由 prefab 按 Lua 在构造时随机选择 1～3 阶段。已导入腐朽计时器由逻辑树持有，卸载模型时继续计时，保存后重建剩余截止时间，永久移除时取消；`plantregrowth` 未迁移。`blue_mushroom` 保留 `rain`，开合由世界时钟重建。
- `grass`、`sapling`、`cave_fern`、`cave_fern_withered`：迁移 `pickable` 状态；蕨类保留 `anim`（`f1`～`f10`）。草和树苗将 `witherable.withered/restore_cycles/delay_time_remaining/task_time_remaining` 转为现有组件字段；不支持的保护计时器仍报错。枯萎检查通过游戏时间调度器执行，保存和重载保留剩余时间。`houndbone` 保留 `bonetype`（1～3）。
- `flower_cave`、`flower_cave_double`、`flower_cave_triple`：`light_state`、`plantname`、采摘及再生状态、亮灯／充能计时器 → `bulbPlant`。`lightflier_flower` → `lightflierFlower`，保留 `childspawner.childreninside`；外飞子实体 GUID 只在子实体同样导入时链接。`lightflier` 不在白名单中。
- `rock1`、`rock2`、`rock_moon_shell`、`rock_flintless`、`rock_flintless_med`、`rock_flintless_low`、`rock_moon`：按 `rocks.lua` 不保存开采量，只接受空状态或空 workable。`cavein_boulder` 保留 `variation`（默认 1）、`raised`／`formed`，接受静止落石的 `submersible.force_no_repositioning: false`，拒绝尚未移植的下落目标和关联状态。
- `grotto_pool_big`、`grotto_pool_small`：子物件源 GUID 转为项目实体 ID，写入 `grottoPool.children`，仅链接已导入的子物件。`grotto_moonglass_1/3/4`、`grotto_waterfall_small1/2` 保留 `workable.workleft`（`maxwork = -1`）；`grotto_waterfall_big` 不接受状态。
- `treasurechest`：源 `container.items`（一基槽位，表或带空洞的字典）→ `container`（9 格），物品经与玩家背包相同的转换，ID 为 `<箱子 ID>_<槽位>`；未知物品、不能放入容器的物品及无对应字段的组件记入来源报告 `containerItems`。`skinname` → `building.skinId`（拒绝运行时派生的 `treasurechest_upgraded_*`），`burnt` → `building.burnt`，烧毁箱子不得带内容物。只接受未升级的 `upgradeable`（`numupgrades = 0`）与已运行的 `scenariorunner`；`smart_minisign` 晚于本地源 Lua，附带的 `minisign` 未移植，校验后丢弃。箱子按 `MakeChest` 带 `chest` 标签和 `treasurechest.png` 小地图图标。当前地表快照导入 2 个箱子。
- `beefalo`：`knownlocations`（源坐标按同一平移／Z 轴映射转换，`herd` 同时作为 `home`）、`periodicspawner.time` → `poopRemainingSeconds`、`beard` → `beefalo.beard`；源不保存朝向，`heading` 取 0。只接受野生默认状态：`tendency` 为 `DEFAULT`、无胡萝卜鼠、未驯化、无服装、满血、饥饿 0、未命名，这些及 `leader`（追随者为未移植的 `babybeefalo`）、`uniqueid`、`brushable` 校验后丢弃。`babybeefalo`、`beefaloherd` 不在白名单中。当前地表快照导入 37 头。
- `pond`：`plants`、`childspawner`、`worldsettingstimer`（青蛙生成器，未移植）校验后丢弃，鱼数量取默认；小地图图标 `pond.png`。`lava_pond`：`rocks`（`rocktype`、`offset`）→ `lavaPond.rocks`；小地图图标 `lava_pond.png`。`pond_mos`、`pond_cave` 不在白名单内。

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

当前默认存档来源为 `Cluster_62`；保持原点重新生成及校验：

```bash
python3 scripts/import-dst-region.py --cluster public/saves/Cluster_62 --output public/saves/Cluster_1 --origin-cell 214 213 --forest-origin-cell 189 197
python3 scripts/import-dst-region.py --cluster public/saves/Cluster_62 --output public/saves/Cluster_1 --origin-cell 214 213 --forest-origin-cell 189 197 --check
```

地表检测到 144 种、1,027 个散落物品实体（合计 2,371 件），洞穴 20 种、130 个实体（146 件）。每份 `.import.json` 的 `groundItemCounts` 记录 `entities`、`quantity` 和 `sourceComponents`；数量按地面实体的 stackable.stack 计算，不遍历玩家库存、容器或包裹内容。`groundItemScope` 明确记录美术范围。

这些记录存为 `ground_item.components.stack`，保存 `itemId`、`count`、可选 `skinId` 与 `variant`。石头／冰块的 anim、月亮碎片的 glassname、贝壳的 variation、稀有蓝图、包裹大小和扑克牌正面映射为白名单外观变体。保留源高度并按现有坐标比例及 Z 轴映射导入；平台坐标仍拒绝。其余源组件只在报告中记录名称，不因美术导入扩展组件实现；已有 prefab 沿用原工厂、组件及交互，仅有美术的 ID 不增加拾取／使用／装备目标、容器或计时器。

所有记录复用原有 `GroundItemManager`、ground prefab 工厂及共享 archive 资源、PrefabInstance/PrefabDisplay 和 tile 活动订阅；仅活跃条目参与更新，休眠释放 visual，保存保留逻辑记录，唤醒恢复外观。新增的 `c_spawn` ID、语法和例子见 [README 调试命令](../README.md)。

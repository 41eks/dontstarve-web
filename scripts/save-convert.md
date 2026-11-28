# DST 存档转换

在仓库根目录安装 Node 依赖（`pnpm install --frozen-lockfile`），再用 `uv run` 将原版 Cluster 的地表与洞穴快照转换为本项目的 JSON 存档。入口脚本声明了 Python 3.11+ 及 Pydantic 2 依赖，`uv` 自动准备运行环境。

```bash
uv run scripts/import-dst-region.py \
  --cluster public/saves/Cluster_65 \
  --output public/saves/Cluster_1 \
  --origin-cell 214 213 \
  --forest-origin-cell 189 197
```

命令转换源目录中所有世界快照（当前共 12 份：地表 `0000000328`–`0000000333`、洞穴 `0000000149`–`0000000154`）及各自存在的玩家文件，按世界类型写入 `Master/save/session/<session>/<snapshot>.json` 或 `Caves/save/session/<session>/<snapshot>.json`。同编号玩家文件放在该 Session 的用户子目录；世界 JSON 的 `session.playerFile` 指向它。`Master.json`、`Caves.json` 及各自的 `.import.json` 是每种世界最新快照的便捷副本。`session.json` 列出全部转换结果；游戏从每个 Session 的最新快照判断玩家是否已迁移，再加载唯一没有 `migration` 标记的玩家所在世界。不带 `?save=` 启动时读取的是 `session.json` 指向的 Session 快照（例如地表 `Master/save/session/03741E1B78B29575/0000000333.json`），不是 `Master.json`／`Caves.json` 便捷副本；调试存档字段请改前者，或用 `?save=Cluster_1/Master.json` 显式加载副本。源目录中洞穴快照实际保存在 `Master/save/session/04E26ADB66396E8D/`，也会按洞穴类型归入输出的 Caves 目录；`Caves` 物理目录里同一 Session 只剩建档当天的 `0000000002`、`0000000003`，作为残留跳过。`--origin-cell COL ROW` 在整簇导入时只固定洞穴原点；地表独立居中，可用 `--forest-origin-cell COL ROW` 固定。检查已有结果而不写入文件时，在相同命令末尾加 `--check`。

```bash
uv run scripts/import-dst-region.py --cluster public/saves/Cluster_65 --output public/saves/Cluster_1 --origin-cell 214 213 --forest-origin-cell 189 197 --check
```

转换和 `--check` 都会先校验整批数据，再写入或比对文件。`scripts/dst_save_schema.py` 使用 `TypedDict`、`Literal` 和 Pydantic `TypeAdapter` 描述世界、地图、玩家、持有物品、分离的 Session 玩家文件和索引，与 [TS 存档类型](../src/save/types.ts) 及 [实体存档类型](../packages/prefab/src/saveRecord.ts) 对齐。修改存档字段时同步更新对应定义。迁移目标坐标随原始迁移记录留在 `.import.json`，游戏存档和 Session 索引只写 TS 声明的迁移字段。

转换器调用游戏的 [TS 读档器](../src/save/deserialize.ts) 验证每份世界及其玩家数据。具体 prefab 的组件、皮肤、物品规格和跨字段限制随游戏的读档规则更新。校验错误会注明文件和字段路径。`--check` 还会逐字节比较存档、索引和来源报告。

玩家当前在地表，最新地表快照 `0000000333` 有 9,196 个实体，其中 4 个是 `insanityrock`。最新洞穴快照 `0000000154` 有 7,694 个实体，其中 29 个是 `insanityrock`。洞穴快照中的已升级龙鳞箱及其超上限物品堆叠仍保存在原始 DST 文件中，转换时在 `skippedEntities` 记录该箱子。早期快照没有玩家文件或组件表时，仍保留世界实体，游戏只从各 Session 的最新快照选择玩家。导入保留地表各海洋类型、海冰、码头／农田底层地皮。

重新导入后、提交前，用 `scripts/dst-save-diff.py` 确认只有预期的实体组变化。它按实体组和导入报告汇总相对 git 版本的差异，并列出最新快照的 source／imported 数量；`--base` 指定比较的版本（默认 `HEAD`），有 `--expect` 时出现其他变更或预期 ID 未变化都以退出码 1 结束：

```bash
python3 scripts/dst-save-diff.py --expect pillar_cave monkeypillar
```

世界状态从每份快照的 `world_network_fn` 导入，不沿用模板默认值：`clock.cycles`、`phase`、`remainingtimeinphase` → `world.elapsedSeconds`（按项目的固定 10/4/2 段换算）和 `world.systems.clock`（`day = cycles + 1`），`mooomphasecycle` → `systems.moon`；`seasons.season`／`remainingdaysinseason` → `systems.season`；`worldtemperature` 的季节温度、时段温度、`noisetime` 和 `daylight` → `systems.worldtemperature`；`weather`（地表）或 `caveweather`（洞穴）的 `moisture`、`moisturefloor`、`moistureceil`、`preciptype`、`peakprecipitationrate`、`snowlevel` → `systems.weather`；洞穴的 `nightmareclock` 原样保留。`seasons.lua` 的季节段数尚未移植，导入按源阶段内的进度映射到项目固定段长，因此同一日、同一时段及进度恢复。`fumarolelocaltemperature`、`quaker` 等未移植状态校验后丢弃，来源值记录在 `.import.json` 的 `worldSystems`。

单分片导入、其他参数和源快照限制见 [地表与洞穴地图导入](../docs/dst-static-layouts.md#从完整存档导入地表与洞穴地图)。

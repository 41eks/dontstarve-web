# DST 存档转换

在仓库根目录运行 `scripts/import-dst-region.py`，可将原版 Cluster 的地表与洞穴快照转换为本项目的 JSON 存档：

```bash
python3 scripts/import-dst-region.py \
  --cluster public/saves/Cluster_62 \
  --output public/saves/Cluster_1 \
  --origin-cell 214 213 \
  --forest-origin-cell 189 197
```

命令转换源目录中所有世界快照（当前共 14 份）及各自存在的玩家文件，按世界类型写入 `Master/save/session/<session>/<snapshot>.json` 或 `Caves/save/session/<session>/<snapshot>.json`。同编号玩家文件放在该 Session 的用户子目录；世界 JSON 的 `session.playerFile` 指向它。`Master.json`、`Caves.json` 及各自的 `.import.json` 是每种世界最新快照的便捷副本。`session.json` 列出全部转换结果；游戏从每个 Session 的最新快照判断玩家是否已迁移，再加载唯一没有 `migration` 标记的玩家所在世界。源目录中较新的洞穴快照实际保存在 `Master/save/session/04E26ADB66396E8D/0000000033`，也会按洞穴类型归入输出的 Caves 目录。`--origin-cell COL ROW` 在整簇导入时只固定洞穴原点；地表独立居中，可用 `--forest-origin-cell COL ROW` 固定。检查已有结果而不写入文件时，在相同命令末尾加 `--check`。

```bash
python3 scripts/import-dst-region.py --cluster public/saves/Cluster_62 --output public/saves/Cluster_1 --origin-cell 214 213 --forest-origin-cell 189 197 --check
```

玩家当前在地表：最新地表快照 `0000000148` 的玩家文件转换后位于项目脚点 `[1187.244, 0, 1012.662]`。最新地表快照有 6,848 个实体（含 1 座已修复 `moonbase`、1 个 `researchlab2`、1 个带 `researchlab3_nature` 皮肤的 `researchlab3` 和 1 座大理石邪天翁雕像）；最新洞穴快照 `0000000060` 有 6,571 个实体；见 [遗迹家具移植](../docs/dst-ruinsrelic.md) 与 [石笋移植](../docs/dst-stalagmite.md)。早期快照没有玩家文件或组件表时，仍保留世界实体，游戏只从各 Session 的最新快照选择玩家。导入保留地表各海洋类型、海冰、码头／农田底层地皮。

单分片导入、其他参数和源快照限制见 [地表与洞穴地图导入](../docs/dst-static-layouts.md#从完整存档导入地表与洞穴地图)。

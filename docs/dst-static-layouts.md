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

## 校验

```bash
python3 packages/prefab/scripts/import-static-layouts.py --check
cd packages/animation && npx vitest run tests/pigKing.test.ts tests/nightmareRock.test.ts
cd packages/ui && npx playwright test tests/pigking.spec.ts
```

`pigKing.test.ts` 检查 40 / 12 块地皮、角点对齐和岩石坐标；`pigking.spec.ts` 在真实场景中检查 8 块岩石、草地图层、`c_spawn("insanityrock")` 以及 `c_save()` 后的实体数量和 ID 唯一性。

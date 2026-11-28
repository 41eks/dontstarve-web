# 陆地裙边：Map:IsVisualGroundAtPoint

陆地格的地面贴图会画进相邻的非陆地格（海洋格或洞穴虚空格），画面上的海岸线因此比 tile 边界向外多出一圈。DST 把这一圈称为 land overhang，并用引擎函数 `Map:IsVisualGroundAtPoint(x, y, z)` 判断某点是否落在陆地或裙边上。这个函数在 C++ 引擎里，Lua 源码只调用它，所以实现取自对 `dontstarve_steam_x64.exe` 的反汇编。

移植位置：`packages/prefab/src/turfMap.ts` 的 `TurfMap.isVisualGroundAtPoint`；测试在 `packages/prefab/tests/visualGround.test.ts`。

## Lua 里依赖它的函数

`components/map.lua`：

| Lua | 定义 | TS |
| --- | --- | --- |
| `Map:IsOceanTileAtPoint` | 该点 tile 属于海洋组，裙边也算 | `TurfMap.isOceanAtWorld` |
| `Map:IsOceanAtPoint(x, y, z, allow_boats)` | 海洋 tile，且不是视觉陆地，且（`allow_boats` 或）该点没有船 | `TurfMap.isOceanAtPoint`（船未移植，省略平台判断） |
| `Map:IsLandTileAtPoint`、`Map:IsAboveGroundAtPoint`（不带 `allow_water`） | 该点 tile 属于 `TileGroups.LandTiles`，裙边不算 | `TurfMap.isLandTileAtPoint` |
| `Map:IsPassableAtPoint(x, y, z)` | `IsAboveGroundAtPoint`，否则在不设 `ignore_land_overhang` 时取 `IsVisualGroundAtPoint`，再否则看可行走平台 | `TurfMap.isPassableAtPoint`（陆地或裙边；平台未移植） |
| `EntityScript:IsOnValidGround()` | 直接返回 `IsVisualGroundAtPoint` | 风滚草注入 `isVisualGroundAtPoint` |

`floater.lua` 的 `ShouldShowEffect` 是 `IsOceanAtPoint(...) and not IsVisualGroundAtPoint(...)`。由于 `IsOceanAtPoint` 已排除裙边，漂浮判定只需调用 `isOceanAtPoint`：贴着海岸、落在裙边上的物品站在岸上，不漂浮。`deployable.lua` 的部署检查用 `IsPassableAtPointWithPlatformRadiusBias(..., ignore_land_overhang = true)`，所以部署仍只看 tile。

## 引擎实现

Lua 绑定表在 `.data` 里，每项是一对指针：名字字符串 `IsVisualGroundAtPoint`（`.rdata` VA `0x1405229d8`）和绑定函数 `0x14007b0c0`。绑定函数读取 Lua 参数 x、y、z，组成 `float[3]` 后调用 `0x1400c8a50(map, &pos)`，这才是判断本身。其中用到两个辅助函数：

- `0x1400fdaa0(tilegrid, tx, ty)`：返回 8 个相邻格的陆地掩码，越过地图边缘的相邻格不计。
- `0x14049d890(tilemanager, tile)`：判断 tile 是否属于 `TileGroupManager` 偏移 `0x38` 处的组。`SetIsLandTileGroup`（`0x14049e850` → `0x14049deb0`）写的就是这个偏移，所以它是 `tilegroups.lua` 的 `TileGroups.LandTiles`。

常量（`.rdata`）：`TILE_SCALE = 4.0`、`0.5`、`2.0`、`0.25`、`0.75`、`1.25`、`1.75`。

```text
tx = trunc((x + 2 + width  * 4 * 0.5) * 0.25)      -- 即 floor(x/4 + width/2 + 0.5)
ty = trunc((z + 2 + height * 4 * 0.5) * 0.25)
if tx, ty 越界: return false
if IsLand(tile[tx, ty]): return true
m = 相邻陆地掩码(tx, ty)
if m == 0: return false
fx = (x + 2 + width  * 2) * 0.25 - tx              -- 点在格内的位置，0..1
fz = (z + 2 + height * 2) * 0.25 - ty

-- 掩码位：1 = (tx, ty-1)，2 = (tx+1, ty)，4 = (tx, ty+1)，8 = (tx-1, ty)
--         0x80 = (tx-1, ty-1)，0x10 = (tx+1, ty-1)，0x20 = (tx+1, ty+1)，0x40 = (tx-1, ty+1)
-- 侧边：靠陆地一侧的四分之一格
if m&1 and fz <= 0.25: return true
if m&4 and fz >= 0.75: return true
if m&8 and fx <= 0.25: return true
if m&2 and fx >= 0.75: return true

-- 四个角各取相关的三位：两条侧边加对角
low = m & 0x89; right = m & 0x13; up = m & 0x4c; far = m & 0x26
-- 两侧和对角都是陆地，或只有两侧是陆地：切掉角上一条宽斜带
if low   in (0x89, 0x09) and 0.75 - fx > fz: return true
if right in (0x13, 0x03) and fx - 0.25 > fz: return true
if up    in (0x4c, 0x0c) and fz > fx + 0.25: return true
if far   in (0x26, 0x06) and fz > 1.25 - fx: return true
-- 只有对角是陆地：切掉角上一条窄斜带
if low   == 0x80 and 0.25 - fx >= fz: return true
if right == 0x10 and fx - 0.75 >= fz: return true
if up    == 0x40 and fz >= fx + 0.75: return true
if far   == 0x20 and fz >= 1.75 - fx: return true
return false
```

比较的严格与否（`>` 与 `>=`）按汇编里的 `ja`／`jae` 照搬。汇编中各角的判断按"三位齐全、仅对角、仅两侧"的顺序排列；由于每个条件都只会返回 true，先后顺序不影响结果。

## 换算到本项目的网格

- tile 坐标公式与 `bunch_spawner.lua` 的 `floor(WIDTH/2 + 0.5 + x/TILE_SCALE)` 一致。存档导入脚本 `scripts/saveconvert/dst-region-tile.py` 已把这半格计入平移，所以项目格子 `col = floor(x / TILE_SIZE)`、`row = floor(z / TILE_SIZE)` 正好对应引擎的 tx、ty，不需要再偏移。
- 导入时把 z 取反（DST 是左手坐标系），行号随 DST 的 y 反向增长：引擎的 `ty - 1` 是项目的 `row + 1`，格内位置 `fz = 1 - (z / TILE_SIZE - row)`；x 方向不变。
- "陆地"用 `groundTileQuads.ts` 的 `isLandTile`，即项目里所有非海洋地皮。这些地皮都在 DST 的 LandTiles 范围内。

## 调用方的对应关系

| 用途 | Lua | TS 调用 |
| --- | --- | --- |
| 玩家移动（`Locomotor.isPassable`） | 原版由引擎碰撞限制，玩家能走到画面上的岸边 | `isPassableAtPoint` |
| 传送法杖落点、Wortox 灵魂跳跃、闪烁法杖落点、死亡是否留骷髅、部署的 `ExtraDeployDist` | `IsPassableAtPoint` | `isPassableAtPoint` |
| 物品下沉（`ShouldEntitySink`） | `IsPassableAtPoint(..., allow_water = not sinks)` | `isPassableAtPoint` 或（允许水面时）`isOceanAtWorld` |
| 物品漂浮、三叉戟和法杖的水面判断 | `IsOceanAtPoint` | `isOceanAtPoint` |
| 闪烁法杖的 `IsAboveGroundAtPoint`；鼹鼠、牛、闪电羊的游荡点；龙蝇的生成点（`FindWalkableOffset`） | `IsAboveGroundAtPoint` | `isLandTileAtPoint` |
| 风滚草落地检查 | `IsOnValidGround` | `isVisualGroundAtPoint` |
| 部署检查 | `ignore_land_overhang = true` | `deployMap` 的规则只看 tile |
| 寻路网格 | 引擎 C++，未核实 | `isLandTileAtPoint`，裙边不在网格内 |

## 已知差异

- 船与可行走平台未移植，`IsOceanAtPoint` 和 `IsPassableAtPoint` 里的平台判断都省略。
- 寻路网格没有反汇编核实，目前按 tile 划分；目标点在裙边上时，按现有逻辑直线走过去。
- 洞穴虚空旁的陆地同样有裙边：`vaultroom.lua` 用 `tile == IMPASSABLE and IsVisualGroundAtPoint` 判断，与反汇编结果一致，玩家可以走进虚空格的四分之一。

## 复查方法

```bash
E=/data/copy/AssetArchive-Dev/data/DST/bin64/dontstarve_steam_x64.exe
llvm-objdump -d --no-show-raw-insn -j .text $E > dst.asm
# 名字字符串的文件偏移 0x5211d8 → VA：.rdata 文件偏移 0x514800 对应 VA 0x140516000
# 在 .data 中搜索 VA 0x1405229d8 的 8 字节小端值，其后 8 字节就是绑定函数地址
grep -n '^1400c8a50:' dst.asm
```

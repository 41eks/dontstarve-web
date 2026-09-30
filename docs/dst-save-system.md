# 《饥荒联机版》存档原理与项目 JSON 存档设计

本文先总结《饥荒联机版》（Don't Starve Together，以下简称 DST）的存档目录、世界与玩家数据结构、地形编码方式，以及保存和加载流程，再据此设计适合本项目的 JSON 存档格式。结论主要来自以下 Lua 源码：

- `scripts/mainfunctions.lua`
- `scripts/networking.lua`
- `scripts/shardindex.lua`
- `scripts/gamelogic.lua`
- `scripts/entityscript.lua`
- `scripts/components/autosaver.lua`
- `scripts/components/map.lua`
- `scripts/components/undertile.lua`
- `scripts/map/forest_map.lua`
- `scripts/constants.lua`

同时使用项目中的 `save/Cluster_54` 作为实例进行验证。文中涉及的二进制布局如果没有出现在 Lua 源码中，会明确标为实测结果或推断；这部分的最终实现位于 Klei 原生引擎中。

## 总体结论

项目当前从 `public/saves/initial-world.json` 反序列化初始世界，Prefab 定义位于 `packages/prefab/src/definitions.json`。在游戏调试控制台输入 `c_save()`，会将当前内存中的世界和玩家状态导出并下载为 `initial-world.json`，格式与启动文件一致。将下载的文件替换到 `public/saves/initial-world.json` 后刷新页面即可加载；浏览器下载不会直接修改项目文件。

手动导出保存所有月树逻辑记录（包括距离玩家超过 120 单位、模型已卸载的月树）、已放置建筑和墙、箱子状态及物品、地面掉落物、玩家位置、背包、装备、待放置建造缓存和累计运行时间。摆放预览、相机朝向、动画帧与引擎对象不写入 JSON。打开或关闭箱子的动画按目标状态保存；Snapshot 编号递增，`parentId` 指向上一次成功下载的编号。自动保存与存档列表管理仍属于后续设计。

DST 的存档不是单个文件，而是由多个层次组成：

```text
Cluster（服务器集群）
├── Master（地表 Shard）
│   ├── shardindex
│   └── save/session/<session_id>/
│       ├── <snapshot>
│       ├── <snapshot>.meta
│       └── <encoded_user_id>/<snapshot>
└── Caves（洞穴 Shard）
    ├── shardindex
    └── save/session/<session_id>/...
```

核心设计可以概括为：

1. 每个 Shard 独立保存自己的世界。
2. `shardindex` 指向该 Shard 当前使用的 `session_id`。
3. 每次保存产生一个递增编号的世界 Snapshot。
4. 世界 Snapshot 保存地形、世界组件以及所有持久化世界实体。
5. 玩家角色单独保存在用户目录中，不直接塞进世界实体表。
6. 地形使用定长二维栅格编码；树木、建筑、容器等使用 Prefab 实体记录。
7. Lua 负责组织存档数据，最终文件管理、压缩和 Snapshot 操作由 `TheNet`、`TheSim` 等原生接口完成。

保存关系如下：

```text
当前服务器配置
      │
      ▼
  shardindex ──────► 当前 session_id
                           │
                           ▼
                    世界 Snapshot
                 ┌─────────┴─────────┐
                 ▼                   ▼
          地形与世界实体        snapshot.players
                                     │
                                     ▼
                              玩家独立 Snapshot
```

## 存档目录的层次

### Cluster

Cluster 是一组相互连接的 DST 世界。`cluster.ini` 保存集群级服务器配置，常见的 `Master` 和 `Caves` 则是两个独立运行、互相通信的 Shard。

地表和洞穴不是同一个世界文件中的两层地图。它们各自拥有：

- `server.ini`
- `leveldataoverride.lua`
- `modoverrides.lua`
- `save/shardindex`
- `save/session/`
- 独立的世界实体和地形 Snapshot

### ShardIndex

`shardindex` 是当前 Shard 的索引和配置文件，主要保存：

- 当前 `session_id`
- 世界类型，例如 `forest` 或 `cave`
- 游戏模式和生成选项
- 已启用的服务器 Mod
- ShardIndex 自身的数据版本

加载存档时，`ShardIndex:GetSaveData()` 先读取当前 `session_id`，再通过 `TheNet:GetWorldSessionFile()` 找到对应的世界 Snapshot。因此判断哪个 session 当前有效，应以 `shardindex` 为准，不能只选择 `session` 目录中看起来最新的目录。

本项目样本中：

| Shard | 当前 Session | 世界类型 |
|---|---|---|
| `Master` | `49C77C52C52BF94F` | `forest` |
| `Caves` | `037C7E6495AF42E4` | `cave` |

`Master/save/session` 中还保留了另一个 session 的文件，但它没有被当前 Master 的 `shardindex` 引用，因此不能仅凭文件存在就将它视为当前地表世界。

### Session 和 Snapshot

Session 表示一个连续世界存档，其目录名称是 `session_id`。目录中的数字文件是世界 Snapshot：

```text
0000000008
0000000008.meta
0000000009
0000000009.meta
...
0000000013
0000000013.meta
```

数字编号随保存递增，用于自动保存和回档。`.meta` 是供 Snapshot 列表快速显示的轻量元数据。在当前样本中，它包含时钟、天数、昼夜阶段和季节等信息，而完整世界状态位于无扩展名的 Snapshot 文件中。

## 世界 Snapshot 的顶层结构

世界保存入口是 `mainfunctions.lua` 中的 `SaveGame()`。它组装的 `savedata` 主要包含：

| 字段 | 内容 |
|---|---|
| `map` | 地形栅格、世界生成拓扑和世界 Prefab 组件状态 |
| `ents` | 树、建筑、生物、地面物品等持久化实体 |
| `world_network` | 网络世界实体的组件状态，如时钟和季节 |
| `shard_network` | Shard 间共享或同步的组件状态 |
| `snapshot` | 本次世界 Snapshot 所关联的在线玩家 ID |
| `meta` | Session、生成版本、种子等世界元数据 |
| `mods` | 保存时启用的 Mod 记录 |
| `super` | 控制台超级权限使用标记 |

当前样本的开发版世界 Snapshot 是一段返回 `savedata` 的 Lua 代码：

```lua
local savedata = {}
local tablefunctions = {}

tablefunctions["map_fn"] = function()
    return { ... }
end

savedata["map"] = tablefunctions["map_fn"]()
return savedata
```

读取时，Lua 侧最终会在受限环境中运行这段序列化结果，将其恢复成 table。正式版本还可以由原生层进一步编码或压缩，因此不能假设所有 DST Snapshot 都一定是可直接阅读的纯文本 Lua。

## 世界实体如何保存

### 哪些实体会进入存档

`SaveGame()` 遍历全局 `Ents`，只保存满足以下条件的实体：

```lua
v.persists
and v.prefab ~= nil
and v.Transform ~= nil
and v.entity:GetParent() == nil
and v:IsValid()
```

也就是说：

- `persists = false` 的特效、临时对象不会保存。
- 没有 Prefab 或位置组件的对象不会作为普通世界实体保存。
- 已经属于容器、物品栏或其他父实体的子对象不会再次作为顶层世界实体保存，避免重复。

### SaveRecord

每个实体通过 `EntityScript:GetSaveRecord()` 生成记录，基本结构为：

```lua
{
    prefab = "treasurechest",
    x = 12.345,
    y = 0,
    z = -8.25,
    skinname = ...,
    data = {
        container = ...,
        workable = ...,
        ...
    }
}
```

其中：

- `prefab` 决定加载时生成哪种对象。
- `x/y/z` 是世界坐标，保存前取到小数点后三位。
- 船和其他可行走平台上的对象还可保存平台 UID 与相对坐标。
- `skinname`、`skin_id` 等字段保存皮肤。
- `data` 来自实体及其组件的 `OnSave`/持久化数据。

容器和物品栏中的物品会嵌套保存。例如箱子由世界实体表保存，箱内物品由 `container` 组件调用物品的 `GetSaveRecord()`，写入箱子的组件数据中。

### 按 Prefab 分组

世界实体在 Snapshot 中按照 Prefab 名称分组：

```lua
ents = {
    evergreen = {
        { x = ..., z = ..., data = ... },
        { x = ..., z = ..., data = ... },
    },
    treasurechest = {
        { x = ..., z = ..., data = ... },
    },
}
```

因为外层键已经表明 Prefab，保存时会移除每条记录中重复的 `prefab` 字段。序列化时实体表也不是作为一个超大 Lua table 一次性处理，而是按 Prefab 分别执行 `DataDumper()`。

### 实体引用

传送器、跟随关系等对象可能引用其他实体。保存阶段会收集这些引用，并给被引用实体保留原 GUID 作为存档 `id`。加载时分两遍处理：

1. 第一遍 `SpawnSaveRecord()` 创建所有 Prefab、设置位置并加载各自数据。
2. 第二遍 `LoadPostPass()` 使用旧 ID 到新实体的映射重新连接跨实体引用。

这避免了“加载 A 时它引用的 B 还没有生成”的顺序问题。

## 玩家为什么单独保存

在线玩家不会作为普通世界实体混入 `savedata.ents`。保存世界时，代码会：

1. 将在线玩家的用户 ID 写入 `savedata.snapshot.players`。
2. 对每位玩家调用 `SerializeUserSession()`。
3. 使用 `player:GetSaveRecord()` 保存角色状态。
4. 由原生 `TheNet:SerializeUserSession()` 写入该用户自己的 Snapshot。

典型目录为：

```text
save/session/<session_id>/<encoded_user_id>/<snapshot>
```

玩家记录包含角色 Prefab、坐标、年龄以及角色组件状态。物品栏和装备由玩家的 `inventory` 组件递归保存，因此会跟随玩家存档，而不是保存到世界的地面实体列表中。

这样设计使玩家数据可以在登录、下线、换角色、跨 Shard 和世界回档时单独处理。世界 Snapshot 中的玩家列表则负责把某次世界状态与对应的玩家状态关联起来。

## 地形如何保存

地形不是由大量“地皮实体”组成，而是四张与地图等宽高的编码栅格：

| 字段 | 作用 |
|---|---|
| `tiles` | 每格当前地皮的数值 ID |
| `tiledata` | 每格附加地图数据，精确位定义位于原生引擎中 |
| `nav` | 寻路栅格 |
| `nodeidtilemap` | 每格所属的世界生成节点/房间 |

此外还保存：

| 字段 | 作用 |
|---|---|
| `width`、`height` | 地形栅格尺寸 |
| `world_tile_map` | 地皮名称到数值 ID 的映射 |
| `topology` | 世界生成节点、边、区域和生成选项 |
| `generated` | 世界生成阶段留下的数据 |
| `roads` | 道路数据 |
| `persistdata` | 世界 Prefab 的组件数据 |
| `prefab` | 世界类型，例如 `forest` |

### 首次生成与后续保存

首次生成世界时，`forest_map.lua` 调用：

```lua
save.map.tiles,
save.map.tiledata,
save.map.nav,
save.map.adj,
save.map.nodeidtilemap = WorldSim:GetEncodedMap(join_islands)
```

后续保存则直接从当前 Map 重新取得数据：

```lua
save.map.tiles = ground.Map:GetStringEncode()
save.map.world_tile_map = GetWorldTileMap()
save.map.tiledata = ground.Map:GetDataStringEncode()
save.map.nav = ground.Map:GetNavStringEncode()
save.map.nodeidtilemap = ground.Map:GetNodeIdTileMapStringEncode()
save.map.width, save.map.height = ground.Map:GetSize()
```

所以玩家铲掉或铺设地皮后，`Map:SetTile()` 修改的是当前地形栅格；下次保存时，变化后的结果自然会进入 `tiles`，不需要保存一份“玩家曾经铲地”的事件日志。

### 当前样本的实测格式

当前 Master 的 `0000000013` Snapshot 中：

```text
width  = 426
height = 426
格子数 = 181476
```

`tiles`、`tiledata`、`nav`、`nodeidtilemap` 四个字段都是 Base64 字符串，每个字段：

```text
Base64 长度：483948 字符
解码长度：  362961 字节
头部：      56 52 53 4E 00 01 00 00 00
数据区：    362952 字节
```

数据区满足：

```text
362952 = 426 × 426 × 2
```

因此这份 Snapshot 的每张栅格每格占 2 字节。将 `tiles` 数据区按小端 `uint16` 解析，可以准确得到 `world_tile_map` 中的地皮 ID。头部可以识别为 `VRSN\0` 加版本值 `1`；其正式定义和其他三张栅格中每一位的语义没有出现在 Lua 源码中。

当前地形数量最多的部分为：

| ID | 地皮名 | 格子数 | 占比 |
|---:|---|---:|---:|
| 203 | `OCEAN_SWELL` | 43,286 | 23.85% |
| 204 | `OCEAN_ROUGH` | 40,399 | 22.26% |
| 201 | `OCEAN_COASTAL` | 33,641 | 18.54% |
| 6 | `GRASS` | 11,025 | 6.08% |
| 1 | `IMPASSABLE` | 11,003 | 6.06% |
| 7 | `FOREST` | 10,021 | 5.52% |
| 3 | `ROCKY` | 6,080 | 3.35% |

`constants.lua` 定义 `TILE_SCALE = 4`，即一个地形格对应约 `4 × 4` 世界坐标单位。地图以世界原点为中心进行坐标换算。

### 地皮 ID 的版本兼容

Snapshot 不仅保存数字 ID，还保存 `world_tile_map`：

```lua
{
    GRASS = 6,
    FOREST = 7,
    OCEAN_COASTAL = 201,
    ...
}
```

加载时，游戏将旧存档的名称映射与当前版本的 `GetWorldTileMap()` 比较。如果同名地皮的 ID 已改变，就建立旧 ID 到新 ID 的转换表，再调用 `DoDynamicTileConversion()`。

这对游戏升级和 Mod 地皮尤其重要。解析器不能把某个版本中的数值 ID 永久写死，应优先读取 Snapshot 自带的 `world_tile_map`。

### 临时覆盖地形

某些地形会临时覆盖原地皮。主 `tiles` 栅格记录当前可见地皮，而 `undertile` 世界组件使用一个稀疏 `DataGrid` 保存下面原本的地皮。它通过 `ZipAndEncodeSaveData()` 压缩后进入 `map.persistdata`。

加载时，`undertile` 同样使用地皮 ID 转换表处理版本变化。因此仅解析 `tiles` 可以还原当前表面，但如果要完整还原临时地形消失后的状态，还需要读取世界组件数据。

## 世界组件状态

不是所有全局状态都适合表示成地图格或实体。例如：

- 当前天数和昼夜阶段
- 季节及剩余天数
- Boss 和事件管理器
- 再生、生成器和全局计时器
- 临时地皮、码头和海冰管理器

这些状态通常由世界 Prefab、`world_network` 或 `shard_network` 上的组件通过 `GetPersistData()` 保存。

大体分工如下：

| 位置 | 典型内容 |
|---|---|
| `map.persistdata` | 世界 Prefab 的服务端组件状态 |
| `world_network.persistdata` | 时钟、季节等需要网络同步的世界状态 |
| `shard_network.persistdata` | Shard 间共享或协调的数据 |

因此只复制 `ents` 和 `tiles` 并不能得到一个完整可运行的世界。

## 序列化与文件格式

### DataDumper

世界保存时，顶层字段分别经过 `DataDumper()` 转成 Lua 表达式。实体数据则按 Prefab 分组单独序列化。在写盘前，源码还会检查 `NaN`、正负无穷等可能破坏存档的数据。

随后调用：

```lua
SerializeWorldSession(data, session_identifier, callback, metadataStr)
```

它最终转交给：

```lua
TheNet:SerializeWorldSession(
    data,
    session_identifier,
    ENCODE_SAVES,
    callback,
    metadataStr
)
```

`ENCODE_SAVES` 在源码中定义为：

```lua
ENCODE_SAVES = BRANCH ~= "dev"
```

因此开发分支可以产生便于阅读的 Lua Snapshot，非开发分支则允许原生层进行编码。不同文件还可能使用 `TheSim:ZipAndEncodeString()`，先用 `DataDumper()` 序列化，再由引擎压缩和编码。

这说明 DST 存档不能统一当作普通 Lua 文本处理。可靠的工具至少需要识别：

- 可读 Lua Snapshot
- 引擎编码或压缩的存档
- Base64 地图栅格
- 组件内部的 `ZipAndEncodeSaveData`
- 玩家 Snapshot 的原生文件包装

## 保存流程

完整世界保存过程可以概括为：

```text
服务器触发保存
      │
      ▼
TheNet:StartWorldSave()
      │
      ├── 遍历 Ents，生成实体 SaveRecord
      ├── 编码当前 Map 地形和寻路栅格
      ├── 保存 World / WorldNetwork / ShardNetwork 组件
      ├── 分别序列化在线玩家
      └── 记录 Mod 和世界元数据
      │
      ▼
DataDumper 分块序列化
      │
      ▼
TheNet:SerializeWorldSession()
      │
      ├── 写世界 Snapshot
      └── 写 Snapshot .meta
      │
      ▼
IncrementSnapshot()
      │
      ▼
更新 shardindex 和时间文件
```

只有服务器会保存世界；客户端的 `ShardIndex:SaveCurrent()` 会直接返回。客户端可以保存或更新自己的用户 Session，但不负责生成权威世界 Snapshot。

## 自动保存与多 Shard 同步

`autosaver.lua` 监听天数变化和保存事件。Master Shard 发起保存后，其他 Shard 会同步 Snapshot 编号：

- Secondary 落后时可以向前同步编号。
- Snapshot 编号不一致且无法直接对齐时，会截断较新的 Snapshot 并重新加载。
- Master 和 Caves 各自写自己的世界数据，但回档边界需要保持一致。

保存完成后，`TheNet:IncrementSnapshot()` 增加编号。回档界面则通过 `TruncateSnapshots()` 删除目标点之后的 Snapshot，使世界和相关玩家记录回到同一个历史时刻。

## 加载流程

世界恢复顺序大致如下：

1. 从 `shardindex` 取得当前 `session_id`。
2. 原生层找到对应的世界 Snapshot 并反序列化成 `savedata`。
3. 创建世界 Prefab 并设置地图宽高。
4. 恢复 `tiles`、`tiledata` 和 `nodeidtilemap`。
5. 根据 `world_tile_map` 转换旧地皮 ID。
6. 在实体尚未生成前执行存档 Retrofit，兼容旧版本世界。
7. 创建地形物理碰撞并恢复 `nav` 寻路栅格。
8. 恢复 `topology`、世界元数据和世界组件。
9. 按 Prefab 创建 `savedata.ents` 中的实体。
10. 第二遍连接跨实体引用并执行 `LoadPostPass()`。
11. 恢复 Mod 记录、世界规则及场景脚本。
12. 玩家加入时，再从对应的用户 Session 恢复角色。

存档升级不是简单修改版本号。`map/retrofit_savedata.lua` 会在实体生成之前检查旧世界并按当前版本补充、删除或迁移地图与实体内容。

## `server_temp/server_save` 不是完整世界备份

`gamelogic.lua` 会生成一个“server friendly”的临时文件，但写入前会暂时移除：

- `ents`
- `snapshot`
- `map.adj`
- `map.generated`
- `map.world_tile_map`
- `map.persistdata`
- `map.nav`
- `map.tiles`
- 世界网络数据及部分元数据

其中 `map.tiles` 会被替换为空字符串。因此：

> `server_temp/server_save` 不能用来完整恢复地形和世界实体。权威世界数据位于 `save/session/<session_id>/<snapshot>`。

## 实现存档解析器时的建议

如果当前项目以后需要读取或还原 DST 存档，建议分层实现：

1. **目录解析**：读取 Cluster、ShardIndex、Session 和 Snapshot 关系。
2. **外层解码**：识别纯 Lua、引擎编码和压缩包装。
3. **Lua 数据解析**：不要直接在非沙箱环境执行不可信存档代码。
4. **地形解析**：读取 Snapshot 自带的宽高及 `world_tile_map`，校验 `VRSN` 和数据长度。
5. **实体解析**：按 Prefab 展开记录，保留嵌套物品及引用 ID。
6. **组件解析**：按需支持世界、玩家和 Prefab 组件的私有数据。
7. **版本迁移**：不要假设不同游戏版本、分支或 Mod 使用完全相同的数据结构。

对于当前项目的地形渲染，最小可用数据是：

```text
map.width
map.height
map.tiles
map.world_tile_map
```

若要实现可行走区域、世界生成房间分析、完整回档或游戏逻辑恢复，还需要继续处理 `tiledata`、`nav`、`nodeidtilemap`、`topology`、`persistdata`、`ents` 和玩家 Session。

## 小结

DST 的存档本质上是“版本化世界快照 + 独立玩家快照”的组合：

- `shardindex` 决定当前世界 Session。
- Snapshot 编号提供自动保存和回档历史。
- 地形使用紧凑的二维数值栅格。
- 世界物体以 Prefab 和组件状态保存。
- 玩家角色、物品栏和装备独立保存。
- 世界级系统由多个 PersistData 区域保存。
- 加载时先恢复地形，再生成实体，最后重建引用和组件关系。
- 压缩、Snapshot 管理和部分二进制编码由 Klei 原生引擎实现，并未完全暴露在 Lua 源码中。

这种结构既避免了为每块地皮、每个物品建立统一巨型对象，也允许地表、洞穴和玩家在保持 Snapshot 一致性的前提下分别保存和恢复。

---

## 本项目的 JSON 存档设计

### 目标与边界

本项目借鉴 DST 的“版本化 Snapshot、Prefab 实体、组件数据、玩家逻辑独立、两遍恢复引用”设计，但不复制 Lua 文件和原生编码层。第一版采用一个自包含 JSON 文件表示一次完整 Snapshot，适合浏览器本地保存、下载和导入：

```text
three-roaming-save-v1.json
├── 格式、版本和 Session 标识
├── Snapshot 元数据
├── World
│   ├── 世界系统状态
│   ├── 地形或世界生成数据
│   └── 按 Prefab 分组的持久化实体
└── Players
    └── 玩家位置、状态、背包、装备和缓冲建造
```

这里的“玩家逻辑独立”是指玩家数据不混入 `world.entities`，不是指第一版必须拆成多个物理文件。单文件可以保证世界、地面物品和玩家背包来自同一提交点，避免复制或丢失物品。将来支持多人或地表/洞穴 Shard 后，可以在不改变内部对象结构的前提下将 `world` 和各个 `players[playerId]` 拆成独立文件，由 Manifest 绑定为同一个 Snapshot。

第一版应满足以下要求：

1. 保存的是游戏逻辑状态，不是 Three.js 场景树的镜像。
2. 一个文件可以完整恢复当前单人世界，不依赖更早的 Snapshot。
3. 所有格式变更均有显式版本，并通过迁移函数升级。
4. 实体通过稳定 ID 引用，加载时先创建、再连接引用。
5. 写入是原子的；未写完的 Snapshot 永远不能成为当前存档。
6. 导入的数据在创建场景对象前完成结构和语义校验。

### 顶层格式

顶层结构固定如下：

| 字段 | 类型 | 说明 |
|---|---|---|
| `format` | string | 固定为 `three-roaming-save`，防止误读其他 JSON |
| `schemaVersion` | integer | JSON 数据结构版本；第一版为 `1` |
| `gameVersion` | string | 写入存档的应用版本，仅用于诊断和兼容提示 |
| `session` | object | 一次连续游戏的身份与初始创建时间 |
| `snapshot` | object | 本次不可变快照的编号、父快照和保存原因 |
| `world` | object | 世界系统、地图和世界实体 |
| `players` | object | 以稳定玩家 ID 为键的玩家记录 |

`session.id` 在新建世界时生成，此后保持不变。`snapshot.id` 在同一 Session 内单调递增，使用补零字符串，例如 `0000000042`，避免 JSON 数值精度和文件名排序问题。手动存档和自动存档都创建新 Snapshot，不原地修改历史 Snapshot。

时间字段使用 UTC ISO 8601 字符串；持续时间使用秒。坐标、比例和进度必须是有限数，禁止 `NaN` 和正负无穷。可选字段不存在时应省略，只有字段语义明确允许空值时才写 `null`。

### 完整示例

下面示例覆盖当前项目实际需要保存的主要状态。为了便于阅读，只展示少量实体和背包槽；正式存档允许对应数组为空或包含更多记录。

```json
{
  "format": "three-roaming-save",
  "schemaVersion": 1,
  "gameVersion": "0.0.0",
  "session": {
    "id": "0195ca23-4f37-7d84-90b1-5d2777189f28",
    "createdAt": "2026-09-28T04:12:30.000Z"
  },
  "snapshot": {
    "id": "0000000042",
    "parentId": "0000000041",
    "savedAt": "2026-09-28T05:03:11.482Z",
    "reason": "autosave"
  },
  "world": {
    "shardId": "master",
    "prefab": "forest",
    "seed": "1538069317",
    "elapsedSeconds": 1842.375,
    "systems": {
      "clock": {
        "day": 32,
        "phase": "day",
        "phaseProgress": 0.42
      },
      "season": {
        "name": "autumn",
        "daysRemaining": 8.5
      },
      "random": {
        "algorithm": "xoshiro128ss",
        "state": [1252864550, 388211817, 90175512, 3109841255]
      }
    },
    "map": {
      "kind": "generated",
      "generator": {
        "id": "forest-v1",
        "seed": "1538069317",
        "options": {
          "size": 1000,
          "moonTreeCount": 500,
          "moonTreeExclusionRadiusSquared": 600
        }
      }
    },
    "entities": {
      "moon_tree": [
        {
          "id": "e_moon_tree_000001",
          "transform": {
            "position": [114.375, 0, -208.125],
            "rotationY": 0
          },
          "components": {}
        },
        {
          "id": "e_moon_tree_000002",
          "transform": {
            "position": [-87.5, 0, 341.75],
            "rotationY": 0
          },
          "components": {}
        }
      ],
      "researchlab": [
        {
          "id": "e_01J8Y2KMH2Q4JVV9V4T4ZP3JPK",
          "transform": {
            "position": [18.125, 0, -9.5],
            "rotationY": 0
          },
          "components": {
            "building": {
              "state": "idle"
            }
          }
        }
      ],
      "treasurechest": [
        {
          "id": "e_01J8Y2N6PMAZE47YDCA3KT2F0A",
          "transform": {
            "position": [25, 0, -12.25],
            "rotationY": 0
          },
          "components": {
            "building": {
              "skinId": "treasurechest_ancient",
              "state": "closed"
            },
            "container": {
              "slotCount": 9,
              "slots": [
                {
                  "slotKey": "0",
                  "item": {
                    "itemId": "log",
                    "count": 8
                  }
                }
              ]
            }
          }
        }
      ],
      "wall_stone": [
        {
          "id": "e_01J8Y2P017M81DGWTZ7NTQSE8P",
          "transform": {
            "position": [32.5, 0, -17.5],
            "rotationY": 0
          },
          "components": {
            "health": {
              "current": 400,
              "maximum": 400
            }
          }
        }
      ],
      "ground_item": [
        {
          "id": "e_01J8Y2QE5N0T16QPFAN4FK2G8X",
          "transform": {
            "position": [3.25, 0, 6.75],
            "rotationY": 0
          },
          "components": {
            "stack": {
              "itemId": "twigs",
              "count": 1
            }
          }
        }
      ]
    }
  },
  "players": {
    "local": {
      "prefab": "wilson",
      "shardId": "master",
      "transform": {
        "position": [0, 0, 0],
        "rotationY": 0
      },
      "stats": {
        "health": 150,
        "hunger": 150,
        "sanity": 200
      },
      "inventory": {
        "containers": {
          "player:inventory": {
            "slotCount": 15,
            "slots": [
              {
                "slotKey": "0",
                "item": {
                  "itemId": "cutgrass",
                  "count": 3
                }
              },
              {
                "slotKey": "1",
                "item": {
                  "itemId": "twigs",
                  "count": 17
                }
              }
            ]
          },
          "player:equipment": {
            "slotCount": 3,
            "slots": [
              {
                "slotKey": "hand",
                "item": {
                  "itemId": "torch",
                  "count": 1
                }
              }
            ]
          }
        },
        "bufferedBuilds": [
          {
            "recipeId": "treasurechest",
            "skinId": "treasurechest_ancient"
          }
        ]
      }
    }
  }
}
```

`snapshot.parentId` 在第一个 Snapshot 中为 `null`。它只表达历史关系；每个文件仍是完整快照，加载时不需要沿父链回放增量。

### 世界数据

#### 世界系统

`world.systems` 保存没有自然宿主实体的权威状态，例如时钟、季节、世界事件和确定性随机数状态。每个系统拥有自己的小对象，不建立一个无约束的全局 `data` 字段。

第一版当前尚未实现的时钟、季节和生存属性可以省略，不能用虚构的默认进度写入存档。对应玩法落地时再增加字段并提升 `schemaVersion` 或提供有明确默认值的迁移。

随机数状态需要与生成种子区分：

- `world.seed` 标识初始世界。
- `map.generator.seed` 复现初次生成。
- `systems.random.state` 让加载后的下一次随机事件与保存前连续。

如果业务仍直接使用 `Math.random()`，就不能承诺后续随机序列可复现；第一版实现存档前应先引入可保存状态的伪随机数生成器。

#### 地图与月树实体

当前地面是固定平面，没有 DST 式可修改地皮，因此 `map` 保存生成器或初始数据集的身份和参数。当前应用从 `public/saves/initial-world.json` 的 `world.entities.moon_tree` 读取 500 个预先随机生成的固定坐标，通过 `createMoonTreeForest()` 的 `positions` 选项创建通用实体记录；坐标位于 1000 × 1000 的区域内，并保留出生点空地。每次进入页面直接恢复存档中的实体记录，不在运行时重新随机生成。

`ProximityEntities` 保留全部实体的 `id` 和地面接触点 `position`，按玩家与月树在 XZ 平面上的距离管理模型：距离小于或等于 `10 * TILE_SIZE` 时创建模型，超出时移除模型并释放其几何体。项目的 `TILE_SIZE = 12`，因此加载半径为 120 个世界单位。只有范围内的月树更新动画和 Billboard 朝向，并与玩家、猪王一起按脚点的相机空间深度排序。

月树使用通用动画精灵，通过 `createAnimatedSpriteFactory()` 共享一次加载的动画资源、材质和贴图；每个已加载实体拥有独立模型、几何体和动画控制器。存档应遍历 `MoonTreeForest.entities` 中的全部逻辑记录，而不能只保存 `activeEntities` 或场景中当前存在的模型。距离卸载只释放渲染对象，不删除世界实体。

第一版每棵月树保存稳定的存档 ID、脚点位置和逻辑旋转，当前没有额外持久化组件时使用空的 `components`。`ProximityEntity.id` 按位置数组下标生成，只适用于本次运行；持久化 ID 由 `saveId` 从 JSON 恢复并在导出时保留。加载范围、是否已加载、模型引用、动画帧和相机朝向属于运行时派生状态，按当前 Prefab 定义与恢复后的玩家位置重新计算。`map.generator.options.moonTreeCount` 仅描述初次生成参数，不能代替实际实体记录。

若以后加入可修改地皮，可采用与 DST 类似的编码对象：

```json
{
  "width": 426,
  "height": 426,
  "tileSize": 4,
  "tileCatalog": {
    "GRASS": 6,
    "FOREST": 7
  },
  "tiles": {
    "encoding": "base64-le-u16",
    "data": "BgAGAAcA..."
  }
}
```

加载器必须用存档自带的 `tileCatalog` 按名称映射到当前 ID，不能假设数字 ID 永远不变。Base64 只是 JSON 内的二进制承载方式，不表示加密；解码后必须校验字节数等于 `width × height × 2`。

#### Prefab 实体

`world.entities` 按 Prefab ID 分组，避免每条记录重复 `prefab`。记录只包含可持久化逻辑：

- `id`：Session 内永不复用的实体 ID。
- `transform`：地面接触点位置和必要的逻辑旋转。
- `components`：该 Prefab 已注册的持久化组件数据。

当前项目需要的 Prefab 映射为：

| 运行时对象 | 存档 Prefab | 需要保存的组件 |
|---|---|---|
| 研究站、炼金引擎、箱子、帐篷 | 各自的建造 ID | `building`，以及将来的 `container` 等 |
| 石墙 | `wall_stone` | `health` 等逻辑状态 |
| 地面物品 | `ground_item` | `stack` |
| 每棵月树 | `moon_tree` | 当前无额外组件；保存所有实体的 ID 和 Transform，包括未加载模型的月树 |
| Wilson | 不进入世界实体表 | `players.local` |

墙的画面朝向只由相机 heading 决定，不能保存 `frontImageIndex`、`sideImageIndex` 或当前选中的图片。石墙逻辑旋转保持 `0`；加载后的每帧继续通过 `isDiagonalHeading()` 选择正面或斜面。

`building.state` 只允许稳定状态，例如 `idle`、`closed`、`open`。`placing`、`opening`、`closing` 等过渡态在保存时归一化到明确的稳定状态，加载时不重放一次性动画。

`c_save()` 将所有 `treasurechest` 的 `building.state` 统一保存为 `closed`，保留皮肤和槽位内容。此归一化仅作用于输出存档，当前场景中的开关状态保持不变；初始存档中的箱子也使用 `closed`。

#### 实体引用与父子关系

组件引用其他实体时统一保存 ID，不保存数组下标、Three.js `Object3D.id` 或内存引用：

```json
{
  "follower": {
    "leaderEntityId": "e_01J8Y2KMH2Q4JVV9V4T4ZP3JPK"
  }
}
```

容器中的物品作为 `container.slots[].item` 嵌套保存，不同时出现在 `world.entities.ground_item` 中。物品从地面放入容器时，应在同一逻辑事务内删除地面实体并写入槽位；反向操作同理。这继承了 DST “有父实体的对象不再作为顶层实体保存”的规则。

### 玩家与物品栏

玩家记录独立于 `world.entities`，但通过 `shardId` 与本次世界快照关联。当前位置取玩家地面接触点，即 `player.position`，不保存 Cannon 刚体中心的高度偏移。

物品栏使用项目已有的稳定地址：

- 普通背包：`containerId = "player:inventory"`，`slotKey = "0"` 到 `"14"`。
- 装备栏：`containerId = "player:equipment"`，`slotKey = "hand" | "body" | "head"`。

JSON 按容器分组，只写非空槽，空槽由 `slotCount` 和缺失的 `slotKey` 推导。每个 `item` 仅保存权威字段 `itemId`、`skinId` 和 `count`；名称、图标、Atlas、最大堆叠数和装备类型都从当前 `INVENTORY_ITEM_SPECS` / `INVENTORY_SKIN_SPECS` 重建，避免元数据在存档中过期。

`bufferedBuilds` 是 `InventoryStore` 的权威状态，也必须保存。读取时需要校验：

- `itemId` 和 `recipeId` 当前存在。
- `count` 是正的安全整数，且不超过当前 `maxStack`。
- `skinId` 属于对应物品或配方。
- 装备物品可被目标 `hand`、`body` 或 `head` 槽接受。
- 槽地址没有重复，普通背包索引在 `0..14` 内。

不兼容的物品不能静默删除。加载器应拒绝该 Snapshot，并给出包含玩家 ID、容器和槽位的错误；以后如需支持被移除的 Mod 物品，应另行设计可恢复的 `orphanedItems` 机制。

### 哪些内容不保存

以下内容可由权威状态重建，或者属于不应跨会话保留的瞬时状态：

- Three.js 的 `Scene`、`Group`、`Mesh`、材质、纹理、Geometry 和对象数字 ID。
- Cannon `World`、`Body`、Shape、当前速度和碰撞接触缓存。
- 相机矩阵、Billboard 法线、透明物体 `renderOrder` 和墙的当前朝向图片。
- 动画当前帧、帧累计时间，以及拾取、进食、拿出物品等一次性动画。
- 月树的 `model` 引用、`activeEntities` 集合和距离加载状态；由恢复后的玩家位置及 `10 * TILE_SIZE` 半径重建。
- 鼠标位置、射线检测结果、建造预览、拖拽状态、选中槽和打开的 UI 面板。
- 物品的显示名、图标路径、Atlas 路径、最大堆叠数等静态定义。
- 可从资源和 Prefab 定义重新得到的比例、ground offset 与碰撞形状。

保存发生时若玩家正拖拽槽位，应先完成或取消 UI 操作；若正处于建造预览，预览本身不保存，尚未消费的配方仍由 `bufferedBuilds` 或背包物品保留。

### 保存流程

保存必须在一个游戏逻辑帧边界取得一致快照，不能在异步贴图加载或动画回调中分别读取世界与背包：

```text
收到保存请求
    │
    ├── 等到当前逻辑更新结束
    ├── 暂停会修改权威状态的输入一个逻辑帧
    ├── 依次采集 world、entities、players
    ├── 深拷贝为纯数据，恢复正常更新
    ├── 校验并 JSON.stringify
    ├── 写入临时记录
    └── 完整写入成功后，原子更新 activeSnapshotId
```

浏览器内推荐使用 IndexedDB：

- `snapshots` Object Store 以 `[sessionId, snapshotId]` 为键，值是完整 JSON 对象或其 UTF-8 文本。
- `sessions` Object Store 保存 `activeSnapshotId` 和 Snapshot 列表。
- 写入 Snapshot 和更新活动指针必须处于同一个读写事务。

下载到文件时不能原子覆盖用户已有文件，应生成带 Session 和 Snapshot ID 的新文件。服务端或桌面文件系统实现应先写同目录临时文件、刷新成功后再 rename；活动索引最后更新。

自动保存可保留最近若干个完整 Snapshot，手动存档单独标记且不参与自动清理。删除历史时以整个 Snapshot 为单位，绝不能只删世界或玩家的一半。

### 加载流程

加载按以下固定顺序执行：

1. 将 UTF-8 文本解析为 JSON；限制最大文件大小、对象深度、实体数和字符串长度。
2. 校验 `format`，拒绝高于当前支持值的 `schemaVersion`。
3. 对旧版本在纯数据层逐版迁移，例如 `v1 -> v2 -> v3`，禁止跨版本猜测字段。
4. 做完整语义校验，包括有限坐标、唯一实体 ID、已知 Prefab、合法组件、物品堆叠和所有强引用可解析。
5. 预加载本 Snapshot 所需的 Prefab 和图集；任一必需资源失败时保持旧世界不变。
6. 在离屏的新世界中恢复地图与世界系统。
7. 第一遍恢复所有世界实体的逻辑记录和玩家，并建立 `savedEntityId -> runtimeEntity` 映射；月树的映射目标是始终存在的逻辑记录，模型按距离另行创建。
8. 恢复各组件的本地状态和嵌套容器。
9. 第二遍解析跨实体引用，再执行组件的 `afterLoad`。
10. 从保存位置同步已创建的 Three.js 对象和 Cannon Body，重建衍生渲染状态；月树依据恢复后的玩家位置调用 `updateNearby()`，仅创建 10 格半径内的模型，再更新动画、Billboard 朝向与脚点深度排序。
11. 所有步骤成功后一次性替换当前世界；失败则销毁离屏世界并继续运行旧世界。

加载不能通过调用“放置建筑”“丢弃物品”“装备火把”等玩家操作接口来实现，因为这些接口会消费物品、播放动画并产生副作用。每种持久化 Prefab 应提供无副作用的 `spawnFromSave(record)` 或等价恢复入口。

### 版本与迁移

`schemaVersion` 描述数据结构，不等同于 `gameVersion`。读取器只写当前版本，但至少保留仍受支持旧版本的纯函数迁移：

```ts
type Migration = (oldSave: unknown) => unknown;

const migrations: Readonly<Record<number, Migration>> = {
  1: migrateV1ToV2,
  2: migrateV2ToV3,
};
```

迁移原则如下：

- 每个函数只负责相邻版本，并且不访问场景或网络。
- 迁移后重新执行当前版本的完整校验。
- 保留原文件；成功加载旧档后，下次保存才生成新版本 Snapshot。
- 新读取器可以读取受支持的旧版本；旧读取器必须拒绝新版本，不能忽略未知权威字段后覆盖存档。
- Prefab 或物品改名必须通过明确映射迁移，不能在加载器里长期散落别名判断。

### 校验规则

正式实现应使用 JSON Schema 做结构校验，再用 TypeScript 代码做跨字段语义校验。至少应保证：

| 范围 | 规则 |
|---|---|
| 顶层 | `format` 精确匹配，版本为支持的正整数，必需字段存在 |
| Snapshot | ID 格式合法；`parentId` 只能是更早编号或 `null` |
| 数值 | 所有数值有限；计数为安全整数；进度在 `0..1` 内 |
| 实体 | ID 全局唯一；Prefab 已注册；组件属于该 Prefab |
| Transform | 三维坐标长度固定为 3，处于允许世界边界内 |
| 引用 | 所有强引用目标存在且类型兼容；弱引用可在缺失时置空 |
| 物品 | 定义存在、数量合法、皮肤匹配、目标槽可接受 |
| 月树 | 校验全部逻辑记录的数量上限、唯一 ID 和合法脚点位置，不按当前加载范围过滤记录 |
| 地形 | Catalog 不重复；Base64 合法；解码长度与地图尺寸一致 |

不要用 TypeScript 类型断言代替运行时校验。存档属于不可信输入，即使它最初由本项目生成，也可能被用户修改、截断或来自更高版本。

### 当前代码落地所需接口

当前实现的大部分状态封装在私有数组或 Map 中。为了避免存档模块读取渲染对象内部字段，领域对象应显式提供快照接口：

```ts
interface SaveParticipant<T> {
  save(): T;
  load(data: T): Promise<void> | void;
}
```

建议的最小改造顺序为：

1. 为 `InventoryStore` 增加纯数据 `exportState()` 和原子 `replaceState()`，覆盖槽位与 `bufferedBuilds`。
2. 为 `GroundItemManager` 增加稳定实体 ID、`exportRecords()` 和无扣减背包副作用的 `restoreRecords()`。
3. 为 `AnimatedBuildingPlacement` 与 `WallPlacement` 增加实体 ID、稳定状态导出和 `spawnFromSave()`。
4. 为月树增加稳定持久化 ID、完整逻辑记录导出和记录恢复入口；保存全部 `entities`，恢复后按玩家位置重建 `activeEntities`，不重新随机生成坐标。
5. 建立 Prefab 持久化注册表，由注册表负责校验、创建、保存和迁移组件。
6. 最后实现统一 `SaveCoordinator`，只负责帧边界、校验、Snapshot 编号和存储事务。

存档层不应直接依赖 UI，也不应遍历 `scene.children` 猜测哪些对象需要保存。新增可持久化玩法时，必须显式注册其 Prefab/组件序列化器；未注册的视觉对象默认不保存。

### 设计结论

本项目第一版使用“单文件完整 JSON Snapshot”，但在数据模型上保持 DST 的边界：世界、Prefab 实体和玩家各自拥有清晰职责。具体取舍是：

- 世界实体按 Prefab 分组，组件只保存权威逻辑状态。
- 玩家不作为普通世界实体；背包和装备使用已有稳定槽地址。
- 容器物品嵌套保存，避免同一物品同时存在于地面和容器。
- 月树作为通用实体写入 `world.entities.moon_tree`；全部逻辑记录持久化，模型仅在玩家 10 格（120 个世界单位）半径内加载。
- 渲染、物理和动画的派生状态在加载后重建。
- 每个 Snapshot 自包含、不可变，并通过事务更新活动指针。
- 所有旧存档先迁移再校验，所有实体引用用两遍加载恢复。

这套格式先覆盖当前单人浏览器游戏，同时给未来的容器、生命值、地形修改、多人玩家和多 Shard 留出扩展位置，而不需要把运行时引擎对象泄漏进存档协议。

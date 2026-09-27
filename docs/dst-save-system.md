# 《饥荒联机版》存档原理

本文总结《饥荒联机版》（Don't Starve Together，以下简称 DST）的存档目录、世界与玩家数据结构、地形编码方式，以及保存和加载流程。结论主要来自以下 Lua 源码：

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

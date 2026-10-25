# DST 物品资产与地面外观

开发约束见 [AGENTS.md](../AGENTS.md)。本文记录资产路径、源码入口、具体外观案例与当前加载流程。

## 资产路径

原始资产保持源 `data` 目录下的相对路径与文件名。例如：

```text
/data/copy/AssetArchive-Dev/data/DST/data/anim/wilson.zip
→ public/dst/data/anim/wilson.zip
→ ${import.meta.env.BASE_URL}dst/data/anim/wilson.zip
```

音频解码生成的 WAV 使用 `<bank>.fsb-<index>.wav`，是文件名约定的例外；命令和事件映射见 [音频提取指南](vgmstream-cli-guide.md)。

## 库存、地面与穿戴外观

这三种用途来自不同的源数据：

| 用途 | 源数据 | 加载内容 |
| --- | --- | --- |
| 物品栏与装备槽图标 | 库存元数据及皮肤覆盖 | 图片名与实际匹配的 atlas |
| 地面物品 | prefab Lua 的 `AnimState:SetBank()`、`SetBuild()`、`PlayAnimation()` | 动画、build、纹理及符号覆盖；单帧姿态也来自动画资产 |
| 玩家穿戴或手持 | 装备回调、角色符号覆盖及皮肤定义 | 如 `swap_hat` 等玩家符号对应的 build 图像 |

库存 atlas 位于 `public/dst/data/databundles/images.zip` 中的 `images/inventoryimages*.xml`。默认 atlas 可以是 `images/inventoryimages.xml`，但具体物品或皮肤使用其他 atlas 时，需要传入对应覆盖。

草帽是一个例子：库存使用 `strawhat.tex`；地面使用 `anim/hat_straw.zip`，bank 为 `strawhat`、build 为 `hat_straw`、动画为 `anim`。这些地面值来自 `databundles/scripts_unpacked/scripts/prefabs/hats.lua` 的共享构造函数。玩家头上的帽子则使用该 build 对玩家 `swap_hat` 等符号进行覆盖，不能用库存图标或地面整帧替代。

## 地面资产目录中的案例

`packages/prefab/src/groundItems.json` 分别记录动画归档、build 归档、源 bank/clip、皮肤 build 和符号覆盖。

| 物品 | 动画/build 资产 | 地面姿态或符号覆盖 |
| --- | --- | --- |
| 火把 | `anim/torch.zip` 与 `anim/swap_torch.zip` | 使用源地面动画及手持 build |
| 码头套装 `dock_kit` | 地面 `anim/dock_kit.zip`，bank/build `dock_kit`、clip `idle` | `prefabs/dock_kit.lua` 的 `SetBank/SetBuild/PlayAnimation`；库存图标 `dock_kit.tex` 来自 `images/inventoryimages1.xml`，无手持美术和源皮肤。部署预览不是物品美术，而是 `anim/gridplacer.zip`；部署后的 `MONKEY_DOCK` 地皮用 `levels/tiles/cave.*` 图集和 `levels/textures/ground_noise_dock.tex`（小地图 `mini_dock_noise.tex`），由 `import-ground-tiles.py` 导入 |
| 暗夜剑 `nightsword` | 地面 `anim/nightmaresword.zip`，手持 `anim/swap_nightmaresword.zip` | `prefabs/nightsword.lua` 地面 bank/build 为 `nightmaresword`、姿态为 `idle`；装备以 `swap_nightmaresword` 覆盖玩家 `swap_object`。默认库存图标来自 `inventoryimages.xml`，5 个皮肤图标来自 `inventoryimages2.xml`，地面和手持用各自 `anim/dynamic/nightsword_*.zip` / `.dyn` |
| 料理 | `anim/cook_pot_food.zip` | 通过 `swap_food` 覆盖显示具体料理 |
| 三色生／熟蘑菇 | `anim/mushrooms.zip`，bank/build 均为 `mushrooms` | `prefabs/mushrooms.lua` 选择 `red_cap` / `green_cap` / `blue_cap` 及各自的 `_cooked` 单帧姿态；六种库存图标均来自 `images/inventoryimages.xml` |
| 草簇 `dug_grass` | `anim/grass.zip` 的 bank `grass` 与 `anim/grass1.zip` 的 build `grass1` | `prefabs/plantables.lua` 的 `dropped` 地面姿态；库存另用 `images/inventoryimages.xml` 的 `dug_grass.tex`，每叠最多 10 个，无装备外观和源皮肤 |
| 普通墙物品 | `anim/wall.zip` 与对应 `anim/wall_*.zip` build | 地面物品使用 `idle`；已建墙使用独立的 `half` 姿态 |
| `wall_dreadstone_item` | `anim/wall_dreadstone.zip` | bank、build、动画均来自此归档 |
| 暖石 `heatrock` | `anim/heat_rock.zip`，bank/build `heat_rock`；三款皮肤使用 `anim/dynamic/heatrock_*.zip` / `.dyn` | `heatrock.lua` 的 `UpdateImages(inst, 3)` 初始姿态为循环 `3`；库存为 `heat_rock3.tex`，皮肤为 `<skin>3.tex`。目录的 `inventoryImageVariants` 核对基础和皮肤的全部 1～5 档图标 atlas；当前不接入温度变化 |
| 噩梦燃料 | `anim/nightmarefuel.zip` | `idle_loop` 循环；源 `SetMultColour(1, 1, 1, 0.5)` 和 `UsePointFiltering(true)` 分别控制半透明与点采样 |

NPC 专用的 `shadow_thrall_parasitehat` 不属于玩家帽子目录，不导入库存元数据、配方或图标回退。

熔岩池是独立场景 prefab：`lava_tile.zip` 提供 `lava_tile/bubble_lava` 循环池面，`scorched_rock.zip` 提供焦岩的 `idle`、`idle2`～`idle7`。池面使用 OnGround 背景绘制，焦岩各自作为完整 billboard 参加脚点排序；二者均不使用库存图标，也没有原版皮肤。两份归档纳入同一导入脚本的路径／字节校验。

常青树 normal build 使用 `anim/evergreen_new.zip` 的 build `evergreen_new`，bank 为 `evergreen_short`；短／中阶段动画在 `anim/evergreen_short_normal.zip`，大／衰老阶段在 `anim/evergreen_tall_old.zip`。加载两份动画后组合到同一共享 build，保留原点并按脚点排序；`pine_needles_chop` 来自 `anim/pine_needles.zip` 的 `chop`。这些文件由导入脚本的 `--check` 验证原始路径和字节，无源皮肤。

## 当前加载流程

`src/groundItems.ts` 的 `GroundItemManager` 通过 `packages/prefab/src/groundPrefabRegistry.ts` 中的 `GroundPrefabRegistry` 查找物品工厂。注册表首先加载共享目录工厂，再由专用 prefab 工厂覆盖同名 ID。

`ArchiveSpriteAssets` 和 `GroundItemAssets` 不接收动画目录参数，统一从 `${import.meta.env.BASE_URL}dst/data/anim` 加载，支持子路径部署。使用 `new ArchiveSpriteAssets()` 或 `new GroundItemAssets()`；`ArchiveSpriteAssets` 的可选构造参数仅指定材质名称前缀，例如 `new ArchiveSpriteAssets('farm')`。仅转发动画目录的 prefab／特效构造参数一并移除，材质缓存和释放仍由原有资源对象管理。

帽子工厂是 `packages/prefab/src/hats.ts` 的 `createHatGroundFactory()`；普通目录物品工厂调用 `packages/prefab/src/groundItems.ts` 的 `createResidentGroundItem()`。`GroundItemManager` 不直接选择这两个函数。未注册的物品才使用库存图标回退，回退物品同样是 `createPrefabEntity()` 创建的 `PrefabInstance` 实体，由 `PrefabDisplay` 绘制图标 billboard。

地面模型保留源原点作为脚点，用于绘制顺序、拾取距离与存档位置。皮肤通过库存、地面、穿戴和存档路径传递，换肤不应创建新的逻辑实体。

普通目录物品还需要保留 prefab 的材质设置。导入脚本从共享简单构造分支读取 `SetMultColour` 的四个数值及 `UsePointFiltering`，分别写入 `multColour` 与 `pointFiltering`。`ArchiveSpriteAssets` 按归档、颜色倍率和采样方式缓存材质；同一外观共享材质，不同外观不会相互修改透明度或纹理采样。透明部分仍使用通用 `MeshBasicMaterial`、源纹理 alpha 与标准混合，交给现有世界光照／调色 shader 处理；噩梦燃料没有额外指定特效 shader。此前仅使用纹理 alpha、漏掉额外的 0.5 倍率，导致其黑色内部看起来不透明。库存图标是独立资源，不应用这些地面设置。

## 重新导入与校验

在仓库根目录运行：

```bash
python3 packages/prefab/scripts/import-ground-items.py
python3 packages/prefab/scripts/import-ground-items.py --check
```

默认源目录是 `/data/copy/AssetArchive-Dev/data/DST/data`。其他来源可通过 `--source <DST data 目录>` 指定；`--check` 校验生成的定义及源资产字节，避免扁平化路径或替换资源内容。

## fence_item

`prefabs/fence.lua` 的 `MakeInvItem("fence_item", "fence", "fence", false)` 使用 bank/build `fence`、动画 `inventory`（`anim/fence.zip`），库存图标为 `images/inventoryimages.xml` 的 `fence_item.tex`。`import-ground-items.py` 将其作为 `animation_archive='fence.zip'` 的普通地面物品导入，并自动收录 13 款源皮肤（`fence_<名称>_item` → `dynamic/fence_<名称>.zip`，图标 `inventoryimages2.xml`）。已建成的 `fence` 另外需要窄 bank 的 `anim/fence_thin.zip`（只含动画，build 仍用 `fence.zip`），导入器把它一并镜像，`--check` 校验路径与字节。

## razor

`razor.lua` 使用 bank `razor` 与 build `swap_razor`，动画包为 `anim/razor.zip`（clip `idle`），物品栏图标为 `inventoryimages.xml` 的 `razor.tex`。`import-ground-items.py` 将其作为 `animation_archive='razor.zip'` 的普通地面物品导入，并自动收录三款原版皮肤 `razor_barber`、`razor_scissors`、`razor_straight` 的 `dynamic/*.zip` 与对应图标；`--check` 校验源路径与字节。razor 不可装备，没有手持美术，只通过鼠标举着使用。

## Turf 地皮资源

`turfs.lua` 遍历 `worldtiledefs.turf`，定义来自 `tiledefs.lua` 的第六个 `TileManager.AddTile` 参数；`tilemanager.lua` 补齐默认 `bank_build="turf"`、`anim=name`。`import-ground-items.py` 与 `import-ground-tiles.py` 共用 `scripts/turf-source.py` 读取这些参数，覆盖全部 40 种物品。物品资源、库存图标与铺地纹理分别解析，不能互相替代：

| 用途 | 解析方式与例子 |
| --- | --- |
| 地面物品 | `bank_build`、`anim` 与可选 overrides。`turf_underrock` 的 clip 是 `rock`，`turf_desertdirt` 是 `dirt`；`turf_carpetfloor2` 使用 `turf_drama.zip:carpet2`，`turf_beard_rug` 使用 `turf_beard.zip:turf_beard`。共用及独立动画包保留源路径 |
| 库存图标 | 查询 `databundles/images.zip` 的实际 atlas，分别落在 `images/inventoryimages.xml` 和 `images/inventoryimages3.xml`，制作格也使用同一 metadata |
| 铺地纹理 | 第四个 AddTile 参数的 `name`、`atlas`、`noise_texture`，记录在 `groundTiles.json`；包含全部 turf 及现有 DIRT/FARMING_SOIL，共 42 个地形定义。ROAD 的噪声直接使用 `images/square.tex`，不拼接 `levels/textures/`；`turf_vault` 对应 `VAULT_CLEAN` |

地面物品走共享 ground prefab 工厂，源物品 ID 均支持 `c_spawn` 和 `c_give`，堆叠上限为 `STACK_SIZE_MEDITEM`（20）。原版没有 turf 物品皮肤或装备外观；铺地部署玩法暂未接入。铺地资源可通过 `loadGroundTileAssets` / `createTurfGround` 按地形键加载；现有世界的地形布局不变。

```bash
python3 packages/prefab/scripts/import-ground-items.py --check
python3 packages/prefab/scripts/import-ground-tiles.py --check
```

前者核对全部物品的 bank/build/clip metadata、图标 atlas 和动画源字节；后者核对 terrain metadata、每张 atlas 的 48 个源变体以及纹理／XML 字节。新地形无旧 GROUND ID 时按 TileManager 的 LAND 范围顺序分配，保留源渲染顺序。

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

## 当前加载流程

`src/groundItems.ts` 的 `GroundItemManager` 通过 `packages/prefab/src/groundPrefabRegistry.ts` 中的 `GroundPrefabRegistry` 查找物品工厂。注册表首先加载共享目录工厂，再由专用 prefab 工厂覆盖同名 ID。

帽子工厂最终调用 `packages/prefab/src/hats.ts` 的 `createHatGroundSprite()`；普通目录物品工厂调用 `packages/prefab/src/groundItems.ts` 的 `createGroundItemSprite()`。`GroundItemManager` 不再直接选择这两个函数。未注册的物品才使用库存图标创建回退模型。

地面模型保留源原点作为脚点，用于绘制顺序、拾取距离与存档位置。皮肤通过库存、地面、穿戴和存档路径传递，换肤不应创建新的逻辑实体。

普通目录物品还需要保留 prefab 的材质设置。导入脚本从共享简单构造分支读取 `SetMultColour` 的四个数值及 `UsePointFiltering`，分别写入 `multColour` 与 `pointFiltering`。`ArchiveSpriteAssets` 按归档、颜色倍率和采样方式缓存材质；同一外观共享材质，不同外观不会相互修改透明度或纹理采样。透明部分仍使用通用 `MeshBasicMaterial`、源纹理 alpha 与标准混合，交给现有世界光照／调色 shader 处理；噩梦燃料没有额外指定特效 shader。此前仅使用纹理 alpha、漏掉额外的 0.5 倍率，导致其黑色内部看起来不透明。库存图标是独立资源，不应用这些地面设置。

## 重新导入与校验

在仓库根目录运行：

```bash
python3 packages/prefab/scripts/import-ground-items.py
python3 packages/prefab/scripts/import-ground-items.py --check
```

默认源目录是 `/data/copy/AssetArchive-Dev/data/DST/data`。其他来源可通过 `--source <DST data 目录>` 指定；`--check` 校验生成的定义及源资产字节，避免扁平化路径或替换资源内容。

## razor

`razor.lua` 使用 bank `razor` 与 build `swap_razor`，动画包为 `anim/razor.zip`（clip `idle`），物品栏图标为 `inventoryimages.xml` 的 `razor.tex`。`import-ground-items.py` 将其作为 `animation_archive='razor.zip'` 的普通地面物品导入，并自动收录三款原版皮肤 `razor_barber`、`razor_scissors`、`razor_straight` 的 `dynamic/*.zip` 与对应图标；`--check` 校验源路径与字节。razor 不可装备，没有手持美术，只通过鼠标举着使用。

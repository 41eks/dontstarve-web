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
| 料理 | `anim/cook_pot_food.zip` | 通过 `swap_food` 覆盖显示具体料理 |
| 普通墙物品 | `anim/wall.zip` 与对应 `anim/wall_*.zip` build | 地面物品使用 `idle`；已建墙使用独立的 `half` 姿态 |
| `wall_dreadstone_item` | `anim/wall_dreadstone.zip` | bank、build、动画均来自此归档 |

NPC 专用的 `shadow_thrall_parasitehat` 不属于玩家帽子目录，不导入库存元数据、配方或图标回退。

## 当前加载流程

`src/groundItems.ts` 的 `GroundItemManager` 通过 `packages/prefab/src/groundPrefabRegistry.ts` 中的 `GroundPrefabRegistry` 查找物品工厂。注册表首先加载共享目录工厂，再由专用 prefab 工厂覆盖同名 ID。

帽子工厂最终调用 `packages/prefab/src/hats.ts` 的 `createHatGroundSprite()`；普通目录物品工厂调用 `packages/prefab/src/groundItems.ts` 的 `createGroundItemSprite()`。`GroundItemManager` 不再直接选择这两个函数。未注册的物品才使用库存图标创建回退模型。

地面模型保留源原点作为脚点，用于绘制顺序、拾取距离与存档位置。皮肤通过库存、地面、穿戴和存档路径传递，换肤不应创建新的逻辑实体。

## 重新导入与校验

在仓库根目录运行：

```bash
python3 packages/prefab/scripts/import-ground-items.py
python3 packages/prefab/scripts/import-ground-items.py --check
```

默认源目录是 `/data/copy/AssetArchive-Dev/data/DST/data`。其他来源可通过 `--source <DST data 目录>` 指定；`--check` 校验生成的定义及源资产字节，避免扁平化路径或替换资源内容。

# dontstarve-web

https://41eks.github.io/dontstarve-web/

## 调试命令（debugCommand）

在游戏页面按反引号键（`Backquote`，通常与 `~` 共用）打开或关闭调试控制台，输入命令后按 `Enter` 执行。执行后控制台自动关闭；`Esc` 可关闭，`↑` / `↓` 可浏览最近 50 条历史命令。执行结果或错误显示在浏览器开发者工具的 Console 中。

| 命令 | 参数与作用 | 示例 |
| --- | --- | --- |
| `c_give("item_id", count)` | 向物品栏添加物品。`count` 可省略，默认 `1`，必须为正的安全整数；按堆叠上限分配。未知物品或物品栏空间不足时失败。 | `c_give("torch")`、`c_give("hammer")`、`c_give("meatballs", 10)` |
| `c_spawn("prefab_id")` | 生成一个当前支持的场景对象。建筑和墙生成在玩家前方，洞穴植物、萤火虫和岩石生成在玩家当前位置，皮弗娄牛生成在玩家附近的空地。 | `c_spawn("cookpot")`、`c_spawn("beefalo")`、`c_spawn("rock1")` |
| `c_save()` | 将当前游戏状态导出并下载为 `initial-world.json`。要作为初始存档加载，将下载文件放到 `public/saves/initial-world.json` 后重新加载页面。 | `c_save()` |

命令支持单引号或双引号、额外空白及末尾分号；`c_give` 的参数分隔符也支持中文逗号。每次提交一条命令。

锤子可用 `c_give("hammer")` 获取，每格只能放一把，拖到手部装备槽后显示原版手持外观。Shift + 右键物品槽可放到地上，点击地面锤子可拾回。用 `c_spawn("treasurechest")` 等命令生成建筑后，手持锤子右键建筑会自动走近并播放挥锤及对应受击动画；移动、Esc 或卸下锤子可取消。这阶段只播放动画，不消耗锤子、不损坏建筑、不掉落物品或改变容器状态；营火没有 HAMMER 动作。

鹤嘴锄可用 `c_give("pickaxe")`（或 `c_give("goldenpickaxe")`）获取，拖到手部装备槽后显示原版手持外观。用 `c_spawn("rock1")` 等命令生成岩石后，手持鹤嘴锄右键岩石会自动走近并播放 `anim/player_actions_pickaxe.zip` 的开采挥镐动画，命中帧在岩石上触发轻微受击脉冲；移动、Esc 或卸下鹤嘴锄可取消。这阶段只播放动画，不消耗工具、不减少岩石状态、不破坏岩石或掉落物品。

### c_spawn 支持的对象

| 类型 | prefab_id |
| --- | --- |
| 建筑 | `cookpot`、`firepit`、`icebox`、`treasurechest`、`tent`、`dragonflychest`、`campfire`、`saltbox`、`nightlight`、`pighouse`、`mushroom_light`、`mushroom_light2` |
| 科技建筑 | `researchlab`、`researchlab2`、`researchlab3`、`researchlab4` |
| 墙 | `wall_stone`、`wall_stone_2`、`wall_wood`、`wall_hay`、`wall_ruins`、`wall_ruins_2`、`wall_moonrock`、`wall_dreadstone`、`wall_scrap`，以及各自的 `wall_*_item`（两种 ID 均生成建成的墙） |
| 洞穴植物 | `flower_cave`、`flower_cave_double`、`flower_cave_triple` |
| 岩石 | `rock1`、`rock2`、`rock_flintless`、`rock_flintless_med`、`rock_flintless_low` |
| 生物 | `fireflies`、`beefalo` |

`c_give` 可用的物品 ID 由 [src/inventoryItems.ts](src/inventoryItems.ts) 汇总的物品定义决定；命令解析见 [src/debugCommands.ts](src/debugCommands.ts)，场景对象生成入口见 [src/main.ts](src/main.ts)。

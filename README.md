# dontstarve-web

https://41eks.github.io/dontstarve-web/

## 调试命令（debugCommand）

在游戏页面按反引号键（`Backquote`，通常与 `~` 共用）打开或关闭调试控制台，输入命令后按 `Enter` 执行。执行后控制台自动关闭；`Esc` 可关闭，`↑` / `↓` 可浏览最近 50 条历史命令。执行结果或错误显示在浏览器开发者工具的 Console 中。

| 命令 | 参数与作用 | 示例 |
| --- | --- | --- |
| `c_give("item_id", count)` | 向物品栏添加物品。`count` 可省略，默认 `1`，必须为正的安全整数；按堆叠上限分配。未知物品或物品栏空间不足时失败。 | `c_give("torch")`、`c_give("opalstaff")`、`c_give("pitchfork")`、`c_give("hammer")`、`c_give("meatballs", 10)` |
| `c_spawn("prefab_id")` | 生成一个当前支持的场景对象。建筑和墙生成在玩家前方，洞穴植物、萤火虫和岩石生成在玩家当前位置，皮弗娄牛生成在玩家附近的空地。 | `c_spawn("cookpot")`、`c_spawn("beefalo")`、`c_spawn("rock1")` |
| `c_save()` | 将当前游戏状态（包括挖过的地皮）导出并下载为 `initial-world.json`。要作为初始存档加载，将下载文件放到 `public/saves/initial-world.json` 后重新加载页面。 | `c_save()` |

命令支持单引号或双引号、英文或中文括号（也可混用）、额外空白及末尾分号；`c_give` 的参数分隔符也支持中文逗号。每次提交一条命令。

启迪之冠可用 `c_give("alterguardianhat")` 获取，也支持输入 `c_give("alterguardianhat"）`。每顶占一格，物品栏需有空位；获取后拖到头部装备槽即可佩戴，播放原版升起、漂浮环绕和发光动画，并照亮周围地面；卸下或换帽后停止。支持“最终棱镜”皮肤。该 prefab 在原版 `hats.lua` 中由 `MakeHat("alterguardian")` 注册，动态外观来自 `anim/hat_alterguardian_equipped.zip`。原版在理智高于 85% 时激活；当前游戏尚无权威理智状态，装备控制器默认按满理智展示，可通过 `setSanityPercent(0…1)` 控制激活与收回。

用 `c_spawn("icebox")` 或 `c_spawn("treasurechest")` 生成冰箱或木箱后，走近并左键点击可打开，再次点击关闭。开关动画开始时分别播放原版 `dontstarve/common/icebox_open` / `icebox_close` 或 `dontstarve/wilson/chest_open` / `chest_close`；走远自动关闭时也播放关闭声。恢复存档时不重放开门声。

`c_spawn("moonbase")` 在玩家前方生成月亮石，使用原版 `anim/moonbase.zip` 的 bank/build `moonbase` 和初始 `med` 破损姿态，默认不发光；位置随 `c_save()` 保存并在加载时恢复。当前支持生成与显示，尚未接入修复、插入魔杖和满月充能交互。

`c_give("reskin_tool")` 获取清洁扫把，数量可用第二个参数指定，例如 `c_give("reskin_tool", 2)`；每把占一格。支持原版物品图标、手部装备外观、4 个皮肤，以及 Shift + 右键丢弃和点击拾回。装备到手部后，右键有可用皮肤的建筑或地面物品进行换肤，超出施法距离时自动走近；按当前支持的皮肤目录循环，最后回到基础外观。玩家按原版 `veryquickcastspell` 播放 `anim/player_attacks.zip` 的 `atk_pre → atk`，开始时播放挥动声，第 9 帧提交换肤并在目标位置播放 `reskin_tool_fx.zip` 的 `puff` 及换肤音效；清洁扫把的 4 个皮肤使用各自的特效外观，幽灵画笔使用独立音效。移动、跳跃、左键、Esc、卸下或更换扫把可取消未提交的换肤；取消后不出现换肤特效或结果音效。换肤保留实体 ID、位置、物品数量及容器内容，皮肤随 `c_save()` 保存和恢复；暂不处理背包内目标、角色胡须及原版皮肤所有权筛选。

锤子可用 `c_give("hammer")` 获取，每格只能放一把，拖到手部装备槽后显示原版手持外观。Shift + 右键物品槽可放到地上，点击地面锤子可拾回。用 `c_spawn("treasurechest")` 等命令生成建筑后，手持锤子右键建筑会自动走近并播放挥锤及对应受击动画，在 `pickaxe_loop` 第 7 帧播放原版 `dontstarve/wilson/hit`（两段样本随机选择）；移动、Esc 或卸下锤子可取消尚未命中的挥锤及音效。当前播放动画和声音，不消耗锤子、不损坏建筑、不掉落物品或改变容器状态；营火没有 HAMMER 动作。

鹤嘴锄可用 `c_give("pickaxe")`（或 `c_give("goldenpickaxe")`）获取，拖到手部装备槽后显示原版手持外观。用 `c_spawn("rock1")` 等命令生成岩石后，手持鹤嘴锄右键岩石会自动走近并播放 `anim/player_actions_pickaxe.zip` 的开采挥镐动画，在 `pickaxe_loop` 第 7 帧触发岩石受击脉冲及原版 `dontstarve/wilson/use_pick_rock`；两种鹤嘴锄使用同一音效。移动、Esc 或卸下鹤嘴锄可取消尚未命中的开采及音效。当前播放动画和声音，不消耗工具、不减少岩石状态、不破坏岩石或掉落物品。

干草叉可用 `c_give("pitchfork")`（或 `c_give("goldenpitchfork")`）获取，每格一把。拖到手部装备槽后，右键地面会自动走近目标地皮中心，播放 `anim/player_actions_shovel.zip` 的 `shovel_pre` → `shovel_loop` → `shovel_pst`，在动作开始后第 25 帧将整格地皮改成 `WORLD_TILES.DIRT`（原版泥土贴图）；猪王周围的木地板也可挖，泥土不可重复挖。移动、跳跃、左键、Esc 或卸下工具可取消尚未完成的挖地。支持原版地面和手持外观及皮肤；Shift + 右键物品槽可丢弃，点击地面物品可拾回。挖地变化会随 `c_save()` 保存并在加载时恢复；当前不消耗耐久或生成挖出的地皮物品。

地皮边缘按 `tilemanager.lua` / `tiledefs.lua` 的 atlas、噪声贴图和绘制优先级处理（泥土 → 落叶林 → 木地板），根据相邻八格选择原版边缘、外角及内角贴图。连续挖地会同步更新周围边界，同种地皮之间不留接缝。

唤星者魔杖可用 `c_give("yellowstaff")` 获取，拖入手部装备槽后右键地面施法。施法第 13 帧播放原版 `dontstarve/wilson/use_gemstaff`，第 53 帧生成矮星；第 13 帧前取消施法不会触发施法声。矮星出现时播放 `dontstarve/common/staff_star_create`，存在期间独立循环播放 `dontstarve/common/staff_star_LP`，消失动画结束或场景释放时停止。矮星持续 24 分钟；`c_save()` 保存其落点与剩余寿命，加载后接续循环音效。浏览器首次交互后启用声音。

唤月者魔杖可用 `c_give("opalstaff")` 获取，数量可指定为 `c_give("opalstaff", 2)`，每把占一格。拖入手部装备槽后，右键地面施法，在第 13 帧播放原版 `dontstarve/common/staffteleport`，第 53 帧在点击位置召唤蓝色极光（`staffcoldlight`），照亮周围地面。使用原版 `anim/star_cold.zip` 的出现、三种待机与消失动画；极光持续 16 分钟，出现时播放 `staff_star_create`，存在期间播放 `staff_coldlight_LP` 的三层循环音效。卸下魔杖可取消尚未完成的召唤。支持原版图标、手持与地面外观、皮肤、Shift + 右键丢弃和点击拾回；魔杖及极光的落点、剩余寿命随 `c_save()` 保存并在加载时恢复。当前施法不消耗耐久或理智。

### c_spawn 支持的对象

| 类型 | prefab_id |
| --- | --- |
| 建筑 | `cookpot`、`firepit`、`icebox`、`treasurechest`、`tent`、`moonbase`、`dragonflychest`、`campfire`、`saltbox`、`nightlight`、`pighouse`、`mushroom_light`、`mushroom_light2` |
| 科技建筑 | `researchlab`、`researchlab2`、`researchlab3`、`researchlab4` |
| 墙 | `wall_stone`、`wall_stone_2`、`wall_wood`、`wall_hay`、`wall_ruins`、`wall_ruins_2`、`wall_moonrock`、`wall_dreadstone`、`wall_scrap`，以及各自的 `wall_*_item`（两种 ID 均生成建成的墙） |
| 洞穴植物 | `flower_cave`、`flower_cave_double`、`flower_cave_triple` |
| 岩石 | `rock1`、`rock2`、`rock_flintless`、`rock_flintless_med`、`rock_flintless_low` |
| 生物 | `fireflies`、`beefalo` |

`c_give` 可用的物品 ID 由 [src/inventoryItems.ts](src/inventoryItems.ts) 汇总的物品定义决定；命令解析见 [src/debugCommands.ts](src/debugCommands.ts)，场景对象生成入口见 [src/main.ts](src/main.ts)。

# DST Lua prefab 的 c_spawn / c_give 静态核对

核对日期：2026-10-07。依据本地 DST Lua 源码，整理原版命令的适用条件与 prefab ID；没有运行 DST 引擎验证。

源码根目录：`/data/copy/AssetArchive-Dev/data/DST/data/databundles/scripts_unpacked/scripts/`。下文 `prefabs/*.lua`、`components/*.lua` 等路径均相对于该目录，行号对应本次读取的源码版本。

清单覆盖项目 [groundItems.json](../packages/prefab/src/groundItems.json) 的 234 个 ID、[hats.json](../packages/prefab/src/hats.json) 的 82 个玩家帽子 ID，以及本次查看的 57 个世界实体和部分生物、特殊实体。2026-10-08 补充核对三色生／熟蘑菇的六个物品 ID。它是已核对范围的快照，不是 DST 全量 prefab 注册表，也不是项目当前命令支持列表。

## 分类汇总

| 类别 | 原版 c_spawn | 原版 c_give 的入栏结果 | 代表 prefab ID |
| --- | --- | --- | --- |
| 普通材料、食物 | 可生成 | 可入栏 | `cutgrass`、`twigs`、`rocks`、`seeds`、`meatballs` |
| 工具、玩家帽子 | 可生成 | 可入栏 | `torch`、`hammer`、`lantern`、`reskin_tool`、`footballhat` |
| 有 inventoryitem 的生物 | 可生成 | 可入栏；角色与状态影响后续操作 | `rabbit`、`crow`、`bee`、`butterfly`、`fireflies`、`spider` |
| 建筑、植物、地形实体 | 可生成 | 无 inventoryitem 的实例不能入栏 | `icebox`、`treasurechest`、`grass`、`sapling`、`pond` |
| 无 inventoryitem 的生物 | 可生成 | 不能入栏 | `beefalo`、`pigman`、`hound`、`deerclops`、`dragonfly` |
| 部署物品与建成实体 | 两种形态分别生成 | 只有物品形态可入栏 | `wall_stone_item` / `wall_stone`、`farm_plow_item` / `farm_plow` |
| 特殊持有或转换 | 可生成 | 需看容器限制与拾取回调 | `backpack`、`bernie_active` |
| 皮肤注册项 | DebugSpawn 排除 is_skin 项 | 同样不能通过 DebugSpawn 生成 | 使用基础 prefab 的换肤流程 |

## 命令实现与判断依据

两种命令共用 `DebugSpawn`，没有互斥的 prefab 分类白名单。`c_give` 在生成后进一步尝试交给玩家，因此“c_give 不能入栏”不代表完全没有生成实体。

| 源码位置 | 核对结果 |
| --- | --- |
| `consolecommands.lua:208` | `c_spawn(prefab, count, dontselect)` 循环调用 `DebugSpawn`，默认数量 1，并将 prefab 字符串转为小写；dontselect 控制是否设置调试选中实体。 |
| `consolecommands.lua:486` | `c_give(prefab, count, dontselect)` 取得控制台玩家，调用 `DebugSpawn` 后调用玩家的 `inventory:GiveItem`；数量默认 1，同样将字符串转为小写。 |
| `util.lua:20` | `DebugSpawn` 要求 TheSim / TheInput 存在；加载 prefab 后检查已注册、不是 is_skin、有构造函数；创建实例后要求有 Transform，放到控制台指向的世界位置。 |
| `components/inventory.lua:1029` | `GiveItem` 拒绝没有 inventoryitem 或无效的实例；不会仅因这一入口检查失败而移除已生成实体。 |
| `components/inventory.lua:231` | 普通物品格检查 inventoryitem.cangoincontainer 等条件；特殊游戏模式还有其他限制。 |
| `components/inventory.lua:1058`、`components/inventoryitem.lua:433` | 入栏先执行 OnPickup；回调可能转换、删除实例，不能只凭组件存在判断最终保留的 prefab。 |
| `components/inventory.lua:1177` | 找不到可用格子后还有鼠标持有、溢出容器或掉落等处理；c_give 的返回实体不等于成功进入普通格。 |

以下“可生成”“可入栏”均指正常服务端游戏环境下的静态源码路径；可入栏还以空间和状态条件允许为前提。后续 AI、延迟任务、角色交互和实体生命周期不由这份表保证。

## 地面物品目录：234 个 ID

ID 与来源按项目地面资源目录核对，组件证据来自对应 Lua 文件。共用文件的行号指向共用构造实现，不是每个 ID 的独立注册位置。Lua 文件名与 prefab ID 不必相同。

| prefab ID | c_spawn | c_give | inventoryitem 源码 |
| --- | --- | --- | --- |
| `cutgrass` | 可生成 | 可入栏 | `prefabs/cutgrass.lua:33` |
| `twigs` | 可生成 | 可入栏 | `prefabs/twigs.lua:41` |
| `log` | 可生成 | 可入栏 | `prefabs/log.lua:50` |
| `cutreeds` | 可生成 | 可入栏 | `prefabs/cutreeds.lua:47` |
| `boards` | 可生成 | 可入栏 | `prefabs/boards.lua:42` |
| `rope` | 可生成 | 可入栏 | `prefabs/rope.lua:61` |
| `cutstone` | 可生成 | 可入栏 | `prefabs/cutstone.lua:33` |
| `flint` | 可生成 | 可入栏 | `prefabs/flint.lua:52` |
| `goldnugget` | 可生成 | 可入栏 | `prefabs/goldnugget.lua:62` |
| `gears` | 可生成 | 可入栏 | `prefabs/gears.lua:77` |
| `charcoal` | 可生成 | 可入栏 | `prefabs/charcoal.lua:55` |
| `pigskin` | 可生成 | 可入栏 | `prefabs/pigskin.lua:39` |
| `silk` | 可生成 | 可入栏 | `prefabs/silk.lua:39` |
| `stinger` | 可生成 | 可入栏 | `prefabs/stinger.lua:35` |
| `houndstooth` | 可生成 | 可入栏 | `prefabs/houndstooth.lua:45` |
| `nitre` | 可生成 | 可入栏 | `prefabs/nitre.lua:49` |
| `livinglog` | 可生成 | 可入栏 | `prefabs/livinglog.lua:63` |
| `nightmarefuel` | 可生成 | 可入栏 | `prefabs/nightmarefuel.lua:93` |
| `petals` | 可生成 | 可入栏 | `prefabs/petals.lua:99` |
| `petals_evil` | 可生成 | 可入栏 | `prefabs/petals_evil.lua:56` |
| `ash` | 可生成 | 可入栏 | `prefabs/ash.lua:75` |
| `beefalowool` | 可生成 | 可入栏 | `prefabs/beefalowool.lua:32` |
| `boneshard` | 可生成 | 可入栏 | `prefabs/boneshard.lua:30` |
| `butterflywings` | 可生成 | 可入栏 | `prefabs/butterflywings.lua:45` |
| `honey` | 可生成 | 可入栏 | `prefabs/honey.lua:50` |
| `honeycomb` | 可生成 | 可入栏 | `prefabs/honeycomb.lua:37` |
| `thulecite` | 可生成 | 可入栏 | `prefabs/thulecite.lua:42` |
| `thulecite_pieces` | 可生成 | 可入栏 | `prefabs/thulecite_pieces.lua:37` |
| `guano` | 可生成 | 可入栏 | `prefabs/guano.lua:83` |
| `tentaclespots` | 可生成 | 可入栏 | `prefabs/tentaclespots.lua:28` |
| `spidergland` | 可生成 | 可入栏 | `prefabs/spidergland.lua:37` |
| `slurtleslime` | 可生成 | 可入栏 | `prefabs/slurtleslime.lua:67` |
| `slurtle_shellpieces` | 可生成 | 可入栏 | `prefabs/slurtle_shellpieces.lua:29` |
| `walrus_tusk` | 可生成 | 可入栏 | `prefabs/walrus_tusk.lua:33` |
| `deerclops_eyeball` | 可生成 | 可入栏 | `prefabs/deerclops_eyeball.lua:31` |
| `bearger_fur` | 可生成 | 可入栏 | `prefabs/bearger_fur.lua:29` |
| `dragon_scales` | 可生成 | 可入栏 | `prefabs/dragon_scales.lua:29` |
| `glommerfuel` | 可生成 | 可入栏 | `prefabs/glommerfuel.lua:49` |
| `acorn` | 可生成 | 可入栏 | `prefabs/acorn.lua:121` |
| `rocks` | 可生成 | 可入栏 | `prefabs/inv_rocks.lua:59` |
| `ice` | 可生成 | 可入栏 | `prefabs/inv_rocks_ice.lua:107` |
| `seeds` | 可生成 | 可入栏 | `prefabs/seeds.lua:100` |
| `seeds_cooked` | 可生成 | 可入栏 | `prefabs/seeds.lua:100` |
| `red_cap` | 可生成 | 可入栏 | `prefabs/mushrooms.lua:338` |
| `red_cap_cooked` | 可生成 | 可入栏 | `prefabs/mushrooms.lua:396` |
| `green_cap` | 可生成 | 可入栏 | `prefabs/mushrooms.lua:338` |
| `green_cap_cooked` | 可生成 | 可入栏 | `prefabs/mushrooms.lua:396` |
| `blue_cap` | 可生成 | 可入栏 | `prefabs/mushrooms.lua:338` |
| `blue_cap_cooked` | 可生成 | 可入栏 | `prefabs/mushrooms.lua:396` |
| `pinecone` | 可生成 | 可入栏 | `prefabs/pinecone.lua:108` |
| `acorn_cooked` | 可生成 | 可入栏 | `prefabs/acorn.lua:121` |
| `poop` | 可生成 | 可入栏 | `prefabs/poop.lua:89` |
| `spoiled_food` | 可生成 | 可入栏 | `prefabs/spoiledfood.lua:126` |
| `redgem` | 可生成 | 可入栏 | `prefabs/gem.lua:74` |
| `bluegem` | 可生成 | 可入栏 | `prefabs/gem.lua:74` |
| `purplegem` | 可生成 | 可入栏 | `prefabs/gem.lua:74` |
| `greengem` | 可生成 | 可入栏 | `prefabs/gem.lua:74` |
| `orangegem` | 可生成 | 可入栏 | `prefabs/gem.lua:74` |
| `yellowgem` | 可生成 | 可入栏 | `prefabs/gem.lua:74` |
| `feather_crow` | 可生成 | 可入栏 | `prefabs/feathers.lua:47` |
| `feather_robin` | 可生成 | 可入栏 | `prefabs/feathers.lua:47` |
| `feather_robin_winter` | 可生成 | 可入栏 | `prefabs/feathers.lua:47` |
| `feather_canary` | 可生成 | 可入栏 | `prefabs/feathers.lua:47` |
| `torch` | 可生成 | 可入栏 | `prefabs/torch.lua:445` |
| `backpack` | 可生成 | 特殊持有，不能进普通格 | `prefabs/backpack.lua:268` |
| `bernie_inactive` | 可生成 | 可入栏 | `prefabs/bernie_inactive.lua:272` |
| `farm_plow_item` | 可生成 | 可入栏 | `prefabs/farm_plow.lua:309` |
| `lantern` | 可生成 | 可入栏 | `prefabs/mininglantern.lua:259` |
| `phonograph` | 可生成 | 可入栏 | `prefabs/phonograph.lua:190` |
| `record` | 可生成 | 可入栏 | `prefabs/records.lua:98` |
| `lightbulb` | 可生成 | 可入栏 | `prefabs/lightbulb.lua:64` |
| `butterfly` | 可生成 | 可入栏 | `prefabs/butterfly.lua:129` |
| `fireflies` | 可生成 | 可入栏 | `prefabs/fireflies.lua:225` |
| `yellowstaff` | 可生成 | 可入栏 | `prefabs/staff.lua:770` |
| `opalstaff` | 可生成 | 可入栏 | `prefabs/staff.lua:770` |
| `reskin_tool` | 可生成 | 可入栏 | `prefabs/reskin_tool.lua:386` |
| `hammer` | 可生成 | 可入栏 | `prefabs/hammer.lua:86` |
| `bugnet` | 可生成 | 可入栏 | `prefabs/bugnet.lua:74` |
| `pitchfork` | 可生成 | 可入栏 | `prefabs/pitchfork.lua:77` |
| `goldenpitchfork` | 可生成 | 可入栏 | `prefabs/pitchfork.lua:77` |
| `farm_hoe` | 可生成 | 可入栏 | `prefabs/farm_hoe.lua:103` |
| `golden_farm_hoe` | 可生成 | 可入栏 | `prefabs/farm_hoe.lua:103` |
| `axe` | 可生成 | 可入栏 | `prefabs/axe.lua:101` |
| `goldenaxe` | 可生成 | 可入栏 | `prefabs/axe.lua:101` |
| `pickaxe` | 可生成 | 可入栏 | `prefabs/pickaxe.lua:92` |
| `goldenpickaxe` | 可生成 | 可入栏 | `prefabs/pickaxe.lua:92` |
| `shovel` | 可生成 | 可入栏 | `prefabs/shovel.lua:92` |
| `goldenshovel` | 可生成 | 可入栏 | `prefabs/shovel.lua:92` |
| `moonglassaxe` | 可生成 | 可入栏 | `prefabs/axe.lua:101` |
| `wall_stone_item` | 可生成 | 可入栏 | `prefabs/walls.lua:218` |
| `wall_wood_item` | 可生成 | 可入栏 | `prefabs/walls.lua:218` |
| `wall_hay_item` | 可生成 | 可入栏 | `prefabs/walls.lua:218` |
| `wall_ruins_item` | 可生成 | 可入栏 | `prefabs/walls.lua:218` |
| `wall_moonrock_item` | 可生成 | 可入栏 | `prefabs/walls.lua:218` |
| `wall_scrap_item` | 可生成 | 可入栏 | `prefabs/walls.lua:218` |
| `wall_dreadstone_item` | 可生成 | 可入栏 | `prefabs/walls.lua:218` |
| `meat` | 可生成 | 可入栏 | `prefabs/meats.lua:190` |
| `cookedmeat` | 可生成 | 可入栏 | `prefabs/meats.lua:190` |
| `meat_dried` | 可生成 | 可入栏 | `prefabs/meats.lua:190` |
| `monstermeat` | 可生成 | 可入栏 | `prefabs/meats.lua:190` |
| `cookedmonstermeat` | 可生成 | 可入栏 | `prefabs/meats.lua:190` |
| `monstermeat_dried` | 可生成 | 可入栏 | `prefabs/meats.lua:190` |
| `smallmeat` | 可生成 | 可入栏 | `prefabs/meats.lua:190` |
| `cookedsmallmeat` | 可生成 | 可入栏 | `prefabs/meats.lua:190` |
| `smallmeat_dried` | 可生成 | 可入栏 | `prefabs/meats.lua:190` |
| `drumstick` | 可生成 | 可入栏 | `prefabs/meats.lua:190` |
| `drumstick_cooked` | 可生成 | 可入栏 | `prefabs/meats.lua:190` |
| `batwing` | 可生成 | 可入栏 | `prefabs/meats.lua:190` |
| `batwing_cooked` | 可生成 | 可入栏 | `prefabs/meats.lua:190` |
| `plantmeat` | 可生成 | 可入栏 | `prefabs/meats.lua:190` |
| `plantmeat_cooked` | 可生成 | 可入栏 | `prefabs/meats.lua:190` |
| `fishmeat_small` | 可生成 | 可入栏 | `prefabs/meats.lua:190` |
| `fishmeat_small_cooked` | 可生成 | 可入栏 | `prefabs/meats.lua:190` |
| `fishmeat_small_dried` | 可生成 | 可入栏 | `prefabs/meats.lua:190` |
| `fishmeat` | 可生成 | 可入栏 | `prefabs/meats.lua:190` |
| `fishmeat_cooked` | 可生成 | 可入栏 | `prefabs/meats.lua:190` |
| `fishmeat_dried` | 可生成 | 可入栏 | `prefabs/meats.lua:190` |
| `humanmeat` | 可生成 | 可入栏 | `prefabs/meats.lua:190` |
| `humanmeat_cooked` | 可生成 | 可入栏 | `prefabs/meats.lua:190` |
| `humanmeat_dried` | 可生成 | 可入栏 | `prefabs/meats.lua:190` |
| `barnacle` | 可生成 | 可入栏 | `prefabs/meats.lua:190` |
| `barnacle_cooked` | 可生成 | 可入栏 | `prefabs/meats.lua:190` |
| `batnose` | 可生成 | 可入栏 | `prefabs/meats.lua:190` |
| `batnose_cooked` | 可生成 | 可入栏 | `prefabs/meats.lua:190` |
| `mitegland` | 可生成 | 可入栏 | `prefabs/meats.lua:190` |
| `mitegland_cooked` | 可生成 | 可入栏 | `prefabs/meats.lua:190` |
| `cave_banana` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `cave_banana_cooked` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `carrot` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `carrot_cooked` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `corn` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `corn_cooked` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `pumpkin` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `pumpkin_cooked` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `eggplant` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `eggplant_cooked` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `durian` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `durian_cooked` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `pomegranate` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `pomegranate_cooked` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `dragonfruit` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `dragonfruit_cooked` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `berries` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `berries_cooked` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `berries_juicy` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `berries_juicy_cooked` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `fig` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `fig_cooked` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `cactus_meat` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `cactus_meat_cooked` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `watermelon` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `watermelon_cooked` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `kelp` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `kelp_cooked` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `tomato` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `tomato_cooked` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `potato` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `potato_cooked` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `asparagus` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `asparagus_cooked` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `onion` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `onion_cooked` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `garlic` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `garlic_cooked` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `pepper` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `pepper_cooked` | 可生成 | 可入栏 | `prefabs/veggies.lua:499` |
| `butterflymuffin` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `frogglebunwich` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `taffy` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `pumpkincookie` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `stuffedeggplant` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `fishsticks` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `honeynuggets` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `honeyham` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `dragonpie` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `kabobs` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `mandrakesoup` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `baconeggs` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `meatballs` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `bonestew` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `perogies` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `turkeydinner` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `ratatouille` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `jammypreserves` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `fruitmedley` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `fishtacos` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `waffles` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `monsterlasagna` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `powcake` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `unagi` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `wetgoop` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `flowersalad` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `icecream` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `watermelonicle` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `trailmix` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `hotchili` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `guacamole` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `jellybean` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `potatotornado` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `mashedpotatoes` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `asparagussoup` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `vegstinger` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `bananapop` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `frozenbananadaiquiri` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `bananajuice` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `ceviche` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `salsa` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `pepperpopper` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `californiaroll` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `seafoodgumbo` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `surfnturf` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `lobsterbisque` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `lobsterdinner` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `barnaclepita` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `barnaclesushi` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `barnaclinguine` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `barnaclestuffedfishhead` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `leafloaf` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `leafymeatburger` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `leafymeatsouffle` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `meatysalad` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `shroomcake` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `sweettea` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `koalefig_trunk` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `figatoni` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `figkabab` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `frognewton` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `bunnystew` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `justeggs` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `veggieomlet` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `talleggs` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `beefalofeed` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `beefalotreat` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |
| `shroombait` | 可生成 | 可入栏 | `prefabs/preparedfoods.lua:128` |

## 玩家帽子目录：82 个 ID

`prefabs/hats.lua:219` 的共用构造添加 inventoryitem。这里保留项目已纳入的玩家帽子，排除 NPC 专用 `shadow_thrall_parasitehat`。皮肤 ID 不作为单独的普通 prefab ID。

| prefab ID | c_spawn | c_give | inventoryitem 源码 |
| --- | --- | --- | --- |
| `strawhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `tophat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `beefalohat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `featherhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `beehat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `minerhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `spiderhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `footballhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `earmuffshat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `winterhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `bushhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `flowerhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `walrushat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `slurtlehat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `ruinshat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `molehat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `wathgrithrhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `wathgrithr_improvedhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `walterhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `icehat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `rainhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `catcoonhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `watermelonhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `eyebrellahat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `red_mushroomhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `green_mushroomhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `blue_mushroomhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `hivehat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `dragonheadhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `dragonbodyhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `dragontailhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `deserthat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `goggleshat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `moonstorm_goggleshat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `skeletonhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `kelphat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `mermhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `cookiecutterhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `batnosehat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `nutrientsgoggleshat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `plantregistryhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `balloonhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `alterguardianhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `eyemaskhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `antlionhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `mask_dollhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `mask_dollbrokenhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `mask_dollrepairedhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `mask_blacksmithhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `mask_mirrorhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `mask_queenhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `mask_kinghat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `mask_treehat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `mask_foolhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `mask_sagehat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `mask_halfwithat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `mask_toadyhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `mask_ancient_handmaidhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `mask_ancient_architecthat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `mask_ancient_masonhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `monkey_mediumhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `monkey_smallhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `polly_rogershat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `salty_doghat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `nightcaphat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `woodcarvedhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `dreadstonehat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `lunarplanthat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `voidclothhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `wagpunkhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `moon_mushroomhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `scrap_monoclehat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `scraphat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `mermarmorhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `mermarmorupgradedhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `inspectacleshat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `roseglasseshat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `ghostflowerhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `rabbithat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `pumpkinhat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `mask_princesshat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |
| `yoth_knighthat` | 可生成 | 可入栏 | `prefabs/hats.lua:219` |

## 世界实体：57 个 ID

下列实例的构造没有添加 inventoryitem。共用文件可能为其他实体添加该组件，例如 treasurechest.lua 的 sunkenchest 分支；不能按整个文件是否出现 inventoryitem 来分类。

| prefab ID | c_spawn | c_give | Lua 来源 |
| --- | --- | --- | --- |
| `firepit` | 可生成 | 不能入栏 | `prefabs/firepit.lua` |
| `coldfirepit` | 可生成 | 不能入栏 | `prefabs/coldfirepit.lua` |
| `campfire` | 可生成 | 不能入栏 | `prefabs/campfire.lua` |
| `coldfire` | 可生成 | 不能入栏 | `prefabs/coldfire.lua` |
| `icebox` | 可生成 | 不能入栏 | `prefabs/icebox.lua` |
| `saltbox` | 可生成 | 不能入栏 | `prefabs/saltbox.lua` |
| `tent` | 可生成 | 不能入栏 | `prefabs/tent.lua` |
| `siestahut` | 可生成 | 不能入栏 | `prefabs/tent.lua` |
| `wardrobe` | 可生成 | 不能入栏 | `prefabs/wardrobe.lua` |
| `pighouse` | 可生成 | 不能入栏 | `prefabs/pighouse.lua` |
| `birdcage` | 可生成 | 不能入栏 | `prefabs/birdcage.lua` |
| `moonbase` | 可生成 | 不能入栏 | `prefabs/moonbase.lua` |
| `nightlight` | 可生成 | 不能入栏 | `prefabs/nightlight.lua` |
| `mushroom_light` | 可生成 | 不能入栏 | `prefabs/mushroom_light.lua` |
| `mushroom_light2` | 可生成 | 不能入栏 | `prefabs/mushroom_light.lua` |
| `treasurechest` | 可生成 | 不能入栏 | `prefabs/treasurechest.lua` |
| `pandoraschest` | 可生成 | 不能入栏 | `prefabs/treasurechest.lua` |
| `minotaurchest` | 可生成 | 不能入栏 | `prefabs/treasurechest.lua` |
| `terrariumchest` | 可生成 | 不能入栏 | `prefabs/treasurechest.lua` |
| `beefalo` | 可生成 | 不能入栏 | `prefabs/beefalo.lua` |
| `pigman` | 可生成 | 不能入栏 | `prefabs/pigman.lua` |
| `pigguard` | 可生成 | 不能入栏 | `prefabs/pigman.lua` |
| `moonpig` | 可生成 | 不能入栏 | `prefabs/pigman.lua` |
| `hound` | 可生成 | 不能入栏 | `prefabs/hound.lua` |
| `firehound` | 可生成 | 不能入栏 | `prefabs/hound.lua` |
| `icehound` | 可生成 | 不能入栏 | `prefabs/hound.lua` |
| `deerclops` | 可生成 | 不能入栏 | `prefabs/deerclops.lua` |
| `bearger` | 可生成 | 不能入栏 | `prefabs/bearger.lua` |
| `dragonfly` | 可生成 | 不能入栏 | `prefabs/dragonfly.lua` |
| `moose` | 可生成 | 不能入栏 | `prefabs/moose.lua` |
| `antlion` | 可生成 | 不能入栏 | `prefabs/antlion.lua` |
| `toadstool` | 可生成 | 不能入栏 | `prefabs/toadstool.lua` |
| `toadstool_dark` | 可生成 | 不能入栏 | `prefabs/toadstool.lua` |
| `glommer` | 可生成 | 不能入栏 | `prefabs/glommer.lua` |
| `chester` | 可生成 | 不能入栏 | `prefabs/chester.lua` |
| `hutch` | 可生成 | 不能入栏 | `prefabs/hutch.lua` |
| `wormhole` | 可生成 | 不能入栏 | `prefabs/wormhole.lua` |
| `flower` | 可生成 | 不能入栏 | `prefabs/flower.lua` |
| `flower_rose` | 可生成 | 不能入栏 | `prefabs/flower.lua` |
| `flower_cave` | 可生成 | 不能入栏 | `prefabs/flower_cave.lua` |
| `flower_cave_double` | 可生成 | 不能入栏 | `prefabs/flower_cave.lua` |
| `flower_cave_triple` | 可生成 | 不能入栏 | `prefabs/flower_cave.lua` |
| `grass` | 可生成 | 不能入栏 | `prefabs/grass.lua` |
| `sapling` | 可生成 | 不能入栏 | `prefabs/sapling.lua` |
| `sapling_moon` | 可生成 | 不能入栏 | `prefabs/sapling.lua` |
| `pond` | 可生成 | 不能入栏 | `prefabs/pond.lua` |
| `pond_mos` | 可生成 | 不能入栏 | `prefabs/pond.lua` |
| `pond_cave` | 可生成 | 不能入栏 | `prefabs/pond.lua` |
| `rock1` | 可生成 | 不能入栏 | `prefabs/rocks.lua` |
| `rock2` | 可生成 | 不能入栏 | `prefabs/rocks.lua` |
| `rock_flintless` | 可生成 | 不能入栏 | `prefabs/rocks.lua` |
| `rock_flintless_med` | 可生成 | 不能入栏 | `prefabs/rocks.lua` |
| `rock_flintless_low` | 可生成 | 不能入栏 | `prefabs/rocks.lua` |
| `farm_plow` | 可生成 | 不能入栏 | `prefabs/farm_plow.lua` |
| `farm_soil` | 可生成 | 不能入栏 | `prefabs/farm_soil.lua` |
| `farm_soil_debris` | 可生成 | 不能入栏 | `prefabs/farm_soil_debris.lua` |
| `bernie_big` | 可生成 | 不能入栏 | `prefabs/bernie_big.lua` |

## 生物与特殊实体

butterfly、fireflies 已计入前面的 234 个 ID；本表重复列出它们以说明生物的分类依据。

| prefab ID | c_spawn | c_give | 源码与说明 |
| --- | --- | --- | --- |
| `rabbit` | 可生成 | 可入栏 | `prefabs/rabbit.lua:385` |
| `crow` | 可生成 | 可入栏 | `prefabs/birds.lua:343` |
| `robin` | 可生成 | 可入栏 | `prefabs/birds.lua:343` |
| `robin_winter` | 可生成 | 可入栏 | `prefabs/birds.lua:343` |
| `canary` | 可生成 | 可入栏 | `prefabs/birds.lua:343` |
| `bee` | 可生成 | 可入栏 | `prefabs/bee.lua:184` |
| `killerbee` | 可生成 | 可入栏 | `prefabs/bee.lua:184` |
| `mosquito` | 可生成 | 可入栏 | `prefabs/mosquito.lua:203` |
| `butterfly` | 可生成 | 可入栏 | `prefabs/butterfly.lua:129` |
| `fireflies` | 可生成 | 可入栏 | `prefabs/fireflies.lua:225` |
| `spider` | 可生成 | 可入栏 | `prefabs/spider.lua:702`；初始 canbepickedup=false 限制地面拾取动作，GiveItem 入口不检查该标记 |
| `bernie_active` | 可生成 | 入栏时转换为 bernie_inactive | `prefabs/bernie_active.lua:75` 的拾取回调、`:158` 的组件添加 |
| `shadow_thrall_parasitehat` | 有构造路径 | 有 inventoryitem，带 NPC 专用生命周期逻辑 | `prefabs/hats.lua:5786`；不纳入项目玩家帽子、库存 metadata、配方或图标 fallback |

spider.lua 还有其他共享构造的蜘蛛，但本表只单列已查看的 `spider`，不把所有变体重复计数。普通玩家的地面拾取、使用与角色专属玩法仍需分别核对。

## 分体 ID、命名与特殊行为

| prefab / 场景 | 静态源码结论 | 源码位置 |
| --- | --- | --- |
| `wall_stone` 与 `wall_stone_item` 等墙 | 建成墙只能生成；墙物品可生成、可入栏。原版 c_spawn("wall_stone_item") 生成墙物品。 | `prefabs/walls.lua:218`（物品组件）、`:377`、`:378`（两个注册项） |
| `farm_plow` 与 `farm_plow_item` | 前者是部署后的工作机器，不能入栏；后者是打包物品，支持两种命令。 | `prefabs/farm_plow.lua:309`、`:362`、`:363` |
| `bernie_inactive`、`bernie_active`、`bernie_big` | inactive 可生成与入栏；active 的 OnPickup 转换为 inactive 并交给玩家；big 没有 inventoryitem。 | `prefabs/bernie_inactive.lua:272`、`prefabs/bernie_active.lua:22`、`:75`、`:158`、`prefabs/bernie_big.lua` |
| `backpack` | 有 inventoryitem，但 cangoincontainer=false；不能放普通格，GiveItem 可能放鼠标持有位置，取决于库存状态。 | `prefabs/backpack.lua:268`、`:269`；`components/inventory.lua:1177` |
| `phonograph` 与 `record` | 留声机虽然外观类似建筑，实际有 inventoryitem；两者均支持生成与入栏。record 的源文件名是 records.lua。 | `prefabs/phonograph.lua:190`；`prefabs/records.lua:98`、`:114` |
| `lantern` | 提灯实际 prefab ID 是 lantern，源文件名是 mininglantern.lua。 | `prefabs/mininglantern.lua:259`、`:302` |
| `shadow_thrall_parasitehat` | NPC 专用实体，有共用帽子组件不等于可作为普通玩家帽子导入；保留项目排除规则。 | `prefabs/hats.lua:5786`；[AGENTS.md](../AGENTS.md) |

## 原版 Lua 与当前项目

本页记录原版源码判断。项目自己的命令由注册表和物品定义决定；查看原版结果时需分别检查项目是否已经接入对应 prefab。

| 项目范围 | 当前依据 / 差异 |
| --- | --- |
| c_spawn 支持的 ID | [src/prefabDefinitions.ts](../src/prefabDefinitions.ts) 的 debugSpawnIds；[README 调试命令](../README.md#调试命令debugcommand) 列出支持对象。 |
| c_give 支持的 ID | [src/inventoryItems.ts](../src/inventoryItems.ts) 的 INVENTORY_ITEM_SPECS；命令通过物品定义校验，并由库存系统添加。 |
| 参数 | 项目支持 c_spawn("prefab_id") 和 c_give("item_id", count)，不支持原版的 dontselect，也未接入 c_spawn 的数量参数。 |
| 墙物品的 c_spawn | 项目 wall_*_item 别名生成建成墙，与原版生成墙物品不同。 |
| 背包入栏 | 项目将背包作为普通库存物品，每个占一格；原版的 cangoincontainer=false 不适用于当前项目库存模型。 |
| torch 等普通物品 | 原版两种命令都可用；项目的 torch 已支持 c_give 与 c_spawn，其他普通物品的 c_spawn 仍需单独出现在 debugSpawnIds 中。 |

本次只增加调查文档，没有更改命令参数、行为或支持 ID。

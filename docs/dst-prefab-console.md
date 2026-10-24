# DST Lua prefab 的 c_spawn / c_give 静态核对

核对日期：2026-10-07。依据本地 DST Lua 源码，整理原版命令的适用条件与 prefab ID；没有运行 DST 引擎验证。

源码根目录：`/data/copy/AssetArchive-Dev/data/DST/data/databundles/scripts_unpacked/scripts/`。下文 `prefabs/*.lua`、`components/*.lua` 等路径均相对于该目录，行号对应本次读取的源码版本。

清单覆盖项目 [groundItems.json](../packages/prefab/src/groundItems.json) 的 235 个 ID、[hats.json](../packages/prefab/src/hats.json) 的 82 个玩家帽子 ID，以及本次查看的 57 个世界实体和部分生物、特殊实体。2026-10-08 补充核对三色生／熟蘑菇的六个物品 ID，2026-10-11 补充核对 `book_silviculture`、`book_rain`、`book_moon`、`dug_sapling`、`dug_sapling_moon`、`marble`、`moon_tree_blossom`、`moonbutterfly`、`moonbutterflywings` 和 `sculptingtable`，2026-10-12 补充核对 `bird_egg`、`rottenegg`，并确认 `birdcage` 与四种鸟的入栏形态。它是已核对范围的快照，不是 DST 全量 prefab 注册表，也不是项目当前命令支持列表。

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

## 地面物品目录

ID 与来源按项目地面资源目录核对，组件证据来自对应 Lua 文件。共用文件的行号指向共用构造实现，不是每个 ID 的独立注册位置。Lua 文件名与 prefab ID 不必相同。

| prefab ID | c_spawn | c_give | inventoryitem 源码 |
| --- | --- | --- | --- |
| `cutgrass` | 可生成 | 可入栏 | `prefabs/cutgrass.lua:33` |
| `dug_grass` | 可生成 | 可入栏 | `prefabs/plantables.lua` 的共享草簇构造分支 |
| `dug_sapling` | 可生成 | 可入栏 | `prefabs/plantables.lua:88`（`make_plantable` 共享构造） |
| `dug_sapling_moon` | 可生成 | 可入栏 | `prefabs/plantables.lua:88`（`make_plantable` 共享构造） |
| `twigs` | 可生成 | 可入栏 | `prefabs/twigs.lua:41` |
| `log` | 可生成 | 可入栏 | `prefabs/log.lua:50` |
| `cutreeds` | 可生成 | 可入栏 | `prefabs/cutreeds.lua:47` |
| `boards` | 可生成 | 可入栏 | `prefabs/boards.lua:42` |
| `rope` | 可生成 | 可入栏 | `prefabs/rope.lua:61` |
| `cutstone` | 可生成 | 可入栏 | `prefabs/cutstone.lua:33` |
| `marble` | 可生成 | 可入栏 | `prefabs/inv_marble.lua:36` |
| `foliage`、`beardhair`、`scrapbook_page` | 可生成 | 可入栏 | `prefabs/foliage.lua`、`beardhair.lua`、`scrapbook_page.lua`：仅接入地面美术、库存图标和堆叠 40；干燥、雪人装饰、图鉴教学、燃烧等交互未实现 |
| `cookingrecipecard`、`blueprint` | 可生成 | 可入栏 | `prefabs/cookingrecipecard.lua`、`blueprint.lua`：仅接入地面美术和图标（`blueprint_rare` 作为稀有变体资源），不堆叠；随机配方、命名、教学与燃烧未实现 |
| `trinket_1`～`trinket_46` | 可生成 | 可入栏 | `prefabs/trinkets.lua` 按 `NUM_TRINKETS = 46` 注册的实际 ID：`trinkets.zip` 的编号剪辑与 `inventoryimages.xml` 图标，堆叠 40；可交易、诱饵、弹药、海钓配件等交互未实现 |
| `moon_tree_blossom` | 可生成 | 可入栏 | `prefabs/moontree_blossom.lua` 的 `inventoryitem` 分支 |
| `moonbutterflywings` | 可生成 | 可入栏 | `prefabs/moonbutterflywings.lua` 的 `inventoryitem` 分支 |
| `mole` | 可生成 | 可入栏（活体、每只一槽） | `prefabs/mole.lua` 的 `inventoryitem`、`MakeFeedableSmallLivestock`；地下不可拾取，锤击击晕后可拾取 |
| `molehill` | 可生成 | 无 inventoryitem，不能入栏 | `prefabs/molehill.lua`：单子代 `spawner`、50 槽 inventory、1 次 DIG |
| `lightflier` | 可生成 | 可入栏，地面需虫网捕获 | `prefabs/lightflier.lua`：`inventoryitem`、`workable NET`、`MakeFeedableSmallLivestock`；堆叠 40，饥饿产生荧光果 |
| `lightflier_flower` | 可生成 | 无 inventoryitem | `prefabs/lightflier_flower.lua`：nil-product `pickable`、`childspawner`；采摘释放光虫，回巢恢复花 |
| `moonbutterfly` | 可生成 | 可入栏 | `prefabs/moonbutterfly.lua:163`（`canbepickedup = false`，需捕虫网） |
| `dreadstone` | 可生成 | 可入栏 | `prefabs/dreadstone.lua:36` |
| `wagpunk_bits` | 可生成 | 可入栏 | `prefabs/wagpunk_bits.lua:34` |
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
| `papyrus` | 可生成 | 可入栏 | `prefabs/papyrus.lua:46` |
| `featherpencil` | 可生成 | 可入栏 | `prefabs/featherpencil.lua:34` |
| `nightmarefuel` | 可生成 | 可入栏 | `prefabs/nightmarefuel.lua:93` |
| `petals` | 可生成 | 可入栏 | `prefabs/petals.lua:99`：inventoryitem、PERISH_FAST（6 游戏日），腐败为同数量 spoiled_food；当前项目接入库存／地面 perish 与存读档 |
| `petals_evil` | 可生成 | 可入栏 | `prefabs/petals_evil.lua:56` |
| `ash` | 可生成 | 可入栏 | `prefabs/ash.lua:75` |
| `beefalowool` | 可生成 | 可入栏 | `prefabs/beefalowool.lua:32` |
| `boneshard` | 可生成 | 可入栏 | `prefabs/boneshard.lua:30` |
| `butter` | 可生成 | 可入栏 | `prefabs/butter.lua`：inventoryitem、edible、PERISH_SUPERSLOW，腐败为 spoiled_food |
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
| `carrot_seeds` | 可生成 | 可入栏 | `prefabs/veggies.lua` |
| `corn_seeds` | 可生成 | 可入栏 | `prefabs/veggies.lua` |
| `pumpkin_seeds` | 可生成 | 可入栏 | `prefabs/veggies.lua` |
| `eggplant_seeds` | 可生成 | 可入栏 | `prefabs/veggies.lua` |
| `durian_seeds` | 可生成 | 可入栏 | `prefabs/veggies.lua` |
| `pomegranate_seeds` | 可生成 | 可入栏 | `prefabs/veggies.lua` |
| `dragonfruit_seeds` | 可生成 | 可入栏 | `prefabs/veggies.lua` |
| `watermelon_seeds` | 可生成 | 可入栏 | `prefabs/veggies.lua` |
| `tomato_seeds` | 可生成 | 可入栏 | `prefabs/veggies.lua` |
| `potato_seeds` | 可生成 | 可入栏 | `prefabs/veggies.lua` |
| `asparagus_seeds` | 可生成 | 可入栏 | `prefabs/veggies.lua` |
| `onion_seeds` | 可生成 | 可入栏 | `prefabs/veggies.lua` |
| `garlic_seeds` | 可生成 | 可入栏 | `prefabs/veggies.lua` |
| `pepper_seeds` | 可生成 | 可入栏 | `prefabs/veggies.lua` |
| `kelp_dried` | 可生成 | 可入栏 | `prefabs/veggies.lua` |
| `red_cap` | 可生成 | 可入栏 | `prefabs/mushrooms.lua:338` |
| `red_cap_cooked` | 可生成 | 可入栏 | `prefabs/mushrooms.lua:396` |
| `green_cap` | 可生成 | 可入栏 | `prefabs/mushrooms.lua:338` |
| `green_cap_cooked` | 可生成 | 可入栏 | `prefabs/mushrooms.lua:396` |
| `blue_cap` | 可生成 | 可入栏 | `prefabs/mushrooms.lua:338` |
| `blue_cap_cooked` | 可生成 | 可入栏 | `prefabs/mushrooms.lua:396` |
| `pinecone` | 可生成 | 可入栏 | `prefabs/pinecone.lua:108` |
| `acorn_cooked` | 可生成 | 可入栏 | `prefabs/acorn.lua:121` |
| `poop` | 可生成 | 可入栏 | `prefabs/poop.lua:89` |
| `gunpowder` | 可生成 | 可入栏 | `prefabs/gunpowder.lua:85` |
| `fence_item` | 可生成 | 可入栏 | `prefabs/fence.lua:939` |
| `fence` | 可生成 | 不可入栏 | `prefabs/fence.lua:938` |
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
| `backpack` | 可生成；项目支持 `c_spawn("backpack")` | 特殊持有，不能进普通格 | `prefabs/backpack.lua:268`；地面地图图标为 `backpack.png`，拾取／装备后隐藏；`c_save()` 与读档保留身份、位置和容器状态 |
| `amulet` | 可生成；`c_spawn("amulet")` | 可入栏（`c_give("amulet")`），装备于身体槽 | `prefabs/amulet.lua` 的红色护符；地面 `amulets/redamulet`，穿戴 `torso_amulets` 的 `redamulet`（皮肤 `amulet_red_heart` / `occulteye` / `relic` / `rose`）；幽灵作祟后经 `respawnfromghost` 进入 `amulet_rebirth`，护符被消耗 |
| `armorsnurtleshell` | 可生成；`c_spawn("armorsnurtleshell")` | 可入栏（`c_give("armorsnurtleshell")`），装备于身体槽 | `prefabs/armor_snurtleshell.lua`；地面与穿戴均为 `armor_slurtleshell` build（`swap_body_tall`），缩壳动画在 `player_slurtle_armor.zip`；穿上后右键物品槽触发 `USEITEM`，播放 `shell_enter` → `shell_idle`，`blocked` 事件播放 `shell_hit` |
| `bernie_inactive` | 可生成 | 可入栏 | `prefabs/bernie_inactive.lua:272` |
| `farm_plow_item` | 可生成 | 可入栏 | `prefabs/farm_plow.lua:309` |
| `dock_kit` | 可生成 | 可入栏（`stackable`，上限 `STACK_SIZE_MEDITEM = 20`） | `prefabs/dock_kit.lua`；`deployable` 为 `DEPLOYMODE.CUSTOM`，只能铺在与永久陆地或码头相邻的 `OCEAN_COASTAL` 格上，部署后该格变为 `MONKEY_DOCK` |
| `lantern` | 可生成 | 可入栏 | `prefabs/mininglantern.lua:259` |
| `heatrock` | 可生成 | 可入栏 | `prefabs/heatrock.lua:232` 的 `inventoryitem`；无 `stackable` 或 `equippable`。本项目暂固定初始第 3 档，温度分支未实现 |
| `phonograph` | 可生成 | 可入栏 | `prefabs/phonograph.lua:190` |
| `record` | 可生成 | 可入栏 | `prefabs/records.lua:98` |
| `lightbulb` | 可生成 | 可入栏 | `prefabs/lightbulb.lua:64` |
| `butterfly` | 可生成 | 可入栏 | `prefabs/butterfly.lua:129` |
| `fireflies` | 可生成 | 可入栏 | `prefabs/fireflies.lua:225` |
| `yellowstaff` | 可生成 | 可入栏 | `prefabs/staff.lua:770` |
| `moonrocknugget` | 可生成 | 可入栏 | `prefabs/moonrocknugget.lua:57`；原版 `repairer` 的 moonrock 材质与 2 点修复值 |
| `opalstaff` | 可生成 | 可入栏 | `prefabs/staff.lua:770` |
| `greenstaff` | 可生成 | 可入栏 | `prefabs/staff.lua:770`、`:953`；配方目标施法与 5 次耐久 |
| `trident` | 可生成 | 可入栏 | `prefabs/trident.lua`；200 次耐久，仅可对水面点施法（`spellcaster.canuseonpoint_water`），经 `SGwilson.lua` 的 `play_strum`；`c_save()` 保留耐久与皮肤 `trident_merm` |
| `opalpreciousgem` | 可生成 | 可入栏 | `prefabs/gem.lua:74`、`:96`；`buildgem("opal", true)` |
| `reskin_tool` | 可生成 | 可入栏 | `prefabs/reskin_tool.lua:386` |
| `book_silviculture` | 可生成 | 可入栏 | `prefabs/books.lua:1031`（`MakeBook` 共享构造）；`componentactions.lua:2525` 仅向带 `reader` 标签的玩家提供 READ |
| `book_rain` | 可生成 | 可入栏 | `prefabs/books.lua:809`（`MakeBook` 共享构造）；`componentactions.lua:2525` 仅向带 `reader` 标签的玩家提供 READ；成功阅读由 `components/book.lua:OnRead` 生成 `fx.lua:3052` 的 `fx_book_rain` |
| `book_moon` | 可生成 | 可入栏 | `prefabs/books.lua:845`（`MakeBook` 共享构造）；`componentactions.lua:2525` 仅向带 `reader` 标签的玩家提供 READ；成功阅读由 `components/book.lua:OnRead` 生成 `fx.lua:2926` 的 `fx_book_moon` |
| `hammer` | 可生成 | 可入栏 | `prefabs/hammer.lua:86` |
| `bugnet` | 可生成 | 可入栏 | `prefabs/bugnet.lua:74` |
| `razor` | 可生成 | 可入栏 | `prefabs/razor.lua:30`、`:32` 的 `inventoryitem` 与 `shaver`；无 `stackable`、`equippable` 或 `finiteuses`，由鼠标举着对睡着的牛使用 |
| `panflute` | 可生成 | 可入栏 | `prefabs/panflute.lua:128`–`:144` 的 `instrument`、`tool(PLAY)`、`finiteuses(10)`；`componentactions.lua:2697` 向物品栏提供 PLAY，催眠仅对 `sleeper` 标签生效 |
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
| `bird_egg` | 可生成 | 可入栏 | `prefabs/egg.lua:75`（commonfn("idle", true)） |
| `rottenegg` | 可生成 | 可入栏 | `prefabs/egg.lua:178` |
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

## 世界实体

下列实例的构造没有添加 inventoryitem。共用文件可能为其他实体添加该组件，例如 treasurechest.lua 的 sunkenchest 分支；不能按整个文件是否出现 inventoryitem 来分类。

| prefab ID | c_spawn | c_give | Lua 来源 |
| --- | --- | --- | --- |
| `planted_flower` | 可生成 | 不能入栏 | `prefabs/flower.lua:plantedflowerfn`：将 prefab 设为 flower，planted=true；由 butterfly.lua:OnDeploy 生成 |
| `firepit` | 可生成 | 不能入栏 | `prefabs/firepit.lua` |
| `coldfirepit` | 可生成 | 不能入栏 | `prefabs/coldfirepit.lua` |
| `campfire` | 可生成 | 不能入栏 | `prefabs/campfire.lua` |
| `coldfire` | 可生成 | 不能入栏 | `prefabs/coldfire.lua` |
| `icebox` | 可生成 | 不能入栏 | `prefabs/icebox.lua` |
| `saltbox` | 可生成 | 不能入栏 | `prefabs/saltbox.lua` |
| `bookstation` | 可生成 | 不能入栏 | `prefabs/bookstation.lua` |
| `tent` | 可生成 | 不能入栏 | `prefabs/tent.lua` |
| `siestahut` | 可生成 | 不能入栏 | `prefabs/tent.lua` |
| `wardrobe` | 可生成 | 不能入栏 | `prefabs/wardrobe.lua` |
| `pighouse` | 可生成 | 不能入栏 | `prefabs/pighouse.lua` |
| `sculptingtable` | 可生成 | 不能入栏 | `prefabs/sculptingtable.lua` |
| `winterometer` | 可生成 | 不能入栏 | `prefabs/winterometer.lua` |
| `lightning_rod` | 可生成 | 不能入栏 | `prefabs/lightningrod.lua` |
| `birdcage` | 可生成 | 不能入栏 | `prefabs/birdcage.lua` |
| `moonbase` | 可生成 | 不能入栏 | `prefabs/moonbase.lua` |
| `moondial` | 可生成 | 不能入栏 | `prefabs/moondial.lua` |
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
| `evergreen`、`evergreen_short`、`evergreen_normal`、`evergreen_tall` | 可生成 | 不能入栏 | `prefabs/evergreens.lua` normal build：保存名统一为 `evergreen`，四阶段生长，`CHOP` 砍伐、`DIG` 铲树桩；松果为单独库存物品 |
| `deciduoustree`、`deciduoustree_short`、`deciduoustree_normal`、`deciduoustree_tall` | 可生成 | 不能入栏 | `prefabs/deciduoustrees.lua` normal build：统一保存为 `deciduoustree`，三阶段循环生长，`CHOP` 砍伐、`DIG` 铲树桩；季节树叶与 `acorn` 掉落沿用正常树分支，无 `inventoryitem` |
| `moon_tree`、`moon_tree_short`、`moon_tree_normal`、`moon_tree_tall` | 可生成 | 不能入栏 | `prefabs/moontree.lua`：世界实体，支持三阶段循环生长；各构造的保存名统一为 `moon_tree` |
| `moonbutterfly_sapling` | 可生成 | 不能入栏 | `prefabs/planted_tree.lua`：`baby_moon_tree`，`timer` 到期生成 `moon_tree_short`；`moonbutterfly.lua:OnDeploy` 种下此实体并消耗一只月蛾 |
| `flower_rose` | 可生成 | 不能入栏 | `prefabs/flower.lua` |
| `flower_cave` | 可生成 | 不能入栏 | `prefabs/flower_cave.lua` |
| `flower_cave_double` | 可生成 | 不能入栏 | `prefabs/flower_cave.lua` |
| `flower_cave_triple` | 可生成 | 不能入栏 | `prefabs/flower_cave.lua` |
| `grass` | 可生成 | 不能入栏 | `prefabs/grass.lua` |
| `berrybush` | 可生成 | 不能入栏 | `prefabs/berrybush.lua` normal 分支：`PICK` 浆果、动态再生、冬季暂停、`DIG` 铲取与施肥移植；支持三款原版皮肤 |
| `monkeytail` | 可生成 | 不能入栏 | `prefabs/monkeytail.lua`：`PICK` 芦苇、冬季暂停再生、`DIG` 挖取；移植后施肥恢复 5–7 次采摘额度 |
| `sapling` | 可生成 | 不能入栏 | `prefabs/sapling.lua` |
| `sapling_moon` | 可生成 | 不能入栏 | `prefabs/sapling.lua` |
| `sanityrock`、`insanityrock` | 可生成 | 不能入栏 | `prefabs/nightmarerock.lua`：无 inventoryitem；项目已接入 `SGnightmarerock`（`raise` / `lower` / `conceal` / `reveal`）、障碍物随激活开关，以及 `sanity_raise` / `sanity_lower` 特效；静态布局 `default_pigking` 在猪王周围放置各 4 块，可由 `c_save()` 保存位置与实体 ID |
| `pond` | 可生成 | 不能入栏 | `prefabs/pond.lua` |
| `tumbleweed` | 可生成 | 不能入栏 | `prefabs/tumbleweed.lua`、`components/blowinwind.lua`、`components/worldwind.lua`：风向驱动滚动、`PICK` 触发 `startlongaction` 停止／重启、3 件加权战利品与 `break` 特效；未接入燃烧、音效和作祟，无 prefab 的战利品不掉落 |
| `hotspring` | 可生成 | 不能入栏 | `prefabs/hotspring.lua`：heater（`HOTSPRING_HEAT` PASSIVE 45 / ACTIVE 90）、投入沐浴球后点亮的光源与 `bathbombable`；项目已接入这三条分支及 `isbathbombed` 存档，结晶、沐浴池、蒸汽、水源和音效未接入 |
| `bathbomb` | 可生成 | 可 `c_give` | `prefabs/bathbomb.lua`：`bathbomb`、`fuel`（`MED_FUEL`）、可燃、堆叠 20、无 perishable；`BATHBOMB` 动作经 `bathbomb` 与 `bathbombable` 标签匹配，库存图标 `bathbomb.tex`（`inventoryimages1.xml`） |
| `lava_pond` | 可生成 | 不能入栏 | `prefabs/lava_pond.lua`：有 heater，无 inventoryitem；项目已接入供热接口、外观、障碍和布局存档 |
| `lava_pond_rock`、`lava_pond_rock2`～`lava_pond_rock7` | 可生成 | 不能入栏 | `prefabs/lava_pond.lua:makerock` 的 7 个实际 ID；无 inventoryitem，独立生成时可持久化，池的子焦岩不独立持久化 |
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

butterfly、fireflies 已计入前面的地面物品目录；本表重复列出它们以说明生物的分类依据。

| prefab ID | c_spawn | c_give | 源码与说明 |
| --- | --- | --- | --- |
| `rabbit` | 可生成 | 可入栏 | `prefabs/rabbit.lua:385` |
| `crow` | 可生成 | 可入栏 | `prefabs/birds.lua:343` |
| `robin` | 可生成 | 可入栏 | `prefabs/birds.lua:343` |
| `robin_winter` | 可生成 | 可入栏 | `prefabs/birds.lua:343` |
| `canary` | 可生成 | 可入栏 | `prefabs/birds.lua:343`；项目只移植被捕获后的物品形态（见下） |
| `bee` | 可生成 | 可入栏 | `prefabs/bee.lua:184` |
| `killerbee` | 可生成 | 可入栏 | `prefabs/bee.lua:184` |
| `mosquito` | 可生成 | 可入栏 | `prefabs/mosquito.lua:203` |
| `butterfly` | 可生成 | 可入栏 | `prefabs/butterfly.lua:129` |
| `fireflies` | 可生成 | 可入栏 | `prefabs/fireflies.lua:225` |
| `spider` | 可生成 | 可入栏 | `prefabs/spider.lua:702`；初始 canbepickedup=false 限制地面拾取动作，GiveItem 入口不检查该标记 |
| `bernie_active` | 可生成 | 入栏时转换为 bernie_inactive | `prefabs/bernie_active.lua:75` 的拾取回调、`:158` 的组件添加 |
| `shadow_thrall_parasitehat` | 有构造路径 | 有 inventoryitem，带 NPC 专用生命周期逻辑 | `prefabs/hats.lua:5786`；不纳入项目玩家帽子、库存 metadata、配方或图标 fallback |

项目对 `crow`、`robin`、`robin_winter`、`canary` 的支持：`c_give` 入栏，`c_spawn` 生成 `SGbird` `stunned_loop` 姿势的地面物品（`canbepickedup` 恢复可拾取）；野外飞行、`birdbrain`、`birdspawner` 和 `flyaway` 超时未移植。

spider.lua 还有其他共享构造的蜘蛛，但本表只单列已查看的 `spider`，不把所有变体重复计数。普通玩家的地面拾取、使用与角色专属玩法仍需分别核对。

## 分体 ID、命名与特殊行为

| prefab / 场景 | 静态源码结论 | 源码位置 |
| --- | --- | --- |
| `wall_stone` 与 `wall_stone_item` 等墙 | 建成墙只能生成；墙物品可生成、可入栏。原版 c_spawn("wall_stone_item") 生成墙物品。 | `prefabs/walls.lua:218`（物品组件）、`:377`、`:378`（两个注册项） |
| `berrybush` 与 `dug_berrybush` | 前者是世界植物，仅可生成；后者由 plantables.lua 添加 inventoryitem，两种命令均可用。健康植株可铲取移植，缺肥／枯萎时铲取只掉两根树枝；普通浆果丛的三款源皮肤在两种形态间映射。 | `prefabs/berrybush.lua:dig_up_common`、`prefabs/plantables.lua:121` |
| `monkeytail` 与 `dug_monkeytail` | 前者是世界植物，仅可生成；后者由 plantables.lua 添加 inventoryitem，两种命令均可用，可栽种回猴尾草。 | `prefabs/monkeytail.lua:156`、`prefabs/plantables.lua:93`、`:174` |
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

此表记录源码调查及对应的项目实现说明；当前命令支持范围以 README 和注册表为准。

2026-10-14 补充石果灌木：`prefabs/rock_avocado_bush.lua` 注册世界实体 `rock_avocado_bush`（无 inventoryitem，只支持 `c_spawn`）；`prefabs/plantables.lua` 的 `name = "rock_avocado_bush"` 经共享构造注册 `dug_rock_avocado_bush`，带 inventoryitem 与 stackable，可 `c_spawn` / `c_give`；`prefabs/rock_avocado_fruit.lua` 注册硬壳 `rock_avocado_fruit`，库存实际图名为 `rock_avocado_fruit_rockhard`，同样支持两种命令。支持灌木采摘、四阶段生长、移植与施肥，以及硬壳果实的库存／地面形态。

2026-10-14 补充火药：`prefabs/gunpowder.lua` 注册 `gunpowder`，带 inventoryitem 与 stackable，可 `c_spawn` / `c_give`；`explode_small` 是其爆炸特效 prefab，无 inventoryitem，不作为独立命令目标。火药 `MakeSmallBurnable(3 + math.random() * 3)` 且 `SetOnBurntFn(nil)`，烧尽由 `burnable.lua:DoneBurning` 调用 `explosive:OnBurnt()`，范围 3 DST 单位内对 `workable` 执行 `WorkedBy(10 * 叠数)`（背包物品最多处理 20 件，按各自叠数放大）、点燃无 `fueled` 的 `burnable` 并推送 `explosion`；硬壳石果因此被整堆开采，超出上限而幸存的石果由 `OnExplosion_rock_avocado_fruit_full` 的 `LaunchAt` 弹开。战斗伤害、码头伤害、`explosiveresist` 和屏幕闪动尚未实现。

2026-10-14 补充木栅栏：`prefabs/fence.lua` 注册世界实体 `fence`（无 inventoryitem，只支持 `c_spawn`）和部署物 `fence_item`（`stackable` `STACK_SIZE_MEDITEM`、`inventoryitem`、`deployable` `DEPLOYMODE.WALL`，可 `c_spawn` / `c_give`）。与项目的 `wall_*_item` 别名不同，`c_spawn("fence_item")` 生成地面物品而不是建成栅栏，建成栅栏用 `c_spawn("fence")`。同文件还有 `fence_gate`、`fence_gate_item`、`quagmire_park_gate` 和 `fence_junk`，`fence_electric*` 与 `fence_rotator` 在其他文件，均不在当前范围内。

2026-10-14 补充开壳与石果芽：同一 `prefabs/rock_avocado_fruit.lua` 注册 `rock_avocado_fruit_ripe`、`rock_avocado_fruit_ripe_cooked`、`rock_avocado_fruit_sprout`，均带 inventoryitem 与 stackable，可 `c_spawn` / `c_give`；世界幼苗 `rock_avocado_fruit_sprout_sapling` 没有 inventoryitem，只可 `c_spawn`。硬壳果实的 `workable` 为 `MINE`，普通命中开 1 个，按单果 65% 熟果 / 1% 芽 / 34% 石头抽签；芽部署后生成世界幼苗，`timer.grow` 为 `5 * day_time = 1500` 秒，`seed_growth` 结束生成原生 `rock_avocado_bush`。`timer` 保存正在等待的计时器，破土动画与烧毁进度无自定义存档。命令、剩余石果数量、产物、工具耐久、幼苗身份／位置与剩余生长时间均纳入保存／恢复验证。

2026-10-16 补充 `marblebean`、`marblebean_sapling`、`marbleshrub`：`prefabs/marblebean.lua` 的种子带 inventoryitem、stackable（`STACK_SIZE_SMALLITEM`）和 `deployable`（PLANT），可 `c_spawn` / `c_give`；`prefabs/planted_tree.lua` 的 `marblebean_sapling` 与 `prefabs/marbleshrub.lua` 的 `marbleshrub`、`marbleshrub_short`、`marbleshrub_normal`、`marbleshrub_tall` 没有 inventoryitem，只可 `c_spawn`（后三者只改变起始阶段，实例 prefab 仍是 `marbleshrub`）。树苗 `workable` 为 `DIG`（铲子），灌木为 `MINE`（镐）。命令、树苗剩余生长时间、灌木阶段 / 剩余时间 / 外形 / 明度和开采掉落均纳入保存 / 恢复验证。

2026-10-16 补充 `pighead`：`prefabs/stickheads.lua` 的 `pighead` / `mermhead` 同一构造函数，没有 inventoryitem，只可 `c_spawn`（本项目目前只移植 `pighead`）。`workable` 为 `HAMMER`（3 次），`MakeSmallBurnable(inst, nil, nil, true)` 可点燃，`DeconstructRecipe("pighead", 4 猪皮 + 4 树枝)` 作为 `lootdropper` 的配方掉落。命令、烧毁标记与位置纳入保存 / 恢复验证。

2026-10-16 补充 `mermhead` 与 `pondfish`：`mermhead` 与 `pighead` 同属 `prefabs/stickheads.lua`，只可 `c_spawn`；`DeconstructRecipe("mermhead", 1 pondfish + 4 spoiled_food + 4 twigs)` 提供锤子掉落。`prefabs/pondfish.lua` 的 `pondfish` 带 inventoryitem（无 stackable），可 `c_spawn` / `c_give`。

2026-10-16 补充 `fishingrod` 与池塘钓鱼：`prefabs/fishingrod.lua` 的 `fishingrod` 带 inventoryitem、equippable、finiteuses（`FISHINGROD_USES` = 9）、weapon 和 `fishingrod` 组件，可 `c_spawn` / `c_give`，有 `fishingrod_block`、`fishingrod_curl`、`fishingrod_sword` 三个皮肤。`prefabs/pond.lua` 的 `pond` 挂 `fishable`（`FISH_RESPAWN_TIME` = 160 秒），`pond_mos` / `pond_cave` 不在当前范围。`fishable` 保存 `{ fish = fishleft }`（仅当少于 10 条），`fishingrod` 本身不保存状态，读档后不在钓鱼状态。`SGwilson.lua` 的 `fishing_pre`、`fishing`、`fishing_nibble`、`fishing_strain`、`catchfish`、`loserod`、`fishing_pst` 与 `fishingcancel` 事件已移植；`REEL` 是即时动作，由控制器直接调用鱼竿组件。命令、鱼数、鱼竿耐久与皮肤纳入保存 / 恢复验证。

2026-10-17 补充 `prefabs/archive_props.lua` 的静态部分：该文件注册 13 个世界 prefab，均无 inventoryitem，只可 `c_spawn`，没有 `c_give`。当前移植 `archive_moon_statue`、`archive_rune_statue`、`archive_portal`、`archive_switch_base`、`archive_switch_pad`、`archive_ambient_sfx`、`rubble1`、`rubble2`。月亮雕像（`statuefn`）带 `workable`（`MINE`，`TUNING.MARBLEPILLAR_MINE` = 10 次）和 `archive_statues` 掉落表（`thulecite` 与 `moonrocknugget` 必掉，另有 5% 再掉一个 `moonrocknugget`），完成时生成 `collapse_small`（`rock` 材质：`destroy_smoke` 加 `wilson/rock_break`）并移除；`workable` 不保存进度（`savestate = false`），存档只写 `anim`（`math.random(4)`）。符文雕像（`runefn`）无 `workable`，`anim` 为 `math.random(3)`，`inspectable.getstatus` 首次检查时按模块级 `_storyprogress` 分配 `LINE_1`～`LINE_5` 并保存 `storyprogress`，读档后计数取已有最大值。传送门与开关底座／踏板用 `ANIM_ORIENTATION.OnGround` 与 `LAYER_BACKGROUND`，传送门另挂 `DECOR | NOCLICK` 的 `archive_portal_base` 阴影子实体并 `SetEightFaced`。`archive_switch_pad` 是 `persists = false`，`rubble1` / `rubble2` 是下一帧自我移除的世界生成物件，`c_spawn` 它们不留下实体，`c_save()` 也不导出。未移植：`archive_security_desk`、`archive_security_pulse`（及 `_sfx`）、`archive_security_waypoint`、`archive_switch`，以及它们依赖的 `archivemanager`、`childspawner`、`follower`、`grottowarmanager` 和 `archive_securitypulsebrain`；因此传送门的 `POWEROFF` 检查文本、`ms_register_vault_lobby_exit_target` 事件、开关底座朝向最近 `archive_switch` 的旋转、`arhivepoweron/off` 响应、环境声以及 `MakeHauntableWork` 都未接入，`inspectable` 目前只在符文雕像实例上以 `getstatus` / `descriptionfn` 暴露源逻辑（项目尚无 Examine 动作）。命令、月亮雕像开采掉落、符文故事进度、传送门与底座位置纳入保存／恢复验证。

2026-10-17 补充死亡流程的骷髅与幽灵（`stategraphs/SGwilson.lua` death 的 `animover`、`prefabs/skeleton.lua`、`prefabs/player_common_extensions.lua` 的 `SpawnDeathProduct` / `CommonPlayerDeath` / `OnMakePlayerGhost`、`stategraphs/SGwilsonghost.lua`）。`skeleton_player` 只可 `c_spawn`，没有 `c_give`；移植其带 `playerskeleton` 标签、`MakeSmallObstaclePhysics(.25)`、`workable`（`HAMMER`，`TUNING.SKELETON_WORK` = 3 次）、`skeleton_player` 掉落表（两个 `boneshard`，必掉）、完成时 `collapse_small`（`rock` 材质）并移除的部分；`anim` 为 `math.random(1, 6)`（`idle1`～`idle6`），存档写 `anim`、`char`、`playername`、`userid`、`pkname`、`cause`（`SetSkeletonDescription` 把死因转小写，被玩家击杀时不存）。2026-10-17 追加 `skeleton`、`skeleton_notplayer`、`skeleton_notplayer_1`、`skeleton_notplayer_2`：同样可 `c_spawn`、无 `c_give`，`anim` 取 `common_fn` 的 `animnum_min..animnum_max`（`skeleton` 1～6，`skeleton_notplayer` 7～8，`_1` 固定 7，`_2` 固定 8），掉落表 `skeleton`（两个 `boneshard` 必掉，`scrapbook_page` 10%），存档只写 `anim`。未移植：`Decay` / `skeletonspawntime` 的 `age`、`playeravatardata`、`shallow_grave` 与 `ms_skeletonspawn`。生命降到 0 时 `death` 状态在 `animover` 向玩家推送 `makeplayerghost { skeleton = IsPassableAtPoint }`（`turfMap` 非海洋、非 `INVALID`），`OnMakePlayerGhost` 生成骷髅与 `die_fx`（`fx.lua`：`die` 构建、`small`，`dontstarve/common/deathpoof`，棕色 `tint`），换用 `ghost` bank 与 `ghost_waxwell_build`，进入 `SGwilsonghost`（`appear` → `idle`，`run` 沿用 `idle` 循环，`hit` 由 `attacked` 触发，`ghost_howl` 两层并发），加 `playerghost` 标签、`GHOST_LIGHT_OVERRIDE` = .5 与 `(180, 195, 225)/255`、强度 .6、半径 .5、衰减 .6 的光源，`MakeGhostPhysics`（只与地面碰撞，穿过障碍），并按 `CommonPlayerDeath` 移除 `slipperyfeet`、设无敌且不可治疗、理智 50%、饥饿 2/3，生命设为 `RESURRECT_HEALTH` = 50，`player_classified:SetGhostMode` 对应 `playerGhostMode`（驱动 `ghost_cc` 色彩立方体）。存档在 `players.local.ghost` 写 `is_ghost`，读档按 `loading` 恢复：不生成骷髅和 `die_fx`、跳过 `appear`、保留已保存的数值。幽灵无任何 action handler，不能跳跃、合成、表情和使用物品；`haunt`、`dissipate`、`talk`、`remoteresurrect`、`migrate`、`rewindtime` 状态、复活、死亡公告和 `playercorpse` 分支未接入。素材 `skeletons.zip`、`die.zip`、`ghost_waxwell_build.zip`、`player_ghost_withhat.zip` 与 `common.fsb-187.wav`、`ghost.fsb-12..19.wav` 已按 FEV（`common/deathpoof` sounddef 476、`ghost/ghost_howl` sounddef 1889 / 1891）核对。命令、骷髅敲碎掉落、保存／恢复与死亡转幽灵纳入验证（`packages/animation/tests/skeleton.test.ts`、`packages/ui/tests/player_ghost.spec.ts`）。


2026-10-17 补充 `cave_entrance`、`cave_entrance_open`：`prefabs/cave_entrance.lua` 的两个世界实体没有 inventoryitem，只可 `c_spawn`。封闭入口使用 `anim/cave_entrance.zip`（`idle_closed` / `med` / `low`），`workable` 为 `MINE`（`TUNING.ROCKS_MINE` = 6），完成后播放 `rock_break` 音效，掉落 `rocks`×2、`flint`×3，并在同一位置生成 `cave_entrance_open`（`no_access` 循环、`LAYER_BACKGROUND`、小地图 `cave_open.png`）。`cave_entrance_open` 带 `worldmigrator`（`packages/componets/src/worldmigrator.ts`，目的地 `Caves`，`migration_available` 切到 `open`、`migration_unavailable` 切到 `no_access`、`migration_full` 切到 `over_capacity`，`migrator` 标签随 ACTIVE），左键 `MIGRATE`（`packages/stategraphs/src/migrate.ts`，SGwilson `migrate` 状态）经场景注入的 `shard.migratePlayer` 重载页面到同目录的 `Caves.json`；迁移时地表存档、玩家物品与状态、计时器及 `childspawner`（蝙蝠）暂未处理，`cave_entrance_ruins` 未实现。命令、开采、掉落与保存 / 恢复由 `packages/animation/tests/cave_entrance.test.ts` 验证。


2026-10-17 补充 `firestaff`：`prefabs/staff.lua` 的 `red()`（tags `firestaff`、`weapon`、`rangedweapon`、`rangedlighter`，`FIRESTAFF_USES` = 20，`weapon:SetRange(8, 10)`，投射物 `fire_projectile`），可 `c_give` / `c_spawn`。右键可燃物触发 `ACTIONS.ATTACK`（`RANGEDLIGHT`，文案“点燃”），`SGwilson` 的 `attack` 状态使用 `projectiledelay`（1 帧）并在 `onupdate` 中发射；命中后 `onattack_red` 点燃 / 加燃料 / 解冻 / 唤醒目标并扣 `SANITY_SUPERTINY`。声音 `attack_firestaff`（sounddef 624 → `sfx.fsb-1261..1264`）、`fireball_explo`（sounddef 625 → `sfx.fsb-1260`）与 `fire_fail_fx` 的 `fireOut` 已核对。`c_save()` 保留物品身份、耐久和皮肤。`controlled_burner` 标签、`onhauntred` 作祟和 `firepen` 未接入。


2026-10-17 Wortox 灵魂跳跃 / 回声：核对 `prefabs/wortox.lua` 的 `GetPointSpecialActions`、`CanBlinkTo`、`TryToPortalHop`、`FinishPortalHop`、`OnSave/OnLoad`，`actions.lua` 的 BLINK 与 `stategraphs/SGwilson.lua` 三个 portal_jump 状态。按项目要求跳过库存灵魂数量判定，其余基础两跳／5 秒规则保留，未启用技能树。`prefabs/wortox_portal_fx.lua` 的 `wortox_portal_jumpin_fx` 和 `wortox_portal_jumpout_fx` 可 `c_spawn`，没有 inventoryitem，不能 `c_give`；bank `wilson`、build `wortox_portal`、对应同名去掉 `_fx` 的动画，FinalOffset 3，animover 后 2 帧移除，persists=false。两个特效均不入档，回声计数与玩家落点通过 `c_save()` 保存并重载。代表性覆盖见 `packages/animation/tests/wortox.test.ts` 与 `packages/ui/tests/wortox_soulhop.spec.ts`。

2026-10-17 补充 `cave_exit`：`prefabs/cave_exit.lua` 是没有 inventoryitem 的世界实体，只可 `c_spawn`。使用 `anim/cave_exit.zip`（`cave_stairs` bank、`cave_exit` build，两张 atlas，初始 `open` 循环；`no_access` / `over_capacity` 由 `worldmigrator` 事件触发，暂未接入），`MakeObstaclePhysics(inst, 2)`，小地图 `cave_open2.png`。存档只保留 ID 与位置；导入器接受原版 `worldmigrator` 的 `id/auto/linkedWorld/receivedPortal` 但不保存。`packages/animation/tests/cave_exit.test.ts` 验证渲染、障碍物理与保存 / 恢复。 2026-10-21 补充：`cave_exit` 带 `worldmigrator`（目的地 `Master`，`open` / `no_access` / `over_capacity` 随迁移事件切换），左键 `MIGRATE` 经场景注入的 `shard.migratePlayer` 重载到同目录的 `Master.json`；sprite 改由 `ResidentSprite` 随 tickingarea 加载。

2026-10-17 补充 `mushtree_moon`、`mushtree_medium`（及 `_stump`）：`prefabs/mushtree.lua` / `mushtree_moon.lua` 的世界实体，没有 inventoryitem，只可 `c_spawn`。月亮树使用 `anim/mushroom_tree_tall.zip`（bank `mushroom_tree`）与 `mutatedmushroom_tree_build.zip`，红蘑菇树使用 `mushroom_tree_med.zip`（bank `mushroom_tree_med`，开花 build 为 `mushroom_tree_med_bloom.zip`）；`swap_acidglob*` 符号隐藏。`MakeObstaclePhysics(inst, .25)`、本地光 `.8 / .5`、随机明暗（`SetMultColour`）、`workable` 为 `CHOP`（月亮 `MUSHTREE_CHOPS_TALL` = 15，红蘑菇 `MUSHTREE_CHOPS_MEDIUM` = 10），完成后 `makestump`（`DIG` 1 次，掘出 `log`，30 天后腐烂）。红蘑菇树的 `growable` 为 `growonly` + `loopstages`（`Growable.growonly` 与 Lua `DoGrowth` 一致：只运行 `growfn`，14 帧后由预制体 `SetStage`），夏季随机延迟后切换到 bloom build，存档保留 `treestate`。音效：`use_axe_mushroom`（sfx 1253–1255）、`treefall`（等同 FEV `treeFall`）、`cave/mushtree_tall_grow_1..3` 与 `_shrink`（together 291–305），均由 `-i` 导出并与源目录已有 WAV 字节一致。`moon_cap` 尚无地面物品，掉落时跳过（同月亮树的做法）；`periodicspawner` 孢子、`acidinfusible`、`plantregrowth`、`simplemagicgrower` 暂未移植。命令、砍伐 / 掘桩 / 开花与保存 / 恢复由 `packages/animation/tests/mushtree.test.ts` 验证。

2026-10-17 补充月亮洞穴水池：`prefabs/grotto_pool_big.lua`、`grotto_pool_small.lua`、`grotto_pool_moonglass.lua` 和 `grotto_waterfall_small.lua` 共 8 个世界 prefab，只可 `c_spawn`（无 inventoryitem）：`grotto_pool_big`、`grotto_pool_small`、`grotto_moonglass_1/3/4`、`grotto_waterfall_big`、`grotto_waterfall_small1/2`。池面用 `anim/moonglasspool_tile.zip`（bank/build `moonglasspool_tile`，`idle` / `smallpool_idle`），OnGround、LAYER_BACKGROUND、排序 3；雾气 FX 为 `anim/moonglass_bigwaterfall_steam.zip`（`steam_big` / `steam_small1|2`，LightOverride .5）；瀑布和玻璃为 `anim/moonglass_bigwaterfall.zip`，起始帧随机。每个池带 `Light`、`MakeObstaclePhysics`（TUNING.GROTTO_POOL_BIG_RADIUS 5.5 / SMALL 2）、`watersource` 标签和小地图图标 `grotto_pool_big.png` / `grotto_pool_small.png`，`DoTaskInTime(0)` 按 `prefab_layout` 生成缺失的子物件（读档时先按保存的 ID 与索引接回）；移除池会按相反顺序移除子物件。可开采的玻璃和小瀑布 `MINE` 6 次（`workable.savestate = true`），完成时播放 `rock_break_fx` 的 `rock_break` 声，按 `moonglass_prop`（1、1、.5）／`smallfalls`（1、.5）在挖掘者脚下掉 `moonglass`，随后 `*_mined` 循环并去掉碰撞半径、加 `NOCLICK`；`iscavefullmoon` 每次变化有 10% 概率恢复（`halloween_moonpuff`，`moon_tea_fx.zip` 的 `fx_moon_tea/puff`，FinalOffset 3，`fireAddFuel` 声）。当前仍用地表的月相与昼夜判断洞穴满月，没有独立的洞穴时钟。`grottowaterfallsoundcontroller.lua` 对应的 `grotto/common/waterfall_LP`（grotto.fev：sounddef 41 + 99，`grotto_sfx` 提取索引 557 和 545–556）由 `GrottoPoolManager` 按最近 3 个池（40 单位内）分配循环音源并淡入淡出。`moonglass` 物品（`c_give("moonglass", n)`，`anim/moonglass.zip` 的 `f1`，堆叠 40）作为战利品加入地面物品目录；随机 `f1`～`f3` 姿态、食用和 `moonglass_charged` 暂未接入。动画侧：`findImage` 现在让超出 build 最后一帧的索引循环（`moonglasspool_tile` 用 34 帧贴图跑 140 帧动画）。`packages/animation/tests/grotto_pool.test.ts` 覆盖生成、子物件、开采掉落、`c_save()` 保存／恢复和 Caves 存档解析。

2026-10-17 补充 `mushtree_tall`、`blue_mushroom`：`mushtree_tall` 与 `mushtree_medium` 同属 `prefabs/mushtree.lua`，使用 `mushroom_tree_tall.zip`（bank `mushroom_tree`，开花 build 为 `mushroom_tree_tall_bloom.zip`）、小地图 `mushroom_tree.png`、`MUSHTREE_CHOPS_TALL` = 15、掉落 `log`×2 与 `blue_cap`、冬季开花、带 `webbable` 标签；`WatchWorldState("is"..season)` 只通知树自己的季节（进入时开花，离开时恢复）。`blue_mushroom` 来自 `prefabs/mushrooms.lua`：`mushrooms.zip`（bank/build `mushrooms`），`pickable` 无定时再生（`regrowTime` 为空），采后 `rain = 10 + math.random(10)`，每 `SEG_TIME` 周期在下雨时减 1，归零时 `Regen`；`open_time = night`，进入夜晚后 3–9 秒播放 `open_inground` → `open_blue` → `blue` 并允许采摘，离开夜晚后 `close_blue` → `inground`；`workable` 为 `DIG`（已采 1 个、未采 2 个 `blue_cap`）、`MakeSmallBurnable` / `MakeSmallPropagator`。音效 `mushroom_up` / `mushroom_down`（common 224–226 / 221–223）已用 `-i` 导出并与源 WAV 字节一致。项目尚无独立的洞穴时钟，"洞穴夜晚"取世界时钟的夜晚；`AddToRegrowthManager`、`hauntable` 与 `transformer`（Lua 中已注释）未移植。`packages/animation/tests/mushroomPlant.test.ts`、`mushtree.test.ts` 验证命令、采摘 / 掘取 / 再生 / 开花与保存 / 恢复。


2026-10-18 岩石实例化与开采：核对 `prefabs/rocks.lua`、`cavein_boulder.lua`、`moonrockseed.lua`、`components/workable.lua`、`actions.lua` 的 MINE、`SGwilson.lua` 的 mine_start/mine 和 `simutil.lua:ErodeAway`。八种矿石均接入统一的 `MINE` 工具动作；`rock_moon`（`rock7.zip`，bank `rock5`）与 `rock_moon_shell`（`moonrock_shell.zip`）需 6 次，按剩余工作量切换 full/med/low；`cavein_boulder`（bank `cavein_boulder`，build `swap_cavein_boulder`）需 3 次，保持 idle 外形，raised 时禁用 workable。按源表分别掉落 rocks/flint/moonrocknugget；落石使用自己的 rocks/rocks/.4 rocks/.1 flint 表，formed 且玩家处于 working 状态时按 LaunchAt 向玩家抛出。月岩壳先掉矿物，workfinished 再同步生成一个预载的 `moonrockseed`，加 NOCLICK，播放 break，2 秒后侵蚀 1 秒再移除；壳立即停止入档，任务由 ComponentTimer 和游戏时间调度器持有，移除实体取消任务。`moonrockseed` 仍仅显示 `moonrock_seed.zip` 的 idle 静态美术，保留 irreplaceable/nonpotatable/celestial_station，不添加开采或其他交互。所有存活矿石的 workable 均不保存进度，落石保留外形编号 1–8 与 raised/formed；搬运和组合落石不在此次开采范围。`c_spawn("cavein_boulder")`、`c_spawn("rock_moon")`、`c_spawn("rock_moon_shell")`、`c_spawn("moonrockseed")` 的 ID 和无额外参数的语法不变，未开放重物／宝球的 c_give。共享 archive sprite 的 InstancedMesh 保留各实体明暗、拾取和侵蚀状态。`rockArt.test.ts`、`rockMining.test.ts`、`pickaxe.test.ts`、`rock-sprite.spec.ts`、`rock-mining.spec.ts` 验证资源、开采提交／取消、掉落、壳移除、实例侵蚀和 c_save 导出／重载后的宝球及矿物；资源由 `import-rocks.py --check` 校验原路径与字节。

2026-10-18 补充 `cave_fern`、`cave_fern_withered`：`prefabs/cave_fern.lua` / `cave_fern_withered.lua` 是没有 inventoryitem 的世界实体，只可 `c_spawn`，没有 `c_give`。bank `ferns`，动画来自 `anim/cave_ferns.zip`，build 分别为 `cave_ferns` 和 `cave_ferns_withered_build`（`anim/cave_ferns_withered_build.zip`）；生成时从 `f1`～`f10` 随机选姿态，OnSave/OnLoad 以 `data.anim` 保存。`pickable` 为 `SetUp("foliage" / "cutgrass", 10)`，`quickpick = true`、`remove_when_picked = true`，`picksound` `dontstarve/wilson/pickup_plants`（`dontstarve.fev` sounddef 83 → wilson file_index 66，vgmstream `-s 67`）；没有 `workable`，铲子不能挖。`MakeSmallBurnable` + `MakeSmallPropagator`，烧毁留灰烬。存档保留 ID、位置和姿态（`components.variant.anim`），采摘后不再保存；导入器 `ENTITY_WHITELIST` 已接受两者。

2026-10-18 补充 `houndbone`：`prefabs/houndbone.lua` 的世界实体没有 inventoryitem，只可 `c_spawn`，没有 `c_give`。bank `houndbase`、build `hound_base`（`anim/hound_base.zip`），带 `bone` 标签；`math.random(#names)` 选 `piece1`～`piece3`，OnSave 写 `bonetype`（旧存档的 `anim` 字段不再写出）。`workable` 为 `HAMMER`、1 次，`onhammered` 调 `DropLoot`：共享表 `houndbone` 必掉 `boneshard`，`bonetype == 3` 时另加 `AddChanceLoot("houndstooth", .5)`，再播放 `collapse_small`（`rock` 材质）并移除。`lootdropper` 补充 `AddChanceLoot` / `ClearChanceLoot`。无物理体、无燃烧。存档保留 ID、位置与 `bonetype`；导入器 `ENTITY_WHITELIST` 已接受。

2026-10-18 补充 `flower_cave`、`flower_cave_double`、`flower_cave_triple`、`lightflier_flower` 的区域导入：这些 prefab 已有 `c_spawn` / 存档支持，命令与支持 ID 不变；导入器新增的转换函数按 `OnSave` 的 `light_state`、`plantname`、`pickable.picked/time`、`timer` 与 `childspawner` 转为 `bulbPlant` / `lightflierFlower` 组件。

2026-10-18 补充 `red_mushroom`、`green_mushroom`：与 `blue_mushroom` 同属 `prefabs/mushrooms.lua` 的 `mushcommonfn(data)`，仅 `animname` / `pickloot` / `open_time` 不同——红：`red` / `red_cap` / `day`，绿：`green` / `green_cap` / `dusk`。共用 `mushrooms.zip`（bank/build `mushrooms`）、`mushroom_up` / `mushroom_down` 音效、采后下雨再生、`DIG` 与燃烧，沿用 `MushroomPlant` 行为类并改由数据表选择；管理器 `spawn` 接收 prefab ID，`exportRecords` 保存各自的 `prefabId`。未移植 `hauntable`（`OnHauntMush` 换色）、`transformer`（Lua 中已注释）与 `AddToRegrowthManager`。`packages/animation/tests/mushroomPlant.test.ts` 验证红蘑菇白天可采、绿蘑菇黄昏后可采、各自产出对应帽并在保存记录中保留 prefab ID。

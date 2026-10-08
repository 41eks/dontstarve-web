# dontstarve-web

https://41eks.github.io/dontstarve-web/

场景实体后续的活动区域与资源管理方案见 [按 tile 管理生命周期](docs/tile-lifecycle.md)：每个 tile 持有活动 signal，玩家跨 tile 时更新区域差集，prefab 用 `createMemo` 派生活动状态。该方案尚未接入运行时。


## 调试命令（debugCommand）

`c_give("backpack")` 获取背包，第二个参数为数量（默认 `1`，例如 `c_give("backpack", 2)`），每个占一格。拖到身体装备槽或右键背包即可装备，角色显示 `swap_backpack.zip` 的原版外观；右侧播放 `anim/ui_backpack_2x4.zip` 的 `open` 动画并显示 2 列 × 4 行的 8 个储物格，可与物品栏、其他容器拖放物品，材料可用于制作。Shift + 右键丢弃时使用原版 `anim/backpack.zip` 的 bank `backpack1`、`anim` 地面姿态和 `anim/swap_backpack.zip` 的 build，点击可拾回。支持 36 个原版皮肤及其实际库存图标 atlas；可在制作面板选择皮肤，或装备清洁扫把右键地面背包循环换肤。拾回和重新装备保留皮肤，隐形皮肤仅隐藏穿戴外观，地面姿态仍可见。卸下时播放 `close` 并隐藏储物格，再次装备时恢复内容；当前储物格属于玩家，同一玩家的多个背包共用这些格子。皮肤、地面背包和格子内容随 `c_save()` 保存和恢复。

在游戏页面按反引号键（`Backquote`，通常与 `~` 共用）打开或关闭调试控制台，输入命令后按 `Enter` 执行。执行后控制台自动关闭；`Esc` 可关闭，`↑` / `↓` 可浏览最近 50 条历史命令。执行结果或错误显示在浏览器开发者工具的 Console 中。

| 命令 | 参数与作用 | 示例 |
| --- | --- | --- |
| `c_give("item_id", count)` | 向物品栏添加物品。`count` 可省略，默认 `1`，必须为正的安全整数；按堆叠上限分配。未知物品或物品栏空间不足时失败。 | `c_give("torch")`、`c_give("opalstaff")`、`c_give("pitchfork")`、`c_give("hammer")`、`c_give("meatballs", 10)` |
| `c_spawn("prefab_id")` | 生成一个当前支持的场景对象。建筑和墙生成在玩家前方，洞穴植物、萤火虫、伯尼、岩石、草、树苗、池塘、虫洞、留声机、唱片和梦魇疯长生成在玩家当前位置，皮弗娄牛生成在玩家附近的空地。 | `c_spawn("cookpot")`、`c_spawn("beefalo")`、`c_spawn("bernie_inactive")`、`c_spawn("rock1")`、`c_spawn("grass")`、`c_spawn("sapling")`、`c_spawn("pond")`、`c_spawn("wormhole")`、`c_spawn("nightmaregrowth")` |
| `c_save()` | 无参数。将当前游戏状态（包括挖过的地皮、耕地地皮和月岩多人传送门）校验后导出并下载为 `initial-world.json`，同时在画面上方偏右显示原版 `anim/saving.zip` 的保存动画（`save_pre` → `save_loop` → `save_post`），结束后隐藏；保存超过 0.5 秒显示“正在保存…”。快速保存也会完整播放一轮动画；校验失败时结束提示，并在浏览器 Console 报告“保存失败”及具体字段路径，下载不会开始。要作为初始存档加载，将下载文件放到 `public/saves/initial-world.json` 后重新加载页面。 | `c_save()` |
| `c_setsanity(percent)` | 设置 Wilson 的理智比例；`percent` 为必填的 `0` 到 `1` 数字（上限 200），同步状态栏和低理智滤镜，并随 `c_save()` 保存。调色按每 10% 一档四舍五入；实际理智、晃动速度和幅度保留连续值。 | `c_setsanity(0)`、`c_setsanity(0.175)`、`c_setsanity(1)` |

命令支持单引号或双引号、英文或中文括号（也可混用）、额外空白及末尾分号；`c_give` 的参数分隔符也支持中文逗号。每次提交一条命令。

玩家动作控制器统一由 `@dontstarve-web/stategraphs` 导出，实现在 `packages/stategraphs/src`：锤击、采矿、捕虫、铲地、园艺锄耕坑、铲垃圾、种子交互、换肤及法杖施法输入。`src/main.ts` 将物品栏状态、移动、动画和目标操作接口接入控制器；`packages/prefab` 负责工具美术、目标实体与特效，`SGwilson` 负责动作状态和提交帧。


物品现在按 Lua 的 `Inventory:GiveItem/Equip/DropItem` 与 `Stackable:Get/Put` 交接实体：背包、装备槽和地面持有同一物品实体，整件转移、拾取、丢弃和换肤保留 ID 与组件；拆堆创建新实体，合堆保留接收方实体。火把控制器随实体保留，卸下只停止燃烧，耗尽才移除实体。`c_save()` 的库存物品快照新增可选 `entityId`，地面仍保存记录 `id`；旧存档缺少物品 ID 时自动分配。`c_give`、`c_spawn` 和 `c_save` 的语法、参数和支持 ID 保持不变，细节见 [库存架构](docs/inventory-architecture.md)。

`c_give("torch", 2)` 获取两把满耐久火把，每把占一格；`c_spawn("torch")` 在玩家脚下生成可拾取的满耐久火把。物品栏、装备槽和储物格在图标下方显示燃料百分比，按原版 `widgets/itemtile.lua:SetPercent()` 四舍五入，未耗尽时最低显示 `1%`。基础燃料为 `TUNING.TORCH_FUEL = 75` 秒，由 torch prefab 的 `onequip()` / `onunequip()` 管理燃烧：装备到手部时点燃并消耗，卸下或普通丢弃后停止；耗尽时由 torch 移除物品，清除手持外观和照明。燃料随转移、丢弃、拾取、清洁扫把换肤及 `c_save()` 保存恢复；旧存档未记录燃料的火把按满耐久加载。燃料每 60 个燃烧帧结算一次，扣减这段时间累计的实际 `dt`，UI 随结算刷新；转移、丢弃、拾取、换肤、熄灭和 `c_save()` 前会结算不足 60 帧的部分，保留已经消耗的燃料。当前使用基础燃烧速率，尚未接入雨水、技能加成和投掷后持续燃烧。

手部装备变化在库存事务成功提交后发布到 [packages/signals](packages/signals/README.md) 的客户端共享 `handEquipmentState`，同时携带对应的物品实体引用。先在 `src/playerHandEquipment.ts` 注册共享 signal 的订阅，再由 `InventoryStore.replaceState()` 恢复存档并写入 signal；该次写入直接触发装备生命周期和手持动画，订阅注册时不回放当前值，也没有单独的初始同步。后续变化使用同一订阅，通过 prefab 注册表依次执行旧装备卸下、新装备装备，并接入手持外观、照明和光标。`main.ts` 只接入订阅器的帧更新、结算、成功转移动画和释放。燃料及其他库存更新不重新发布装备。prefab 的 `onequip(handEquipmentState)` 接收具体槽位，torch 通过独立的 `burning` signal 同步照明，`extinguish()` 校验装备引用后清空绑定槽位；`onunequip()` 和释放停止燃烧并解除绑定，不修改槽位值。地面火把没有槽位绑定，熄灭不会修改玩家装备。耗尽同时移除库存物品；未耗尽时显式熄灭保留库存燃料。旧 torch 不会清空新装备。signal 不写入存档；UI 操作、命令及读档仍由库存提交装备结果。

手部 signal 的非空值必须声明 `EQUIPSLOTS = "HANDS"`，同时受 TypeScript 类型和 setter 运行时校验限制；身体装备或缺少槽位声明的对象不能写入。torch 公开只读的 `EQUIPSLOTS: "HANDS"` 属性。`c_give`、`c_spawn` 和 `c_save` 的命令参数及支持 ID 不变。

火把点燃播放原版 `dontstarve/wilson/torch_swing`（两段样本随机选择），卸下、燃尽或成功拾取正在燃烧的地面火把时播放一次 `dontstarve/common/fireOut`。`OnPutInInventory()` 恢复 `idle`、停止燃烧与地面音源，保留剩余燃料和皮肤；普通未点燃火把拾取不播放熄灭声。地面实体接收 `onextinguish` 事件后调用 `OnExtinguish()`：熄灭照明、恢复 `idle`，按 Lua 的小范围随机水平速度和向上速度弹离地面，保留燃料、实体 ID 与皮肤，不修改玩家手部装备。声音在装备或生成前预加载，真实鼠标或键盘输入恢复音频上下文。

地面燃烧状态保存到 `ground_item.components.torch.lit`，剩余燃料仍保存在 `stack.remainingFuel`；换肤保留燃烧和最新燃料，读档恢复燃烧但不重播点燃声。`c_spawn("torch")` 和普通丢弃仍生成未点燃火把。当前接入这两个回调及地面照明/弹跳，不包含投掷输入、飞行/插地动作、雨水/技能修正及原版火焰粒子；外部游戏逻辑可通过地面模型的 `userData.torch.ignite()` 点燃，通过 `onextinguish` 事件熄灭。

原版 Lua 中哪些 prefab 可用 `c_spawn`、哪些可通过 `c_give` 入栏，见 [prefab 命令静态核对表](docs/dst-prefab-console.md)。该表记录源码调查结果；本项目当前支持的 ID 以本文下方对象列表及物品定义为准。

低理智滤镜使用原版 `images/colour_cubes/insane_day_cc.tex`、`insane_dusk_cc.tex` 和 `insane_night_cc.tex`，按昼夜与季节调色同步渐变。调色将理智比例四舍五入到最近的 10% 档位（0%、10%、…、100%），再按 `colourcube.lua` 的平方曲线计算 `(1 - 档位比例)²`；例如 `c_setsanity(0.175)` 保留理智 35/200，调色按 20% 计算，强度为 0.64；`c_setsanity(0.149)` 按 10% 计算，强度为 0.81。原版 Lua 的曲线未作这种分档。世界画面边缘按 `postprocess_distort.ksh` 晃动，速度和幅度仍使用实际理智比例，速度为原版扭曲系数 `1` 时的一半，中心保持稳定；HUD 不受滤镜影响。旧存档未提供理智时沿用状态栏的 35/200，`c_setsanity(1)` 可恢复满理智画面。

调色资源由 `src/main.ts` 显式调用 `DstLightingRenderer.create()` 并行加载，完成后通过 `game:lighting-ready` 事件发布实例，`src/universal.ts` 接收后供场景使用。场景在事件完成后启动；加载失败会中止启动。单独导入 `universal.ts` 不会请求调色资源或读取存档。




`c_give("bernie_inactive")` 获取伯尼，数量可指定为 `c_give("bernie_inactive", 2)`，每只占一格。Shift + 右键物品槽放到地面，也可用 `c_spawn("bernie_inactive")` 直接在玩家位置生成。地面形态按玩家实际理智比例切换：低于 15%（Wilson 理智低于 30/200）显示 `bernie_big`，其余显示 `bernie_active`；`c_setsanity(0.1)` 和 `c_setsanity(0.175)` 可验证两种形态。变大播放大伯尼的 `activate`；变小依次播放大伯尼的 `deactivate`、`deactivate_pst` 和小伯尼的 `activate`。起身结束后先播放 0.5 秒 `idle_loop_nodir`，保留播放时间切回 `idle_loop`。变身期间再次改变理智，会在当前动画流程完成后按最新理智切换。使用原版 `bernie.zip` / `bernie_big.zip` 动画和共享 `bernie_build.zip`，大伯尼保持 Lua 的 0.7 缩放，支持艾希莉、小火花两种皮肤。点击任一形态拾回时立即取消动画，仍为 `bernie_inactive`；位置、实体 ID、皮肤和物品数量随 `c_save()` 保存，恢复时根据玩家理智直接显示待机形态。当前按请求让 Wilson 也能触发两种地面形态，实现待机、大小切换动画与拾取，不包含原版 Willow 限制、技能、跟随、战斗、耐久和变身冷却。




用 `c_spawn("icebox")` 或 `c_spawn("treasurechest")` 生成冰箱或木箱后，走近并左键点击可打开，再次点击关闭。开关动画开始时分别播放原版 `dontstarve/common/icebox_open` / `icebox_close` 或 `dontstarve/wilson/chest_open` / `chest_close`；走远自动关闭时也播放关闭声。恢复存档时不重放开门声。

`c_spawn("moonbase")` 在玩家前方生成月亮石，使用原版 `anim/moonbase.zip` 的 bank/build `moonbase` 和初始 `med` 破损姿态，默认不发光；位置随 `c_save()` 保存并在加载时恢复。当前支持生成与显示，尚未接入修复、插入魔杖和满月充能交互。

`c_spawn("wardrobe")` 在玩家前方生成衣柜，使用原版 `anim/wardrobe.zip` 的 bank/build `wardrobe` 和 `closed` 外观。当前仅实现贴图显示，无开关门、换装或锤击交互；位置随 `c_save()` 保存并在加载时恢复。


`c_give("reskin_tool")` 获取清洁扫把，数量可用第二个参数指定，例如 `c_give("reskin_tool", 2)`；每把占一格。支持原版物品图标、手部装备外观、4 个皮肤，以及 Shift + 右键丢弃和点击拾回。装备到手部后，右键有可用皮肤的建筑或地面物品进行换肤，超出施法距离时自动走近；按当前支持的皮肤目录循环，最后回到基础外观。玩家按原版 `veryquickcastspell` 播放 `anim/player_attacks.zip` 的 `atk_pre → atk`，开始时播放挥动声，第 9 帧提交换肤并在目标位置播放 `reskin_tool_fx.zip` 的 `puff` 及换肤音效；清洁扫把的 4 个皮肤使用各自的特效外观，幽灵画笔使用独立音效。移动、跳跃、左键、Esc、卸下或更换扫把可取消未提交的换肤；取消后不出现换肤特效或结果音效。换肤保留实体 ID、位置、物品数量及容器内容，皮肤随 `c_save()` 保存和恢复；暂不处理背包内目标、角色胡须及原版皮肤所有权筛选。

锤子可用 `c_give("hammer")` 获取，每格只能放一把，拖到手部装备槽后显示原版手持外观。Shift + 右键物品槽可放到地上，点击地面锤子可拾回。用 `c_spawn("treasurechest")` 等命令生成建筑后，手持锤子右键建筑会自动走近并播放挥锤及对应受击动画，在 `pickaxe_loop` 第 7 帧播放原版 `dontstarve/wilson/hit`（两段样本随机选择）；移动、Esc 或卸下锤子可取消尚未命中的挥锤及音效。科技建筑 `researchlab`、`researchlab2`、`researchlab3`、`researchlab4` 按 Lua 需要 4 次成功命中：前三次播放 `hit` 后恢复靠近/待机动画，第四次触发 `onhammered`，按配方各材料的 50% 向上取整掉落物品，播放原版 `collapse_small` 木质坍塌特效和声音，并从场景、交互目标和存档中移除。材料按 `lootdropper.lua:FlingItem()` 逐件抛向随机方向，水平速度 `0–2`、向上速度 `8±4` 按场景比例换算，起点避开建筑碰撞半径；使用简化抛物线与落地弹跳，最后停在各自落点。飞行中也可拾取，保存当前地面位置，读档不重播抛出过程。可用 `c_spawn("researchlab")` 后手持锤子右键 4 次验证；未销毁的建筑读档后恢复 4 次锤击，符合 Lua workable 默认不保存进度的行为。其他建筑目前仍只播放受击动画和声音，保留容器状态；锤子暂不消耗耐久，营火没有 HAMMER 动作。

鹤嘴锄可用 `c_give("pickaxe")`（或 `c_give("goldenpickaxe")`）获取，拖到手部装备槽后显示原版手持外观。用 `c_spawn("rock1")` 等命令生成岩石后，手持鹤嘴锄右键岩石会自动走近并播放 `anim/player_actions_pickaxe.zip` 的开采挥镐动画，在 `pickaxe_loop` 第 7 帧触发岩石受击脉冲及原版 `dontstarve/wilson/use_pick_rock`；两种鹤嘴锄使用同一音效。移动、Esc 或卸下鹤嘴锄可取消尚未命中的开采及音效。当前播放动画和声音，不消耗工具、不减少岩石状态、不破坏岩石或掉落物品。

干草叉可用 `c_give("pitchfork")`（或 `c_give("goldenpitchfork")`）获取，每格一把。拖到手部装备槽后，右键地面会自动走近目标地皮中心，播放 `anim/player_actions_shovel.zip` 的 `shovel_pre` → `shovel_loop` → `shovel_pst`，在动作开始后第 25 帧将整格地皮改成 `WORLD_TILES.DIRT`（原版泥土贴图）；猪王周围的木地板也可挖，泥土不可重复挖。移动、跳跃、左键、Esc 或卸下工具可取消尚未完成的挖地。支持原版地面和手持外观及皮肤；Shift + 右键物品槽可丢弃，点击地面物品可拾回。挖地变化会随 `c_save()` 保存并在加载时恢复；当前不消耗耐久或生成挖出的地皮物品。




`c_spawn("phonograph")` 在玩家当前位置生成留声机；`c_give("phonograph", 2)` 获取两台，每台占一格。`c_give("record")` 获取唱片，`c_spawn("record")` 生成地面唱片。走近留声机后，右键物品栏中的唱片选择它，再左键留声机插入；插片播放 `open` → `play_loop`，旧唱片原样掉落。右键已装唱片的留声机开关播放，空机不能开启；播放 64 秒后回到 `idle` 并播放原版结束声。Esc、移动键或选择其他物品取消插片选择。左键地面留声机拾回时停止播放，保留唱片；Shift + 右键丢弃后保持关闭，可再右键开启。留声机和唱片均使用各自源动画及实际库存 atlas，不可装备。

装备清洁扫把后右键留声机，可循环原版 6 种皮肤（`decor_phonograph_cawnival`、`decor_phonograph_fantasy`、`decor_phonograph_hallowed`、`decor_phonograph_handmade`、`decor_phonograph_rose`、`decor_phonograph_western`）；地面唱片支持 4 种皮肤（`record_creepyforest`、`record_drstyle`、`record_efs`、`record_hallowednights`）及对应歌曲。换肤保留实体 ID、位置、已装唱片及播放进度。手持锤子右键留声机，一次成功命中即锤毁，掉出已装唱片并播放木质坍塌特效和声音。`c_save()` 保存地面位置、皮肤、库存中的已装唱片和地面播放剩余时间，读档按进度恢复；各留声机音源独立，拾取、锤毁和退出时停止。当前未接入农作物照料、家具摆放和内部 `SetRecord("balatro")` 变体。

`c_give("farm_plow_item")` 获取耕地机，第二个参数可指定数量，每台占一格、初始 4 次使用。左键物品栏中的耕地机进入部署预览，右键可种植的空地部署；预览和落点吸附到整格地皮中心（`TILE_SIZE = 12`），显示原版 `tile_outline` 使用的 `anim/gridplacer.zip`、bank/build `gridplacer`、`anim` 地皮边框。不能部署到已耕地地皮或有阻挡物的格子。成功部署时由物品实体的 `finiteuses.use(1)` 消耗一次使用，保存扣减后的完整物品快照；钻地 15 秒后将该格改为 `WORLD_TILES.FARMING_SOIL`（ID `47`），从快照折回物品，第 4 次用完后不再返还。`c_spawn("farm_plow_item")` 只生成 `idle_packed` 地面物品；`c_spawn("farm_plow")` 直接生成工作中的调试耕地机，完成后不返还物品。`c_save()` 将耕地机进度及完整物品快照保存到 `components.farmPlow.deployItem`，包含物品 ID、数量及组件状态；完成或被锤毁时恢复该快照，保留物品 ID 和剩余使用次数。地面物品加载成功前保留返还快照。旧存档的 `returnUses` 自动迁移；`c_spawn("farm_plow")` 的快照为 `null`。耕地结果及原地皮 ID 保存到 `world.map.tiles`，加载后恢复。

`c_give("farm_hoe")` / `c_give("golden_farm_hoe")` 获取园艺锄 / 黄金园艺锄，数量由第二个参数指定，每把占一格；`c_spawn("farm_hoe")` / `c_spawn("golden_farm_hoe")` 在玩家脚下生成可拾取的地面工具。地面美术分别使用 `anim/quagmire_hoe.zip` / `anim/goldenhoe.zip` 的 `idle`，基础图标均来自 `images/inventoryimages2.xml`；手持符号分别来自 `quagmire_hoe.zip:swap_quagmire_hoe` / `swap_goldenhoe.zip:swap_goldenhoe`。拖到手部装备后，右键耕地机生成的农田 tile，在鼠标落点耕坑，距离较远时自动走近；播放原版 `player_actions_till.zip` 的 `till_pre → till_loop → till_pst`，`till_loop` 第 11 帧生成 `farm_soil` 的 `till_rise → till_idle`。可重新整理破损坑或调整完整坑的位置，附近旧坑按原版坍塌规则移除或变为破损状态；普通地皮、杂物和已播种位置不允许耕坑。移动、跳跃、左键、Esc、卸下工具或切换物品取消未提交的动作。支持 Shift + 右键丢弃、左键拾回、现有清洁扫把换肤，以及皮肤和坑的 ID/位置随存档保存恢复。园艺锄支持 `farm_hoe_invisible`、`farm_hoe_rustic`；黄金园艺锄支持 `golden_farmhoe_garden`、`golden_farmhoe_invisible`，拟真皮肤隐藏手持工具。本次仅接入地面与手持美术和农田耕坑，不处理耐久或战斗。

`c_give("shovel")` / `c_give("goldenshovel")` 获取铲子 / 黄金铲子，数量可由第二个参数指定，例如 `c_give("goldenshovel", 2)`，每把占一格；`c_spawn("shovel")` / `c_spawn("goldenshovel")` 在玩家脚下生成可拾取的地面工具。地面分别使用 `anim/shovel.zip` / `anim/goldenshovel.zip` 的同名 bank/build 和 `idle`，基础物品图标均来自 `images/inventoryimages.xml`；手持资源分别为 `anim/swap_shovel.zip:swap_shovel` / `anim/swap_goldenshovel.zip:swap_goldenshovel`。拖到手部装备后，右键耕地机生成的农田 tile 上的垃圾（`farm_soil_debris`）自动走近，播放原版 `shovel_pre → shovel_loop → shovel_pst`，在 `shovel_loop` 第 15 帧挖掉该堆垃圾并显示 `dirt_puff`。按原版基础 25% 概率掉落一份材料，树枝 / 石头 / 燧石 / 硝石 / 金块权重为 40 / 25 / 20 / 10 / 5。清理保留农田地皮、坑、已播种实体和其他垃圾；移动、跳跃、左键、Esc、切换物品或卸下工具可取消未提交的挖掘。支持 Shift + 右键丢弃、左键拾回和现有清洁扫把换肤；铲子有 7 个原版皮肤，黄金铲子支持 `goldenshovel_invisible`、`goldenshovel_northern`，拟真皮肤隐藏手持工具。物品皮肤、地面实体 ID/位置/数量及垃圾清理结果随 `c_save()` 保存并恢复。本次仅实现两种铲子的美术、装备和农田垃圾清理，不处理耐久、战斗或其他挖掘目标。



`c_give("seeds", 10)` 获取种子，`c_spawn("seeds")` 在玩家脚下生成可拾取的原版地面种子（`anim/seeds.zip`，bank/build `seeds`，`idle`；物品图标来自 `images/inventoryimages.xml`）。Shift + 右键丢弃、左键拾回；右键物品栏种子播放 `quick_eat_pre → quick_eat`，第 12 帧消耗一粒并增加 4.6875 饥饿，上限 150，健康和理智不变。左键物品栏种子选中种植，鼠标跟随原版种子图标及剩余数量，种子仍保留在原槽；左键耕地机完成后农田 tile 上的完整坑（`farm_soil`）自动走近，在 `pickup → pickup_pst` 的第 6 帧消耗一粒，替换为原版 `farm_plant_randomseed`（`anim/farm_soil.zip` 的 `sow → sow_idle`）。正在耕地的坑、破损坑和空地不可种植；移动、跳跃、Esc、点击空地或切换物品取消未提交的操作，失败不消耗种子。`c_spawn("farm_plant_randomseed")` 直接生成播种后的外观；地面种子及已播种实体的 ID、位置和数量随 `c_save()` 保存并恢复。本次仅实现种子地面美术、进食和坑内播种，播种后保持种子阶段。


矮星与极光可分别用 `c_give("yellowstaff")`、`c_give("opalstaff")` 获取法杖后施放，寿命分别为 24 分钟、16 分钟。玩家位置每帧读取一次，所有星体共享该位置进行 XZ 距离判断。玩家在星体地面 XZ 距离 10 格（120 场景单位）内时，每 60 个有效游戏帧结算一次寿命，按累计实际 `dt` 扣减；附近的动画和光照脉动仍逐帧更新。远离时结算不足 60 帧的部分，将星体移出场景，销毁独立动画模型的网格并停止、断开音源，仅保留位置、实体 ID 和寿命等逻辑状态；同类星体共享的纹理和材质由管理器缓存，退出时统一释放。寿命按游戏时间继续流逝；再次靠近时先统一补算，已过期的直接清除逻辑状态，未过期的在原位置重建待机模型和独立循环音效，不重播出现动画或音效。`c_save()` 会补算所有星体（包括远处星体），保存实体 ID、位置和最新剩余时间，过期星体不写入存档；读档不重播出现音效。游戏暂停期间不扣寿命。

### c_spawn 支持的对象

`c_spawn("wormhole")` 在玩家当前位置生成虫洞，使用原版 `anim/teleporter_worm.zip` 的 bank `teleporter_worm` 和 `anim/teleporter_worm_build.zip` 的 build `teleporter_worm_build`。玩家进入 12 个场景单位内（原版 4 单位）播放 `open_pre` → `open_loop`，超过 15 个场景单位（原版 5 单位）播放 `open_pst` → `idle_loop`；距离只计算地面 XZ 平面。开口第 10 帧切入地面背景层，闭合第 4 帧恢复以地面原点排序的世界层，所有状态保持原版 billboard 朝向。用 `c_give("reskin_tool")` 获取清洁扫把并装备到手部，右键虫洞按 `wormhole_claw`、`wormhole_fantasy`、`wormhole_gothic`、`wormhole_lureplant`、`wormhole_spider`、`wormhole_worm` 顺序换肤，再回到默认外观；资源为原版 `anim/dynamic/wormhole_*.zip` / `.dyn`。换肤保留实体 ID、位置和当前动画进度；位置、实体 ID 和皮肤随 `c_save()` 保存，读档后根据玩家距离重新决定开闭。虫洞属于场景实体，通过 `c_spawn` 生成；当前不包含传送、配对、物品投喂或虫洞音效。

`c_spawn("multiplayer_portal_moonrock")` 在玩家当前位置生成月岩多人传送门，使用原版 `anim/portal_moonrock.zip` 的 bank `portal_moonrock_dst` 和 build `portal_moonrock`，`light`、`portalbg`、`spiralfx1` 符号覆盖自 `anim/portal_stone.zip`；FX 子实体隐藏 `portal` 层并覆盖 `FX_ray1`。循环播放 `idle_loop` 待机动画；每圈动画为 60 帧 / 2 秒，在第 0 帧（进入待机或循环回到起点）和第 30 帧各播放一次 `spawnportal_jacob` 鸟叫声；音效跟随动画实际跨过的帧触发，丢帧或大时间步进也不会使用独立计时器提前播放，移除实体时停止最近一次鸟叫。月岩传送门无环境循环音效（Lua `idle_loop = nil`）。位置和实体 ID 随 `c_save()` 保存，下载的存档加载后会恢复传送门及其 FX 子实体。当前仅实现外观与音效，不包含建造系统、月球商人或玩家传送。

用 `c_spawn("wall_stone")`、`c_spawn("wall_wood")`、`c_spawn("wall_hay")`、`c_spawn("wall_ruins")`、`c_spawn("wall_moonrock")` 或 `c_spawn("wall_dreadstone")` 生成建成墙；`wall_*_item` 别名仍生成建成墙。`c_give("wall_stone_item", 10)` 等命令获取可放置的墙物品，库存图标、掉落地面的 `idle` 动画与建成墙的 `half` 外观分别使用各自原版资源。装备 `c_give("reskin_tool")` 获取的清洁扫把，右键建成墙可按下表循环换肤，最后回到默认外观；原有地面墙物品也可换肤。放置带皮肤的墙物品会映射到对应的建成墙皮肤，保留正面/斜面随相机朝向切换、受击动画和绝望石墙的红色覆盖层。换肤保留实体 ID、地面落点及已保存的健康状态；建成墙皮肤随 `c_save()` 保存并恢复，旧的无皮肤墙存档仍可加载。档案馆墙 `wall_stone_2` / `wall_ruins_2` 和废料墙 `wall_scrap` 没有原版皮肤，不提供换肤。

| 建成墙 prefab_id | 皮肤循环顺序 |
| --- | --- |
| `wall_stone` | `wall_stone_an`、`wall_stone_ancient`、`wall_stone_ancient_alt`、`wall_stone_gothic`、`wall_stone_rose`、`wall_stone_shell`、`wall_stone_victorian` |
| `wall_wood` | `wall_wood_ornate` |
| `wall_hay` | `wall_hay_corn` |
| `wall_ruins` | `wall_ruins_thulecite`、`wall_ruins_thulecite2`、`wall_ruins_thulecite2_alt`、`wall_ruins_thulecite_alt`、`wall_ruins_victorian` |
| `wall_moonrock` | `wall_moonrock_victorian` |
| `wall_dreadstone` | `wall_dreadstone_relic` |

`c_spawn("grass")` 在玩家当前位置生成草丛，使用原版 `grass.lua` 的 bank `grass`（`anim/grass.zip`）与 build `grass1`（`anim/grass1.zip`），循环播放 84 帧 `idle`。当前仅实现贴图显示，不包含采集、挖掘、枯萎、冬季或变色蜥蜴变形；位置随 `c_save()` 保存并在加载时恢复。

`c_spawn("sapling")` 和 `c_spawn("sapling_moon")` 在玩家当前位置生成树苗，分别使用原版 `anim/sapling.zip` 与 `anim/sapling_moon.zip` 中与 prefab 同名的 bank 和 build，循环播放 80 帧 `sway`。当前仅实现贴图显示，不包含种植、采集、挖掘、枯萎、冬季停止生长或万圣节月亮形态转换；位置随 `c_save()` 保存并在加载时恢复。

`c_spawn("pond")` 在玩家当前位置生成池塘，使用原版 `anim/marsh_tile.zip` 的 bank/build `marsh_tile` 和循环 `idle` 动画，贴图平铺在地面上并绘制在角色下方。当前仅实现池塘外观，不包含交互、碰撞、鱼蛙生成、岸边植物或季节变化；位置随 `c_save()` 保存并在加载时恢复。

`c_spawn("nightmaregrowth")` 在玩家当前位置生成梦魇疯长，使用原版 `anim/nightmaregrowth.zip` 的 bank/build `nightmaregrowth`：主体显示 `idle`，地面裂纹显示 `crack_idle` 并随机旋转。当前仅实现外观；位置和裂纹朝向随 `c_save()` 保存并在加载时恢复。

| 类型 | prefab_id |
| --- | --- |
| 建筑 | `cookpot`、`firepit`、`icebox`、`treasurechest`、`tent`、`moonbase`、`wardrobe`、`dragonflychest`、`campfire`、`saltbox`、`nightlight`、`pighouse`、`mushroom_light`、`mushroom_light2` |
| 科技建筑 | `researchlab`、`researchlab2`、`researchlab3`、`researchlab4` |
| 墙 | `wall_stone`、`wall_stone_2`、`wall_wood`、`wall_hay`、`wall_ruins`、`wall_ruins_2`、`wall_moonrock`、`wall_dreadstone`、`wall_scrap`，以及各自的 `wall_*_item`（两种 ID 均生成建成的墙） |
| 洞穴植物 | `flower_cave`、`flower_cave_double`、`flower_cave_triple` |
| 岩石 | `rock1`、`rock2`、`rock_flintless`、`rock_flintless_med`、`rock_flintless_low` |
| 草丛 | `grass` |
| 树苗 | `sapling`、`sapling_moon` |
| 池塘 | `pond` |
| 场景装饰 | `nightmaregrowth`、`wormhole`、`multiplayer_portal_moonrock` |
| 耕地机及耕地装饰 | `farm_plow`、`farm_plow_item`（未部署物品）、`farm_soil`、`farm_soil_debris`、`farm_plant_randomseed`（播种后外观） |
| 种子地面物品 | `seeds` |
| 火把地面物品 | `torch` |
| 园艺锄地面物品 | `farm_hoe`、`golden_farm_hoe` |
| 铲子地面物品 | `shovel`、`goldenshovel` |
| 可拾取家具及唱片 | `phonograph`、`record` |
| 生物 | `fireflies`、`beefalo`、`bernie_inactive`（地面形态由理智决定） |

`c_give` 可用的物品 ID 由 [src/inventoryItems.ts](src/inventoryItems.ts) 汇总的物品定义决定；命令解析见 [src/debugCommands.ts](src/debugCommands.ts)，场景与存档共享 [src/prefabDefinitions.ts](src/prefabDefinitions.ts) 的 prefab 注册定义，统一声明持久化 ID、`c_spawn` ID/别名及组件校验规则；[src/sceneEntities.ts](src/sceneEntities.ts) 将创建、恢复、导出、更新和销毁绑定到同一份定义，由 [src/entityRegistry.ts](src/entityRegistry.ts) 调度。新增 prefab 无需再维护存档 ID 白名单；启动时会检查共享定义是否都已绑定场景处理函数。`c_spawn` 的支持 ID 来自定义的 `debugSpawnIds`，落点规则由对应创建函数决定。

# dontstarve-web

https://41eks.github.io/dontstarve-web/

首页保留 Hamlet 主菜单的展示内容；点击“论坛”打开项目介绍、Klei 社区和项目反馈链接，可用“关闭”按钮或 `Esc` 返回。介绍内容直接写在 `index.html` 的原生 `dialog` 中，构建后的初始 HTML 即可读取，无需等待动画加载。首页标题、描述、canonical 和分享元信息也在 `index.html` 中；`public/sitemap.xml` 仅列出首页，可在站长工具中提交 `https://41eks.github.io/dontstarve-web/sitemap.xml`。更换部署域名或路径时，同步修改 canonical、`og:url` 与 sitemap 的地址。生产构建显示首页，开发模式仍直接进入游戏。

右上角世界时钟使用原版 `clock_transitions.zip`、`moon_phases_clock.zip` 和 `moon_phases.zip`，按 `widgets/uiclock.lua` 的地表时钟逻辑跟随场景时间。当前世界使用默认 16 格、每格 30 秒：白天 300 秒、黄昏 120 秒、夜晚 60 秒；指针每 480 秒转一圈，白天跨格时播放太阳脉动，昼夜切换播放过渡动画，月相按原版 20 天周期变化。日期和指针从存档的 `world.elapsedSeconds` 恢复。

## 开发文档

开发约束见 [AGENTS.md](AGENTS.md)，实现说明与案例见：

- [DST 物品资产、地面外观与导入](docs/dst-item-assets.md)
- [Billboard 绘制顺序与墙朝向](docs/dst-billboard-rendering.md)
- [物品栏架构与交互](docs/inventory-architecture.md)
- [DST 音频提取与浏览器播放](docs/vgmstream-cli-guide.md)

## 调试命令（debugCommand）

`c_give("backpack")` 获取背包，第二个参数为数量（默认 `1`，例如 `c_give("backpack", 2)`），每个占一格。拖到身体装备槽或右键背包即可装备，角色显示 `swap_backpack.zip` 的原版外观；右侧播放 `anim/ui_backpack_2x4.zip` 的 `open` 动画并显示 2 列 × 4 行的 8 个储物格，可与物品栏、其他容器拖放物品，材料可用于制作。Shift + 右键丢弃时使用原版 `anim/backpack.zip` 的 bank `backpack1`、`anim` 地面姿态和 `anim/swap_backpack.zip` 的 build，点击可拾回。支持 36 个原版皮肤及其实际库存图标 atlas；可在制作面板选择皮肤，或装备清洁扫把右键地面背包循环换肤。拾回和重新装备保留皮肤，隐形皮肤仅隐藏穿戴外观，地面姿态仍可见。卸下时播放 `close` 并隐藏储物格，再次装备时恢复内容；当前储物格属于玩家，同一玩家的多个背包共用这些格子。皮肤、地面背包和格子内容随 `c_save()` 保存和恢复。

在游戏页面按反引号键（`Backquote`，通常与 `~` 共用）打开或关闭调试控制台，输入命令后按 `Enter` 执行。执行后控制台自动关闭；`Esc` 可关闭，`↑` / `↓` 可浏览最近 50 条历史命令。执行结果或错误显示在浏览器开发者工具的 Console 中。

| 命令 | 参数与作用 | 示例 |
| --- | --- | --- |
| `c_give("item_id", count)` | 向物品栏添加物品。`count` 可省略，默认 `1`，必须为正的安全整数；按堆叠上限分配。未知物品或物品栏空间不足时失败。 | `c_give("torch")`、`c_give("opalstaff")`、`c_give("pitchfork")`、`c_give("hammer")`、`c_give("meatballs", 10)` |
| `c_spawn("prefab_id")` | 生成一个当前支持的场景对象。建筑和墙生成在玩家前方，洞穴植物、萤火虫、伯尼、岩石、草、树苗、池塘、虫洞和梦魇疯长生成在玩家当前位置，皮弗娄牛生成在玩家附近的空地。 | `c_spawn("cookpot")`、`c_spawn("beefalo")`、`c_spawn("bernie_inactive")`、`c_spawn("rock1")`、`c_spawn("grass")`、`c_spawn("sapling")`、`c_spawn("pond")`、`c_spawn("wormhole")`、`c_spawn("nightmaregrowth")` |
| `c_save()` | 无参数。将当前游戏状态（包括挖过的地皮）导出并下载为 `initial-world.json`，同时在画面上方偏右显示原版 `anim/saving.zip` 的保存动画（`save_pre` → `save_loop` → `save_post`），结束后隐藏；保存超过 0.5 秒显示“正在保存…”。快速保存也会完整播放一轮动画；失败时结束提示并报告错误。要作为初始存档加载，将下载文件放到 `public/saves/initial-world.json` 后重新加载页面。 | `c_save()` |
| `c_setsanity(percent)` | 设置 Wilson 的理智比例；`percent` 为必填的 `0` 到 `1` 数字（上限 200），同步状态栏和低理智滤镜，并随 `c_save()` 保存。调色按每 10% 一档四舍五入；实际理智、晃动速度和幅度保留连续值。 | `c_setsanity(0)`、`c_setsanity(0.175)`、`c_setsanity(1)` |

命令支持单引号或双引号、英文或中文括号（也可混用）、额外空白及末尾分号；`c_give` 的参数分隔符也支持中文逗号。每次提交一条命令。

低理智滤镜使用原版 `images/colour_cubes/insane_day_cc.tex`、`insane_dusk_cc.tex` 和 `insane_night_cc.tex`，按昼夜与季节调色同步渐变。调色将理智比例四舍五入到最近的 10% 档位（0%、10%、…、100%），再按 `colourcube.lua` 的平方曲线计算 `(1 - 档位比例)²`；例如 `c_setsanity(0.175)` 保留理智 35/200，调色按 20% 计算，强度为 0.64；`c_setsanity(0.149)` 按 10% 计算，强度为 0.81。原版 Lua 的曲线未作这种分档。世界画面边缘按 `postprocess_distort.ksh` 晃动，速度和幅度仍使用实际理智比例，速度为原版扭曲系数 `1` 时的一半，中心保持稳定；HUD 不受滤镜影响。旧存档未提供理智时沿用状态栏的 35/200，`c_setsanity(1)` 可恢复满理智画面。

调色资源由 `src/main.ts` 显式调用 `DstLightingRenderer.create()` 并行加载，完成后通过 `game:lighting-ready` 事件发布实例，`src/universal.ts` 接收后供场景使用。场景在事件完成后启动；加载失败会中止启动。单独导入 `universal.ts` 不会请求调色资源或读取存档。

地面物品通过 `GroundPrefabRegistry` 选择 prefab。各 prefab TS 自己导出 `createXXXGroundFactory(context)`，绑定地面 sprite 创建、专用缓存和捕获策略，并在自身 `model` 上监听 `ondropped`、`onputininventory`；应用的 `GroundItemManager` 只提供资源路径和世界上下文，在成功掉落、成功拾取（包括虫网捕获）后分发事件，失败的库存操作不触发事件。恢复存档和换肤使用 `onload` 初始化地面状态，不重放掉落效果。Bernie、提灯、荧光果、蝴蝶和萤火虫的行为分别定义在对应 prefab TS 中；移除实体时释放事件监听，管理器销毁时由注册表释放资源缓存。

通用地面动画的加载、bank/动画选择、皮肤与符号覆盖、模型创建和逐帧绘制位于 `packages/animation/src/archiveSprite.ts`。prefab 层传入资源定义，保留物品 ID、皮肤校验和库存事件；`createGroundItemSprite` 与 `GroundItemAssets` 的原有调用方式保持兼容。

点击地面物品拾取时，与木箱共用玩家距离规则：水平距离进入 9 个场景单位内（含边界）后允许拾取，超过 10 个单位后失效，重新靠近到 9 个单位内恢复。距离以物品脚点计算，忽略高度；每帧及点击转入库存前检查当前位置。距离过远或库存已满时，物品留在地面，不播放拾取动画或触发 `onputininventory`。规则适用于普通物品、帽子、伯尼及图标回退物品，包括从存档或命令生成的物品；虫网捕获继续使用原有捕获距离。

`c_give("bernie_inactive")` 获取伯尼，数量可指定为 `c_give("bernie_inactive", 2)`，每只占一格。Shift + 右键物品槽放到地面，也可用 `c_spawn("bernie_inactive")` 直接在玩家位置生成。地面形态按玩家实际理智比例切换：低于 15%（Wilson 理智低于 30/200）显示 `bernie_big`，其余显示 `bernie_active`；`c_setsanity(0.1)` 和 `c_setsanity(0.175)` 可验证两种形态。变大播放大伯尼的 `activate`；变小依次播放大伯尼的 `deactivate`、`deactivate_pst` 和小伯尼的 `activate`。起身结束后先播放 0.5 秒 `idle_loop_nodir`，保留播放时间切回 `idle_loop`。变身期间再次改变理智，会在当前动画流程完成后按最新理智切换。使用原版 `bernie.zip` / `bernie_big.zip` 动画和共享 `bernie_build.zip`，大伯尼保持 Lua 的 0.7 缩放，支持艾希莉、小火花两种皮肤。点击任一形态拾回时立即取消动画，仍为 `bernie_inactive`；位置、实体 ID、皮肤和物品数量随 `c_save()` 保存，恢复时根据玩家理智直接显示待机形态。当前按请求让 Wilson 也能触发两种地面形态，实现待机、大小切换动画与拾取，不包含原版 Willow 限制、技能、跟随、战斗、耐久和变身冷却。




用 `c_spawn("icebox")` 或 `c_spawn("treasurechest")` 生成冰箱或木箱后，走近并左键点击可打开，再次点击关闭。开关动画开始时分别播放原版 `dontstarve/common/icebox_open` / `icebox_close` 或 `dontstarve/wilson/chest_open` / `chest_close`；走远自动关闭时也播放关闭声。恢复存档时不重放开门声。

`c_spawn("moonbase")` 在玩家前方生成月亮石，使用原版 `anim/moonbase.zip` 的 bank/build `moonbase` 和初始 `med` 破损姿态，默认不发光；位置随 `c_save()` 保存并在加载时恢复。当前支持生成与显示，尚未接入修复、插入魔杖和满月充能交互。

`c_spawn("wardrobe")` 在玩家前方生成衣柜，使用原版 `anim/wardrobe.zip` 的 bank/build `wardrobe` 和 `closed` 外观。当前仅实现贴图显示，无开关门、换装或锤击交互；位置随 `c_save()` 保存并在加载时恢复。

`c_give("reskin_tool")` 获取清洁扫把，数量可用第二个参数指定，例如 `c_give("reskin_tool", 2)`；每把占一格。支持原版物品图标、手部装备外观、4 个皮肤，以及 Shift + 右键丢弃和点击拾回。装备到手部后，右键有可用皮肤的建筑或地面物品进行换肤，超出施法距离时自动走近；按当前支持的皮肤目录循环，最后回到基础外观。玩家按原版 `veryquickcastspell` 播放 `anim/player_attacks.zip` 的 `atk_pre → atk`，开始时播放挥动声，第 9 帧提交换肤并在目标位置播放 `reskin_tool_fx.zip` 的 `puff` 及换肤音效；清洁扫把的 4 个皮肤使用各自的特效外观，幽灵画笔使用独立音效。移动、跳跃、左键、Esc、卸下或更换扫把可取消未提交的换肤；取消后不出现换肤特效或结果音效。换肤保留实体 ID、位置、物品数量及容器内容，皮肤随 `c_save()` 保存和恢复；暂不处理背包内目标、角色胡须及原版皮肤所有权筛选。

锤子可用 `c_give("hammer")` 获取，每格只能放一把，拖到手部装备槽后显示原版手持外观。Shift + 右键物品槽可放到地上，点击地面锤子可拾回。用 `c_spawn("treasurechest")` 等命令生成建筑后，手持锤子右键建筑会自动走近并播放挥锤及对应受击动画，在 `pickaxe_loop` 第 7 帧播放原版 `dontstarve/wilson/hit`（两段样本随机选择）；移动、Esc 或卸下锤子可取消尚未命中的挥锤及音效。科技建筑 `researchlab`、`researchlab2`、`researchlab3`、`researchlab4` 按 Lua 需要 4 次成功命中：前三次播放 `hit` 后恢复靠近/待机动画，第四次触发 `onhammered`，按配方各材料的 50% 向上取整掉落物品，播放原版 `collapse_small` 木质坍塌特效和声音，并从场景、交互目标和存档中移除。材料按 `lootdropper.lua:FlingItem()` 逐件抛向随机方向，水平速度 `0–2`、向上速度 `8±4` 按场景比例换算，起点避开建筑碰撞半径；使用简化抛物线与落地弹跳，最后停在各自落点。飞行中也可拾取，保存当前地面位置，读档不重播抛出过程。可用 `c_spawn("researchlab")` 后手持锤子右键 4 次验证；未销毁的建筑读档后恢复 4 次锤击，符合 Lua workable 默认不保存进度的行为。其他建筑目前仍只播放受击动画和声音，保留容器状态；锤子暂不消耗耐久，营火没有 HAMMER 动作。

鹤嘴锄可用 `c_give("pickaxe")`（或 `c_give("goldenpickaxe")`）获取，拖到手部装备槽后显示原版手持外观。用 `c_spawn("rock1")` 等命令生成岩石后，手持鹤嘴锄右键岩石会自动走近并播放 `anim/player_actions_pickaxe.zip` 的开采挥镐动画，在 `pickaxe_loop` 第 7 帧触发岩石受击脉冲及原版 `dontstarve/wilson/use_pick_rock`；两种鹤嘴锄使用同一音效。移动、Esc 或卸下鹤嘴锄可取消尚未命中的开采及音效。当前播放动画和声音，不消耗工具、不减少岩石状态、不破坏岩石或掉落物品。

干草叉可用 `c_give("pitchfork")`（或 `c_give("goldenpitchfork")`）获取，每格一把。拖到手部装备槽后，右键地面会自动走近目标地皮中心，播放 `anim/player_actions_shovel.zip` 的 `shovel_pre` → `shovel_loop` → `shovel_pst`，在动作开始后第 25 帧将整格地皮改成 `WORLD_TILES.DIRT`（原版泥土贴图）；猪王周围的木地板也可挖，泥土不可重复挖。移动、跳跃、左键、Esc 或卸下工具可取消尚未完成的挖地。支持原版地面和手持外观及皮肤；Shift + 右键物品槽可丢弃，点击地面物品可拾回。挖地变化会随 `c_save()` 保存并在加载时恢复；当前不消耗耐久或生成挖出的地皮物品。



唤月者魔杖可用 `c_give("opalstaff")` 获取，数量可指定为 `c_give("opalstaff", 2)`，每把占一格。拖入手部装备槽后，右键地面施法，在第 13 帧播放原版 `dontstarve/common/staffteleport`，第 53 帧在点击位置召唤蓝色极光（`staffcoldlight`），照亮周围地面。使用原版 `anim/star_cold.zip` 的出现、三种待机与消失动画；极光持续 16 分钟，出现时播放 `staff_star_create`，存在期间播放 `staff_coldlight_LP` 的三层循环音效。卸下魔杖可取消尚未完成的召唤。支持原版图标、手持与地面外观、皮肤、Shift + 右键丢弃和点击拾回；魔杖及极光的落点、剩余寿命随 `c_save()` 保存并在加载时恢复。当前施法不消耗耐久或理智。

### c_spawn 支持的对象

`c_spawn("wormhole")` 在玩家当前位置生成虫洞，使用原版 `anim/teleporter_worm.zip` 的 bank `teleporter_worm` 和 `anim/teleporter_worm_build.zip` 的 build `teleporter_worm_build`。玩家进入 12 个场景单位内（原版 4 单位）播放 `open_pre` → `open_loop`，超过 15 个场景单位（原版 5 单位）播放 `open_pst` → `idle_loop`；距离只计算地面 XZ 平面。开口第 10 帧切入地面背景层，闭合第 4 帧恢复以地面原点排序的世界层，所有状态保持原版 billboard 朝向。用 `c_give("reskin_tool")` 获取清洁扫把并装备到手部，右键虫洞按 `wormhole_claw`、`wormhole_fantasy`、`wormhole_gothic`、`wormhole_lureplant`、`wormhole_spider`、`wormhole_worm` 顺序换肤，再回到默认外观；资源为原版 `anim/dynamic/wormhole_*.zip` / `.dyn`。换肤保留实体 ID、位置和当前动画进度；位置、实体 ID 和皮肤随 `c_save()` 保存，读档后根据玩家距离重新决定开闭。虫洞属于场景实体，通过 `c_spawn` 生成；当前不包含传送、配对、物品投喂或虫洞音效。

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
| 场景装饰 | `nightmaregrowth`、`wormhole` |
| 生物 | `fireflies`、`beefalo`、`bernie_inactive`（地面形态由理智决定） |

`c_give` 可用的物品 ID 由 [src/inventoryItems.ts](src/inventoryItems.ts) 汇总的物品定义决定；命令解析见 [src/debugCommands.ts](src/debugCommands.ts)，场景实体的创建、恢复、导出、更新和销毁集中声明在 [src/sceneEntities.ts](src/sceneEntities.ts)，由 [src/entityRegistry.ts](src/entityRegistry.ts) 统一调度；`c_spawn` 的支持 ID 与落点规则由对应注册项决定。

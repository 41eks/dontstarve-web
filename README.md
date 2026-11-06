# dontstarve-web

https://41eks.github.io/dontstarve-web/




## 调试命令（debugCommand）


制作菜单右侧快捷栏按面板高度整体同比缩放，按钮、页码和槽位间距保持比例；窗口变矮时不再溢出面板。大小屏均将面板中心对齐窗口高度的 50%；展开和收起共用垂直定位与缩放原点，仅横向移动。该布局调整不改变调试命令的语法、参数、支持 ID 或存档格式。

地面物品与库存物品共用一个逻辑实例：`ItemEntity` 继承 `PrefabInstance`，`prefabInstance(model)` 返回库存持有的同一对象。身份、标签、事件、组件、皮肤、持久化和逻辑生命周期统一保存在实例上；`stackable` 管数量，`perishable` 管整叠新鲜度。落地时 display 绑定原实例，拾取只释放地面 display，重新丢弃保留实例及组件；`instance.position`、`entity.transform.position` 与当前地面 model 的位置引用同一个向量，不再绑定第二个地面实例或转发库存事件。模型和显示资源通过 `prefabDisplay(model)` 获取。这次统一保留 `c_spawn`、`c_give`、`c_save()` 的语法、参数、支持 ID 与存档格式。

prefab 包内原先直接持有 `scene` 的 38 个类改由 `PrefabDisplayGroup` 接管显示对象的场景挂载和场景内释放，燃烧传播通过逻辑实体查询发现邻居。梦魇方尖碑的升降、隐藏状态、状态图和任务直接属于 `NightmareRockInstance`，通过 `prefabInstance(model)` 读取；不再写入 `model.userData.nightmareRock` 或 `removed`。方尖碑休眠保留逻辑状态和碰撞，永久移除取消任务并释放显示；`sanityrock`／`insanityrock` 的 `c_spawn` ID、命令参数及 `c_save()` 字段不变。


玩家的动画、装备外观、颜色和读书／工具破损 FX 通过 `instance.sprite` 声明，由 `PrefabDisplay` 加载并绘制；`createWilsonPlayer` / `createWilsonPlayerPrefab` 同步创建实体和刚体，美术等待由应用的 `display.artLoaded()` 承担。状态图使用导入的动画时长，动作与 FX 计时器不等待资源；加载完成只应用当前外观，不回写玩家逻辑。刚体绑定和逻辑清理由 `PrefabInstance` 管理。休眠释放 visual，保留位置、刚体、装备与状态图时间线，唤醒复用共享资源恢复外观。子 FX 的 visual 驻留由父子状态派生，到期移除由游戏时间调度器执行。外观声明使用 `createRenderEffect` 同步写入。调试命令的语法、参数、支持 ID 与 `c_save()` 存档格式不变。




静态资源缓存不改变调试命令的语法、参数、行为或支持的 `c_spawn` / `c_give` ID；`c_save()` 仍按原有流程导出存档。

局部存档导入的实体换算包含原版的半格偏移：`gx = x / 4 + width / 2 + 0.5`，Z 同理，再按选区原点转换为项目坐标。猪头已与木地板布局对齐，月亮雕像也恢复到对应档案馆地皮；`c_save()` 保存修正后的位置，命令语法、参数和支持 ID 不变。

地皮活动查询接收实体的 tile key `ReadonlySignal<number>` 和可选半径（默认 10 格），同一个 tile signal、半径复用 memo；`TileTracker` 发布新 key 后自动切换所监听的格子，避免移动实体一直读取出生格子的活动状态，详见 [移动实体的 tile 归属](docs/tile-lifecycle.md#移动实体不能一直监听出生-tile)。调试命令的语法、参数及支持的 `c_spawn` / `c_give` ID 保持不变。

活动网格在世界创建时读取存档的 `world.map.generator.options.size` 并注入 tileManager，按每格 12 世界单位计算地皮范围，不再固定为 84×84。网格包含边缘不足整格的地皮，但地图外坐标仍无效；`c_save()` 保留原地图尺寸，读档重新建立对应网格。调试命令的语法、参数和支持 ID 不变。

`FindEntities(position, radius, mustTags?, cantTags?, oneOfTags?)` 直接遍历顶层 `activePrefabs` 数组，按实体脚点距离和调用方标签筛选，不再接收 scene 或依赖模型父节点。世界 tickingarea signal 的 effect 同时维护标签和数组：active 注册，inactive 注销，默认仍为玩家周围 10 格方形区域；移动实体随现有每 60 活动帧的位置快照刷新 tile，模型加入场景时立即同步位置。拾取、模型替换、永久移除及场景销毁清理索引和订阅。无活动区域门控时保持 active；inactive 逻辑实体仍由原存档系统保存。`c_spawn`、`c_give`、`c_save()` 的语法、参数和支持 ID 不变。





游戏时间调度器使用带索引的最小堆，注册、取消与取出任务均为 `O(log N)`，等待时不遍历任务；大量任务取消时立即移除并释放回调。同一截止时间的登记顺序、长帧按实际截止时间追赶、组件 timer 的保存／恢复及 signal effect 的调度语义保持不变，详见 [signals 调度说明](packages/signals/README.md)。调试命令语法、参数与支持 ID 不变。

可选地表存档 `public/saves/initial-world.json` 保留以原点为中心、tile 中心距离不超过 20 格的陆地（本项目每格 12 世界单位，半径 240），外侧 5,792 格使用原版 `OCEAN_COASTAL`（地皮 ID `201`），已移除海洋格上的实体。加载器和 `c_save()`（无参数）支持保存、导出并重新加载这些海洋格，陆地上的实体身份和组件状态照常保存。近海使用原版 `levels/textures/ocean_noise.tex`、海域颜色及三层动态噪声；昼夜颜色纹理按原版九点核执行 3 轮横向／纵向模糊，然后进行 RGBA 昼夜混合、动态噪声与世界光照合成、2 倍编码及屏幕空间解码，详见 [海洋渲染管线](docs/dst-ocean-rendering.md)。地面积雪按 `ground_overlay.ksh` 乘上实际地皮 atlas 的 alpha，沿陆地伸入海洋格的岸边过渡区域渐隐，海面内部不积雪；挖地或耕地后同步更新遮罩。岸浪与浅海波纹通过注入的 `tickingarea` 监听玩家周围默认 10 格方形活动区域，按 Lua 的 `OnEntitySleep = inst.Remove` 在离开范围时立即移除并释放独立几何和订阅，返回范围不恢复旧波浪；播放结束也自动移除，不参与存档，未注入查询或查询返回 `undefined` 时保持原有动画生命周期；船只与海洋生物尚未接入。调试命令语法、参数和支持的 `c_spawn` / `c_give` ID 不变，海洋属于地图地皮。

入口在主场景资源、存档实体和交互绑定初始化完成并渲染完整场景后才关闭世界生成页；可等待 `src/main.ts` 导出的 `gameReady`，或检查主 canvas 的 `data-loaded="true"`。地皮 KTEX 解码由共享 Worker 完成，重复路径复用解码结果；纹理上传和世界／光照／后处理着色器分批预热，同时通过 `PrewarmSounds()` 下载并解码声音表中全部事件的音频（含各层与随机变体，也覆盖后续合成、`c_spawn` / `c_give` 的物品）。两者完成后才启动物理和游戏时间循环，`gameReady` 使用循环的首次渲染，不再额外绘制。音频预热不等待用户手势，实际播放仍在交互时恢复；重复音频复用共享缓存，单个音频失败沿用警告并允许后续重试，不阻止进入游戏。其他加载失败时保留生成页并显示错误，开发模式也使用相同的加载等待。调试命令语法、参数及支持 ID 不变。

场景动作同样由 `PlayerController` 处理：`PlayerActionPicker` 按 `componentactions.lua` 的 SCENE 条目从命中实体的组件收集 `PICKUP`（`inventoryitem`）、`PICK`（`pickable`）、`HARVEST`（`stewer` / `occupiable`）、`TAKEITEM`（`shelf`）、`TURNON` / `TURNOFF`（`machine`，右键）、`RUMMAGE`（`container`）、`SLEEPIN`（`sleepingbag`）、`MIGRATE`（`worldmigrator`）和 `HAUNT`（`hauntable`）；执行者 `act.doer` 是玩家（物品栏、理智、战斗与 `sleepingbaguser` 都挂在它上面），命中帧执行 `actionfns.ts` 中对应 `ACTIONS.<动作>.fn`。采集与收获的产物生成后交给玩家物品栏，装不下时按 `inventory:GiveItem` 掉在脚下。启动时按 `player_common.lua` 压入 `PlayerActionFilter`，活着时不提供幽灵专属的 `HAUNT`；变成幽灵后只保留 `ghost_valid` 动作，`HAUNT` 至少走到 2 格（`mindistance`）。到达距离统一为 `ARRIVE_STEP` 加双方物理半径。`c_give`、`c_spawn` 和 `c_save()` 的语法、参数、支持 ID 与存档字段不变。

建筑由各 prefab 创建 `workable` 并注册 `onworked(inst, worker, workleft, numworks)`／`onhammered(inst, worker)`，直接使用实例及组件；`LootDropper` 按配方、剩余使用次数比例和烧毁状态计算返还，并处理木炭概率，manager 维护集合与移除清理。`c_spawn`、`c_give`、`c_save()` 的语法、参数、支持 ID 和存档字段不变。

避雷针 `lightning_rod` 的回调沿用 `lightningrod.lua` 的名称：`onhit` 注册到 `workable.SetOnWorkCallback`，也由雷击回调调用，播放 `hit → idle`；`onhammered` 注册到 `SetOnFinishCallback`，负责掉落材料、生成金属倒塌特效并移除实体。

`c_give("dreadstone", 3)` / `c_give("wagpunk_bits", 3)` 获取墙体拆除材料，`c_spawn("dreadstone")` / `c_spawn("wagpunk_bits")` 在玩家位置生成一份。库存图标使用各自真实 atlas，地面使用源动画的 `idle`；数量、实体 ID 和落点随 `c_save()` 保存恢复。


手持地皮或种植物品时的右键按原版 `OnRightClick` 处理：指向可部署的空地才执行 `DEPLOY`（悬停文字取自源字符串，分别为「放置地皮」「栽种」）；位置无效，或鼠标指着不提供动作的实体时，整叠物品放回物品栏（优先来源槽，没有完整空位时仍由鼠标持有）；实体上有其他物品动作时交给该动作。`c_give("dug_grass", 2)` 拿到鼠标后右键空地可种回草丛：第 6 帧消耗 1 个，生成需要施肥的枯萎 `grass`（`OnTransplant`），`c_save()` 保留植株状态和鼠标上剩余的堆叠。命令语法和支持 ID 不变。

草丛、树苗、猴尾草、苔藓、洞穴蕨、浆果丛、仙人掌、蘑菇和石果灌木的采摘、再生、移植、变贫瘠、挖掘与燃烧回调由各自 prefab 实例注册到组件；应用层全局唯一的 `PrefabEntityManager` 统一管理实体集合、共享显示资源和保存恢复，所有已接入的 prefab 共用此实例，更新和存档只遍历一次。`c_spawn`、`c_give`、`c_save()` 的语法、参数、支持 ID 和存档字段不变。

码头套装 `c_give("dock_kit", 2)` 走同一条部署路径：点击物品栏拿到鼠标后显示 `gridplacer`（悬停文字「放置地皮」），右键与陆地或码头相邻的 `OCEAN_COASTAL` 格时角色走到岸边（`ExtraDeployDist` 让到达距离增加 3 DST 单位，共 4.1），在 `doshortaction` 第 6 帧消耗 1 个并把该格变为 `MONKEY_DOCK`；位置无效时右键放回物品栏。`c_save()` 保留码头地块、其下的海洋格和鼠标上剩余的堆叠。命令语法和支持 ID 不变。

栽种物品的 `ondeploy` 都写在所属 prefab 模块（`plantables.ts`、`butterfly.ts`、`marblebean_sapling.ts`、`rock_avocado_fruit.ts`），通过注册表的 `SpawnPrefab` 按源 prefab ID 生成植物；调试命令不变。

`c_give("butterfly", 2)` 获取活蝴蝶；点击或右键物品栏中的蝴蝶拿到鼠标后，右键可种植的空地执行 `DEPLOY`。预览使用 `anim/flowers.zip` 的 `flowers` bank/build、`f1`，间距为 LESS（0.75 DST 单位）；角色自动走近，在 `doshortaction` 第 6 帧消耗 1 只并生成原版 `planted_flower`（运行时及存档 prefab 为 `flower`），触发 `growfrombutterfly` 并播放种植声。花型随机为 f1–f10，玫瑰概率 1%；无效地形、阻挡、Esc 或切换动作不会消耗蝴蝶。`c_spawn("planted_flower")` 可直接生成种下的花，不支持 `c_give`；`c_save()` 保存花的 ID、脚点、花型及种植标记，恢复后仍可供蝴蝶授粉。

花朵（含自然花、种下的花和玫瑰）和大理石豆苗 `marblebean_sapling` 通过动画包的 `ResidentSprite` 驻留，石果萌芽 `rock_avocado_fruit_sprout_sapling` 由全局 `PrefabEntityManager` 管理，均共享 archive sprite 与实例批次；源动画仍按非循环方式播放。活动区休眠只释放 visual，唤醒恢复花型、形状、明度、积雪和相机朝向，保留实体、脚点、组件及已有的物理和小地图。豆苗和石果萌芽在休眠时仍按游戏时间生长／替换，燃烧计时也继续；大理石灌木开采后由调度器在 `mined_*` 动画时长结束时移除，不因卸载 visual 提前结算。调试命令语法、参数和支持的 `c_spawn` / `c_give` ID 不变，`c_save()` 继续保存休眠中的逻辑实体。

花朵支持玩家左键通用 `PICK`：例如 `c_spawn("planted_flower")` 后点击花朵，角色走近并通过快速 `doshortaction` 在第 6 帧获得 1 个 `petals`，恢复 5 点理智；`plantkin` 不获得这次理智恢复。玫瑰会通过玩家 `combat:GetAttacked` 造成 1 点伤害并发送 `thorns`，已装备 `bramble_resistant` 标签物品或带 `shadowminion` 标签时免疫刺伤；只放在物品栏里的装备不生效。成功后依次发送世界 `plantkilled`、实体 `picked` 并移除花朵，取消或产物准备失败时保留花和属性，燃烧／`intense` 状态不能采摘。库存满时沿用 `GiveItem` 将花瓣掉到玩家脚点；采花后 `c_save()` 不再导出该花，花瓣身份、数量、位置及玩家理智／生命保存恢复，读档不会重新出现已采的花。花的 `picksound` 保留原版字段，普通玩家快速采摘状态不额外播放该元数据的声音。

`c_spawn("flower")` 生成未种植的随机花，`c_spawn("flower_rose")` 强制生成未种植的玫瑰，`c_spawn("planted_flower")` 生成带 `planted=true` 的随机花；三者都保存为 `flower`，不能 `c_give`。花型 `animname`、种植标记、`OnSave`／`OnLoad` 和 `onpickedfn` 属于 `FlowerInstance`，存档继续使用 `flower.animation`／`flower.planted`；`setflowertype` 仅在花型变化时声明非循环动画，并更新 `thorny` 和检查状态 `ROSE`。显式 `flower_rose` 按 Lua 注册 `DoRoseBounceAnim`，声明 `rose_bounce → rose`，不依赖显示资源完成业务逻辑。燃烧回调直接修改 `instance.persists`：点燃后不导出、扑灭后恢复导出，烧完生成灰烬并移除实例；移除会取消采摘与燃烧任务。manager 不再通过 `model.userData` 保存花型、种植标记或移除状态。洞穴黑暗枯萎、自然花再生管理器、作祟换花、万圣节变异和 Charlie 残留系统仍未移植。

采花得到的 `petals` 和 `c_give("petals", count)` / `c_spawn("petals")` 生成的花瓣均接入原版 `PERISH_FAST`：基础保鲜期 6 游戏日（2880 秒），每 10 游戏秒结算，完全腐败后整叠替换为同数量 `spoiled_food`。地面、冰箱、受潮和温度倍率沿用通用 perishable 组件；转移和 `c_save()` 前结清不足 10 秒的时间，鼠标持有与读档保留身份、数量和新鲜度。

普通蝴蝶按 `BUTTERFLY_PERISH_TIME` 在持有者中饥饿腐败，基础寿命为 3 游戏日（1440 秒），每 10 游戏秒结算，丢弃时结清并暂停、捕获后继续；地面自由飞行期间不腐败。转移、保存和种植前结清未满周期的时间，`c_save()` 保留物品栏／鼠标堆叠的身份、数量和新鲜度。寿命耗尽时先移除整叠蝴蝶，再对每只按原版权重独立生成 `butter`（0.1 / 5.1）或 `butterflywings`（5 / 5.1），放回持有者，装不下则掉落。`c_give("butter", count)` / `c_spawn("butter")` 支持黄油，地面使用 `anim/butter.zip` 的 `butter/idle`，库存图标为 `images/inventoryimages.xml` 的 `butter.tex`；黄油与翅膀分别在 40 / 6 游戏日后腐败为 `spoiled_food`，可食用，均无装备外观或源皮肤。

蝴蝶与萤火虫的昼夜判断通过 `WorldContentKey.Cycle` 的私有监听读取世界状态；满月仍属于夜晚，不从光照表现层反推。月晷、月台和月之魔典通过 `WorldContentKey.Moon` 读取 `{ phase, waxing }`，月台结合 Cycle 派生满月夜，月之魔典仍使用世界命令修改月相；移除或动作结束时释放对应监听。世界内容新增 `WorldContentKey.PlayerPositions`（`playerpositions: Vector3[]`）：初始化及每 60 个活动帧发布玩家位置副本，暂停帧不计数。萤火虫通过私有位置监听响应快照变化，按 Lua 的 3 / 5 单位（场景 9 / 15，边界为严格小于）判断靠近／离开，不逐帧查询玩家。萤火虫显隐判定集中在 `createEffect`，休眠继续门控昼夜与位置监听；`tickingarea` 变为 true 后 effect 重新读取当前昼夜，白天立即隐藏模型、清零光照、停止淡变与延迟检查并禁用 NET，不保留夜晚状态或丢弃闪光，且在读取玩家位置前短路。活动区内进入白天也执行相同清理；夜晚切换及夜晚／黄昏丢弃后的 2～3 游戏秒检查、普通淡出后的 1.5～2.5 秒 NET 禁用仍由游戏时间调度器计时，入栏／移除取消任务；便便苍蝇的 `playerprox` 也读取自己的私有位置监听，保留 2 / 3 单位（场景 6 / 9）范围；组件通过纯 `createMemo` 缓存玩家的 X/Z tile 坐标，按当前 near/far 半径排除相隔过远的格子，其余候选继续使用完整三维平方距离和严格边界判断。位置快照不变时复用玩家 tile 坐标，移除时随私有监听释放 memo。模块顶部按两个 tile index 的无序对缓存格子间距，同一格的实体、不同 near/far 半径以及 A→B／B→A 共用同一项；玩家换格后使用新的 key，位置快照更新无需清空格子距离缓存，各实体的精确距离与 near/far 状态仍独立。现有调试命令语法、参数、支持 ID 和存档字段不变。

常青树 `evergreen*`、桦树 `deciduoustree*`、月树 `moon_tree*` 和蘑菇树 `mushtree*` 现由 `PrefabInstance` 声明状态与动画，`packages/display` 管理 visual 的创建、休眠、唤醒和永久释放。季节 build、树叶符号、颜色、雪层与相机朝向在重建后恢复；生长、砍伐工作量、树桩、烧焦状态和组件计时保留在逻辑实体上。针叶、落叶、花瓣与燃烧火焰也由 display 绘制，火焰通过 `attachFx()` 声明。常青树、桦树、月树与幼苗都由通用的 `PrefabEntityManager` 按存档逐棵恢复（`evergreenPrefabs()`、`deciduousPrefabs()`、`moonTreePrefabs()` 声明）；砍伐、烧毁、树桩挖掘和成长回调在所属 prefab 模块内注册到实例和组件。已删除森林聚合容器、随机森林参数及 `bindWorld()`／`setNormals()` 接口；月树 prefab、幼苗、种植、伐木和存档支持保留。调试命令语法与支持 ID 不变，例如 `c_spawn("evergreen_tall")`、`c_spawn("deciduoustree_tall")`、`c_spawn("moon_tree_tall")`、`c_spawn("mushtree_medium")`、`c_spawn("moonbutterfly_sapling")`，`c_save()` 继续导出活动与休眠中的全部逻辑树木。

斧头可用 `c_give("axe")`、`c_give("goldenaxe")` 或 `c_give("moonglassaxe")` 获取，`c_spawn` 同名 ID 生成地面工具，每格一把。三种斧头满耐久均为 `TUNING.AXE_USES = 100`，每次成功砍伐分别消耗 1 / 0.25 / 1.25，月光玻璃斧的 `CHOP` 效率为 2.5；拖到手部装备槽后显示 `swap_axe` / `swap_goldenaxe` / `swap_glassaxe` 手持外观，耗尽后自动卸下并移除。月树 `moon_tree` 支持 `short` / `normal` / `tall` 三阶段，旧森林存档的空组件继续从 `tall` 恢复：装备斧头后左键月树（与镐子相同，按 Lua 的 `tool` 组件动作使用左键），玩家自动走近并播放 `anim/player_actions_axe.zip` 的 `chop_pre → chop_loop`，第 2 帧执行 `CHOP` 工作并消耗耐久；`CHOP_tool` / `CHOP_workable` 标签选择动作，命中时重新验证组件，移动、Esc、卸下或更换斧头可取消尚未命中的砍伐。月树需要 `TUNING.MOON_TREE_CHOPS_TALL = 16` 次工作量，每次命中播放 `dontstarve/wilson/use_axe_tree`（FEV 两层：`chop_tree_V2_*` 与 `branchfoley_v2_*`）、`chop_tall` 与花瓣特效 `tree_petal_fx`；最后一击播放 `dontstarve/forest/treeFall`，按玩家相对相机右向量选择 `fallleft_tall` / `fallright_tall`，在倒下一侧抛出 4 个 `log`、2 个 `moon_tree_blossom` 和 1–2 只 `moonbutterfly`（第二只 50%），随后保持 `stump_tall` 树桩（移除 `shelter` 并标记 `stump`）。砍伐进度与 Lua `workable` 一样不写入存档，但加载/卸载月树模型时保留；`c_save()` 对树桩保存 `moon_tree.components.moonTree.stump`，读档直接显示树桩。`moon_tree_blossom` 为 `PERISH_FAST` 的月树花（`HEALING_TINY`），可用 `c_give("moon_tree_blossom")` 或 `c_spawn("moon_tree_blossom")` 获取。装备铲子或黄金铲子后可右键挖掉树桩：树桩带 `DIG_workable`，只需 1 次工作，在 `shovel_loop` 第 15 帧掉落 2 个 `log` 并移除树桩；成功才消耗铲子耐久，取消不消耗。铲除会同时移除逻辑实体与模型，离开再返回不会重生，`c_save()` 不再导出已挖掉的月树，读档保留移除结果与木头掉落。小／中／大月树砍伐工作量分别为 8／12／16，小月树掉落 2 个木头并有 50% 概率掉月树花；中月树掉落 3 个木头、1–2 朵花（第二朵 25%）和 1 只月蛾；大月树维持上述掉落。小月树桩挖掘掉落 1 个木头，中／大树桩掉落 2 个。当前未接入：自然繁殖、技能与角色专属伐木分支。




`c_give("moonbutterfly", 2)` 获取月蛾，点击或右键物品栏里的月蛾拿到鼠标后显示通用种植预览，再右键可种植的空地执行 `DEPLOY`；角色走近后通过 `BufferedAction` 和 `SGwilson.doshortaction`，在第 6 帧消耗 1 只并生成 `moonbutterfly_sapling`。成功后剩余堆叠仍由鼠标持有，可继续种植；Esc 或切换动作取消未提交的动作，不消耗物品。地皮与种植物品共用同一条路径：`componentactions` 的 `deployable` 选出动作，`PlayerController` 负责走近与取消，`ACTIONS.DEPLOY` 按第 6 帧提交，`deployable` 经注入的部署地图校验 TURF／PLANT 规则，`DeployPlacer` 负责预览，花管理器不再监听鼠标或键盘，也不再拥有月蛾的预览、回调扣物品或即时生成入口。间距按 Lua 的 `DEPLOYSPACING.PLACER_DEFAULT` 为 3.2 DST 单位（场景 9.6），月树和幼苗的 smart radius 为一半（场景 4.8）；未加载模型的逻辑月树仍阻挡种植。预览／幼苗使用原版 `anim/baby_moon_tree.zip` 的 `baby_moon_tree` bank/build、`idle`，种下播放 `dontstarve/wilson/plant_tree`。幼苗按 `PINECONE_GROWTIME` 在 150–300 游戏秒后生成小月树，并播放 `grow_seed_to_short`；幼苗不受春季加速。月树按小 → 中 → 大 → 小循环，各阶段持续 300–600／900–2100／900–2100 游戏秒；新登记的生长任务在春季乘 0.75，不改写已登记的截止时间。转换使用 `grow_short_to_normal`、`grow_normal_to_tall`、`grow_tall_to_short` 与原版生长声；转换阶段会重置砍伐工作量。逻辑生长由 `packages/componets/src/growable.ts` 和游戏时间调度器驱动，模型卸载保留计时，重新加载补齐生长；砍倒后停止生长，挖掉幼苗取消它的计时。`c_save()` 保存幼苗 ID／位置及 `saplingTimer` 的 `grow` 剩余时间、鼠标剩余月蛾的身份／数量／新鲜度；月树保存大小、`growable` 阶段／剩余时间／离屏时间，读档恢复原姿态与计时。`c_spawn("moonbutterfly_sapling")` 可直接生成幼苗，`c_spawn("moon_tree")` 随机生成小／中／大月树，`c_spawn("moon_tree_short")`、`c_spawn("moon_tree_normal")`、`c_spawn("moon_tree_tall")` 分别指定阶段；保存时统一使用实际实体名 `moon_tree`。这些世界实体不支持 `c_give`。

`c_spawn("evergreen_tall")` 在玩家所在的地面生成大常青树；`c_spawn("evergreen_short")`、`c_spawn("evergreen_normal")` 分别生成小／中常青树，`c_spawn("evergreen")` 随机选择小／中／大阶段。保存名统一为 `evergreen`，这些世界实体不能 `c_give`。本次交互范围为生长、斧头砍伐和铲除树桩。原版 bank 为 `evergreen_short`、build 为 `evergreen_new`；动画分别来自 `anim/evergreen_short_normal.zip` 和 `anim/evergreen_tall_old.zip`，build 来自 `anim/evergreen_new.zip`。按小 → 中 → 大 → 衰老 → 小循环，阶段时间为 300–600／900–2100／900–2100／150–450 游戏秒，春季新登记任务乘 0.75。变化播放 `grow_short_to_normal`、`grow_normal_to_tall`、`grow_tall_to_old`、`grow_old_to_short` 及原版生长／衰老声；衰老树使用 `idle_old` 且失去 `shelter`。装备斧头后左键目标，沿用 `CHOP` 的走近、动作提交与取消流程；小／中／大／衰老树工作量为 5／10／15／1，转换阶段重置工作量。砍伐播放原版斧击声及 `pine_needles_chop` 松针特效（衰老树无松针）；砍倒按玩家方向选择倒下动画，掉落分别为 1 木头／2 木头 + 1 松果／3 木头 + 2 松果／1 松果，并留下对应阶段树桩，停止生长并移除树干碰撞。铲子右键树桩在挖掘提交帧掉落 1 木头并永久移除；取消不耗耐久。`c_give("pinecone", 3)` 获取松果，`c_spawn("pinecone")` 生成地面松果，库存图标来自 `images/inventoryimages.xml`，地面为 `anim/pinecone.zip` 的 `pinecone/idle`。`c_save()` 保存树的 ID、位置、阶段、剩余生长／离屏时间、树桩和掉落状态，读档恢复对应姿态与碰撞；砍伐进度不写入存档，模型卸载仍保留同一个逻辑 `workable` / `growable` 组件。常青树没有源皮肤。常青树通过共享 archive sprite 的 `instancedAnimations`（`sway1_loop_*`、`idle_old`、`stump_*`、`burnt_*`）合批绘制，两个动画 zip 经 `extraAnimationArchives` 合并为同一 bank；砍伐、生长等一次性动画仍使用共享帧几何，命令与 ID 不变。松果种植、点燃、树桩自然腐朽、自然繁殖、石化与树精守卫不在本次交互范围内。

`c_spawn("deciduoustree_tall")` 在玩家地面脚点生成大桦树；`deciduoustree_short`、`deciduoustree_normal` 分别是小／中桦树，`deciduoustree` 随机选择三个阶段。保存名统一为 `deciduoustree`，世界树不能 `c_give`。小 → 中 → 大 → 小循环，阶段为 300–600／900–2100／900–2100 游戏秒，春季新登记生长任务乘 0.75；工作量为 5／10／15。树干使用 `anim/tree_leaf_trunk_build.zip`，三种大小动画来自 `anim/tree_leaf_short.zip`、`tree_leaf_normal.zip`、`tree_leaf_tall.zip`，`swap_leaves` 分别覆盖绿／红／橙／黄 build，冬季清除树叶。季节切换沿用原版换叶、长叶／落叶动画、森林音效与 `tree_leaf_fx_*` 特效；换叶完成通过游戏时间任务执行，离屏也能完成。每日回调用离散定时任务实现；当前世界尚无自动季节日历，因此季末提前 3 天换叶的分支只有在注入真实日历时执行，不根据温度推断季节进度。

装备斧头后左键桦树，沿用通用 `CHOP` 的走近、动作提交、取消和耐久消耗；砍倒按玩家方向播放倒下动画并留下对应阶段树桩，停止生长／换叶任务，移除树干碰撞。小／中树掉落 1／2 木头，大树掉落 3 木头，春夏另掉 1 桦栗果 `acorn`，秋季另掉 2 桦栗果，冬季无桦栗果。装备铲子右键树桩，在挖掘提交帧再掉落 1 木头并永久删除实体。`c_give("acorn", 3)` 获取桦栗果，`c_spawn("acorn")` 生成地面桦栗果；库存图标为 `images/inventoryimages.xml` 的 `acorn.tex`，地面使用 `anim/acorn.zip` 的 `acorn/idle`。例如 `c_spawn("deciduoustree_tall"); c_give("axe"); c_give("shovel"); c_save()`；存档保留树 ID、位置、生长阶段与剩余时间、树叶 build／当前及目标状态、待换叶时间、树桩和掉落物，砍伐工作进度按 Lua 不写入存档，离屏模型卸载仍保留逻辑组件。桦树没有源皮肤。本次范围为生长、斧头砍伐与铲树桩，不含桦栗果种植、燃烧、自然繁殖／腐朽和桦树精战斗。
工具目标的鼠标选取按手持装备与实时组件能力筛选：空手或工具不匹配时，树木／树桩／仅供铲挖的幼苗和鼹鼠巢穴、矿石／大理石灌木／封闭洞口／可开采的档案馆及洞穴装饰、骨堆／墙／栅栏／耕地机等不参与鼠标射线检测，可以点到其后的物品。`axe`、`shovel`、`pickaxe`、`hammer`（含已支持的黄金／玻璃变体）分别匹配 `CHOP`／`DIG`／`MINE`／`HAMMER`；`torch` 和 `firestaff` 匹配当前允许近战／远程点燃的目标。建筑的开箱、投喂、加燃料等交互继续保留鼠标资格，墙、栅栏和建筑仍可用 `reskin_tool` 换肤；地面物品拾取与植物采摘沿用原有入口。装备切换、工作组件替换、燃烧、工作耗尽和移除会更新独立的鼠标候选，不写入 `NOCLICK`，不影响世界查询、碰撞、生长或存档。验证示例：`c_spawn("evergreen_short"); c_spawn("rock1"); c_spawn("skeleton"); c_give("axe"); c_give("shovel"); c_give("pickaxe"); c_give("hammer"); c_give("torch")`；空手时可点击穿过只支持工具的目标，装备匹配工具后恢复选取。`c_save()` 继续保存实体与掉落结果，命令语法、参数和支持 ID 不变。

树木与花的点燃：装备 `torch` 后右键 `evergreen`、`deciduoustree`、`moon_tree` 的任一阶段树木、树桩以及已种下的 `flower`，沿用通用 `LIGHT` 动作（`canlight` 标签）。树使用 `MakeLargeBurnable(TREE_BURN_TIME = 45)` + `MakeMediumPropagator`，火焰取 `fire.zip` 的 `firelevels[5]`（`level4` 动画、`dontstarve/common/forestfire`、照明半径 6）；树桩和小型火焰按各自 FX 等级取对应项；月树按大小为 22.5／45／67.5 秒，树桩 10／20／30 秒（常青、桦树树桩 10 秒），花 10 秒。烧完的树立即切到 `burnt_*` 并带 `burnt` 标签，0.5 秒后移除 `burnable`／`propagator`／生长／`shelter`，只剩 1 次工作量：砍下播放 `treeCrumble`，掉落 `charcoal`（常青 10% 松果、桦树 10% 桦栗果，另在烧毁 10 秒后各掉一次）并在 `chop_burnt_*` 结束后移除；月树只掉木炭。树桩和花烧完生成 1 个 `ash` 并移除。离开加载范围时，燃烧中的树按 `OnEntitySleep` 直接变为 burnt、燃烧中的树桩直接变灰烬。`c_save()` 对燃烧中或已烧毁的树写入 `evergreen.burnt` / `deciduoustree.burnt` / `moonTree.burnt`（及常青、桦树的 `burntcone`），生长组件只保留 `stage`，读档直接显示烧毁树；燃烧中的树桩仍按树桩保存，燃烧中的花不写入存档。测试：`c_spawn("evergreen_normal")` 后 `c_give("torch")`、装备并右键点燃，等待 45 秒后砍烧毁的树取得 `charcoal`。

鹤嘴锄可用 `c_give("pickaxe")`（或 `c_give("goldenpickaxe")`）获取，`c_spawn("pickaxe")` / `c_spawn("goldenpickaxe")` 生成地面工具，每格一把。普通鹤嘴锄满耐久可开采 33 次，黄金鹤嘴锄可开采 132 次，开采效率相同；内部满耐久均为 33，成功开采分别扣 1 / 0.25，库存及装备槽显示剩余百分比，耗尽后自动卸下并移除。拖到手部装备槽后显示原版手持外观。用 `c_spawn("rock1")` 等命令生成岩石后，手持鹤嘴锄左键岩石会自动走近并播放 `anim/player_actions_pickaxe.zip` 的开采挥镐动画，在 `pickaxe_loop` 第 7 帧执行 MINE 工作、消耗耐久并播放原版 `dontstarve/wilson/use_pick_rock`；两种鹤嘴锄使用同一音效。动作由 `MINE_tool` / `MINE_workable` 标签选择，并在命中时重新验证组件。移动、Esc、卸下或更换鹤嘴锄可取消尚未命中的开采及音效；取消、目标失效或超出距离不消耗耐久。剩余耐久、实体身份和皮肤随掉落、拾取、换肤及 `c_save()` 保存恢复。

岩石按 `rocks.lua` 的 `workable` 处理：`rock1`、`rock2`、`rock_flintless` 需 6 次成功开采，`rock_flintless_med` 需 4 次，`rock_flintless_low` 需 2 次；按剩余工作量切换原版 `full` / `med` / `low` 外观，完成后播放碎石声、按原版概率表逐件抛出石头、燧石、硝石或金块，并从场景、交互目标和存档移除。未挖完的岩石读档后恢复各自初始工作量，符合 Lua workable 默认不保存进度的行为。

八种岩石（上述五种及 `cavein_boulder`、`rock_moon_shell`、`rock_moon`）均支持装备鹤嘴锄后左键开采，沿用走近、缓冲动作、第 7 帧提交、取消和耐久消耗流程。月岩与月岩壳需 6 次，切换 `full/med/low`；落石需 3 次，开采期间保持 `idle` 外形，抬高的 `idle_raised` 不可开采。月岩掉石头、燧石和月岩；落石按原表掉 2 个石头，另有 40% 石头和 10% 燧石。月岩壳先掉石头、燧石及 3 个必掉月岩（另有 30% 月岩），随后同步生成 1 个 `moonrockseed`，加 `NOCLICK`，播放 `break`，2 个游戏秒后开始侵蚀，1 秒后移除；已破碎的壳不入档，宝球与矿物正常保存。所有存活矿石按 Lua 不持久化开采工作量，落石仍保存外形编号与抬高／组合姿态；搬运、组合落石及宝球交互仍未接入，`moonrockseed` 只显示静态美术。

这些岩石使用 `createSharedArchiveSprite()` 的 `instancedAnimations: 'all'` 合批绘制，保留 Lua 原有播放语义、逐实体明暗、侵蚀状态与 alpha 拾取。`c_spawn("cavein_boulder")`、`c_spawn("rock_moon_shell")`、`c_spawn("rock_moon")` 和 `c_spawn("moonrockseed")` 均无额外参数，在玩家脚下生成；命令语法与支持 ID 不变，未开放落石／宝球的 `c_give`。例如 `c_spawn("rock_moon_shell"); c_give("pickaxe")`，装备后左键开采，再执行 `c_save()`；导出后重载保留剩余实体及掉落物。落石使用 `cavein_boulder.zip` 的动画和 `swap_cavein_boulder.zip` 的 build／符号覆盖；月岩为 `rock7.zip` 的 `rock5` bank。资源导入及原路径／字节检查：`python3 packages/prefab/scripts/import-rocks.py`、同命令加 `--check`。

月亮玻璃岩 `moonglass_rock` 按 `rocks.lua` 的 `rock_moon_glass` 接入：构造时 `math.random(4)` 选择 `rock_type`，对应 `moonglass_rock`／`moonglass_rock2`／`moonglass_rock3`／`moonglass_rock4` 四套 bank 与 build，不随机明暗；`c_spawn("moonglass_rock")` 无额外参数，在玩家脚下生成，没有 `c_give`。`c_save()` 保存 ID、位置和 `components.rock_type`，读档恢复同一外观，不重新随机。开采需 6 次（工作量不入档，读档后恢复满工作量），按剩余量切换 `full`／`med`／`low`，挖完掉 2 个 `moonglass` 并有 25% 概率多掉 1 个。未接入：`inspectable` 与 `lunarhailbuildup` 只有构造签名，挖掘者的 `spooked` 分支未接入。

重生护符使用实际 prefab ID `amulet`（`prefabs/amulet.lua` 的红色护符，其余颜色是独立 prefab，未移植）：`c_give("amulet")` 获取，`c_spawn("amulet")` 生成地面物品，可穿在身体槽（右键物品槽穿戴／卸下），带 `resurrector` 标签、20 次耐久（`REDAMULET_USES`）和 4 款来源皮肤（可用 `reskin_tool` 换肤）。穿着时每 30 游戏秒（`REDAMULET_CONVERSION_TIME`，游戏时间调度器）在生命未满且饥饿值大于 5 时转换 5 点饥饿为生命并消耗 1 次耐久，耐久用完自行移除；卸下即停止，该定时器不存档，读档后重新穿戴时重新计时。死亡后的幽灵左键点击地面上的护符（只有 `ghost_valid` 的作祟动作可用）触发 `HAUNT`，`hauntable` 的 `HAUNT_INSTANT_REZ` 发出 `respawnfromghost`：9 帧后幽灵隐藏并移到护符处，再过 51 帧（`DoRezDelay` 每 .35 秒检查护符仍在地面）复活，护符被装备到身体槽并进入 `amulet_rebirth`（动画 `player_amulet_resurrect`、`staff_castinglight` 红色光、`rebirth_amulet_raise` / `rebirth_amulet_poof` 音效），状态内无敌、护符被消耗，80 帧时 10 单位内的 `sleeper` 入睡 20 秒；没有蜗壳／传送门的生命上限惩罚。未移植：摄像机拉远（`SetCameraDistance`）和 HUD 之外的用户会话保存。复活期间物品栏栏随幽灵模式信号隐藏／显示。

蜗壳护甲使用实际 prefab ID `armorsnurtleshell`：`c_give("armorsnurtleshell")` 获取，`c_spawn("armorsnurtleshell")` 生成地面物品，每格一件。拖到身体装备槽后穿上，外观来自 `armor_slurtleshell` 的 `swap_body_tall`；穿着时右键该物品槽（`USEITEM`）进入 `shell_enter` → `shell_idle` 缩壳姿态（动画 `hideshell` / `hideshell_idle`，音效 `foley/hideshell`），此时护甲吸收由 0.6 变为 `FULL_ABSORPTION`（1）。在壳内收到 `blocked` 事件时播放 `shell_hit`（`hitshell`）并发出 `hit_armour` 音效；移动、执行其他动作或卸下护甲都会离开缩壳姿态并恢复 0.6 吸收。护甲耐久为 `150 * 7 * 0.7`，磨损与保存通过 `armor` 组件（`OnSave` / `OnLoad`）完成；目前没有敌对目标攻击玩家，因此原版缩壳 5 秒后让敌人放弃目标的分支（`droptargets`）尚未实现。

暗夜剑使用实际 prefab ID `nightsword`：`c_give("nightsword", 2)` 获取两把，每把占一格；`c_spawn("nightsword")` 在玩家当前位置生成一把地面暗夜剑。拖到手部装备槽显示原版手持外观，Shift + 右键物品槽可丢到地上，点击地面暗夜剑可拾回。库存默认图标为 `images/inventoryimages.xml` 的 `nightsword.tex`；地面使用 `anim/nightmaresword.zip` 的 `nightmaresword` bank/build 和 `idle` 姿态；手持使用独立的 `anim/swap_nightmaresword.zip`，覆盖玩家 `swap_object`。装备清洁扫把后右键地面暗夜剑，依次切换 `nightsword_cotl`、`nightsword_curve`、`nightsword_lightsbane`、`nightsword_sharp`、`nightsword_wizard`，最后恢复默认外观；皮肤库存图标来自 `images/inventoryimages2.xml`，地面和手持均使用对应原版动态 build。换肤、丢弃、拾取及 `c_save()` 保留实体 ID、位置、数量、皮肤和已有物品状态，读档恢复地面及手部装备。已实现手持、地面外观及装备理智消耗；攻击、耐久消耗和皮肤攻击粒子待战斗功能接入。









`c_give("farm_plow_item")` 获取耕地机，第二个参数可指定数量，每台占一格、初始 4 次使用。左键物品栏中的耕地机拿到鼠标后显示预览（悬停文字「部署」），右键可种植的空地时选取 `DEPLOY_TILEARRIVE`：角色走进该格即算到达，在 `doshortaction` 第 6 帧部署；位置无效时右键放回物品栏。预览和落点吸附到整格地皮中心（`TILE_SIZE = 12`），显示原版 `tile_outline` 使用的 `anim/gridplacer.zip`、bank/build `gridplacer`、`anim` 地皮边框。不能部署到已耕地地皮或有阻挡物的格子。成功部署时由物品实体的 `finiteuses.use(1)` 消耗一次使用，保存扣减后的完整物品快照；钻地 15 秒后将该格改为 `WORLD_TILES.FARMING_SOIL`（ID `47`），从快照折回物品，第 4 次用完后不再返还。`c_spawn("farm_plow_item")` 只生成 `idle_packed` 地面物品；`c_spawn("farm_plow")` 直接生成工作中的调试耕地机，完成后不返还物品。`c_save()` 将耕地机进度及完整物品快照保存到 `components.farmPlow.deployItem`，包含物品 ID、数量及组件状态；完成或被锤毁时恢复该快照，保留物品 ID 和剩余使用次数。地面物品加载成功前保留返还快照。旧存档的 `returnUses` 自动迁移；`c_spawn("farm_plow")` 的快照为 `null`。耕地结果及原地皮 ID 保存到 `world.map.tiles`，加载后恢复。

`c_give("farm_hoe")` / `c_give("golden_farm_hoe")` 获取园艺锄 / 黄金园艺锄，数量由第二个参数指定，每把占一格；`c_spawn("farm_hoe")` / `c_spawn("golden_farm_hoe")` 在玩家脚下生成可拾取的地面工具。地面美术分别使用 `anim/quagmire_hoe.zip` / `anim/goldenhoe.zip` 的 `idle`，基础图标均来自 `images/inventoryimages2.xml`；手持符号分别来自 `quagmire_hoe.zip:swap_quagmire_hoe` / `swap_goldenhoe.zip:swap_goldenhoe`。拖到手部装备后，右键耕地机生成的农田 tile，在鼠标落点耕坑，距离较远时自动走近；播放原版 `player_actions_till.zip` 的 `till_pre → till_loop → till_pst`，`till_loop` 第 11 帧生成 `farm_soil` 的 `till_rise → till_idle`。可重新整理破损坑或调整完整坑的位置，附近旧坑按原版坍塌规则移除或变为破损状态；普通地皮、杂物和已播种位置不允许耕坑。移动、跳跃、左键、Esc、卸下工具或切换物品取消未提交的动作。支持 Shift + 右键丢弃、左键拾回、现有清洁扫把换肤，以及皮肤和坑的 ID/位置随存档保存恢复。园艺锄支持 `farm_hoe_invisible`、`farm_hoe_rustic`；黄金园艺锄支持 `golden_farmhoe_garden`、`golden_farmhoe_invisible`，拟真皮肤隐藏手持工具。本次仅接入地面与手持美术和农田耕坑，不处理耐久或战斗。

`c_give("shovel")` / `c_give("goldenshovel")` 获取铲子 / 黄金铲子，数量可由第二个参数指定，例如 `c_give("goldenshovel", 2)`，每把占一格；`c_spawn("shovel")` / `c_spawn("goldenshovel")` 在玩家脚下生成可拾取的地面工具。地面分别使用 `anim/shovel.zip` / `anim/goldenshovel.zip` 的同名 bank/build 和 `idle`，基础物品图标均来自 `images/inventoryimages.xml`；手持资源分别为 `anim/swap_shovel.zip:swap_shovel` / `anim/swap_goldenshovel.zip:swap_goldenshovel`。拖到手部装备后，右键耕地机生成的农田 tile 上的垃圾（`farm_soil_debris`）自动走近，播放原版 `shovel_pre → shovel_loop → shovel_pst`，在 `shovel_loop` 第 15 帧挖掉该堆垃圾并显示 `dirt_puff`。按原版基础 25% 概率掉落一份材料，树枝 / 石头 / 燧石 / 硝石 / 金块权重为 40 / 25 / 20 / 10 / 5。清理保留农田地皮、坑、已播种实体和其他垃圾；移动、跳跃、左键、Esc、切换物品或卸下工具可取消未提交的挖掘。支持 Shift + 右键丢弃、左键拾回和现有清洁扫把换肤；铲子有 7 个原版皮肤，黄金铲子支持 `goldenshovel_invisible`、`goldenshovel_northern`，拟真皮肤隐藏手持工具。物品皮肤、地面实体 ID/位置/数量及垃圾清理结果随 `c_save()` 保存并恢复。普通铲子每次成功 `DIG` 消耗 1 点，共 25 次；黄金铲子同样保存 25 点原始耐久，每次消耗 0.25 点，共 100 次。取消或失败不消耗耐久，耗尽后移除装备；剩余耐久随存档恢复。原生草丛、树苗和砍倒的月树桩也支持同一 `DIG` 动作；小月树桩掉落 1 个木头，中／大树桩掉落 2 个后永久移除；未长大的月树幼苗挖起掉落 1 个树枝，存档保留移除结果。铲子通过 `DIG_tool` / `DIG_workable` 标签选择目标。战斗和其他挖掘目标尚未接入。



食用属性按原版 `preparedfoods.lua`、`prefabs/seeds.lua`、`prefabs/mushrooms.lua` 和 `tuning.lua` 的新鲜食物基础数值结算：

| 物品 ID | 生命 | 饥饿 | 理智 |
| --- | --- | --- | --- |
| `meatballs`（肉丸） | +3 | +62.5 | +5 |
| `seeds`（生种子） | 0 | +4.6875 | 0 |
| `bananajuice`（香蕉奶昔） | +8 | +25 | +33 |
| `red_cap`（生红蘑菇） | -20 | +12.5 | 0 |
| `red_cap_cooked`（熟红蘑菇） | +1 | 0 | -10 |
| `green_cap`（生绿蘑菇） | 0 | +12.5 | -50 |
| `green_cap_cooked`（熟绿蘑菇） | -1 | 0 | +15 |
| `blue_cap`（生蓝蘑菇） | +20 | +12.5 | -15 |
| `blue_cap_cooked`（熟蓝蘑菇） | -3 | 0 | +10 |



通用 `Perishable` 通过游戏时间调度器每 10 个游戏秒结算新鲜度，`updateTimer` 提供周期任务的只读状态，等待期间不逐帧改写；长帧跨过多个周期时依次处理各个到期点，停止腐烂或永久释放时取消任务，恢复时从当前游戏时间重新计时：世界 `WorldPerishClock` 按实际 `dt × 温度倍率` 记录累计刻度，组件 `Update({ time, total })` 扣除前后累计量之差，再应用持有者、湿润和本地倍率。世界私有 `watchSignal` 同步温度，纯 memo 推导冷热倍率；温度变化本身不扣减新鲜度。重设保鲜时长／百分比、改变湿润状态或切换世界前先结清尾帧，若已腐烂并被替换则停止修改旧实体；总时长和满新鲜度原子提交。示例：`c_give("red_cap", 2); c_spawn("red_cap"); c_save()`，保存和读档保留身份、数量、位置与新鲜度，读档在当前游戏时间建立新的累计基准。累计刻度是本项目为休眠补算引入的方案，Lua 原版每次 `Update(inst, dt)` 使用当时温度处理整段 `dt`。命令语法、参数和支持的 prefab/item ID 不变；早晨统一结算与 tile 管理器仍待接入，见 [tile 生命周期](docs/tile-lifecycle.md#腐烂累计刻度与早晨快照)。

| `red_cap` 阶段 | 生命 | 饥饿 | 理智 |
| --- | --- | --- | --- |
| 新鲜 | -20 | +12.5 | 0 |
| 不新鲜（饥饿 ×0.667） | -20 | +8.3375 | 0 |
| 腐烂（饥饿 ×0.5，理智固定 -`SANITY_SMALL`） | -20 | +6.25 | -10 |

负的生命值不受腐烂影响。`bananapop`（香蕉冻）按 `prefabs/preparedfoods.lua` 使用配方的 `perishtime = PERISH_SUPERFAST`（3 天，1440 秒），其余规则与 `red_cap` 相同，腐烂后同样替换为 `spoiled_food`；`c_give("bananapop", count)` 放入物品栏，`c_spawn("bananapop")` 在玩家脚下生成，烹饪锅采收的产物也以满新鲜度开始。香蕉冻可食用（生命 +20、饥饿 +12.5、理智 +33，随腐烂阶段折算；`temperature` 降温效果尚未实现），锅内成品腐烂和食材新鲜度传递仍待实现。新鲜度以 `freshnessPercent` 随库存和地面存档保存，读档后从中恢复剩余时间并继续腐烂。`c_spawn("spoiled_food")` 在玩家脚下生成腐烂物，`c_give("spoiled_food", count)` 放入物品栏。









### c_spawn 支持的对象

`c_spawn("chessjunk1")`、`c_spawn("chessjunk2")`、`c_spawn("chessjunk3")` 分别在玩家脚点生成三种棋械残骸；都是世界 prefab，不支持 `c_give`。三者使用 `chessmonster_ruins.zip`，初始声明非循环 `idle1/2/3`；已修复记录按 Lua `OnLoad` 恢复循环 `hit1/2/3`。`c_save()` 保留 ID、位置和已修复记录中的 `repaired`、`repairerid`、`repairerchar`。洞穴导入分别含 23、33、25 个。无皮肤；修复、敲击、战利品及重生行为未接入。

`c_spawn("chesspiece_malbatross_marble")` 在玩家脚点生成大理石邪天翁雕像，无额外参数；按世界 prefab 处理，不支持 `c_give`。使用 `anim/chesspiece.zip` 的 bank `chesspiece` 和 `anim/swap_chesspiece_malbatross_marble.zip` 的 build，按 Lua 声明非循环 `idle`，带 `heavy`、`blocker` 标签，半径 0.45 的障碍碰撞；锤子一击掉落 1 个 `marble` 并播放 `collapse_small` 后移除。无皮肤、无地图图标。原版 `SetPrefabName` 让所有材质都以 `chesspiece_malbatross` 入档，导入器把 `materialid` 为 1 的记录转成本 ID，其他材质尚未移植，遇到时导入报错；默认 `Cluster_1/Master.json` 含 1 座。`c_save()` 保留 ID、位置、`chesspiece.materialid` 和 `submersible.force_no_repositioning`，读档恢复 `idle`。扛起、装备减速、落水打捞、作祟效果尚未接入。

`c_spawn("archive_centipede_husk")` 在玩家脚点生成档案馆蜈蚣残骸，无额外参数；它是世界 prefab，不支持 `c_give`。原版 `archive_centipede.lua` 的 `huskfn` 使用 bank `archive_centipede`、build `archive_centipede_build`（`anim/archive_centipede.zip` + `anim/archive_centipede_build.zip`），构造时声明非循环 `idle_full`，tag 为 `security_powerpoint`、`mech`、`electricdamageimmune`，无小地图图标与碰撞体。生命值 300，每秒回复 1 点；生命百分比跨越 66%／33% 时按源 `OnHealthDelta` 播放 `idle_med`／`idle_low`，或 `low_to_med`、`med_to_full` 后排队对应待机，低于 20% 时移除 `combat` 并保底 15%。每 3～6 秒（之后每 8～18 秒）在待机时按生命区段播放 `idle2_full/med/low` 并排队对应待机，同时播放 `electricity/idle2` 音效。源没有 `OnSave`，`c_save()` 保存 ID、脚点和 `health`（`current`／`maximum`）；按 `health:OnLoad` 读档不切换动画，仍为 `idle_full`。洞穴导入存档包含 2 个（源存档每个洞穴快照 2 个）。无皮肤；活体 `archive_centipede`、`possess` 复活、攻击接线和闹鬼效果尚未接入。

`c_spawn("ruins_statue_mage")`、`c_spawn("ruins_statue_mage_nogem")`、`c_spawn("ruins_statue_head")`、`c_spawn("ruins_statue_head_nogem")` 在玩家脚点生成遗迹雕像，无额外参数；都是世界 prefab，不支持 `c_give`。原版 `statueruins.lua` 的 `commonfn(small)`：法师雕像使用 `anim/statue_ruins.zip`（bank/build `statue_ruins`），头像使用 `anim/statue_ruins_small.zip`（bank/build `statue_ruins_small`）。构造时按噩梦阶段播放循环 `idle_full`；本项目没有噩梦时钟，不使用 `_night` 动画。tag 均为 `cavedweller`、`structure`、`statue`。带宝石的 `ruins_statue_mage` / `ruins_statue_head` 按 `SetGemmed` 从 `statue_ruins_gem.zip` / `statue_ruins_small_gem.zip` 覆盖 `swap_gem` 符号，掉落 `thulecite` 与宝石，并保存 `gem`（存档字段为 `ruinsStatueMage.gem`）；`_nogem` 两种不覆盖宝石、使用 `statue_ruins_no_gem` 掉落表，不保存任何字段。`c_save()` 保存 ID、脚点及宝石种类；当前洞穴导入存档包含法师雕像 3 座、头像 10 座、无宝石头像 3 座，无宝石法师雕像 0 座（较早的快照 `0000000003` 中有 9 座）。无皮肤。采矿、噩梦阶段切换、悬浮音效与遗迹重生行为尚未接入。

`c_spawn("pandoraschest")` 在玩家前方生成华丽箱子（遗迹宝箱），无额外参数；它是世界 prefab，不支持 `c_give`，也不能制作。原版 `treasurechest.lua` 的 `MakeChest("pandoraschest", "pandoras_chest", "pandoras_chest", indestructible)` 使用 `anim/pandoras_chest.zip`，初始声明非循环 `closed`；打开播放非循环 `open`，关闭播放 `close` 后排队非循环 `closed`。它是 3×3 容器，不可锤、不可燃，无皮肤。`c_save()` 保存 ID、位置和箱内物品；洞穴导入存档包含 46 个，源存档中已运行过的 `chest_labyrinth` 场景记录不导入。遗迹重置、拟态箱转换、闹鬼与灵视行为尚未接入。

`c_spawn("atrium_statue")` 在玩家脚点生成远古雕像，无额外参数；它是世界 prefab，不支持 `c_give`。原版 `atrium_statue.lua` 的 `MakeStatue("atrium_statue", false)` 使用 `anim/atrium_statue.zip`（bank/build 都是 `atrium_statue`），构造时播放一次 `idle_full`，随即按噩梦阶段切换为循环 `idle_full`；本项目没有噩梦时钟，阶段不会是 `wild`，因此不使用 `_night` 动画。源码中开采组件被注释掉，雕像不可开采；无 tag、无皮肤、无 `OnSave` 字段。`c_save()` 保存 ID 与位置；洞穴导入存档包含 15 座。会保存旋转的 `atrium_statue_facing` 尚未移植。

`c_spawn("pandoraschest")` 在玩家前方生成华丽箱子（遗迹宝箱），无额外参数；它是世界 prefab，不支持 `c_give`，也不能制作。原版 `treasurechest.lua` 的 `MakeChest("pandoraschest", "pandoras_chest", "pandoras_chest", indestructible)` 使用 `anim/pandoras_chest.zip`，初始声明非循环 `closed`；打开播放非循环 `open`，关闭播放 `close` 后排队非循环 `closed`。它是 3×3 容器，不可锤、不可燃，无皮肤。`c_save()` 保存 ID、位置和箱内物品；洞穴导入存档包含 46 个，源存档中已运行过的 `chest_labyrinth` 场景记录不导入。遗迹重置、拟态箱转换、闹鬼与灵视行为尚未接入。

`c_spawn("atrium_gate")` 在玩家脚点生成远古大门；这是世界 prefab，不支持 `c_give`。洞穴导入存档包含 1 座。主门使用 `atrium_gate.zip` 的非循环 `idle`、独立地板与源定义的无美术阻挡子实体；读档按保存的钥匙、修复、采摘及世界设置计时器字段声明外观与动画。`c_save()` 保存 ID、位置、`atriumGate`、`pickable`、`charliecutscene`、`worldsettingstimer` 和 `entitytracker` 字段。此移植覆盖存档与显示；钥匙交易、满能量战斗、计时器完成与音效事件尚未接入。原版没有大门皮肤。

`c_spawn("statueglommer")` 在玩家脚点生成格罗姆雕像；它是世界实体，不支持 `c_give`。`c_save()` 保存雕像 ID、位置、`statueglommer.worked/spawned`、`pickable` 与 `workable` 字段；读档按 `statueglommer.lua` 的构造及 OnLoad 顺序恢复 `full`、`med` 或 `low` 的非循环动画。默认导入的地表存档含 1 座，洞穴存档无雕像；原版无雕像皮肤。此移植范围为存档和显示，满月生成格罗姆与花、采摘、采矿和发光行为尚未接入。

`c_spawn("mole")` 在玩家脚点生成鼹鼠；`c_give("mole", count)` 给予活鼹鼠（数量为正整数、默认 1，每只单独占一个槽位）；`c_spawn("molehill")` 生成鼹鼠洞，无额外参数，洞穴不能 `c_give`。例如 `c_spawn("mole");c_give("rocks",3);c_give("hammer");c_give("shovel")`。鼹鼠使用原版分离的 `anim/mole_basic.zip`（bank `mole`）和 `anim/mole_build.zip`，地下移动特效使用 `anim/mole_move_fx.zip`，库存图标由导入器解析实际 atlas；原版没有鼹鼠皮肤。

按 `molebrain.lua` 和 `SGmole.lua` 地下行走（2.75 DST 单位/秒）、每 15～25 游戏秒探头、在 20 DST 单位内寻找有 `molebait` / `bait` 的矿物与玩具，并在偷取动画第 12 帧由诱饵的 `onstolen` 转移真实实体（保留 ID、数量和状态）；目标被拾走或燃烧时取消。携带库存为 3 槽，无洞时先等待两段 5～10 秒延迟，在 5～15 DST 单位的可行走陆地寻找新洞；白天、库存满或同伴遇袭时回巢，将库存转入洞穴的 50 槽库存。洞穴在白天排队，黄昏／夜晚延迟 5～20 秒放出同一只鼹鼠，子代死亡或被捕后按原版 1200 游戏秒补生。 世界阶段统一为从 `clock.phase` 派生的 `cycle`（`day`、`dusk`、`night`）；鼹鼠、洞穴和 Sleeper 各自通过 `WorldContentKey.Cycle` 创建私有监听。Mole 直接传入世界的 `getWatchWorldContent`，返回的本地 signal 带有同一世界的只读 `scheduler` 引用；Mole、Molehill 和 Sleeper 从返回值取得调度器，Sleeper 不再单独接收 scheduler 参数。共享实例由世界状态创建、按游戏时间推进并在世界释放时销毁，组件清理只取消自己的任务。Sleeper 自行创建和清理本地 signal：鼹鼠白天睡觉，黄昏／夜晚醒来。调试命令的语法、参数和支持 ID 不变。

装备锤子，在鼹鼠探头时按住 `Ctrl+F` 强制攻击，命中造成 17 点伤害并击晕；地下和击晕状态不可攻击。击晕时掉出携带物，4～8 游戏秒内可左键拾取；从库存丢出也会击晕，再寻找新洞。鼹鼠有 30 点生命，死亡掉落 `smallmeat`；只在库存内按 2 天基础时长变饿。把矿物拿到鼠标上再点库存中的鼹鼠执行 `FEED`：吃一件 ELEMENTAL 食物、按原版食物值恢复生命并重置饱腹度。支持昼间睡眠和排箫催眠；入睡第 1 帧停止嗅闻，睡眠第 27 帧播放原版音量和降调的短睡眠声（不循环原始样本）、第 42 帧停止，回巢／拾取后暂停状态图，避免隐藏实体继续发声。装备铲子右键洞穴执行 `DIG`，一次挖完，掉出储存物和按 4 / 1.5 / 0.5 / 1.5 权重抽取的 `rocks` / `nitre` / `goldnugget` / `flint`；在洞内的鼹鼠被释放并击晕。

`c_save()` 无参数，保存鼹鼠身份、脚点、生命、饱腹度、无家等待时间和携带物；洞穴保存位置、库存、洞内子代或洞外子代的引用，避免重复保存同一只鼹鼠。读档重建洞穴所属关系及补生任务，鼹鼠的暂态动画不入档。原版的冰冻、电击、陷阱／猫攻击和幽灵作祟交互尚未接入。

通过 `c_give` 获取工具或放置物品后，动作切换由共享的 `action:begin` / `action:interrupt` 事件通知各模块取消自身工作；选槽、制作和表情轮保留各自的打断范围。开始事件排除发起者，异步加载被打断后不再提交旧动作；`PICK` 在请求动作时发送开始事件，走近和资源准备均受同一取消机制管理。事件与清理规则见 [库存与动作接线](docs/inventory-architecture.md)。

`c_spawn("flower_cave")`、`c_spawn("flower_cave_double")`、`c_spawn("flower_cave_triple")` 生成单头、双头和三头灯草。按 Lua 的 `plant` / `pickable` 标签提供通用左键 `PICK` 动作；燃烧（`fire`）或 `intense` 状态不可采集。采集分别获得 1、2、3 个 `lightbulb`，灯草立即熄灭并播放 `picking` → `picked`；再生时间分别为 1440、2160、2880 游戏秒，再生后恢复 `pickable` 标签并开始充能。提交前取消或资源准备失败时保留灯草状态；库存满时产物通过共享 `GiveItem` 路径落地，采摘仍成功。`c_save()` 保存实体 ID、位置、外观变体、光照状态与采集后的剩余再生时间，读档后恢复相应标签和计时。

`c_spawn("wormhole")` 在玩家当前位置生成虫洞，使用原版 `anim/teleporter_worm.zip` 的 bank `teleporter_worm` 和 `anim/teleporter_worm_build.zip` 的 build `teleporter_worm_build`。玩家进入 12 个场景单位内（原版 4 单位）播放 `open_pre` → `open_loop`，超过 15 个场景单位（原版 5 单位）播放 `open_pst` → `idle_loop`；距离只计算地面 XZ 平面。开口第 10 帧切入地面背景层，闭合第 4 帧恢复以地面原点排序的世界层，所有状态保持原版 billboard 朝向。用 `c_give("reskin_tool")` 获取清洁扫把并装备到手部，右键虫洞按 `wormhole_claw`、`wormhole_fantasy`、`wormhole_gothic`、`wormhole_lureplant`、`wormhole_spider`、`wormhole_worm` 顺序换肤，再回到默认外观；资源为原版 `anim/dynamic/wormhole_*.zip` / `.dyn`。换肤保留实体 ID、位置和当前动画进度；位置、实体 ID 和皮肤随 `c_save()` 保存，读档后根据玩家距离重新决定开闭。虫洞属于场景实体，通过 `c_spawn` 生成；当前不包含传送、配对、物品投喂或虫洞音效。

`c_spawn("multiplayer_portal_moonrock")` 在玩家当前位置生成月岩多人传送门（由全局 `PrefabEntityManager` 管理），使用原版 `anim/portal_moonrock.zip` 的 bank `portal_moonrock_dst` 和 build `portal_moonrock`，`light`、`portalbg`、`spiralfx1` 符号覆盖自 `anim/portal_stone.zip`，按地上世界隐藏 `eye`、`eyefx`、`FX_rays` 层；不入档的 `multiplayer_portal_moonrock_fx` 子实体（`FX` 标签）隐藏 `portal` 层并覆盖 `FX_ray1`，与传送门同步播放动画、随传送门移除。动画由 `SGmultiplayerportal` 驱动：`idle` 单次播放 `idle_loop`，进入时和第 30 帧（游戏时间）播放 `spawnportal_jacob`，animover 后 30% 进入 `funnyidle`（`idle_eyescratch`），否则重新进入 `idle`；收到 `rez_player`（幽灵作祟复活）时依次进入 `spawn_pre`／`spawn_loop`／`spawn_pst`，播放 `spawnportal_spawning`、`spawnportal_shake` 和第 55 帧的 `spawnportal_open`。`portal_rez` 世界设置开启时带 `hauntable`（`HAUNT_INSTANT_REZ`）与 `resurrector` 标签。月岩传送门无环境循环音效（Lua `idle_loop = nil`）。位置和实体 ID 随 `c_save()` 保存，下载的存档加载后会恢复传送门及其 FX 子实体。未实现建造系统、`moontrader`（月岩偶像换角色）及洞穴分支。

用 `c_spawn("wall_stone")`、`c_spawn("wall_wood")`、`c_spawn("wall_hay")`、`c_spawn("wall_ruins")`、`c_spawn("wall_moonrock")` 或 `c_spawn("wall_dreadstone")` 生成建成墙；`wall_*_item` 别名仍生成建成墙。`c_give("wall_stone_item", 10)` 等命令获取可放置的墙物品，库存图标、掉落地面的 `idle` 动画与建成墙的 `half` 外观分别使用各自原版资源。装备 `c_give("reskin_tool")` 获取的清洁扫把，右键建成墙可按下表循环换肤，最后回到默认外观；原有地面墙物品也可换肤。放置带皮肤的墙物品会映射到对应的建成墙皮肤，保留正面/斜面随相机朝向切换、受击动画和绝望石墙的红色覆盖层。换肤保留实体 ID、地面落点及已保存的健康状态；建成墙皮肤随 `c_save()` 保存并恢复，旧的无皮肤墙存档仍可加载。档案馆墙 `wall_stone_2` / `wall_ruins_2` 和废料墙 `wall_scrap` 没有原版皮肤，不提供换肤。

墙体与栅栏的 display 使用动画包的 `ResidentSpriteController` 与共享精灵工厂；离开活动区只释放 visual，唤醒后恢复当前朝向、皮肤和姿态，实体 ID、脚点、健康／工作组件、物理登记和存档状态继续保留。栅栏燃烧计时在休眠时继续，到期仍移除实体。调试命令语法、参数与支持的 `c_spawn` / `c_give` ID 不变，`c_save()` 可继续保存休眠实体。

墙、栅栏、骨骸、遗迹复制品、留声机与耕地机的 `HAMMER` 回调在各自 prefab 模块注册到真实实例；组件负责工作量和掉落，拆毁效果交给共享 FX 入口。受击动画按 Lua 声明非循环 `hit → idle`（墙回到当前健康姿态），休眠重建仍保留声明。蜂后巢的工作与再生回调读取实例的组件和计时状态。`c_spawn`、`c_give`、`c_save()` 的语法、支持 ID 和存档字段保持不变。

墙体同样以 `PrefabInstance` 持有皮肤、外观、组件、物理和移除状态，prefab 不再读写模型 `userData`、等待资源或监听相机。`SpriteResources` 缓存静态工厂，`PrefabDisplay` 根据已有的世界相机输入选择正面／斜面图及对应受击动画，并保留绝望石叠层；墙体模型位置直接作为脚点，显示层负责贴图底部对齐。换肤、休眠和唤醒均保留原实例，`c_spawn("wall_stone")`、`c_give("wall_stone_item", 10)`、`c_save()` 的语法、参数、支持 ID 和既有存档字段不变。

墙按 `prefabs/walls.lua` 拥有 `health` 与 `combat` 组件：最大生命为草墙 100、木墙 200、石墙与档案馆石墙 400、铥矿墙 800、月岩墙 600、绝望石墙 800、废料墙 600，新建成的墙以一半生命开始；月岩墙、绝望石墙和废料墙按 `SetAbsorptionAmountFromPlayer(.25)` 减免 25% 玩家伤害。外观由生命 signal 派生：≤0 `broken`、≤40% `onequarter`、≤50% `half`（原有静态图）、<99% `threequarter`、满血按世界坐标稳定选择 `fullA` / `fullB` / `fullC`；受击播放对应的 `*_hit` 再停在该姿态，同时播放材质的 `destroy_*` 音效。生命为 0 的墙显示破损外观，不再是攻击目标，但仍可锤毁（按 0 生命掉落 1 份材料）。墙的当前生命随换肤保留，并以 `health: { current, maximum }` 随 `c_save()` 保存恢复；旧存档缺少该字段时按一半生命加载。

按 F 攻击附近的敌对目标，按住 Ctrl + F 强制攻击：墙不是敌对目标，只能强制攻击（游戏会拦截浏览器的 Ctrl+F 查找）。按 `playercontroller.lua:GetAttackTarget` 在攻击距离外加 6 个单位的范围内选最近的可攻击目标，自动走到攻击距离内，按 `SGwilson.lua` 的 attack 状态出手并在第 8 帧结算：空手为 `punch` 和 `attack_whoosh`、伤害 `UNARMED_DAMAGE = 10`、冷却 24 帧；武器为 `atk_pre → atk` 和 `attack_weapon`（暗夜剑为 `attack_nightsword`）、冷却 13 帧；提灯（`light`）、清洁扫把与各法杖（`nopunch`）使用武器动作但造成空手伤害。武器伤害取源码 `weapon` 组件：火把、锤子、铲子、草叉、园艺锄 17，鹤嘴锄 27.2，捕虫网 4.25，暗夜剑 68；攻击按 `attackwear` 消耗有耐久的工具（捕虫网 3 次，金色工具 0.25 次，暗夜剑新增原版 100 次耐久）。最小攻击间隔为 `WILSON_ATTACK_PERIOD = 0.4` 秒，按住 F 会在每次攻击的冷却结束后连续攻击；移动、Esc 或鼠标点击取消尚未出手的攻击。墙体碰撞随健康值启用／禁用；修理墙、火把点燃可燃墙及生物战斗尚未实现。

| 建成墙 prefab_id | 皮肤循环顺序 |
| --- | --- |
| `wall_stone` | `wall_stone_an`、`wall_stone_ancient`、`wall_stone_ancient_alt`、`wall_stone_gothic`、`wall_stone_rose`、`wall_stone_shell`、`wall_stone_victorian` |
| `wall_wood` | `wall_wood_ornate` |
| `wall_hay` | `wall_hay_corn` |
| `wall_ruins` | `wall_ruins_thulecite`、`wall_ruins_thulecite2`、`wall_ruins_thulecite2_alt`、`wall_ruins_thulecite_alt`、`wall_ruins_victorian` |
| `wall_moonrock` | `wall_moonrock_victorian` |
| `wall_dreadstone` | `wall_dreadstone_relic` |

`c_give("fence_item", 6)` 获取木栅栏物品（每叠 20 个，对应 `fence.lua` 的 `STACK_SIZE_MEDITEM`），`c_spawn("fence_item")` 生成同一个可拾取的地面物品；`c_spawn("fence")` 在玩家前方的格子中心生成已建成的栅栏（旋转为 0，使用窄的 `fence_thin` bank）。`fence_item` 的库存图标为 `images/inventoryimages.xml` 的 `fence_item.tex`，地面使用 `fence/fence/inventory`；它可点燃并留下灰烬，尚未实现燃料用途。物品栏中左键 `fence_item` 进入放置预览：预览按 `MakePlacer(..., fixedcameraoffset = 0, "eight")` 相对相机放置，旋转为 `-相机 heading`，所以放置时栅栏总是正对相机；预览为 65% 不透明，格子吸附与墙相同（1 DST 单位），按 `CalcRotationEnum` 的奇偶选 bank——奇数用 `fence`（宽），偶数用 `fence_thin`（窄），旋转相机时预览随之切换。若紧贴一道与之平行的栅栏且朝向相反（从背面补洞），预览会旋转 180° 与邻居同向（`FixUpFenceOrientation`）。左键放置消耗 1 个物品并播放 `place_structure_wood`，右键取消。已建成的栅栏是八向动画实体：由 `rotation + 相机 heading` 选择 `facing` 掩码（DOWN=8、UP=2、左右共用 5、两组斜向共用 48/192），左右共用的 clip 面向左侧时水平镜像；旋转相机时已放置的栅栏随之换面，但保存的旋转不变。













草丛、树苗、浆果丛、石果灌木、猴尾草、蘑菇、仙人掌和洞穴蕨的逻辑状态由 `PickablePlantInstance` 持有：组件、皮肤、存档身份和 `persists` 不再由植物逻辑写入 `model.userData`。`PrefabDisplay` 负责共享 archive sprite 的绘制、相机朝向和活动区卸载／恢复；燃烧复用通用火焰 FX，休眠只释放 visual，采摘再生、枯萎和燃烧计时继续。小地图按 Lua 由实例声明：`sapling`／`sapling_moon` 共用 `sapling.png`，`grass` 使用 `grass.png`，`berrybush` 使用 `berrybush.png`；采摘和休眠保留标记，读档重建声明，永久移除时清理。`c_spawn("grass")`、`c_spawn("berrybush")`、`c_give("dug_berrybush")` 等现有命令的语法、参数和支持 ID 不变，`c_save()` 继续保留身份、脚点、皮肤及组件计时状态。

| 类型 | prefab_id |
| --- | --- |
| 建筑 | `cookpot`、`firepit`、`icebox`、`treasurechest`、`tent`、`moonbase`、`moondial`、`wardrobe`、`dragonflychest`、`bookstation`、`campfire`、`saltbox`、`nightlight`、`pighouse`、`sculptingtable`、`winterometer`、`lightning_rod`、`pighead`、`mermhead`、`birdcage`、`mushroom_light`、`mushroom_light2` |
| 科技建筑 | `researchlab`、`researchlab2`、`researchlab3`、`researchlab4` |
| 墙 | `wall_stone`、`wall_stone_2`、`wall_wood`、`wall_hay`、`wall_ruins`、`wall_ruins_2`、`wall_moonrock`、`wall_dreadstone`、`wall_scrap`，以及各自的 `wall_*_item`（两种 ID 均生成建成的墙） |
| 洞穴植物 | `flower_cave`、`flower_cave_double`、`flower_cave_triple`、`lightflier_flower`（采摘或亮灯计时结束释放 `lightflier`，虫在外时暂停生长，回巢立即恢复；`idle` 使用共享 InstancedMesh） |
| 光照星体 | `stafflight`、`staffcoldlight` |
| 池塘 | `pond`（生成时按 `pond.lua` 带 2～4 株 `marsh_plant`，结冰时移除、解冻后在新位置重新生成）、`marsh_plant`（`c_spawn` 生成的独立植物可存档；池塘的植物由池塘按偏移重建，不单独存档） |
| 石笋 | 世界实体：`stalagmite`、`stalagmite_full`、`stalagmite_med`、`stalagmite_low`、`stalagmite_tall`、`stalagmite_tall_full`、`stalagmite_tall_med`、`stalagmite_tall_low`；例如 `c_spawn("stalagmite_tall_med"); c_save()`，均无额外参数、无 `c_give`。full/med/low（含高型左右款式）使用共享 `InstancedMesh` 绘制，保留 Lua 的非循环播放；高型随机左右款式；按 Lua 不保存工作进度、左右款式或明暗。默认洞穴导入 834 个，源/导入逐项一致；[源码、字段与验收说明](docs/dst-stalagmite.md) |
| 岩石 | `rock1`、`rock2`、`rock_flintless`、`rock_flintless_med`、`rock_flintless_low`、`cavein_boulder`、`rock_moon_shell`、`rock_moon`、`moonglass_rock` 均可开采；`moonrockseed` 仅静态地面美术；均支持 `c_spawn("ID")` |
| 草丛 | `grass`（共享 archive sprite，`instancedAnimations: 'all'` 合批；命令与 ID 不变） |
| 石果灌木及幼苗 | `rock_avocado_bush`、`rock_avocado_fruit_sprout_sapling` |
| 大理石灌木及幼苗 | `marbleshrub`、`marbleshrub_short`、`marbleshrub_normal`、`marbleshrub_tall`、`marblebean_sapling` |
| 洞穴入口 | `cave_entrance`（封闭，装备 `pickaxe` 左键 `MINE`，6 次工作后掉落 2 个 `rocks`、3 个 `flint` 并原地变为 `cave_entrance_open`）、`cave_entrance_open`（背景层；`worldmigrator` 目的地为 `Caves`，目的地可用时播放 `open` 循环，左键点击走近后执行 `MIGRATE` 并跳转到 `?save=Cluster_1/Caves.json`；蝙蝠、玩家背包／状态随行、地表存档保存尚未接入）；无 `c_give`，`c_save()` 保留 ID 与位置，未挖完的入口重载后恢复满工作量 |
| 月亮洞穴水池 | `grotto_pool_big`（半径 5.5 障碍物理，发光，小地图 `grotto_pool_big.png`，约 0 帧后在 `prefab_layout` 位置生成 `grotto_waterfall_big` 和 3 种 `grotto_moonglass_*`）、`grotto_pool_small`（半径 2，生成随机 `grotto_waterfall_small1` 或 `grotto_waterfall_small2`）；子物件也可单独 `c_spawn`：`grotto_waterfall_big`（NOCLICK 瀑布）、`grotto_moonglass_1` / `grotto_moonglass_3` / `grotto_moonglass_4`、`grotto_waterfall_small1` / `grotto_waterfall_small2`（镐 `MINE` 6 次，掉落 `moonglass`；挖空后在洞穴满月夜晚每次变化有 10% 概率恢复并生成 `halloween_moonpuff`）；水池无 `c_give`，`c_save()` 保留子物件 ID、位置和剩余工作量 |
| 月亮碎片 | `moonglass`（`c_give("moonglass", 40)` / `c_spawn("moonglass")`，叠加上限 40，地面固定 `f1` 姿态）；`halloween_moonpuff` 特效可 `c_spawn`，不入档 |
| 遗迹石柱 | `pillar_ruins`（`idle` 循环 billboard，半径 2.35 的障碍物理，标签 `charge_barrier`、`quake_on_charge`、`blocker`）；`c_spawn("pillar_ruins")` 无额外参数，没有 `c_give`；`c_save()` 保存 ID 和位置。未接入：`shake` 事件的 `hit` 动画。 |
| 洞穴石柱 | `pillar_cave`、`pillar_cave_flintless`、`pillar_cave_rock`、`pillar_algae`（`idle` 循环 billboard，半径 2.35 的障碍物理，标签 `blocker`）；`c_spawn("<id>")` 无额外参数，没有 `c_give`；`c_save()` 保存 ID 和位置。未接入：`shake` 事件的 `hit` 动画 |
| 远古大门石柱 | `pillar_atrium`（`idle` 循环，半径 2.35、高 6 的圆柱障碍，标签 `blocker`、`groundhole`、`pillar_atrium`）；`c_spawn("pillar_atrium")` 无额外参数，没有 `c_give`；`c_save()` 保存 ID 和位置。未接入：`atriumpowered` 事件的 `idle_active` 动画 |
| 档案馆石柱 | `archive_pillar`（`idle` 循环，半径 1.8、高 6 的圆柱障碍，小地图 `pillar_archive.png`，标签 `blocker`、`archive_pillar`；构造时 20% 概率换成 `pillar_archive_broken` 的 bank 和 build）；`c_spawn("archive_pillar")` 无额外参数，没有 `c_give`；`c_save()` 保存 ID、位置和 `broken` |
| 宝库石柱 | `vault_pillar`（单次 `idle_upper`／`idle_upper_capped`／`idle_upper_capped_2`／`idle_upper_broken`，下半部分 `idle_lower` 是不入档的子实体；标签 `decor`、`nomagic`、`nohighlight`，无物理）；`c_spawn("vault_pillar")` 无额外参数，没有 `c_give`；`c_save()` 保存 ID、位置和 `capped` 或 `broken`。未接入：`AttachRelic` 生成的遗物 |
| 猴岛石柱 | `monkeypillar`（`idle1`～`idle4` 单次播放，`animover` 接下一段，每 15～25 秒穿插一次 `idleN_move`；半径 0.6、高 24 的障碍物理，发光，雪覆盖，标签 `blocker`、`SnowCovered`、`inspectable`）；`c_spawn("monkeypillar")` 无额外参数，没有 `c_give`；`c_save()` 保存 ID、位置和 `pillar_id` |
| 洞穴破洞 | `cave_hole`（环形地面洞，`surface`／`hole` 两层 OnGround 美术，外壁半径 2.75、内壁半径 1.5 的中空碰撞，小地图 `cave_hole.png`；灵魂跳跃不能落在两壁之间，可以落进内壁以内，由于推开玩家未接入，进去后只能再跳出来）；`c_spawn("cave_hole")` 无额外参数，没有 `c_give`；`c_save()` 保存 ID、位置和 `allowspawn`。未接入：洞中物品生成（`tryspawn`）、`outofreach`、推开玩家和 `resetruins`，所以新生成的洞是空的 |
| 洞穴出口 | `cave_exit`（`cave_stairs` 楼梯静态美术，`open` 循环，半径 2 的障碍物理，小地图 `cave_open2.png`；`worldmigrator` 目的地为 `Master`，左键点击走近后执行 `MIGRATE` 并跳转到同目录的 `Master.json`；地表存档保存、玩家物品与状态随行尚未接入）；无 `c_give`，`c_save()` 保留 ID 与位置 |
| 蘑菇树 | `mushtree_moon`（月亮蘑菇树，15 次 `CHOP`）、`mushtree_medium`（红蘑菇树，10 次 `CHOP`，夏季开花、三阶段生长）、`mushtree_tall`（蓝蘑菇树，15 次 `CHOP`，冬季开花、三阶段生长）及对应 `mushtree_moon_stump`、`mushtree_medium_stump`、`mushtree_tall_stump`；`idle_loop` 使用完整帧实例化，工作／倒下等动画使用共享帧；砍倒后掉落 `log` 并留下 `DIG` 树桩（再掘出 1 个 `log`），可燃烧；`moon_cap` 尚无地面物品，不掉落；孢子、酸雨与再生暂未接入。无 `c_give`，`c_save()` 保留 ID、位置、树桩 / 生长阶段 / 开花状态 |
| 蘑菇 | `red_mushroom`（白天张开，`red_cap`）、`green_mushroom`（黄昏张开，`green_cap`）、`blue_mushroom`（夜晚破土张开，`blue_cap`），`c_spawn("red_mushroom")` 等；`PICK` 得对应的帽；采后下雨满 10–20 个 30 秒周期再生；`DIG` 未采得 2 个、已采得 1 个对应的帽；可燃烧；`hauntable` 与满月变形未移植；通过共享 archive sprite 的 `instancedAnimations: 'all'` 合批绘制姿态和非循环过渡动画，保持逐株播放与 alpha 拾取；无 `c_give`，`c_save()` 保留 ID、位置、已采状态与剩余雨量，命令语法与支持 ID 不变 |
| 档案馆静态物件 | `archive_moon_statue`、`archive_rune_statue`、`archive_portal`、`archive_switch_base`、`archive_switch_pad`、`archive_ambient_sfx`、`rubble1`、`rubble2`（均无 `c_give`；`archive_switch_pad` 与两种 `rubble` 不入档） |
| 玩家骷髅 | `skeleton_player`（无 `c_give`；锤子 3 次敲出 2 个 `boneshard`；玩家死亡时自动生成） |
| 骷髅 | `skeleton`（`idle1`～`idle6`）、`skeleton_notplayer`（`idle7`～`idle8`）、`skeleton_notplayer_1`（`idle7`）、`skeleton_notplayer_2`（`idle8`）（均无 `c_give`；只有 `c_spawn`；锤子 3 次敲出 2 个 `boneshard`，另有 10% 概率掉 `scrapbook_page`；不带 `playerskeleton` 标签，也不保存死者描述） |
| 普通浆果丛 | `berrybush` |
| 猴尾草 | `monkeytail` |
| 仙人掌 | `cactus`、`oasis_cactus`（`c_spawn` 生成在玩家脚点；左键 `PICK` 得 `cactus_meat`，并对玩家造成 6 点伤害：先经身上护甲按吸收率分摊并扣耐久，剩余伤害扣生命，玩家进入 `hit` 受击状态；夏季开花时另得 `cactus_flower`；采后关闭碰撞，4 游戏日后长回；可燃烧；小地图图标；`c_save()` 保留 ID、位置和采摘／再生状态，存档 `Cluster_1/Master.json` 含原版导入的 14 株 `cactus` 与 18 株 `oasis_cactus`） |
| 树苗 | `sapling`、`sapling_moon`（共享 archive sprite，`instancedAnimations: 'all'` 合批；命令与 ID 不变） |
| 猎犬骨 | `houndbone`（bank `houndbase`、build `hound_base`，随机或存档的 `bonetype` 1～3 对应 `piece1`～`piece3`；装备锤子右键 `HAMMER` 一次即碎，掉落 `boneshard`，`piece3` 另有 50% `houndstooth`，并播放 `collapse_small`（岩石材质）；通过共享 archive sprite 的 `instancedAnimations: 'all'` 合批；只可 `c_spawn`，无 `c_give`，`c_save()` 保留 ID、位置与 `bonetype`） |
| 遗迹家具 | 天然世界实体：`ruins_table`、`ruins_chair`、`ruins_vase`、`ruins_chipbowl`、`ruins_bowl`、`ruins_plate`，以及 `ruins_rubble_table/chair/vase`；例如 `c_spawn("ruins_rubble_chair"); c_save()`，无额外参数，无 `c_give`。复制品：`ruinsrelic_table/chair/vase/chipbowl/bowl/plate` 均可 `c_spawn("完整ID")`；只有 vase/chipbowl/bowl/plate 可 `c_give("完整ID", count)`（默认 1，每份占一格）。保存身份、位置、生命值、碎石状态及椅子复制品的两种皮肤；资源和源码动画逐项说明见 [遗迹家具移植](docs/dst-ruinsrelic.md)。默认洞穴新增 154 个天然遗迹，所有源数量与导入数量一致 |
| 长成的蜂后蜂巢 | `beequeenhivegrown`（`c_spawn("beequeenhivegrown")`，无参数；世界实体无 `c_give`。源 `prefabs/beequeenhive.lua` 使用 `anim/bee_queen_hive.zip`，bank/build 均为 `bee_queen_hive`，生成时播放非循环 `large`，锤击声明 `large_hit` → 非循环 `large`；`c_save()` 保留 ID、脚点、`workable` 的 16 次最大工作量与剩余量，以及存在时的 `hiveregen` 计时器。源无皮肤；`beequeenhive` 基座生成蜂巢、蜂后生成与锤击掉落尚未接入） |
| 龙蝇与生成器 | `dragonfly`、`dragonfly_spawner`（均可 `c_spawn("ID")`，无 `c_give`。生成器是不可见的 `CLASSIFIED` 实体；原始地表存档导入 1 个，保存着 `childspawner.childreninside=1` 和 `queued_spawn=true`，玩家进入活动区后释放排队的龙蝇。生成器按源 Lua 的子代计数、定时生成与 20 游戏日再生计时器保存／恢复；`c_save()` 保留生成器与龙蝇的 ID、位置及组件状态。龙蝇使用 bank `dragonfly`、通常 build `dragonfly_build`、循环 `idle`；原版节日活动还会选用 `dragonfly_yule_build`，源未定义皮肤。战斗行为尚未实现） |
| 洞穴蕨 | `cave_fern`、`cave_fern_withered`（bank `ferns`，build 分别为 `cave_ferns` / `cave_ferns_withered_build`，生成时随机选 `f1`～`f10` 姿态；快速 `PICK` 分别得 `foliage` / `cutgrass`，采后按 `remove_when_picked` 直接移除，无 `workable` 不能铲；可燃烧；通过共享 archive sprite 的 `instancedAnimations: 'all'` 合批，使用 `ResidentSprite` 随活动区卸载／重建 visual，保留实体、组件与姿态，重建后恢复相机朝向；无 `c_give`，`c_save()` 保留 ID、位置与姿态） |
| 苔藓 | `lichen`（`c_spawn("lichen")`，无参数；世界实体无 `c_give`。源 `prefabs/lichen.lua` 使用 `anim/algae_bush.zip`，bank/build 均为 `algae_bush`，tag `lichen`；构造时从随机帧开始循环 `idle`，通过共享 `InstancedMesh` 绘制（采摘、生长与已采姿态也复用批次），并随机 `SetMultColour`（0.75～1 灰度，不保存）。左键 `PICK` 得 `cutlichen`，播放 `pickup_lichen` 音效与 `picking` → 非循环 `picked`，5 游戏日后 `grow` → 循环 `idle`；冬季不生长；可燃烧，无 `workable` 不能铲；`c_save()` 保留 ID、位置和采摘／再生状态；洞穴导入存档包含 258 株。无皮肤） |
| 池塘 | `pond` |
| 温泉 | `hotspring` |
| 风滚草 | `tumbleweed` |
| 熔岩池及焦岩 | `lava_pond`、`lava_pond_rock`、`lava_pond_rock2`～`lava_pond_rock7` |
| 场景装饰 | `nightmaregrowth`、`wormhole`、`multiplayer_portal_moonrock` |
| 耕地机及耕地装饰 | `farm_plow`、`farm_plow_item`（未部署物品）、`farm_soil`、`farm_soil_debris`、`farm_plant_randomseed`、`farm_plant_<carrot|corn|pumpkin|eggplant|durian|pomegranate|dragonfruit|watermelon|tomato|potato|asparagus|onion|garlic|pepper>`（播种后外观） |
| 种子地面物品 | `seeds`、`<veggie>_seeds` |
| 蘑菇地面物品 | `red_cap`、`red_cap_cooked`、`green_cap`、`green_cap_cooked`、`blue_cap`、`blue_cap_cooked` |
| 荧光果地面物品 | `lightbulb` |
| 腐烂物 | `spoiled_food` |
| 带新鲜度的肉与冰 | `meat`（`PERISH_FAST`，腐烂为 `spoiled_food`）、`ice`（`PERISH_SUPERFAST`，带 `frozen` 标签；物品栏中融化时整堆消失，地面上播放 `melt` 后消失；`c_spawn("ice")`、`c_give("ice", n)`） |
| 鸟与鸟蛋 | `crow`、`robin`、`robin_winter`、`canary`（地面为 `stunned_loop` 姿势）、`bird_egg`、`rottenegg`、`smallmeat` |
| 料理地面物品 | `meatballs`、`bananajuice`、`bananapop` |
| 背包地面物品 | `backpack` |
| 身体护甲地面物品 | `armorsnurtleshell`（蜗壳护甲）：`c_give("armorsnurtleshell")`、`c_spawn("armorsnurtleshell")` |
| 重生护符 | `amulet`（红色护符）：`c_give("amulet")`、`c_spawn("amulet")` |
| 手部工具地面物品 | `torch`、`lantern`、`hammer`、`bugnet`、`fishingrod`、`pickaxe`、`goldenpickaxe`、`axe`、`goldenaxe`、`moonglassaxe`、`reskin_tool`、`greenstaff`、`firestaff`、`opalstaff`、`trident` |
| 火魔杖 | `firestaff`（`c_give` / `c_spawn` 均可，20 次耐久，9 种皮肤可由 `reskin_tool` 切换） |
| 武器地面物品 | `nightsword` |
| 暖石地面物品 | `heatrock` |
| 地皮地面物品 | 全部 40 种 `turf_*`，完整 ID 见上文 |
| 剃刀地面物品 | `razor` |
| 排箫地面物品 | `panflute` |
| 书本地面物品 | `book_silviculture` |
| 彩虹宝石地面物品 | `opalpreciousgem` |
| 墙体拆除材料 | `dreadstone`、`wagpunk_bits` |
| 石材地面物品 | `cutstone`、`marble`、`moonrocknugget` |
| 月树花 | `moon_tree_blossom` |
| 花瓣 | `petals`（可采花获取，`c_spawn` / `c_give` 均支持，腐败为 `spoiled_food`） |
| 花朵、蝴蝶种花及掉落 | `flower`、`flower_rose`、`planted_flower`（后两者运行时及存档均为 `flower`）、`butterfly`、`butterflywings`、`butter` |
| 常青树 | `evergreen`、`evergreen_short`、`evergreen_normal`、`evergreen_tall`（地图显示常态／树桩／烧毁图标） |
| 松果地面物品 | `pinecone` |
| 桦树 | `deciduoustree`、`deciduoustree_short`、`deciduoustree_normal`、`deciduoustree_tall`（循环摇摆与烧毁姿态使用 `InstancedMesh` 合批；地图显示常态／树桩／烧毁图标；树叶缺失子图保持隐藏） |
| 桦栗果地面物品 | `acorn` |
| 月树／幼苗 | `moon_tree`、`moon_tree_short`、`moon_tree_normal`、`moon_tree_tall`（地图显示常态／树桩／烧毁图标，保存腐朽计时器）、`moonbutterfly_sapling`（幼苗无地图图标） |
| 火药 | `gunpowder` |
| 木栅栏 | `fence`（世界栅栏，只能 `c_spawn`）、`fence_item`（`c_give` 与 `c_spawn`） |
| 石果及石果芽 | `rock_avocado_fruit`、`rock_avocado_fruit_ripe`、`rock_avocado_fruit_ripe_cooked`、`rock_avocado_fruit_sprout` |
| 仙人掌花 | `cactus_flower`（`c_give("cactus_flower", n)` / `c_spawn("cactus_flower")`，堆叠 40，生命 +8、饥饿 +12.5、理智 +5，3 游戏日腐败为 `spoiled_food`） |
| 可燃材料、草簇及灰烬 | `cutgrass`、`log`、`dug_rock_avocado_bush`、`dug_berrybush`、`dug_monkeytail`、`dug_grass`、`dug_sapling`、`dug_sapling_moon`、`ash` |
| 园艺锄地面物品 | `farm_hoe`、`golden_farm_hoe` |
| 铲子地面物品 | `shovel`、`goldenshovel` |
| 可拾取家具及唱片 | `phonograph`、`record` |
| 生物 | `fireflies`（`swarm_loop` 使用共享完整帧实例化，开始／结束动画使用共享帧；视锥外跳过实例提交，静止动画不重复同步空间／放置索引；未装备 `bugnet` 时带 `NOCLICK`，装备后仍受昼夜／靠近淡出规则限制；保留夜间自亮、虫网捕获和 tickingarea 休眠释放）、`beefalo`、`bernie_inactive`（地面形态由理智决定） |

`archive_moon_statue` 读档及采矿后的 `idle_full_1`～`idle_full_4`、`idle_med_1`～`idle_med_4`、`idle_low_1`～`idle_low_4` 循环动画使用共享 `InstancedMesh` 合批；新生成雕像仍按 Lua 单次播放初始动画。休眠／唤醒保留采矿状态，`c_spawn("archive_moon_statue")`、`c_save()` 的语法、参数和支持 ID 不变；原版只保存雕像款式，读档恢复满工作量。

`c_spawn("lightflier_flower")` 生成月亮蘑菇花，`c_spawn("lightflier")` 生成活动的球状光虫；`c_give("lightflier", 3)` 给予可堆叠的活虫（上限 40）。持有活虫会吸引附近的光虫围绕玩家编队；地面活虫需装备 `bugnet` 捕获，放下整堆时拆成独立实体。活虫在容器中 2 游戏日饥饿，可喂蔬菜恢复存活时间，饿死或被击杀产生荧光果。支持睡眠、冷冻／解冻、受击惊慌、原版发光与飞行声音；远处休眠的虫白天可直接回巢。`c_save()` 保存花的品种、采摘／暂停状态、亮灯计时及子代引用，并保留虫的身份、位置、生命、已知巢址和物品数量／新鲜度；编队是临时状态，读档后重新寻找持虫玩家。

`c_give` 可用的物品 ID 由 [src/inventoryItems.ts](src/inventoryItems.ts) 汇总的物品定义决定；命令解析见 [src/debugCommands.ts](src/debugCommands.ts)，场景与存档共享 [src/prefabDefinitions.ts](src/prefabDefinitions.ts) 的 prefab 注册定义，统一声明持久化 ID、`c_spawn` ID/别名及组件校验规则；[src/sceneEntities.ts](src/sceneEntities.ts) 将创建、恢复、导出、更新和销毁绑定到同一份定义，由 [src/entityRegistry.ts](src/entityRegistry.ts) 调度。新增 prefab 无需再维护存档 ID 白名单；启动时会检查共享定义是否都已绑定场景处理函数。`c_spawn` 的支持 ID 来自定义的 `debugSpawnIds`，落点规则由对应创建函数决定。

默认存档整簇重新导入（完整参数说明见 [存档转换](scripts/save-convert.md)）：

```bash
python3 scripts/import-dst-region.py --cluster public/saves/Cluster_62 --output public/saves/Cluster_1 --origin-cell 214 213 --forest-origin-cell 189 197
python3 scripts/import-dst-region.py --cluster public/saves/Cluster_62 --output public/saves/Cluster_1 --origin-cell 214 213 --forest-origin-cell 189 197 --check
```

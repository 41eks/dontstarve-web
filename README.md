# dontstarve-web

https://41eks.github.io/dontstarve-web/


仅 `pnpm build` 的产物启用缓存，开发服务器不注册 Worker。首次安装接管之前的请求仍走网络；后续请求和再次访问会使用缓存。可在开发者工具 Application → Cache Storage 查看 `dontstarve-assets:` 缓存；清理站点数据会删除缓存。HTML、应用 JS/CSS 和存档不在该缓存范围内，因此尚不提供整个应用的离线启动。运行 `pnpm test:asset-cache` 验证构建版本更新、实际浏览器缓存命中、离线资源读取、音频范围请求及更新生命周期。

场景实体的活动区域与资源管理方案见 [按 tile 管理生命周期](docs/tile-lifecycle.md)：每个 tile 持有活动 signal，玩家跨 tile 时更新区域差集，prefab 用 `createMemo` 派生活动状态。活动网格已接入运行时；萤火虫按活动区域加载／释放动画资源，温泉控制显隐，海浪休眠移除。



## 调试命令（debugCommand）

制作菜单右侧快捷栏按面板高度整体同比缩放，按钮、页码和槽位间距保持比例；窗口变矮时不再溢出面板。大小屏均将面板中心对齐窗口高度的 50%；展开和收起共用垂直定位与缩放原点，仅横向移动。该布局调整不改变调试命令的语法、参数、支持 ID 或存档格式。

实体元数据直接从 `PrefabInstance` 读取：`prefab`、`entityId`、`saveRecord`、`skinId`、`persists`；半径通过 `instance.getPhysicsRadius(fallback)` 获取。模型入口通过 `prefabInstance(model)` 找到实例，地面物品状态以 `ItemEntity` 为准，visual 显式提供 `instance`。公共实体创建与动作注册入口不再向模型写入 `components`、`display`、`animationController` 或动作目标；分别通过 `instance.components`、`instance.sprite`、`prefabDisplay(model)` 和 `findActionEntity(model)` 访问所属对象。建筑以实例位置作为脚点，sprite 底部对齐与资源释放由 display 处理；地面物品的数量、位置和拾取状态以 `ItemEntity` 为准。这些字段不再通过模型的 `userData` 转发。此次调整保留 `c_spawn`、`c_give`、`c_save()` 的语法、参数、支持 ID 与存档格式。

prefab 包内原先直接持有 `scene` 的 38 个类改由 `PrefabDisplayGroup` 接管显示对象的场景挂载和场景内释放，燃烧传播通过逻辑实体查询发现邻居。梦魇方尖碑的升降、隐藏状态、状态图和任务直接属于 `NightmareRockInstance`，通过 `prefabInstance(model)` 读取；不再写入 `model.userData.nightmareRock` 或 `removed`。方尖碑休眠保留逻辑状态和碰撞，永久移除取消任务并释放显示；`sanityrock`／`insanityrock` 的 `c_spawn` ID、命令参数及 `c_save()` 字段不变。

`PrefabInstance.skinId` 写入 `SpriteJson.skinId`，display 按 prefab 声明的源皮肤映射从共享缓存加载并应用 build，清空时恢复基础外观。扫把施法前由 display 预热，命中时更新声明，保留原实体、组件、动画进度与回调；`c_spawn`、`c_give`、`c_save()` 的语法、支持 ID 与存档字段沿用现有实现。

玩家的动画、装备外观、颜色和读书／工具破损 FX 通过 `instance.sprite` 声明，由 `PrefabDisplay` 加载并绘制；`createWilsonPlayer` / `createWilsonPlayerPrefab` 同步创建实体和刚体，美术等待由应用的 `display.artLoaded()` 承担。状态图使用导入的动画时长，动作与 FX 计时器不等待资源；加载完成只应用当前外观，不回写玩家逻辑。刚体绑定和逻辑清理由 `PrefabInstance` 管理。休眠释放 visual，保留位置、刚体、装备与状态图时间线，唤醒复用共享资源恢复外观。子 FX 的 visual 驻留由父子状态派生，到期移除由游戏时间调度器执行。外观声明使用 `createRenderEffect` 同步写入。调试命令的语法、参数、支持 ID 与 `c_save()` 存档格式不变。

`c_spawn("lantern")` 和 `c_spawn("phonograph")` 的地面动画现在随 tile 休眠释放、唤醒重建；保留灯光挂载点、燃料、唱片与播放到期任务。建筑、月树、岩石、`nightmaregrowth` 和已部署的 `farm_plow` 使用实例声明的源码障碍碰撞；鼹鼠地下仍碰撞地形与障碍物，出地后恢复角色碰撞，`lightflier` 使用幽灵碰撞。普通 `treasurechest` 按 Lua 不增加障碍碰撞。命令参数、支持的 ID、`c_give` 与 `c_save()` 格式不变。

按 `M` 打开的地图由 WebGL 画布和 DOM 图标组成：`packages/map` 的 `MiniMapRenderer` 按原版 `minimap.ksh` 把每种地皮的边缘遮罩乘以世界坐标噪声，按源图层顺序画在平铺海洋底板上，画布只有视口大小；只在打开地图时的平移、缩放、转向、窗口调整或地皮改动后绘制一帧，地皮改动只重建所触及的 32×32 格分块，关闭地图时只标记。加载页等待图层纹理和分块几何建好后启动游戏。陆地判定按光标下的地皮格：陆地显示十字光标，海面隐藏光标，左键拖动时显示抓取光标，右键只在陆地格上发起地图动作。地图打开时由 UI 状态直接隐藏世界动作提示并停止其 DOM 命中测试，地图跳跃解除自动暂停后仍保持屏蔽，关闭地图立即重新检查光标下的世界动作。图标层沿用 DOM：缩放修改世界容器宽高，图标用百分比定位并保持 32 CSS 像素宽度，相机转向时只抵消旋转。世界 prefab 通过 `PrefabInstance.minimap` 声明图标，由 `packages/map` 订阅；`MinimapIcons.prewarm()` 在加载页预加载两张完整公共图集并建立图标名到 index 和裁切区域的映射，UI 按实体身份复用 CSS 背景节点。图标声明同时提供实体的 `tileTracker`，打开地图同步一次，之后只更新变化的图标，关闭时解除 DOM 订阅。地图装饰背景按 `widgets/mapwidget.lua` 从 `images/hud.xml`／`images/hud.tex` 取出 `map.tex`，独立拉伸到全屏并固定在屏幕坐标；地图层以 Additive（CSS `plus-lighter`）叠在背景上。地图层级高于物品栏和右侧 backpack，打开时覆盖它们、关闭后保留原状态恢复；地图与旋转按钮保留在上层，暂停按钮按 Lua 在地图打开时隐藏。右下角地图控制整体缩小 20%，以右下角为缩放原点，贴紧窗口右边和底边。地图初始 `zoom=3`，`zoom=1` 最近、`zoom=20` 最远；每侧留出地图边长 10% 的 margin，最远档地图加 margin 构成的正方形边长为窗口长边 1.5 倍；视口平移不越过该边界。滚轮围绕光标以 0.1 秒插值缩放，向上放大、向下缩小。场景释放时清理几何、纹理、WebGL 上下文、节点和订阅。实现见 [世界地皮与 DOM 地图](docs/dst-minimap-rendering.md)。调试命令语法、参数、支持的 `c_spawn` / `c_give` ID 和 `c_save()` 存档格式不变。

开发模式（`pnpm dev`）下的性能诊断开关，不是控制台命令，命令语法与支持的 ID 不变：左上角默认显示 stats-gl 面板（FPS／CPU），URL 加 `?stats=gpu` 另外统计 GPU 时间，库按需加载，不进生产构建；加 `?tileperf` 在控制台输出玩家跨 tile 时的活动网格写入耗时、订阅者耗时和长任务（`[tileperf]`），传送（灵魂跳跃）时附带标记。

精灵性能诊断使用 `?perf`：控制台调用 `__spritePerf.summary()` 查看从加载或上次 `__spritePerf.clear()` 起的 count／total／max；普通模式只累计统计，不逐次写入 User Timing 或打印慢帧警告。`__spritePerf.records` 返回最多 4096 条按时间排列的近期明细，保留准备阶段与慢渲染，普通快速 `render` 每 60 次采样一条，汇总仍统计全部调用。需要浏览器时间线中的全部 `sprite:*` 标记时使用 `?perf=trace`；该模式有额外测量开销，建议只截取待定位的一段。例：`?perf`；开始操作前执行 `__spritePerf.clear()`，结束后查看 `__spritePerf.summary()`。异步 `preload` 包括资源等待时间，嵌套阶段不能相加当作总 CPU 时间；`render.count` 是各资源所有者的 pass 调用数，不是游戏帧数。

月亮洞穴水池及附属雾气、瀑布、月亮玻璃通过动画包通用函数 `createSharedArchiveSprite()` 接入共享帧几何，prefab 无需维护共享动画清单；正常和开采后的 `*_mined` 动画分别缓存，各实体保留自己的播放进度、位置、开采状态及子物件关系，单池移除不释放其他池仍使用的帧。调用方式与资源所有权见 [动画包说明](packages/animation/README.md#通用共享帧入口)。调试命令语法、参数与支持的 `c_spawn` / `c_give` ID 不变，`c_save()` 的导出和恢复流程沿用原有实现。

蘑菇树通过 `createSharedArchiveSprite()` 的 `instancedAnimations: ['idle_loop']` 实例化待机：源 atlas 零件按动画变换和层顺序合成完整帧，整段动画共用固定原点与像素网格，保留每棵树的随机起始帧、颜色、位置与交互。受击、倒下、树桩、生长／开花及燃烧消失仍使用共享帧几何，返回待机自动重新合批。深度预绘制与不写深度的颜色 pass 保持地皮、树和动态角色的遮挡顺序；资源由 manager 统一释放。常青树、桦树和月树统一使用 `@dontstarve-web/animation/residentSprite` 的 `ResidentSprite`，tile effect 只加载／释放 visual，保留同一根节点、交互投影、Workable 和逻辑计时器；已移除旧的整模型卸载路径及每帧 `updateNearby()` 扫描。调试命令语法、参数和支持的 `c_spawn` / `c_give` ID 不变，`c_save()` 继续保存原有树木状态。

世界渲染通过 `renderSceneWithPasses()` 共用一次场景矩阵更新，光照贴图在矩阵准备完成后读取世界位置。矩阵缓存共用唯一更新入口，实体复用同一更新函数和缓存方法，变换快照按标量保存；父节点矩阵在一次场景遍历中共享比较结果，显式查询和同次遍历内再次更新仍即时失效。缓存与祖先快照按各自所有权释放；静态 billboard 保留显式失效的快速路径，其他共享动画及 factory sprite 检测模型、visual 与父节点变化；ResidentSprite 与 ResidentSpriteController 的稳定根节点只缓存自身矩阵，静止时跳过重复计算，当前 sprite 子树及附加 FX 继续使用各自的更新入口；根节点或祖先移动时先使直接子缓存失效，显式浅查询保留后续子树更新。ResidentSprite 用私有 signal 保存实际 visual，effect 在空 visual 时切换到共享空矩阵入口，不再进入逐实体缓存检查；唤醒后强制刷新矩阵，显式世界坐标查询始终更新，附加动态子节点时回到常规遍历。渲染 pass 按注册锚点与祖先可见性选择，不再扫描整棵场景树；实例化代理和空帧退出普通精灵排序，切回工作动画时自动恢复。实例 pass 复用包围球、视锥结果、绘制条目与脚点排序；相机、变换、帧边界或批次成员变化时更新对应缓存，共享祖先的显隐和光照每次 pass 只采样一次。静止且外观属性未变时，换帧只更新 UV；实例批次只上传实际变化的 Float32 属性区间，并保留尚未上传的范围。自动更新设置在本次绘制结束或异常后恢复。调试命令的语法、参数、行为及支持的 `c_spawn` / `c_give` ID 不变。

prefab 只通过 `PhysicsState`（`instance.physics`，对应 Lua `inst.Physics`）声明碰撞体，由 `bindPhysics` 创建、登记和释放刚体，玩家、皮弗娄牛和风滚草的动态刚体也按 `MakeCharacterPhysics` 的零摩擦与 `SetDamping(5)` 绑定；墙和栅栏按源 Lua 设置 `SetDontRemoveOnSleep`，在活动区外仍阻挡移动。静态碰撞体由 `PhysicsWorld` 统一按 `tickingarea`（默认玩家周围 10 格）管理：`registeredBodies` 保留完整登记，`bodies` 只包含参与模拟的碰撞体。离开活动区保留原刚体和 prefab 状态，返回时恢复同一实例；寻路、出生占位和碰撞材质查询使用完整登记。动态刚体与无限地面继续参与模拟。碰撞历史采用 Cannon 的稀疏表并按稳定刚体 ID 记录，避免 tile 切换重排索引产生错误的重复接触事件；永久移除和场景销毁清理监听。静态 billboard 换帧仅更新烘焙几何，位置、朝向或镜像变化才使矩阵失效。`c_spawn`、`c_give` 的语法、参数、支持 ID 和 `c_save()` 存档格式不变。

局部光照系统统一使用所属世界的 `tickingarea`（默认玩家周围 10 格方形区域）过滤光源：GPU 光照贴图叠加与 CPU 光照采样共用同一按 tile 缓存的私有活动监听，区域外及地图网格外的光源不贡献光照、不扩展贴图范围；子光源按世界坐标归属 tile，移动后查询新格子。光源数据保留，返回活动区自动恢复；场景释放时清理活动监听与 memo。未注入活动查询的独立渲染场景保持原有行为。调试命令语法、参数、支持的 `c_spawn` / `c_give` ID 和存档字段不变。

洞穴边缘 falloff 使用地皮／崖壁的 alpha-test 深度预绘制（只写深度、不输出颜色），再按地皮层顺序与相机深度绘制透明颜色；崖壁内部每个边面也按相机深度重排索引，避免相机转向时远处崖壁覆盖近处、或地皮错误盖住前景崖壁。对照原版洞穴参考图，将单张纹理的跨度校准为两格宽、下垂四格高，跨格连续采样并让底部渐隐入黑色虚空；这些尺寸与渐隐是参考图校准值，Lua 仅公开图集与相邻地皮规则，没有公开引擎网格尺寸。调试命令、参数、`c_spawn` / `c_give` 支持 ID 及存档格式不变。

Wortox 可右键有效地面发动「灵魂跳跃」，首跳后 5 个游戏秒内提示变为「灵魂回声」，第二跳或窗口到期结束本轮；按本项目要求，动作选择与提交均跳过库存灵魂数量判定，空库存也可连续使用。保留原版 BLINK 的 36 DST 单位距离（场景 108），超距先寻路到范围内；鼠标持有物品时使用物品动作，装备的地面动作和场景对象交互优先于跳跃。虚空、海洋和带 `groundtargetblocker`／`groundhole` 标签的阻挡落点不可跳，普通障碍可以跨越。预备动画结束提交动作，入场第 4 帧无敌、第 11 帧传送，出场第 7 帧结束无敌、第 8 帧恢复碰撞、第 14 帧回到 idle；动画、传送红色渐变、FX 和音效来自原版素材。地图跳跃按 `M` 打开地图后右键可见陆地，以 `BLINK_MAP` 直接进入同一套跳跃状态，不受普通跳跃距离限制、不先寻路；按本项目要求跳过距离计费与灵魂消耗，也不修改普通跳跃的回声计数或计时器。光标下的地皮格控制悬停光标和右键，预备动画结束时再校验真实陆地，裸海面与虚空不可落地；地图动作不套用普通 BLINK 的地面目标阻挡检查。接受动作后地图保持打开并解除地图自己的自动暂停，键盘移动仍被地图屏蔽；落地重置地图中心并立即定位镜头，关闭再打开地图会重新自动暂停。技能树加速与船平台辅助落点尚未实现。`c_save()` 保存落点与 `players.local.wortox.freehops` / `soulhopcost`；按 Lua 不保存临时结束任务，读档保留回声计数，下一跳结算。新增 `c_spawn("wortox_portal_jumpin_fx")` / `c_spawn("wortox_portal_jumpout_fx")`，无额外参数，在玩家脚点播放原版瞬时特效，动画结束后再等待 2 帧移除；无皮肤、不可 `c_give`，`persists = false`，不写入存档。运行 `python3 packages/prefab/scripts/import-wortox-soulhop.py --check` 校验动画和 32 个由 FEV 核对的 WAV，去掉 `--check` 重新导入。

玩家美术改用 Wortox 默认外观（`wortox_none`）：本体 `anim/dynamic/wortox.zip` / `.dyn`，幽灵 `anim/dynamic/ghost_wortox_build.zip` / `.dyn`；地图图标和物品栏自检头像同步使用 Wortox。共用 `wilson` 动画 bank、装备符号覆盖、死亡／复活及存档流程沿用现有实现，角色数值和存档角色字段沿用现有实现。资源按原路径和字节镜像，运行 `python3 packages/prefab/scripts/import-player-art.py --check` 校验，去掉 `--check` 可重新导入。调试命令语法、参数和支持的 `c_spawn` / `c_give` ID 不变。

默认按 `public/saves/Cluster_1/session.json` 选择各 Session 的最新快照及唯一未迁移的玩家；当前是位于 Atrium 的 Caves `0000000033`。存档转换方法见 [存档转换](scripts/save-convert.md)。可用 `?save=Cluster_1/Master.json` 显式加载地表，或 `?save=initial-world.json` 加载原地表存档。也可用 `?saveData=<base64url>` 直接传入存档 JSON（UTF-8 后按 base64url 编码，无需对应文件），它优先于 `?save=`，并与文件存档一样经过完整校验；浏览器测试用它从测试内构造的存档启动。`c_save()` 无参数，下载包含 `Cluster_1/` 目录的 `Cluster_1.zip`，新增当前世界快照及对应的 Session 玩家文件，更新索引和当前分片的便捷副本，并保留旧快照。将 ZIP 解压到 `public/saves/`，覆盖 `Cluster_1/` 后重载。

已实现树木的导入白名单包含 `evergreen`、`deciduoustree`、`moon_tree`、`mushtree_moon`、`mushtree_medium`、`mushtree_tall`，以及月树幼苗 `moonbutterfly_sapling`。本次重新导入默认存档新增 198 棵月树。常青树、桦树、月树按 Lua 使用原版地图图标、优先级 `-1`，砍倒或烧毁后切换树桩／焦木图标；蘑菇树沿用现有图标。图标属于逻辑树，远处卸载模型时继续显示，永久移除时清理。月树保留大小、生长及 `moonTreeTimer` 腐朽计时器；幼苗保留 `saplingTimer`，按原版不显示地图图标。现有 `c_spawn("evergreen_normal")`、`c_spawn("deciduoustree_normal")`、`c_spawn("moon_tree_normal")` 等命令与支持 ID 不变；`c_save()` 保存树木身份、位置及相应组件状态。

地图导入白名单新增 `pigking`、`deciduoustree`、`fireflies`、`flower`、`butterfly`。`Cluster_58` 当前快照新增猪王 1 个、桦树 695 棵、自然花 441 朵，以及地表／洞穴萤火虫 316／34 群；没有蝴蝶源记录，但导入器支持其存档。桦树保留阶段、树叶、树桩和腐朽计时器；花保留动画与原版 `planted` 标记；萤火虫和蝴蝶进入现有 `ground_item` 存档分组，保留实体 ID、位置、数量和可支持的蝴蝶新鲜度。岩石白名单保持现有内容；调试命令及支持 ID 不变。

静态资源缓存不改变调试命令的语法、参数、行为或支持的 `c_spawn` / `c_give` ID；`c_save()` 仍按原有流程导出存档。

局部存档导入的实体换算包含原版的半格偏移：`gx = x / 4 + width / 2 + 0.5`，Z 同理，再按选区原点转换为项目坐标。猪头已与木地板布局对齐，月亮雕像也恢复到对应档案馆地皮；`c_save()` 保存修正后的位置，命令语法、参数和支持 ID 不变。

地皮活动查询接收实体的 tile key `ReadonlySignal<number>` 和可选半径（默认 10 格），同一个 tile signal、半径复用 memo；`TileTracker` 发布新 key 后自动切换所监听的格子，避免移动实体一直读取出生格子的活动状态，详见 [移动实体的 tile 归属](docs/tile-lifecycle.md#移动实体不能一直监听出生-tile)。调试命令的语法、参数及支持的 `c_spawn` / `c_give` ID 保持不变。

活动网格在世界创建时读取存档的 `world.map.generator.options.size` 并注入 tileManager，按每格 12 世界单位计算地皮范围，不再固定为 84×84。网格包含边缘不足整格的地皮，但地图外坐标仍无效；`c_save()` 保留原地图尺寸，读档重新建立对应网格。调试命令的语法、参数和支持 ID 不变。

`FindEntities(position, radius, mustTags?, cantTags?, oneOfTags?)` 直接遍历顶层 `activePrefabs` 数组，按实体脚点距离和调用方标签筛选，不再接收 scene 或依赖模型父节点。世界 tickingarea signal 的 effect 同时维护标签和数组：active 注册，inactive 注销，默认仍为玩家周围 10 格方形区域；移动实体随现有每 60 活动帧的位置快照刷新 tile，模型加入场景时立即同步位置。拾取、模型替换、永久移除及场景销毁清理索引和订阅。无活动区域门控时保持 active；inactive 逻辑实体仍由原存档系统保存。`c_spawn`、`c_give`、`c_save()` 的语法、参数和支持 ID 不变。





游戏时间调度器使用带索引的最小堆，注册、取消与取出任务均为 `O(log N)`，等待时不遍历任务；大量任务取消时立即移除并释放回调。同一截止时间的登记顺序、长帧按实际截止时间追赶、组件 timer 的保存／恢复及 signal effect 的调度语义保持不变，详见 [signals 调度说明](packages/signals/README.md)。调试命令语法、参数与支持 ID 不变。

可选地表存档 `public/saves/initial-world.json` 保留以原点为中心、tile 中心距离不超过 20 格的陆地（本项目每格 12 世界单位，半径 240），外侧 5,792 格使用原版 `OCEAN_COASTAL`（地皮 ID `201`），已移除海洋格上的实体。加载器和 `c_save()`（无参数）支持保存、导出并重新加载这些海洋格，陆地上的实体身份和组件状态照常保存。近海使用原版 `levels/textures/ocean_noise.tex`、海域颜色及三层动态噪声；昼夜颜色纹理按原版九点核执行 3 轮横向／纵向模糊，然后进行 RGBA 昼夜混合、动态噪声与世界光照合成、2 倍编码及屏幕空间解码，详见 [海洋渲染管线](docs/dst-ocean-rendering.md)。地面积雪按 `ground_overlay.ksh` 乘上实际地皮 atlas 的 alpha，沿陆地伸入海洋格的岸边过渡区域渐隐，海面内部不积雪；挖地或耕地后同步更新遮罩。岸浪与浅海波纹通过注入的 `tickingarea` 监听玩家周围默认 10 格方形活动区域，按 Lua 的 `OnEntitySleep = inst.Remove` 在离开范围时立即移除并释放独立几何和订阅，返回范围不恢复旧波浪；播放结束也自动移除，不参与存档，未注入查询或查询返回 `undefined` 时保持原有动画生命周期；船只与海洋生物尚未接入。调试命令语法、参数和支持的 `c_spawn` / `c_give` ID 不变，海洋属于地图地皮。

入口在主场景资源、存档实体和交互绑定初始化完成并渲染完整场景后才关闭世界生成页；可等待 `src/main.ts` 导出的 `gameReady`，或检查主 canvas 的 `data-loaded="true"`。地皮 KTEX 解码由共享 Worker 完成，重复路径复用解码结果；纹理上传和世界／光照／后处理着色器分批预热，同时通过 `PrewarmSounds()` 下载并解码声音表中全部事件的音频（含各层与随机变体，也覆盖后续合成、`c_spawn` / `c_give` 的物品）。两者完成后才启动物理和游戏时间循环，`gameReady` 使用循环的首次渲染，不再额外绘制。音频预热不等待用户手势，实际播放仍在交互时恢复；重复音频复用共享缓存，单个音频失败沿用警告并允许后续重试，不阻止进入游戏。其他加载失败时保留生成页并显示错误，开发模式也使用相同的加载等待。调试命令语法、参数及支持 ID 不变。


采摘产物统一交给 `Inventory.GiveItem()` 处理：先填充可用槽位和堆叠，背包满时把余量掉在玩家脚边，采摘仍然成功；采摘入口不再预加载或手动生成地面产物。地面贴图加载期间，掉落实体的 ID、数量、位置和组件状态仍可由 `c_save()` 保存。调试命令的语法、参数和支持的 prefab/item ID 不变。

草丛 `grass` 和洞穴花 `flower_cave` 的采摘／再生、灰烬 `ash` 的生成／拾取／移除，以及矮星 `stafflight` 的生成／消失／注销如何映射到 signal，见 [DST 事件与 signal 映射](docs/dst-event.md)。矮星已接入：私有 signal 保存寿命与移除标记，`createMemo` 派生 `active → disappearing → removed`，effect 只同步消失表现；计时和永久移除同步执行。远离卸载模型时释放表现绑定，保留逻辑状态与 memo；永久移除直接清理资源并释放 memo。草丛和洞穴花的再生／灯光 timer 已接入 signal：共享游戏时间调度器在设置、暂停、恢复、取消或到期时提交，等待期间不扣减 timer，memo 派生状态。灰烬消散的 timer signal 仍是后续方案。实体表现 effect 用 `get()` 订阅自身状态，用 `peek()` 读取环境，包含同步调用的辅助函数。调试命令语法和参数保持不变；补齐 `c_spawn("stafflight")`／`c_spawn("staffcoldlight")` 的注册入口。


库存实体直接提供数量、耐久、新鲜度和湿润状态的只读 signal，物品栏、装备、背包和容器 UI 订阅同一份组件状态；数值变化无需替换整份 UI item，数量接收动画读取实时 count。新鲜度和湿润显示使用原版 meter，缺少新鲜度状态时隐藏对应显示。可用 `c_give("torch", 2)` 检查燃料百分比，用 `c_save()` 保存并恢复库存组件状态；已提供的新鲜度与潮湿值也随库存／地面物品保存恢复。声明保鲜时长的物品已接入腐败模拟：`Perishable` 每 10 个游戏秒结算一次，内部通过 `watchSignal` 和 `createEffect` 监听潮湿状态，变化时按旧状态提前结算，随后潮湿倍率为 `1.3`；保存先结算不足 10 秒的部分，移除／释放组件时取消任务并清理监听。雨水吸收和干燥模拟尚未接入；命令语法、参数和支持的 prefab/item ID 不变。详见 [容器 DTO 与 UI signal](docs/inventory-architecture.md#容器-dto-与-ui-signal)。

地面物品的位置统一由 `entity.transform.position` 决定：移动与抛落写入实体，模型、脚点、拾取距离、换肤和保存读取实体坐标；修改模型位置不会覆盖实体。声音的位置参数也统一传递现有地面 `Vector3`，声源保留位置引用，监听器复用向量；距离衰减通过 `distanceToSquared()` 计算，不拆分 XZ 坐标或开方。用 `c_spawn("log")`、`c_spawn("butterfly")` 或 Shift + 右键丢弃物品可验证原有交互，`c_save()` 导出当前实体位置，读档恢复；抛落高度仍是视觉偏移。命令语法、参数和支持的 prefab/item ID 不变，详见 [地面坐标的权威来源](docs/inventory-architecture.md#地面坐标的权威来源)。

物品栏右键参考 Lua `widgets/invslot.lua:OnControl/DropItem/UseItem` 的分工：UI 将右键输入写入 input signal，读取 slot 的只读 `item` signal，并同步发布 `drop/use` 请求；应用验证物品实体后执行丢弃、进食、种花或背包装卸。连续右键分别处理，槽位投影更新不会重放动作；UI 断开和场景停止时释放对应订阅。`game:slot-context-menu` 仍跨 shadow root 冒泡；Shift + 右键丢弃整堆物品，与 Lua `DropItemFromInvTile` 默认的 `wholestack` 一致（网捕生物按只拆成独立实体）。`c_give`、`c_spawn`、`c_save` 的语法、参数和支持 ID 保持不变。


建筑容器面板的开关与屏幕定位由 `packages/ui/src/chest-inventory-panel.ts` 负责；`src/registerDisposal.ts` 创建面板、动作控制器、库存接收动画订阅、表情轮盘和右键菜单订阅，统一注册帧更新与场景内显式释放。`src/main.ts` 只注入依赖，在场景加载后完成注册；容器面板的帧回调也随释放移除。调试命令的语法、参数、行为和支持 ID 不变。








在游戏页面按反引号键（`Backquote`，通常与 `~` 共用）打开或关闭调试控制台，输入命令后按 `Enter` 执行。执行后控制台自动关闭；`Esc` 可关闭，`↑` / `↓` 可浏览最近 50 条历史命令。执行结果或错误显示在浏览器开发者工具的 Console 中。

掉落物不再预先创建：植物、岩石、骨头、雕像、洞口等在采集／开采／锤击／烧毁的提交时刻用 `spawnGroundItem()` 同步生成掉落实体，实体与存档记录立即存在，美术由 display 加载后绘制（`flingLoot()`、`dropLoot` 同样同步）。地面物品工厂的 `create()` 同步返回，资源只由 display 加载；Bernie、蝴蝶、鼹鼠和光虫的逻辑仍读取已加载动画的时长，暂保留异步创建。`c_spawn`、`c_give`、`c_save()` 的语法、参数、支持 ID 与存档格式不变。

通过 `createResidentGroundItem()` 绘制的地面物品使用 `InstancedMesh` 合批，覆盖静态姿态、循环及单次动画；兼容外观共享合成图集和批次，各实体保留独立位置、动画、拾取与休眠生命周期。`c_spawn`、`c_give`、`c_save()` 的语法、参数、支持 ID 与存档格式不变。

`berrybush`、`monkeytail`、`rock_avocado_bush` 使用共享 archive 的 `InstancedMesh` 合批，包含待机、采摘／生长过渡和末帧姿态；石果灌木保持 Lua 的非循环姿态。浆果层、皮肤与积雪分别参与外观缓存，休眠／唤醒和换肤保留实体、组件及外观状态。`c_spawn("berrybush")`、`c_spawn("monkeytail")`、`c_spawn("rock_avocado_bush")`、对应根物品的 `c_give` 和 `c_save()` 的语法、参数、支持 ID 与保存范围不变。

`c_spawn` 生成实体后，由 tickingarea signal 自动维护其 `activePrefabs` 登记；活动实体即使暂时没有场景 visual，仍可被 `FindEntities` 查询。鼠标选取使用独立的 `mouseTargets` 注册表，由实体投影在活动状态、标签和挂载生命周期变化时维护；prefab 可显式启停鼠标登记。萤火虫监听手部装备 signal，只有装备实体具备 `NET_tool`／`tool.CanDoAction('NET')`，且自身处于活动、显示、可点击状态时才登记；卸装、休眠、拾取或移除时退出，仍按 `NET_workable` 和组件状态校验挥网命中。所有鼠标目标共用此表，保留前方实体的遮挡；sprite 外缘增加约每侧 10% 尺寸的选取容错，优先精确命中的目标。`c_spawn`、`c_give`、`c_save()` 的语法、参数、支持 ID 和保存范围不变。



| 命令 | 参数与作用 | 示例 |
| --- | --- | --- |
| `c_give("item_id", count)` | 向物品栏添加物品。`count` 可省略，默认 `1`，必须为正的安全整数；按堆叠上限分配。未知物品或物品栏空间不足时失败。 | `c_give("torch")`、`c_give("book_rain")`、`c_give("book_moon")`、`c_give("opalstaff")`、`c_give("pitchfork")`、`c_give("hammer")`、`c_give("book_silviculture")`、`c_give("meatballs", 10)` |
| `c_spawn("prefab_id")` | 生成一个当前支持的场景对象。建筑和墙生成在玩家前方，洞穴植物、萤火虫、伯尼、岩石、草、树苗、池塘、虫洞、留声机、唱片和梦魇疯长生成在玩家当前位置，皮弗娄牛生成在玩家附近的空地。 | `c_spawn("cookpot")`、`c_spawn("beefalo")`、`c_spawn("bernie_inactive")`、`c_spawn("rock1")`、`c_spawn("grass")`、`c_spawn("sapling")`、`c_spawn("pond")`、`c_spawn("wormhole")`、`c_spawn("lava_pond")` 无额外参数，在玩家脚点生成熔岩池。使用原版 `anim/lava_tile.zip` 的 bank/build `lava_tile` 和 `bubble_lava` 循环动画，池面贴地并位于背景层；局部橙色光保留原版 radius 1.5（场景 4.5）、falloff/intensity 0.66 和 colour `(235,121,12)/255`。池实例挂通用 `heater`，`GetHeat(observer)` 固定返回 500，默认供热、启用距离衰减且无额外半径截断；通过已有 `FindEntities` 查询 `HASHEATER` 实例。静态胶囊障碍半径为 1.95 DST 单位（场景 5.85）。位置确定后按 Lua 的 0 延迟任务随机生成 2～4 块焦岩，7 种外观来自 `anim/scorched_rock.zip` 的 `idle` / `idle2`～`idle7`；焦岩分别以真实脚点进行 billboard 排序。`c_spawn("lava_pond_rock")` 和 `c_spawn("lava_pond_rock2")`～`c_spawn("lava_pond_rock7")` 可独立生成焦岩，实际不存在 `lava_pond_rock1`。这些实体均不能用 `c_give` 入栏，且没有原版皮肤。`c_save()` 保存池的身份、位置和焦岩类型／相对布局，读档直接恢复布局，不重新随机或重复生成；随池生成的焦岩不独立入档，独立生成的焦岩按其实际 prefab ID 保存身份和位置。移除池会取消尚未执行的初始化任务，释放光照、碰撞体、焦岩和 heater 标签。当前只实现热源供给端；角色体温、触碰点燃、火焰传播／伤害、熔岩池烹饪、龙蝇事件及音乐尚未接入，暖石仍保持不实现温度的范围。 `c_spawn("pigking")` 无额外参数，在玩家脚点生成猪王：`idle` 循环 billboard、半径 2 的障碍物和地图图标，白天以 `trader` 接受有 `goldvalue` 的 tradable 物品并朝给予者抛出金块，夜晚进入 `sleep`；不放置 `default_pigking` 地皮与方尖碑（该布局只来自世界存档），不能 `c_give`，没有原版皮肤。`c_save()` 保存猪王身份与位置，读档重建交易与日夜状态。

`c_spawn("nightmaregrowth")` |
| `c_save()` | 无参数。将当前游戏状态（包括挖过的地皮、耕地地皮和月岩多人传送门）校验后写入 ZIP 内对应分片：洞穴为 `Cluster_1/Caves.json`，地表为 `Cluster_1/Master.json`；保留 `public/saves/Cluster_1/` 内其他文件及子目录的原始字节，下载为 `Cluster_1.zip`，同时在画面上方偏右显示原版 `anim/saving.zip` 的保存动画（`save_pre` → `save_loop` → `save_post`），结束后隐藏；保存超过 0.5 秒显示“正在保存…”。快速保存也会完整播放一轮动画；校验失败或目录文件读取失败时结束提示，并在浏览器 Console 报告“保存失败”，下载不会开始。连续保存依次执行，成功下载后推进快照编号。要重新加载，将 ZIP 解压到 `public/saves/` 并覆盖 `Cluster_1/`；默认加载洞穴，地表可使用 `?save=Cluster_1/Master.json`。使用旧地表 JSON 启动时，保存结果也写入 ZIP 内的 `Master.json`。 | `c_save()` |
| `c_setsanity(percent)` | 设置 Wilson 的理智比例；`percent` 为必填的 `0` 到 `1` 数字（上限 200），调用玩家 `components.sanity:SetPercent()`，由组件的只读信号同步状态栏和低理智滤镜，并随 `c_save()` 保存。调色按每 10% 一档四舍五入；实际理智、晃动速度和幅度保留连续值。理智 ≤15% 时边缘播放原版红色花纹，回升到 ≥17.5% 时恢复普通暗角，中间区间保持原状态。 | `c_setsanity(0)`、`c_setsanity(0.175)`、`c_setsanity(1)` |

物品栏左键点击普通物品时，将整叠实体从原槽转移到真实鼠标槽 `player:cursor/0`，图标、数量和耐久跟随鼠标。再点击空槽放下，点击已占用槽则交换鼠标槽与目标槽的整叠物品（包括同类物品），换出的物品继续由鼠标持有；拖放仍执行移动或合堆。失败时保留鼠标物品；`Esc` 尝试放回来源槽，再尝试普通物品栏，无法完整放回时继续持有。鼠标槽不作为 `c_give`、普通拾取或制造产物的自动接收槽，也不自动消耗其中的制造材料。`c_save()` 保存鼠标槽内的实体 ID、数量、皮肤、燃料和容器等状态，读档恢复鼠标持有；旧存档缺少该容器时初始化为空。调试命令语法、参数和支持 prefab/item ID 不变。

手部拿出／收起动画统一由 `src/playerHandEquipment.ts` 订阅装备 signal：装备时播放 `item_out`，正常卸装时播放 `item_in`，换成另一实体时播放新装备的 `item_out`，同一实体换肤不重复播放。动画等待手持美术加载完成，并跳过已被后续换装或关闭取消的请求；读档初始化和物品耗尽移除不播放转移动画。主程序只处理库存转移结果与燃料结算。`c_give`、`c_spawn`、`c_save` 的语法、参数和支持 ID 不变。

降水由天气组件的湿度驱动，地表存档 `initial-world.json` 当前为冬季中点（季节温度 −25°C）、正在下雪并带薄积雪。`c_give("book_rain")` 获取求雨书后右键阅读，无降水时请求开始、有降水时请求停止，雨／雪由世界温度决定。成功阅读消耗 1 次耐久（初始 5 次）、基础理智代价为 33，沿用阅读动画、云朵特效和施法声；`c_save()` 保留天气、季节温度和积雪量。没有新增天气命令，现有命令语法、参数和支持的 prefab/item ID 不变。

`c_give("book_moon")` / `c_spawn("book_moon")` 获取或生成《月之魔典》（`books.lua`，bank/build `books`，clip `book_moon`；3 次耐久，每次阅读基础理智 −50；无皮肤）。右键阅读沿用通用 READ 动画，成功时按 `ms_setmoonphase` 把月相立即设为满月（沿用 `clock.lua` 的 `_mooomphasecycle` 逻辑：从周期中段起找第一个满月步，此时 `waxing` 为 `false`），随后每天照常推进一步；夜间的满月光照随之生效，并在阅读位置生成 `fx_book_moon`（`wickerbottom_rework/book_spells/moon`，`wickerbottom_rework.fsb` 样本 8 与 9 两层）。当前已是满月时返回 `ALREADYFULLMOON`，不扣耐久与理智。`c_save()` 在 `world.systems.moon.mooomphasecycle` 保存 1–20 的月相周期步，读档恢复，旧存档沿用按天数推算的月相。洞穴世界的 `NOMOONINCAVES`、白天阅读的 `ANNOUNCE_BOOK_MOON_DAYTIME` 台词（需要 `talker`）以及 `aspiring_bookworm` 浏览尚未接入。可在书架里存放，每期恢复 0.03 次耐久。阅读后到夜晚可观察满月光照。

雨雪的代码分工、signal／60 帧结算、原版参数与透视适配、雨丝／水花／雨声、雪花 1～2 倍稳定随机大小与边缘概率柔化、最前层绘制、积雪遮罩、保存及清理约束统一见 [雨雪天气实现约束](docs/dst-weather.md)。后续修改雨雪实现时同步更新该文档与相关代表性测试。



玩家动作控制器统一由 `@dontstarve-web/stategraphs` 导出，实现在 `packages/stategraphs/src`：锤击、采矿、捕虫、铲地、园艺锄耕坑、铲垃圾、种子交互、换肤及法杖施法输入。锤子、镐、干草叉、铲子、园艺锄、捕虫网、清洁扫把和光照法杖控制器接收只读 `inventory.handEquipment` signal，在内部读取装备实体的能力；锤子、铲子、捕虫网和清洁扫把按组件及标签选择动作，其他手部工具保留其已支持的 ID 分支；卸装、换成另一实体或换肤会立即取消旧动作，控制器销毁时释放订阅。同一装备实体和皮肤的状态更新不重复取消，控制器不写入装备 signal。光照法杖按召唤目标 `stafflight/staffcoldlight` 选择 `yellowstaff/opalstaff`，更换装备后原先预加载或排入时间线的施法不会生成新光源。`src/main.ts` 注入装备 signal、`registerFrameTask` 帧调度服务、移动、动画和目标操作接口；控制器根据 signal 自行注册／移除帧任务，每帧只更新当前装备对应的手部动作控制器，读档后已有装备也立即注册。卸装和销毁会移除任务，同一身份重复发布不重复注册；法杖由输入事件与状态图时间线驱动，无独立帧任务。`packages/prefab` 负责工具美术、目标实体与特效，`SGwilson` 负责动作状态和提交帧。`c_give`、`c_spawn` 和 `c_save` 的语法与参数保持不变；当前支持 ID 见下方对象表。


悬停文字按 Lua 的动作选择与 `hoverer` 分工统一显示：共享鼠标命中，按源优先级分别选择左右键动作，文字取自源简体中文字符串；控制器只注册动作候选。左键显示原版左键图标及动作文字，右键显示原版右键图标及 `: 动作文字`，可以同时显示两条；建造预览提示优先，鼠标位于 UI 上时隐藏世界提示，文字限制在屏幕边界内。用 `c_give("bugnet")`、`c_give("hammer")`、`c_give("reskin_tool")` 获取并装备相应工具后，目标上分别显示“捕捉”“敲”“打扫”；播种提示为“栽种”，铲子/干草叉为“挖”。选中唱片后，仅在靠近且可插片的留声机上显示“放置唱片”。地面的提灯（`c_spawn("lantern")`）和装有唱片的留声机（`c_spawn("phonograph")`）由 `machine` 组件按 `componentactions.lua` 提供右键“打开”／“关闭”（TURNON／TURNOFF）；留声机每次切换后有 3 秒冷却，提灯没有。箱子、冰箱、烹饪锅等场景容器由 `container` 组件按 `componentactions.lua` 提供左键“打开”，玩家已打开时显示“关闭”（RUMMAGE）；建造预览显示时点击只放置或取消预览，不选取场景动作。卸装或目标失效后提示自动清除。详见 [鼠标悬停动作文字](docs/dst-hover-text.md)。这些命令的参数和支持 prefab/item ID 保持不变。

未显示的建造提示不触发全局悬停刷新，重复隐藏也不重新收集动作。没有鼠标位置或鼠标被其他 DOM UI 遮挡时，在动作收集前直接隐藏提示，避免空闲的各建造控制器重复遍历地面物品和捕虫候选。回到场景后照常查询当前装备、目标和左右键动作；上述命令与交互规则不变。

射线检测统一通过 `PointerRaycaster` 封装，生产代码只在该封装内部创建 `THREE.Raycaster`。地面物品交互也使用 `trackPointer()` / `raycastPointer()`，保留普通精灵几何命中、群体包围盒命中及原有事件优先级；销毁时释放鼠标监听。只检测对象时可不提供地面，地面查询返回空结果；提供地面时 `groundPoint()` 统一返回 `y = 0`。调试命令语法、参数和支持 ID 保持不变。

鼠标拾取从 `activePrefabs` 读取活动实体，筛选仍有模型父节点、未移除且可见／不带 `NOCLICK` 的 visual，再进行精确射线检测。命中子节点沿父链找到实体根节点，由 ActionPicker 生成左右键动作；无法执行动作的可见前景仍遮挡后方。同一点击事件共享一次命中结果。耕地／农场杂物也通过 `actionEntity` 接入相同登记，移除时释放投影。

植物／月树苗种植、耕地机、耕坑和码头预览的阻挡检查使用独立的实体空间索引：按地块或附近半径查询，发现第一个阻挡立即返回，不再汇总渲染列表或复制全量 blocker。实体创建、移动、掉落、标签变化和移除同步维护登记；共同忽略的 `NOBLOCK`／`FX`／`DECOR`／玩家不入索引，带 `dockjammer` 的实体保留地块检查。树林的逻辑位置在美术卸载期间保留，永久删除及场景销毁时清理；各操作继续使用自己的忽略标签与部署间距。调试命令语法、参数、支持 ID 及存档字段不变。

鼠标悬停／点击与 `FindEntities` 共用 tickingarea effect 维护的顶层 `activePrefabs` 数组，不再维护独立鼠标目标集合或鼠标空间网格。选取按活动实体数线性检查，在射线检测前按需更新 visual 矩阵；精确包围盒按当前绘制帧、变换和显隐缓存。精确命中优先；没有目标时，将 sprite 的输入形状围绕包围盒中心放大 20%（每侧约 10%）作为外缘容错，并复用原有的 alpha 命中检测；原包围盒内的透明孔洞保持穿透。此容错不修改 sprite 尺寸、共享几何或游戏作用距离。保留透明像素穿透、实例化代理、镜像图像、高大图像及萤火虫群整体包围盒规则。隐藏／`NOCLICK` 目标不遮挡，`NOBLOCK` 不影响可点击性。display 负责绘制并提供可命中的 sprite，输入层负责射线检测、动作选择和执行。调试命令语法、参数、支持 ID 与存档格式不变。


物品现在按 Lua 的 `Inventory:GiveItem/Equip/DropItem` 与 `Stackable:Get/Put` 交接实体：背包、装备槽和地面持有同一物品实体，整件转移、拾取、丢弃和换肤保留 ID 与组件；拆堆创建新实体，合堆保留接收方实体。火把控制器随实体保留，卸下只停止燃烧，耗尽才移除实体。`c_save()` 的库存物品快照新增可选 `entityId`，地面仍保存记录 `id`；旧存档缺少物品 ID 时自动分配。`c_give`、`c_spawn` 和 `c_save` 的语法、参数和支持 ID 保持不变，细节见 [库存架构](docs/inventory-architecture.md)。

`c_give("torch", 2)` 获取两把满耐久火把，每把占一格；`c_spawn("torch")` 在玩家脚下生成可拾取的满耐久火把。物品栏、装备槽和储物格在图标下方显示燃料百分比，按原版 `widgets/itemtile.lua:SetPercent()` 四舍五入，未耗尽时最低显示 `1%`。基础燃料为 `TUNING.TORCH_FUEL = 75` 秒，由 torch prefab 的 `onequip()` / `onunequip()` 管理燃烧：装备到手部时点燃并消耗，卸下或普通丢弃后停止；装备火把耗尽时校验仍属于当前绑定装备，再将该库存的 `handEquipmentExistenceState` 设为 `null`；玩家 `InventoryStore` 订阅该变化，清空手部槽并清理实体，随后清除手持外观和照明。燃料随转移、丢弃、拾取、清洁扫把换肤及 `c_save()` 保存恢复；旧存档未记录燃料的火把按满耐久加载。燃料每 60 个燃烧帧结算一次，扣减这段时间累计的实际 `dt`，UI 随结算刷新；转移、丢弃、拾取、换肤、熄灭和 `c_save()` 前会结算不足 60 帧的部分，保留已经消耗的燃料。当前使用基础燃烧速率，尚未接入雨水、技能加成和投掷后持续燃烧。

腐烂组件的周期任务直接登记到世界共享游戏时间调度器，仍每 10 游戏秒结算，转移及保存前结清尾段；温度组件随绑定／销毁加入或退出更新集合。场景不再每帧扫描全部物品。`c_give`、`c_spawn`、`c_save()` 的语法、参数、支持 ID 和存档字段保持不变。

`c_give("heatrock", count)` 获取暖石，`count` 为数量、默认 1；每块占一格，不能装备。`c_spawn("heatrock")` 在玩家脚点生成可拾取暖石。使用原版 `anim/heat_rock.zip` 的 bank/build `heat_rock`，初温为世界温度，地面动画和库存图标按相对环境温度切换 1～5 档，阈值为 −30、−10、10、30°C，等于阈值仍属于较低档。暖石的冬季／夏季固有保温均为 120，离开冰箱后按环境和附近热源升降温，排除其他暖石；放入冰箱后每游戏秒降低 1°C，常温环境最低 0°C，负温环境最低 `max(-20, 环境温度)`。初始耐久 100，从最冷／最热档自然返回常温档消耗 12.5，耗尽后移除。装备 `c_give("reskin_tool")` 获取的清洁扫把，右键地面暖石可按 `heatrock_fantasy`、`heatrock_fire`、`heatrock_planet`、默认外观循环换肤，使用各自原版动态 build 和当前温度档位的实际 atlas 图标。拾取、丢弃、转移、换肤及 `c_save()` 保存读档保留身份、数量、位置、皮肤、连续温度、耐久及温度循环的最高／最低记录；读档不额外扣除耐久。角色体温及暖石热光照尚未接入，命令参数和支持 ID 不变。

暖石自身温度使用 `Temperature.current` signal，档位由纯 `createMemo` 派生，库存图标和地面动画由 `createEffect` 更新；温度事件继续同步结算极值、耐久消耗和耗尽移除。`c_give("heatrock", count)`、`c_spawn("heatrock")`、`c_save()` 的语法、参数、支持 ID 和保存字段不变。

普通动画 sprite 按命中 UV 采样当前图集 alpha，透明区域不再遮挡后方的拾取或换肤目标，非透明部分仍参与遮挡；显式按包围盒命中的虫群等实体保留原有行为。可用 `c_spawn("stafflight"); c_spawn("heatrock"); c_give("reskin_tool")` 准备星体与暖石重叠的场景，装备清洁扫把后从星体透明区域右键暖石。命令语法、参数、支持 ID 和保存字段不变。

`c_spawn("staffcoldlight")` 在玩家脚点生成极光，`heater` 按 Lua 固定输出 −100，使用 `SetThermics(false, true)` 制冷；距离衰减相对于过热阈值计算，通过 `HASHEATER` 查询给附近暖石降温。可用 `c_spawn("staffcoldlight"); c_spawn("heatrock")` 验证，或装备 `c_give("opalstaff")` 获取的法杖施放。消失动画期间继续制冷，永久移除时清理组件和标签，卸载模型保留组件；`c_save()` 保存星体身份、位置和剩余寿命，读档重建同样的制冷热源。命令语法、参数、支持 ID 和保存字段不变。

`c_spawn("poop")` 在玩家脚点生成一份便便，`c_give("poop", 3)` 给予三份。地面便便（包括皮弗娄牛定时生成的便便、丢弃和读档恢复）会附带原版 `anim/flies.zip` 的苍蝇子实体：`swarm_pre → swarm_loop` 配独立的 `dontstarve/common/flies` 循环声。玩家进入 2 个 DST 单位（场景 6）内时播放 `swarm_pst` 并停声；离开 3 个单位（场景 9）后重新出现并恢复声音，不要求夜间。拾取、燃烧或移除便便会移除苍蝇并取消其计时和音源；苍蝇是 `NOCLICK/DECOR`，不扩大便便的拾取目标，也不单独入档。`c_save()` 保留便便的身份、位置、数量，读档按当前位置重新建立苍蝇和邻近检测。牛生成便便时通过地面物品的 prefab 索引直接迭代实时位置，不再导出全部地面存档；异步生成和待加载的丢弃物计入密度，拾取／移除退出索引，成功生成时占位同步交接且只计一次。按原版在牛脚点检测：8 DST 单位内严格小于间距时拒绝，20 DST 单位范围内达到 2 个时拒绝，范围包含边界；检测达到上限即停止迭代。便便没有原版皮肤；命令语法、参数和支持 ID 不变。




`c_give("lantern", count)` 获取满燃料提灯，每盏占一格；`c_spawn("lantern")` 在玩家脚下生成已点亮的提灯。燃料与开关按 `prefabs/mininglantern.lua` 的 `fueled` / `machine` 组件挂在物品实体上：满燃料 `TUNING.LANTERN_LIGHTTIME = (night_time + dusk_time) × 2.6 = 468` 秒；装备时有燃料就开灯，卸下只清理手持图层，放入物品栏才关灯；卸下后旧 owner 装备其他手持物或重物也会关灯，掉在地上关灯后再开灯；只有开着时耗油。开灯按 `SetFirstPeriod` 额外扣一次首段燃料（满燃料 1/60 秒，否则 0.5 秒）。燃料每 60 个活动帧结算一次，转移、丢弃、拾取和 `c_save()` 前结算未满一批的部分。光照半径和亮度随燃料百分比从 3→5、0.4→0.6 插值；提灯 prefab 持有独立的 `lanternlight` 子实体，装备时挂到 owner，落地时挂到提灯，关灯／移除时释放。玩家 controller 提供通用 `AnimState.Show/Hide` 图层显隐，不持有光源，也不以手持美术加载完成作为开灯条件。与火把不同，燃料耗尽只关灯，提灯以 0% 燃料保留在手上、物品栏或地面，并以 `remainingFuel: 0` 保存；空提灯补充燃料后可重新点亮。地面提灯另存 `lantern: { ison }`，读档时按 `machine:OnLoad` 恢复开关（旧存档缺少该字段时视为开启）。已支持荧光果 `lightbulb` 添加 `CAVE` 燃料（用法见下文）。尚未实现手动开关、开关音效与循环音效，以及耗尽时的 `torchranout` 自动换装（已按 Lua 关灯后发布该事件）。

装备表现由各 prefab 的 `onequip/onunequip` 调用玩家通用 `AnimState.OverrideSymbol`、`OverrideItemSkinSymbol`、`ClearOverrideSymbol`、`Show/Hide` 和 `ShowSymbol/HideSymbol`。手持符号、皮肤和手臂显隐由对应工具／武器／提灯 prefab 指定，帽子 prefab 管理头发／头部图层、动态跟随和皇冠特效，背包 prefab 设置和清理 `swap_body`。玩家逐帧渲染只查询显隐与符号覆盖，不按装备 ID 分支；状态图的临时覆盖使用同一接口。异步美术准备绑定到本次装备生命周期，卸装后完成的请求不会覆盖新装备。换肤继续使用同一物品实体，保留 ID、燃料／耐久、皮肤及保存恢复行为。`c_give`、`c_spawn`、`c_save()` 的语法、参数与支持 ID 不变。

手部装备变化在库存事务成功提交后发布到 `handEquipmentExistenceState`，同时携带对应的物品实体引用。[packages/signals](packages/signals/README.md) 提供 `createEquipmentExistenceState('HANDS')` 工厂，每个 `InventoryStore` 默认创建独立实例，也可通过构造函数第五个参数的 `{ handEquipmentExistenceState }` 对象注入；`InventoryStore.handEquipment` 是该实例的只读接口。应用通过 `bindPlayerHandEquipment({ handEquipmentExistenceState, owner, ... })` 显式传入同一实例和装备者。存在状态只表示当前装备身份，不是移除请求，不表示燃烧状态或燃料数量。先在 `src/playerHandEquipment.ts` 注册订阅，再由 `InventoryStore.replaceState()` 恢复存档并写入 signal；该次写入直接触发装备生命周期和手持动画，订阅注册时不回放当前值。后续变化通过 prefab 注册表依次执行旧装备 `onunequip()`、新装备 `onequip(owner)`，并接入手持外观、照明和光标。`main.ts` 只接入订阅器的帧更新、结算、成功转移动画和释放。燃料及其他库存更新不重新发布装备。torch 通过独立的 `burning` signal 同步照明，`extinguish()` 只停止燃烧，保留装备和剩余燃料；燃尽时 torch 先 `entity.remove()`（库存 owner 清空手部槽，对应 Lua 的 `inst:Remove()`），再向 owner 推送 `itemranout`，玩家自动装上背包里的下一把同 prefab 火把。`onunequip()` 和释放停止燃烧并释放 owner，不修改槽位值。地面火把没有 owner，熄灭不会修改玩家装备。正常卸下使用库存转移。signal 不写入存档；UI 操作、命令及读档仍由库存提交装备结果。

头部和身体装备采用相同的工厂与订阅流程：`createEquipmentExistenceState('HEAD')` / `createEquipmentExistenceState('BODY')` 创建每个库存独立的 `headEquipmentExistenceState` / `bodyEquipmentExistenceState`，Store 在装备事务成功提交后发布身份。`src/playerHeadEquipment.ts` / `src/playerBodyEquipment.ts` 在读档前注册订阅，帽子与背包外观、背包面板开关和材料可访问性都由 signal 更新驱动；不再通过 `syncHeadEquipment()` / `syncBodyEquipment()` 读取库存同步。三种绑定共用 `@dontstarve-web/signals` 的 `bindEquipmentLifecycle()` 处理生命周期切换与释放。普通物品或组件更新不重新装备，正常卸下仍保留物品；装备耗尽由对应 prefab 移除自己的实体，结果随 `c_save()` 保存恢复。

`c_give("lightbulb", count)` 获取荧光果（默认 1，每叠最多 40 个），`c_spawn("lightbulb")` 在玩家脚点生成发光的地面荧光果；也可用 `c_spawn("flower_cave")` 生成灯草并左键采集。荧光果按 `PERISH_FAST` 保鲜 6 个游戏日（2880 秒），沿用每 10 个游戏秒结算、转移／进食／保存前结清的规则；地面腐败速率为 1.5 倍，温度和受潮倍率由通用 perishable 组件处理。右键物品栏荧光果执行进食：鲜食回复 1 生命，不增加饥饿或理智；陈旧时回复 0.333 生命，变质时不回复生命并损失 10 理智；完全腐烂后整叠替换为 `spoiled_food`。

左键拿起荧光果后，点击物品栏或手部装备槽中的提灯，或左键点击地面提灯，执行通用 `ADDFUEL` / `ADDWETFUEL`；地面目标超出 4 个场景单位时先走近。`pickup → pickup_pst` 第 6 帧成功提交时消耗一个荧光果，补充 90 秒燃料（受潮时 67.5 秒），燃料上限 468 秒，满燃料仍会接受并消耗燃料。提交前取消、目标被转移／移除或荧光果腐烂不会消耗；装备着的空提灯补燃料后自动开启，物品栏和已关闭的地面提灯保持关闭。`c_save()` 无新增参数，保留荧光果身份、数量、新鲜度、受潮与地面位置，以及提灯身份、皮肤、剩余燃料和地面开关，读档恢复；例：`c_give("lightbulb", 4); c_give("lantern"); c_spawn("lightbulb"); c_save()`。

采集等长动作的“刷刷”声随 `build_loop` 动画每一圈触发一次原版双层短音效，不再以约 0.11～0.18 秒的样本时长连续循环；准备、结束及取消后的动画不继续重复。成功采下灯草时另播放一次 `pickup_lightbulb`，与灯草 `picking → picked` 姿态同步。

手部 signal 的非空值必须声明 `EQUIPSLOTS = "HANDS"`，同时受 TypeScript 类型和 setter 运行时校验限制；身体装备或缺少槽位声明的对象不能写入。torch 公开只读的 `EQUIPSLOTS: "HANDS"` 属性。`c_give`、`c_spawn` 和 `c_save` 的命令参数及支持 ID 不变。

火把点燃播放原版 `dontstarve/wilson/torch_swing`（两段样本随机选择），卸下、燃尽或成功拾取正在燃烧的地面火把时播放一次 `dontstarve/common/fireOut`。`OnPutInInventory()` 恢复 `idle`、停止燃烧与地面音源，保留剩余燃料和皮肤；普通未点燃火把拾取不播放熄灭声。地面实体接收 `onextinguish` 事件后调用 `OnExtinguish()`：熄灭照明、恢复 `idle`，按 Lua 的小范围随机水平速度和向上速度弹离地面，保留燃料、实体 ID 与皮肤，不修改玩家手部装备。声音在装备或生成前预加载，真实鼠标或键盘输入恢复音频上下文。

地面燃烧状态保存到 `ground_item.components.torch.lit`，剩余燃料仍保存在 `stack.remainingFuel`；换肤保留燃烧和最新燃料，读档恢复燃烧但不重播点燃声。`c_spawn("torch")` 和普通丢弃仍生成未点燃火把。当前接入这两个回调及地面照明/弹跳，不包含投掷输入、飞行/插地动作、雨水/技能修正及原版火焰粒子；外部游戏逻辑可通过地面模型的 `userData.torch.ignite()` 点燃，通过 `onextinguish` 事件熄灭。

装备 `torch` 后，鼠标悬停可燃建筑显示右键“点燃”，右键自动走近地面脚点并执行原版 `LIGHT → catchonfire`：播放 `light_fire` → `light_fire_pst`，第 13 帧调用火把的 `lighter` 和目标的 `burnable`，不额外扣除火把燃料。当前可燃建筑为木箱 `treasurechest` 和烹饪锅 `cookpot`；例如执行 `c_give("torch");c_spawn("treasurechest");`，或 `c_spawn("cookpot")`，再把火把装备到手部槽并右键建筑。移动、跳跃、Esc、更换装备或操作其他目标会取消未提交的点燃；燃料耗尽、目标移除或已经燃烧时不能提交。

木箱燃烧 10 秒、锅燃烧 20 秒，使用 `anim/fire.zip` 的 `level2` / `level3` 原版火焰、局部照明及独立循环火声；附近已接入燃烧组件的建筑和地面物品按原版热量传播和阴燃分支受热。建筑、草丛／树苗、可燃地面物品和矮星的传播半径按当前季节派生：春季乘原版 `SPRING_FIRE_RANGE_MOD = 0.67`，其他季节使用基础半径；邻居查询与距离热量衰减共用修正后的半径。季节切换不重启传播定时器，下一次 0.5 游戏秒传播更新读取新半径。烧毁后显示原版 `burnt` 残骸、掉出容器中的真实物品，锅掉出已有料理并停止烹饪；残骸不能打开，再锤击一次即可拆除。建筑提供只读 `userData.burningSignal` 和 `userData.burntSignal`，火焰表现和容器 UI 订阅状态更新，烧毁主动关闭已打开的面板；换肤保留根实体、组件、signal、位置和燃烧进度，移除实体或关闭面板时释放订阅。`c_save()` 按原版将正在燃烧或已烧毁的建筑保存为 `building.burnt: true`，读档直接恢复残骸，保留实体 ID、位置、皮肤以及掉出物品的身份、数量和组件状态。当前接入这些建筑和下述材料的普通点火、烧毁及干燥天气传播分支，其他植物/物品、雨水和角色技能修正仍未接入。命令语法和参数不变；材料新增的 `c_spawn` 入口见下文。

地面上的干草 `cutgrass`、木头 `log` 和草簇 `dug_grass` 同样支持手持 `torch` 右键点燃。可执行 `c_give("torch");c_spawn("cutgrass");`，装备火把后右键地面干草；`c_spawn("log")` 生成木头，也可将 `c_give("cutgrass", 3)` / `c_give("log", 7)` 得到的物品丢到地上再点燃。干草燃烧 7.5 秒、木头燃烧 15 秒、草簇燃烧 30 秒，整叠烧毁后在原脚点生成同数量的一叠灰烬 `ash`（原版上限 40），原物品移除；灰烬美术提前准备，烧毁后立即 `c_save()` 即可保存灰烬实体、位置和数量并读档恢复。物品通过只读 `burningSignal`、`burntSignal` 和 `persistenceSignal` 通知表现及存档状态。正在燃烧时不能拾取，按原版 `DefaultBurnFn` 不写入存档；熄灭后重新可保存、可拾取，身份、数量和已有组件状态不变，拾回再丢弃保留同一份燃烧组件和 signal。活木 `livinglog`（`c_spawn("livinglog")` / `c_give("livinglog", 3)`）同样可被火把点燃并燃烧 15 秒、烧成灰烬：按 `livinglog.lua` 的 `onignite` 在点燃瞬间播放 `dontstarve/creatures/leif/livinglog_burn`（`leif.fsb` 四个样本随机选一），燃烧期间沿用通用火焰与循环火声；读档恢复燃烧不重播惨叫。石头等未声明燃烧组件的物品不提供“点燃”。新增 `c_spawn("cutgrass")`、`c_spawn("log")`、`c_spawn("ash")`，均生成在玩家脚点；`c_give` 已支持这三个 ID，语法与数量参数不变。


散落物品静态美术：导入器按原版 prefab ID 检测快照的实体分组，`.import.json` 的 `groundItemCounts` 列出每种物品的地面实体数、总数量及源组件名。物品复用 `ground_item.components.stack` 和原有 `GroundItemManager`，保留 ID、坐标（含高度）、数量、皮肤及 `variant` 外观映射；共享资源、tile 休眠、活跃对象更新及存档均沿用原有路径。已有物品继续使用原 prefab 工厂和交互；仅新增美术的物品只展示，不增加装备、使用、容器或组件计时器。

新增 `c_spawn("ID")` 均无额外参数，通过原有地面物品路径在玩家脚点生成一个实体；`c_save()` 保存并重载这些实体。支持以下 ID：

- `bedroll_straw`、`chum`、`cookiecuttershell`、`coontail`、`driftwood_log`、`glasscutter`、`glommerflower`、`lureplantbulb`、`oceanfishingrod`、`palmcone_scale`
- `palmcone_seed`、`pig_token`、`saltrock`、`sewing_kit`、`shadowheart`、`shroom_skin`、`sketch`、`tentaclespike`、`twiggy_nut`、`waxpaper`
- `beef_bell`、`blowdart_pipe`、`chester_eyebone`、`hutch_fishbowl`、`deer_antler1`、`deer_antler2`、`deer_antler3`、`dug_berrybush_juicy`、`dug_trap_starfish`、`greenamulet`
- `orangeamulet`、`icestaff`、`telestaff`、`horrorfuel`、`lavae_egg`、`tallbirdegg`、`messagebottle`、`oar`、`oar_driftwood`、`malbatross_beak`
- `sculpture_bishophead`、`sculpture_knighthead`、`spoiled_fish_small`、`tacklecontainer`、`terrarium`、`trap`、`bullkelp_beachedroot`、`bundle`、`hermit_bundle`、`playbill_the_doll`
- `playing_card`、`singingshell_octave3`、`singingshell_octave4`、`singingshell_octave5`、`strawhat`、`beefalohat`、`cookiecutterhat`、`dreadstonehat`、`footballhat`、`ruinshat`
- `mask_ancient_architecthat`、`mask_ancient_handmaidhat`、`mask_ancient_masonhat`

本次只移植静态美术，以上新美术不新增 `c_give` 库存支持；已存在的帽子等 `c_give` 行为沿用原实现。皮肤从源存档保留，换肤沿用原有 `reskin_tool` 地面物品路径。例：`c_spawn("icestaff"); c_spawn("singingshell_octave3"); c_save()`。

原版 Lua 中哪些 prefab 可用 `c_spawn`、哪些可通过 `c_give` 入栏，见 [prefab 命令静态核对表](docs/dst-prefab-console.md)。该表记录源码调查结果；本项目当前支持的 ID 以本文下方对象列表及物品定义为准。



幽灵滤镜按 `playervision.lua` 的 `GHOSTVISION_COLOURCUBES` 移植：`OnMakePlayerGhost` 更新 `playerGhostMode` signal，渲染器通过只读 memo 把昼夜、季节调色统一替换为原版 `images/colour_cubes/ghost_cc.tex`（0.25 秒渐变，与 `colourcube.lua` 的 `DEFAULT_BLEND_TIME` 一致），复活后恢复；低理智调色与边缘晃动仍叠加。目前没有直接设置生命的调试命令，可用下述 `red_cap` 食用流程验证。

玩家的三项属性由 `components.health`、`components.hunger`、`components.sanity` 各自持有，`signals` 不再保存独立属性。`hunger.lua` 每 1 游戏秒结算：Wilson 每秒消耗 75/480 饥饿，归零后从下一次结算起每秒受到 150/120 生命伤害；无敌、传送期间按 Lua 阻止扣减，幽灵暂停任务，复活重新启用。`sanity.lua` 同步处理 15%/17.5% 的疯狂迟滞、月狂模式 85%/82.5% 阈值、强制模式、上限惩罚、装备理智速率和事件；普通装备及潮湿装备沿用原版速率。`c_setsanity()` 语法与支持 ID 不变，`c_save()` 在玩家 `stats` 中按需增加 `sanitySane`、`sanityMode`，保留迟滞区间内的状态并兼容旧存档。环境光照、实体理智光环及潮湿角色本体的理智结算仍待相应逻辑组件接入；不会从渲染器读取这些数值。

玩家、生物和建筑共用 `packages/componets/src/health.ts` 的 `Health`，生命值只由实例的 `components.health` 持有；HUD 读取组件的只读信号。伤害、治疗、无敌、生命上限惩罚和保存恢复使用同一套组件方法，`signals` 不再实现玩家专用生命规则。可用 `c_give("red_cap", 8)` 连续食用验证每个 −20 生命、归零死亡、变鬼和复活；传送门复活增加 25% 生命上限惩罚，`c_save()` 和读档保留生命值及惩罚。命令语法、参数、支持 ID 与存档格式保持不变。

生命归零时玩家进入 `SGwilson.lua` 的 `death` 状态（`busy`、`dead`、`pausepredict`、`nomorph`）：`Health.SetVal()` 在生命从正值归零时直接发出 `death` 事件；状态停止移动并清除缓冲动作，播放 `dontstarve/wilson/death`（`dontstarve.fev` sounddef 15，`wilson.fsb-36`）与 Maxwell 的 `characters/maxwell/death_voice`（`waxwell.lua` 的 `soundsname = "maxwell"`，sounddef 758，`maxwell.fsb-92`），`inventory:DropEverything` 把鼠标、物品栏和装备栏的整堆物品从玩家脚下按 `OnDropped(randomdir)` 随机抛出（水平速度 2～3，重物 1～2，竖直速度为其 3 倍，起抛高度 1，重物 .5）（身份、皮肤、耐久/燃料不变；背包连同内容一起掉落；蝴蝶等活体网捕生物按 `butterfly.lua` 的 `OnDropped` 拆成每只一个实体），关闭角色控制并播放 `player_actions.zip` 的 `death` 动画，死亡动画期间不接受移动、制作、表情或重复的 `death` 事件；动画结束后 `OnMakePlayerGhost` 生成 `skeleton_player`／`die_fx` 并进入幽灵状态。可用 `c_give("red_cap", 8)` 连续食用（每个 −20 生命，Wilson 上限 150）把生命降到 0 验证。`humanmeat` 死亡掉落尚未移植。命令语法、参数与支持 ID 不变。

调色资源由 `src/main.ts` 显式调用 `DstLightingRenderer.create()` 并行加载，完成后通过 `game:lighting-ready` 事件发布实例，`src/universal.ts` 接收后供场景使用。场景在事件完成后启动；加载失败会中止启动。单独导入 `universal.ts` 不会请求调色资源或读取存档。




`c_give("bernie_inactive")` 获取伯尼，数量可指定为 `c_give("bernie_inactive", 2)`，每只占一格。Shift + 右键物品槽放到地面，也可用 `c_spawn("bernie_inactive")` 直接在玩家位置生成。地面形态按玩家实际理智比例切换：低于 15%（Wilson 理智低于 30/200）显示 `bernie_big`，其余显示 `bernie_active`；`c_setsanity(0.1)` 和 `c_setsanity(0.175)` 可验证两种形态。变大播放大伯尼的 `activate`；变小依次播放大伯尼的 `deactivate`、`deactivate_pst` 和小伯尼的 `activate`。起身结束后先播放 0.5 秒 `idle_loop_nodir`，保留播放时间切回 `idle_loop`。变身期间再次改变理智，会在当前动画流程完成后按最新理智切换。使用原版 `bernie.zip` / `bernie_big.zip` 动画和共享 `bernie_build.zip`，大伯尼保持 Lua 的 0.7 缩放，支持艾希莉、小火花两种皮肤。点击任一形态拾回时立即取消动画，仍为 `bernie_inactive`；位置、实体 ID、皮肤和物品数量随 `c_save()` 保存，恢复时根据玩家理智直接显示待机形态。当前按请求让 Wilson 也能触发两种地面形态，实现待机、大小切换动画与拾取，不包含原版 Willow 限制、技能、跟随、战斗、耐久和变身冷却。




用 `c_spawn("icebox")` 或 `c_spawn("treasurechest")` 生成冰箱或木箱后，左键点击（RUMMAGE）后玩家走到箱旁、播放 `doshortaction` 并在第 6 帧打开，再次点击以同样流程关闭；箱子放置动画播放期间不能打开。开关动画开始时分别播放原版 `dontstarve/common/icebox_open` / `icebox_close` 或 `dontstarve/wilson/chest_open` / `chest_close`；走远自动关闭时也播放关闭声。恢复存档时不重放开门声。

冰箱按 `icebox.lua` 使用 `fridge` 标签，本身没有体温组件，也不降低周围环境温度。冰箱内易腐物的基础腐烂倍率为 0.5，再叠加已有环境温度、潮湿和局部倍率；带 `frozen` 标签的易腐物在正常冰箱中停止腐烂。开门／关门不改变保鲜效果，木箱使用普通容器倍率。腐烂仍每 10 游戏秒结算，转移、保存及移除前结算不足 10 秒的部分。可用 `c_spawn("icebox"); c_give("red_cap", 2); c_give("heatrock")` 准备场景，将蘑菇和暖石移入冰箱，再用 `c_save()` 验证新鲜度和暖石温度保存恢复。冰块自身的融化组件尚未移植；此处冻结分支适用于已安装 `perishable` 并带 `frozen` 标签的物品。


容器自动关闭与制作站选择由组件订阅 `playerpositions` signal：世界每 60 个活动帧采样，位置或玩家数量变化时发布，组件不逐帧或定时轮询。`container` 只检查实际打开者，超过 Lua 的 3 单位（当前场景 9 单位）或打开者移除时关闭；`builder` 选择最近的合格制作站，`prototyper` 持有使用者集合，最后一人离开才停用。`c_spawn("bookstation")` 的 BOOKCRAFT 科技和 `c_spawn("sculptingtable")` 的 SCULPTING 科技使用同一机制；命令语法、参数、支持 ID 与存档格式不变。

`c_spawn("sculptingtable")` 在玩家前方生成陶轮，也可在制作栏用 2 石砖、2 木板和 4 树枝制作后摆放（摆放时播放 `place` 与 `sculpting_table/craft`）。美术使用原版 `anim/sculpting_station.zip`，支持 `sculptingtable_gothic`、`sculptingtable_swamp` 两款皮肤并可用清洁扫把换肤。准备 `c_give("marble")` 或 `c_give("cutstone")`，拿到鼠标上后走近陶轮左键点击：玩家自动走近并按 `GIVE` 第 13 帧提交，由 `sculptingtable.lua` 的 `trader` / `pickable` 组件接收一块材料（`marble` 覆盖 `marble.zip` 的 `marble01`，`cutstone` 覆盖 `cutstone.zip` 的 `cutstone01`），已有材料时拒收（`SLOTFULL`），其他物品拒收（`NOTSCULPTABLE`）。放入、取回材料时播放原版 `moonbase/moonstaff_place`（木质放置声叠加随机石块碰撞声）；读档恢复已有材料时也按 Lua `giveitem` 播放，换肤不播放。陶轮上的材料可左键走近取回，也会随锤击（4 次）与配方材料一起掉出；`c_save()` 保存 `sculptingtable.itemname`，读档恢复显示且不扣除物品。陶轮的 `prototyper` 在空桌提供 SCULPTING 1，放入已支持材料后提供 SCULPTING 2；选为制作站时播放 `proximity_loop` 及原版循环音效。当前未接入原版的素描收录、雕刻配方制作、月圆夜棋子掉落、燃烧和月亮玻璃。`c_spawn("cutstone")`、`c_spawn("marble")` 生成对应地面物品。
`c_spawn("moondial")` 在玩家前方生成月晷，也可在制作栏用蓝月眼 1、月岩 2、冰 2 制作后摆放（摆放时播放 `place_<月相>`，第 5 帧 `craft`、第 7 帧起非新月时 `water_movement`）。美术使用原版 `anim/moondial.zip`（bank）与 `moondial_build.zip`（build），支持 `moondial_an` 一款皮肤（仅覆盖 `basin`）并可用清洁扫把换肤。按 `moondial.lua` / `SGmoondial.lua` 跟随世界月相：月相变化时播放 `wax_to_*` / `wane_to_*`（第 4 帧 `fill`），随后循环 `idle_<月相>`；盈月（非新月）或满月使用基础反射符号，其余月相用 `moondial_waning_build.zip` 覆盖 `reflection_quarter/half/threequarter`；灯光和 `SetLightOverride` 按 `lightstates`（半月 0.7、四分之三月 1.5、满月 5，新月／蛾眉月无光），满月循环 `full_LP`。锤击（4 次，配方材料掉落并播放 `rock_break`）播放 `hit_<月相>`（第 9 帧 `water_movement`）后回到 idle。月亮玻璃（`isalterawake`）、洞穴状态文本与 Abigail 变形（`ghostgestalter`）依赖尚未移植的系统，未接入。`c_save()` 保存位置和皮肤，读档后按当前月相恢复。

`c_spawn("foliage")`、`c_spawn("beardhair")`、`c_spawn("cookingrecipecard")`、`c_spawn("scrapbook_page")`、`c_spawn("blueprint")`、`c_spawn("trinket_1")`～`c_spawn("trinket_46")` 在玩家脚点生成对应地面物品，同样可用 `c_give("<id>", 数量)`。这些 ID 目前只实现美术：地面使用原版 `anim/foliage.zip`（`anim`）、`beardhair.zip`、`cookingrecipecard.zip`、`scrapbook_page.zip`、`blueprint.zip`（均为 `idle`）和 `trinkets.zip`（bank/build `trinkets`，剪辑名为编号 `1`～`46`，`NUM_TRINKETS = 46`，32～46 为万圣节饰品）；库存图标各自解析实际 atlas（`foliage`/`beardhair`/`blueprint`/`trinket_*` 为 `inventoryimages.xml`，`cookingrecipecard` 为 `inventoryimages1.xml`，`scrapbook_page` 为 `inventoryimages3.xml`）。堆叠上限：`foliage`、`beardhair`、`scrapbook_page`、`trinket_*` 为 40（`STACK_SIZE_SMALLITEM`），`blueprint` 与 `cookingrecipecard` 无 stackable 为 1。`blueprint_rare` 的 `anim/blueprint_rare.zip` 与 `blueprint_rare.tex` 已导入为 `blueprint` 的稀有变体资源，但随机配方、命名、蓝图学习（teacher）、食谱卡随机配方与描述、图鉴页教学、燃烧／燃料、可交易、诱饵与作祟等玩家交互均未实现；`cookingrecipecard` 没有随机配方，所以名称不带“{item}”。`c_save()` 保存身份、位置和数量。

`c_spawn("tumbleweed")` 在玩家脚点生成风滚草，无额外参数，不能 `c_give`。美术使用原版 `anim/tumbleweed.zip`（bank/build `tumbleweed`，四面朝向按摄像机航向选取，`move_loop` 循环）。世界新增 `worldwind` 组件（`packages/componets/src/worldwind.ts`）：`angle` 是私有可写 signal（初始 0～360 随机整数，对外只读），`windchange` 是只读 signal，每次变风都发布一个新的 `{angle, velocity}`（即使角度重复也通知）；风速恒为 1。世界初始化时创建并注入 `getWatchWorldContent`，风滚草通过 `WorldContentKey.Wind` 建立私有监听；世界释放时停止风向任务。首次变风在 1 个游戏秒后，之后每 15～30 秒（`0.5～1 × SEG_TIME`）由游戏时间调度器上的离散任务触发，不逐帧递减；风向不入档，读档重新随机。风滚草按 `blowinwind.lua`（`packages/componets/src/blowinwind.ts`）滚动：生成时读取当前风向并加 ±10 度随机偏差（限制在 0～360），监听 `windchange` 后同样加偏差更新方向；风向向量逐帧累加为速度（上限 1），速度映射到平均行走速度 5 DST 单位（场景 15），速度大于等于 0.5 后按正弦在 0.5～1.5 倍间变化，沿 `(cos, -sin)` 前进，与原版一致。左键点击执行 `PICK`（`dolongaction`），长动作开始时推送 `startlongaction`：风滚草停下并播放 `move_pst → idle`，2～6 秒后 `move_pre → move_loop` 重新滚动。采摘按原版权重表抽取 3 件战利品掉在原地并播放 `break` 特效，风滚草不进入物品栏。每约 0.8 秒检查脚下是否仍是陆地，滚到海里会被移除。`c_save()` 只保存身份和位置（原版只在燃烧时存 `burnt`），读档按当前风向重新滚动。战利品表中 `foliage`、`trinket_*`、`blueprint`、`beardhair`、`cookingrecipecard`、`scrapbook_page` 已有地面美术，会按权重掉落；`rabbit`、`spider`、`frog`、`bee`、`mosquito` 项目尚无 prefab，仍参与抽取但不会掉落；燃烧／灰烬、弹跳与合唱音效、幽灵作祟、玩家靠近事件尚未接入。

`c_spawn("hotspring")` 在玩家脚点生成温泉，`c_give("bathbomb", 2)` 给予沐浴球（每叠 20 个，可燃，也是 `MED_FUEL` 的燃料）。温泉使用原版 `anim/crater_pool.zip` 的 `crater_pool` 循环 `idle`，美术作为 billboard 随相机朝向变化，保留 `LAYER_BACKGROUND` 的背景绘制顺序并按实际地面脚点排序，不将贴图旋转平铺到地面；沐浴球使用 `anim/bath_bomb.zip`，库存图标 `bathbomb.tex` 来自 `images/inventoryimages1.xml`。把沐浴球拿到鼠标后点击温泉执行 `BATHBOMB`（“投入”），走到范围内经 `doshortaction` 第 6 帧提交，成功只消耗 1 个；取消则保留物品。未投入时温泉 `GetHeat()` 为 `TUNING.HOTSPRING_HEAT.PASSIVE`（45），无光；投入后播放 `bath_bomb → glow_pre → glow_loop`，热量变为 `ACTIVE`（90），点亮源 `HOTSPRING_GLOW`（radius 2、intensity/falloff 0.75、colour `(0.1,1.6,2)`，半径按场景换算），`bathbombable` 标签移除，不能重复投入。温泉带 `HASHEATER`、`watersource`、`antlion_sinkhole_blocker`、`birdblocker` 标签和半径 1 DST 单位的障碍。`c_save()` 保存位置、身份和 `isbathbombed`，读档直接恢复发光循环、热量和光照，不重播动画；移除温泉释放碰撞体、光照和 heater 标签。游戏场景中的温泉按玩家周围默认 10 格的方形 tile 区域切换模型、碰撞体和动画更新；离开范围时保留逻辑记录、原模型与组件状态，`c_save()` 仍保存这些温泉，返回范围时恢复同一实例。未注入 tile 查询或查询返回 `undefined` 时回退为 active；有效 tile memo 为 `false` 时正常休眠。休眠模型资源暂不卸载；单个温泉移除会清理自己的 tile 监听，不影响同格其他温泉。蒸汽特效按 `hotspring.lua` 的 `StartFx`：游戏时间调度器上 `HOTSPRING_IDLE.BASE`（3 秒）的周期任务，首次延迟 `random()*HOTSPRING_IDLE.DELAY`（4 秒）；触发时按 `is_bathbombed` 在原位生成一次性、不保存的 `crater_steam_fx1-4`（`anim/crater_steam.zip`）或 `slow_steam_fx1-5`（`anim/slow_steam.zip`），动画 `steam<N>` 播完即移除，按 `SetFinalOffset(1)` 绘制在温泉之上。温泉离开 tile 范围相当于 `OnEntitySleep` 停止周期任务，返回范围（`OnEntityWake`）重新计时；已生成的蒸汽播完即止。当前只实现热源、光源、蒸汽和沐浴球交互；满月结晶（glassed，含结晶闪光）与采矿再生、沐浴池回复生命／理智、水源取水、投入音效以及角色体温消耗热源尚未接入。



**钓鱼**：`c_give("fishingrod")`（淡水钓竿，9 次耐久）或 `c_spawn("fishingrod")`（地面物品），装备后左键点击 `c_spawn("pond")` 的池塘抛竿（`FISH`，走到池边后播放 `fishing_pre`，第 15 帧开始钓鱼）；等待 `4 + (1 - 剩余鱼比例) × 36` 秒后上钩，状态为 `fishing_nibble` 时再点击池塘钩住（光标文字“上钩”），拉扯状态点击收线（“收线”，`REEL`）；钓上的 `pondfish` 落在玩家身后的地面并消耗 1 次耐久。钩住后若在 `耐久比例 × 5` 秒内没有收线，鱼竿断线丢失（`loserod`），鱼放回池塘。在上钩前点击池塘显示“停止钓鱼”，移动或点击别处同样结束钓鱼。钓竿有 3 个原版皮肤（`fishingrod_block`、`fishingrod_curl`、`fishingrod_sword`），可通过清洁扫把更换。未接入 `fishingrod_replica`、`weighable`、海钓竿和冰钓；`dontstarve/common/fishingpole_strain` 在所有 FEV 中都不存在，因此与原版一样无声。示例：`c_spawn("pond"); c_give("fishingrod"); c_save()`。

`c_spawn("mermhead")` 与猪头共用 `stickheads.lua` 的构造函数：同样的睡醒、苍蝇、锤子 3 次、火炬点燃和存档规则，美术为 `anim/merm_head.zip`（无皮肤）。拆除按 `DeconstructRecipe("mermhead", 1 淡水鱼 + 4 腐烂食物 + 4 树枝)` 掉落 1 淡水鱼、2 腐烂食物和 2 树枝，满月夜额外 1 噩梦燃料。为此新增 `pondfish`：`c_give("pondfish")` / `c_spawn("pondfish")`，不可堆叠，地面使用 `fish/fish/idle`，库存图标 `pondfish.tex`；回血 1、饥饿 12.5，`PERISH_SUPERFAST`（3 天）后腐烂为 `fishmeat_small`，可交易（MEAT 金价）。`pondfish` 的地面扑腾、`bait`、`cookable`（熟鱼）、`murderable`、`weighable` 和作祟尚未移植。示例：`c_spawn("mermhead"); c_give("hammer"); c_give("pondfish"); c_save()`。


岩石 `rock1`／`rock2`／`rock_flintless*`／`cavein_boulder`／`rock_moon*`／`moonrockseed`、梦魇方尖碑 `sanityrock`／`insanityrock`、大理石灌木 `marbleshrub*`、已支持的 `archive_props`、骷髅 `skeleton*`、猎犬骨 `houndbone` 和鼹鼠巢穴 `molehill` 通过 `PrefabInstance` 声明生命周期和外观，由 `packages/display` 创建、卸载和恢复 visual。活动区休眠保留 ID、脚点、开采进度、成长计时和巢穴库存／子代；唤醒恢复动画、符号替换、颜色、雪层、侵蚀状态及地面层级，传送门的 `DECOR`／`NOCLICK` 阴影也随主体释放和恢复。鼹鼠巢穴保持原版直立的背景层；方尖碑继续由状态图决定升降与碰撞，休眠中的过渡按项目驻留约定结算。`c_spawn("rock1")`、`c_spawn("sanityrock")`、`c_spawn("marbleshrub_tall")`、`c_spawn("archive_portal")`、`c_spawn("skeleton")`、`c_spawn("houndbone")`、`c_spawn("molehill")` 和无参数 `c_save()` 的语法、支持 ID 与存档字段不变，休眠实体仍参与保存。

`c_spawn("wardrobe")` 在玩家前方生成衣柜，使用原版 `anim/wardrobe.zip` 的 bank/build `wardrobe` 和 `closed` 外观。当前仅实现贴图显示，无开关门、换装或锤击交互；位置随 `c_save()` 保存并在加载时恢复。




捕捉和锤击按 Lua 的组件动作规则选择目标：工具的 `tool` 组件维护 `NET_tool` / `HAMMER_tool`，目标的 `workable` 动态维护 `NET_workable` / `HAMMER_workable`；命中时重新检查组件状态。`c_give("bugnet")` 获取捕虫网，`c_spawn("bugnet")` 生成地面捕虫网，满耐久为 10 次。捕捉蝴蝶、萤火虫成功执行工作后消耗 1 次，完整库存下按 Lua 再次掉落生物并恢复可捕捉状态。萤火虫隐藏、淡出及延迟禁用工作时更新能力标签。`CASTSPELL` 由 `spellcaster` 的 `castontargets` 标签提供，`nomagic` 目标不提供该动作；提交前还要通过清洁扫把的换肤校验。目标列表只提供场景/渲染引用，不按物品 ID 或受击动画推断动作能力。

清洁扫把从 action entity 注册表读取鼠标命中的实体，可换肤实体在注册时提供自身的换肤操作，移除或更换地面模型时清理旧注册。没有皮肤的实体仍按标签提供 `CASTSPELL`，在第 9 帧校验失败时保留目标、不播放换肤烟雾。换肤成功时将预备好的 FX 消息交给目标，目标应用 skinId 后按自身 prefab ID 和脚点启动独立烟雾。FX 的标签、动画、符号覆盖和照明由逻辑实体声明，模型、共享 sprite、场景挂载与释放由 `packages/display` 管理；烟雾不跟随目标移动，也不写入存档。`c_give("reskin_tool")`、`c_spawn("reskin_tool")`、`c_save()` 的语法、参数、支持 ID 和换肤存档行为不变。

锤击与换肤统一从命中实体注册的 `hammerTarget`／`reskinTarget` 取目标，`src/registerDisposal.ts` 不再汇总各 manager 的锤击列表。目标的有效性仍由所属 prefab 判断，工作量由 `workable` 结算，受击与拆除由各 prefab 注册的组件回调处理，命中时重新检查目标与工具；实体移除或地面模型替换会清理这两项注册。`c_give("hammer")`、`c_spawn("hammer")`、`c_give("reskin_tool")` 和 `c_save()` 的语法、参数、支持 ID 与存档字段不变。

建筑由各 prefab 创建 `workable` 并注册 `onworked(inst, worker, workleft, numworks)`／`onhammered(inst, worker)`，直接使用实例及组件；`LootDropper` 按配方、剩余使用次数比例和烧毁状态计算返还，并处理木炭概率，manager 维护集合与移除清理。`c_spawn`、`c_give`、`c_save()` 的语法、参数、支持 ID 和存档字段不变。

`c_give("dreadstone", 3)` / `c_give("wagpunk_bits", 3)` 获取墙体拆除材料，`c_spawn("dreadstone")` / `c_spawn("wagpunk_bits")` 在玩家位置生成一份。库存图标使用各自真实 atlas，地面使用源动画的 `idle`；数量、实体 ID 和落点随 `c_save()` 保存恢复。

蝴蝶 `butterfly` 与月蛾 `moonbutterfly` 现在按 Lua 的实体结构运行：行为树在 `packages/brains/src`（`behaviourtree.ts` 对应 `behaviourtree.lua`，`behaviours/{runaway,wander,doaction,findflower,panic,avoidelectricfence}.ts`、`braincommon.ts`、`butterflybrain.ts`、`moonbutterflybrain.ts` 逐一对应同名 Lua），状态图在 `packages/stategraphs/src/SGbutterfly.ts`，`locomotor`、`pollinator`、`knownlocations` 组件在 `packages/componets/src`，`packages/prefab/src/butterfly.ts` 只负责实体、世界适配和美术。蝴蝶的优先级为 恐慌 → 电栅栏 → `RunAway`（`scarytoprey`，5 单位内逃离、10 单位外停止）→ 夜晚回家 → 采满花粉回家 → `FindFlower` → `Wander`；因 `PriorityNode` 的评估周期散布和 `Wander` 的初始等待，生成后约 2–4 秒才开始飞行（`random` 固定为 0 的测试可复现），`idle` 状态只在 `idle_flight_loop` 播完一轮后才转入 `moving`。到花朵的到达距离按 `locomotor.lua` 的 `ARRIVE_STEP + 物理半径` 计算，而不再直接贴到花心；`POLLINATE` 落地后授粉 2 秒（`GetRandomWithVariance(3, 1)`）再起飞，访问过的花不会再访问，`GOHOME` 落地播放完后移除。月蛾使用 `anim/butterfly_basic.zip` 的 `butterfly` bank 与 `butterfly_moon` build，移动速度 `MOONBUTTERFLY_SPEED = 2.5`，没有授粉组件，行为树是 恐慌 → 电栅栏 → `RunAway` → 围绕 `knownlocations` 的 `home`（掉落时位置）`Wander`（最大 20 单位）；带半径 0.5、强度 0.5 并随 `OnUpdateFlicker` 闪烁的月光（颜色 0.3/0.55/0.45）和 0.15 的光照覆盖。月蛾寿命 `TOTAL_DAY_TIME / 2`，在物品栏里按 0.25 倍速腐败，在物品栏里腐败直接消失，在地面腐败则关闭光、禁用捕虫网并进入 `death`（掉落 `moonbutterflywings`），3 秒后移除。月树砍倒时的 `moonbutterfly` 掉落（100% 一只，50% 第二只）现在是真实的月蛾。`c_spawn("butterfly")`、`c_spawn("moonbutterfly")`、`c_spawn("moonbutterflywings")` 和对应的 `c_give` 都可用；月蛾翅膀可食用并会腐败。尚未接入：冻结/电击状态（`CommonStates.AddFrozenStates` / `AddElectrocuteStates`）、`Pollinator:CreateFlower`、蝴蝶生成器、`MakeFeedableSmallLivestock` 喂食、燃烧与万圣节月亮变异、墙体视线检查（`FindWalkableOffset` 的 `check_los`）和 `RunAway` 的 `safe_point_fn` / 回家分支。

`c_give("butterfly", 2)` 获取活蝴蝶；点击或右键物品栏中的蝴蝶拿到鼠标后，右键可种植的空地执行 `DEPLOY`。预览使用 `anim/flowers.zip` 的 `flowers` bank/build、`f1`，间距为 LESS（0.75 DST 单位）；角色自动走近，在 `doshortaction` 第 6 帧消耗 1 只并生成原版 `planted_flower`（运行时及存档 prefab 为 `flower`），触发 `growfrombutterfly` 并播放种植声。花型随机为 f1–f10，玫瑰概率 1%；无效地形、阻挡、Esc 或切换动作不会消耗蝴蝶。`c_spawn("planted_flower")` 可直接生成种下的花，不支持 `c_give`；`c_save()` 保存花的 ID、脚点、花型及种植标记，恢复后仍可供蝴蝶授粉。

花朵（含自然花、种下的花和玫瑰）、大理石豆苗 `marblebean_sapling` 和石果萌芽 `rock_avocado_fruit_sprout_sapling` 通过动画包的 `ResidentSprite` 驻留，并共享 archive sprite 与实例批次；源动画仍按非循环方式播放。活动区休眠只释放 visual，唤醒恢复花型、形状、明度、积雪和相机朝向，保留实体、脚点、组件及已有的物理和小地图。豆苗和石果萌芽在休眠时仍按游戏时间生长／替换，燃烧计时也继续；大理石灌木开采后由调度器在 `mined_*` 动画时长结束时移除，不因卸载 visual 提前结算。调试命令语法、参数和支持的 `c_spawn` / `c_give` ID 不变，`c_save()` 继续保存休眠中的逻辑实体。

花朵支持玩家左键通用 `PICK`：例如 `c_spawn("planted_flower")` 后点击花朵，角色走近并通过快速 `doshortaction` 在第 6 帧获得 1 个 `petals`，恢复 5 点理智；`plantkin` 不获得这次理智恢复。玫瑰会通过玩家 `combat:GetAttacked` 造成 1 点伤害并发送 `thorns`，已装备 `bramble_resistant` 标签物品或带 `shadowminion` 标签时免疫刺伤；只放在物品栏里的装备不生效。成功后依次发送世界 `plantkilled`、实体 `picked` 并移除花朵，取消或产物准备失败时保留花和属性，燃烧／`intense` 状态不能采摘。库存满时沿用 `GiveItem` 将花瓣掉到玩家脚点；采花后 `c_save()` 不再导出该花，花瓣身份、数量、位置及玩家理智／生命保存恢复，读档不会重新出现已采的花。花的 `picksound` 保留原版字段，普通玩家快速采摘状态不额外播放该元数据的声音。

采花得到的 `petals` 和 `c_give("petals", count)` / `c_spawn("petals")` 生成的花瓣均接入原版 `PERISH_FAST`：基础保鲜期 6 游戏日（2880 秒），每 10 游戏秒结算，完全腐败后整叠替换为同数量 `spoiled_food`。地面、冰箱、受潮和温度倍率沿用通用 perishable 组件；转移和 `c_save()` 前结清不足 10 秒的时间，鼠标持有与读档保留身份、数量和新鲜度。

普通蝴蝶按 `BUTTERFLY_PERISH_TIME` 在持有者中饥饿腐败，基础寿命为 3 游戏日（1440 秒），每 10 游戏秒结算，丢弃时结清并暂停、捕获后继续；地面自由飞行期间不腐败。转移、保存和种植前结清未满周期的时间，`c_save()` 保留物品栏／鼠标堆叠的身份、数量和新鲜度。寿命耗尽时先移除整叠蝴蝶，再对每只按原版权重独立生成 `butter`（0.1 / 5.1）或 `butterflywings`（5 / 5.1），放回持有者，装不下则掉落。`c_give("butter", count)` / `c_spawn("butter")` 支持黄油，地面使用 `anim/butter.zip` 的 `butter/idle`，库存图标为 `images/inventoryimages.xml` 的 `butter.tex`；黄油与翅膀分别在 40 / 6 游戏日后腐败为 `spoiled_food`，可食用，均无装备外观或源皮肤。

蝴蝶与萤火虫的昼夜判断通过 `WorldContentKey.Cycle` 的私有监听读取世界状态；满月仍属于夜晚，不从光照表现层反推。月晷、月台和月之魔典通过 `WorldContentKey.Moon` 读取 `{ phase, waxing }`，月台结合 Cycle 派生满月夜，月之魔典仍使用世界命令修改月相；移除或动作结束时释放对应监听。世界内容新增 `WorldContentKey.PlayerPositions`（`playerpositions: Vector3[]`）：初始化及每 60 个活动帧发布玩家位置副本，暂停帧不计数。萤火虫通过私有位置监听响应快照变化，按 Lua 的 3 / 5 单位（场景 9 / 15，边界为严格小于）判断靠近／离开，不逐帧查询玩家。萤火虫显隐判定集中在 `createEffect`，休眠继续门控昼夜与位置监听；`tickingarea` 变为 true 后 effect 重新读取当前昼夜，白天立即隐藏模型、清零光照、停止淡变与延迟检查并禁用 NET，不保留夜晚状态或丢弃闪光，且在读取玩家位置前短路。活动区内进入白天也执行相同清理；夜晚切换及夜晚／黄昏丢弃后的 2～3 游戏秒检查、普通淡出后的 1.5～2.5 秒 NET 禁用仍由游戏时间调度器计时，入栏／移除取消任务；便便苍蝇的 `playerprox` 也读取自己的私有位置监听，保留 2 / 3 单位（场景 6 / 9）范围；组件通过纯 `createMemo` 缓存玩家的 X/Z tile 坐标，按当前 near/far 半径排除相隔过远的格子，其余候选继续使用完整三维平方距离和严格边界判断。位置快照不变时复用玩家 tile 坐标，移除时随私有监听释放 memo。模块顶部按两个 tile index 的无序对缓存格子间距，同一格的实体、不同 near/far 半径以及 A→B／B→A 共用同一项；玩家换格后使用新的 key，位置快照更新无需清空格子距离缓存，各实体的精确距离与 near/far 状态仍独立。现有调试命令语法、参数、支持 ID 和存档字段不变。

常青树 `evergreen*`、桦树 `deciduoustree*`、月树 `moon_tree*` 和蘑菇树 `mushtree*` 现由 `PrefabInstance` 声明状态与动画，`packages/display` 管理 visual 的创建、休眠、唤醒和永久释放。季节 build、树叶符号、颜色、雪层与相机朝向在重建后恢复；生长、砍伐工作量、树桩、烧焦状态和组件计时保留在逻辑实体上。针叶、落叶、花瓣与燃烧火焰也由 display 绘制，火焰通过 `attachFx()` 声明。月树改由 `createMoonTreeManager()` 按存档逐棵恢复，已删除森林聚合容器、随机森林参数及 `bindWorld()`／`setNormals()` 接口；月树 prefab、幼苗、种植、伐木和存档支持保留。调试命令语法与支持 ID 不变，例如 `c_spawn("evergreen_tall")`、`c_spawn("deciduoustree_tall")`、`c_spawn("moon_tree_tall")`、`c_spawn("mushtree_medium")`、`c_spawn("moonbutterfly_sapling")`，`c_save()` 继续导出活动与休眠中的全部逻辑树木。

斧头可用 `c_give("axe")`、`c_give("goldenaxe")` 或 `c_give("moonglassaxe")` 获取，`c_spawn` 同名 ID 生成地面工具，每格一把。三种斧头满耐久均为 `TUNING.AXE_USES = 100`，每次成功砍伐分别消耗 1 / 0.25 / 1.25，月光玻璃斧的 `CHOP` 效率为 2.5；拖到手部装备槽后显示 `swap_axe` / `swap_goldenaxe` / `swap_glassaxe` 手持外观，耗尽后自动卸下并移除。月树 `moon_tree` 支持 `short` / `normal` / `tall` 三阶段，旧森林存档的空组件继续从 `tall` 恢复：装备斧头后右键月树（与镐子相同，使用右键），玩家自动走近并播放 `anim/player_actions_axe.zip` 的 `chop_pre → chop_loop`，第 2 帧执行 `CHOP` 工作并消耗耐久；`CHOP_tool` / `CHOP_workable` 标签选择动作，命中时重新验证组件，移动、Esc、卸下或更换斧头可取消尚未命中的砍伐。月树需要 `TUNING.MOON_TREE_CHOPS_TALL = 16` 次工作量，每次命中播放 `dontstarve/wilson/use_axe_tree`（FEV 两层：`chop_tree_V2_*` 与 `branchfoley_v2_*`）、`chop_tall` 与花瓣特效 `tree_petal_fx`；最后一击播放 `dontstarve/forest/treeFall`，按玩家相对相机右向量选择 `fallleft_tall` / `fallright_tall`，在倒下一侧抛出 4 个 `log`、2 个 `moon_tree_blossom` 和 1–2 只 `moonbutterfly`（第二只 50%），随后保持 `stump_tall` 树桩（移除 `shelter` 并标记 `stump`）。砍伐进度与 Lua `workable` 一样不写入存档，但加载/卸载月树模型时保留；`c_save()` 对树桩保存 `moon_tree.components.moonTree.stump`，读档直接显示树桩。`moon_tree_blossom` 为 `PERISH_FAST` 的月树花（`HEALING_TINY`），可用 `c_give("moon_tree_blossom")` 或 `c_spawn("moon_tree_blossom")` 获取。装备铲子或黄金铲子后可右键挖掉树桩：树桩带 `DIG_workable`，只需 1 次工作，在 `shovel_loop` 第 15 帧掉落 2 个 `log` 并移除树桩；成功才消耗铲子耐久，取消不消耗。铲除会同时移除逻辑实体与模型，离开再返回不会重生，`c_save()` 不再导出已挖掉的月树，读档保留移除结果与木头掉落。小／中／大月树砍伐工作量分别为 8／12／16，小月树掉落 2 个木头并有 50% 概率掉月树花；中月树掉落 3 个木头、1–2 朵花（第二朵 25%）和 1 只月蛾；大月树维持上述掉落。小月树桩挖掘掉落 1 个木头，中／大树桩掉落 2 个。当前未接入：自然繁殖、技能与角色专属伐木分支。




`c_give("moonbutterfly", 2)` 获取月蛾，点击或右键物品栏里的月蛾拿到鼠标后显示通用种植预览，再右键可种植的空地执行 `DEPLOY`；角色走近后通过 `BufferedAction` 和 `SGwilson.doshortaction`，在第 6 帧消耗 1 只并生成 `moonbutterfly_sapling`。成功后剩余堆叠仍由鼠标持有，可继续种植；Esc 或切换动作取消未提交的动作，不消耗物品。PLANT 地形验证、阻挡、走近、预览与普通蝴蝶／挖起的植物共用 `PlantDeployment`，花管理器不再监听鼠标或键盘，也不再拥有月蛾的预览、回调扣物品或即时生成入口。间距按 Lua 的 `DEPLOYSPACING.PLACER_DEFAULT` 为 3.2 DST 单位（场景 9.6），月树和幼苗的 smart radius 为一半（场景 4.8）；未加载模型的逻辑月树仍阻挡种植。预览／幼苗使用原版 `anim/baby_moon_tree.zip` 的 `baby_moon_tree` bank/build、`idle`，种下播放 `dontstarve/wilson/plant_tree`。幼苗按 `PINECONE_GROWTIME` 在 150–300 游戏秒后生成小月树，并播放 `grow_seed_to_short`；幼苗不受春季加速。月树按小 → 中 → 大 → 小循环，各阶段持续 300–600／900–2100／900–2100 游戏秒；新登记的生长任务在春季乘 0.75，不改写已登记的截止时间。转换使用 `grow_short_to_normal`、`grow_normal_to_tall`、`grow_tall_to_short` 与原版生长声；转换阶段会重置砍伐工作量。逻辑生长由 `packages/componets/src/growable.ts` 和游戏时间调度器驱动，模型卸载保留计时，重新加载补齐生长；砍倒后停止生长，挖掉幼苗取消它的计时。`c_save()` 保存幼苗 ID／位置及 `saplingTimer` 的 `grow` 剩余时间、鼠标剩余月蛾的身份／数量／新鲜度；月树保存大小、`growable` 阶段／剩余时间／离屏时间，读档恢复原姿态与计时。`c_spawn("moonbutterfly_sapling")` 可直接生成幼苗，`c_spawn("moon_tree")` 随机生成小／中／大月树，`c_spawn("moon_tree_short")`、`c_spawn("moon_tree_normal")`、`c_spawn("moon_tree_tall")` 分别指定阶段；保存时统一使用实际实体名 `moon_tree`。这些世界实体不支持 `c_give`。

`c_spawn("evergreen_tall")` 在玩家所在的地面生成大常青树；`c_spawn("evergreen_short")`、`c_spawn("evergreen_normal")` 分别生成小／中常青树，`c_spawn("evergreen")` 随机选择小／中／大阶段。保存名统一为 `evergreen`，这些世界实体不能 `c_give`。本次交互范围为生长、斧头砍伐和铲除树桩。原版 bank 为 `evergreen_short`、build 为 `evergreen_new`；动画分别来自 `anim/evergreen_short_normal.zip` 和 `anim/evergreen_tall_old.zip`，build 来自 `anim/evergreen_new.zip`。按小 → 中 → 大 → 衰老 → 小循环，阶段时间为 300–600／900–2100／900–2100／150–450 游戏秒，春季新登记任务乘 0.75。变化播放 `grow_short_to_normal`、`grow_normal_to_tall`、`grow_tall_to_old`、`grow_old_to_short` 及原版生长／衰老声；衰老树使用 `idle_old` 且失去 `shelter`。右键装备斧头的目标，沿用 `CHOP` 的走近、动作提交与取消流程；小／中／大／衰老树工作量为 5／10／15／1，转换阶段重置工作量。砍伐播放原版斧击声及 `pine_needles_chop` 松针特效（衰老树无松针）；砍倒按玩家方向选择倒下动画，掉落分别为 1 木头／2 木头 + 1 松果／3 木头 + 2 松果／1 松果，并留下对应阶段树桩，停止生长并移除树干碰撞。铲子右键树桩在挖掘提交帧掉落 1 木头并永久移除；取消不耗耐久。`c_give("pinecone", 3)` 获取松果，`c_spawn("pinecone")` 生成地面松果，库存图标来自 `images/inventoryimages.xml`，地面为 `anim/pinecone.zip` 的 `pinecone/idle`。`c_save()` 保存树的 ID、位置、阶段、剩余生长／离屏时间、树桩和掉落状态，读档恢复对应姿态与碰撞；砍伐进度不写入存档，模型卸载仍保留同一个逻辑 `workable` / `growable` 组件。常青树没有源皮肤。常青树通过共享 archive sprite 的 `instancedAnimations`（`sway1_loop_*`、`idle_old`、`stump_*`、`burnt_*`）合批绘制，两个动画 zip 经 `extraAnimationArchives` 合并为同一 bank；砍伐、生长等一次性动画仍使用共享帧几何，命令与 ID 不变。松果种植、点燃、树桩自然腐朽、自然繁殖、石化与树精守卫不在本次交互范围内。

`c_spawn("deciduoustree_tall")` 在玩家地面脚点生成大桦树；`deciduoustree_short`、`deciduoustree_normal` 分别是小／中桦树，`deciduoustree` 随机选择三个阶段。保存名统一为 `deciduoustree`，世界树不能 `c_give`。小 → 中 → 大 → 小循环，阶段为 300–600／900–2100／900–2100 游戏秒，春季新登记生长任务乘 0.75；工作量为 5／10／15。树干使用 `anim/tree_leaf_trunk_build.zip`，三种大小动画来自 `anim/tree_leaf_short.zip`、`tree_leaf_normal.zip`、`tree_leaf_tall.zip`，`swap_leaves` 分别覆盖绿／红／橙／黄 build，冬季清除树叶。季节切换沿用原版换叶、长叶／落叶动画、森林音效与 `tree_leaf_fx_*` 特效；换叶完成通过游戏时间任务执行，离屏也能完成。每日回调用离散定时任务实现；当前世界尚无自动季节日历，因此季末提前 3 天换叶的分支只有在注入真实日历时执行，不根据温度推断季节进度。

装备斧头后右键桦树，沿用通用 `CHOP` 的走近、动作提交、取消和耐久消耗；砍倒按玩家方向播放倒下动画并留下对应阶段树桩，停止生长／换叶任务，移除树干碰撞。小／中树掉落 1／2 木头，大树掉落 3 木头，春夏另掉 1 桦栗果 `acorn`，秋季另掉 2 桦栗果，冬季无桦栗果。装备铲子右键树桩，在挖掘提交帧再掉落 1 木头并永久删除实体。`c_give("acorn", 3)` 获取桦栗果，`c_spawn("acorn")` 生成地面桦栗果；库存图标为 `images/inventoryimages.xml` 的 `acorn.tex`，地面使用 `anim/acorn.zip` 的 `acorn/idle`。例如 `c_spawn("deciduoustree_tall"); c_give("axe"); c_give("shovel"); c_save()`；存档保留树 ID、位置、生长阶段与剩余时间、树叶 build／当前及目标状态、待换叶时间、树桩和掉落物，砍伐工作进度按 Lua 不写入存档，离屏模型卸载仍保留逻辑组件。桦树没有源皮肤。本次范围为生长、斧头砍伐与铲树桩，不含桦栗果种植、燃烧、自然繁殖／腐朽和桦树精战斗。
工具目标的鼠标选取按手持装备与实时组件能力筛选：空手或工具不匹配时，树木／树桩／仅供铲挖的幼苗和鼹鼠巢穴、矿石／大理石灌木／封闭洞口／可开采的档案馆及洞穴装饰、骨堆／墙／栅栏／耕地机等不参与鼠标射线检测，可以点到其后的物品。`axe`、`shovel`、`pickaxe`、`hammer`（含已支持的黄金／玻璃变体）分别匹配 `CHOP`／`DIG`／`MINE`／`HAMMER`；`torch` 和 `firestaff` 匹配当前允许近战／远程点燃的目标。建筑的开箱、投喂、加燃料等交互继续保留鼠标资格，墙、栅栏和建筑仍可用 `reskin_tool` 换肤；地面物品拾取与植物采摘沿用原有入口。装备切换、工作组件替换、燃烧、工作耗尽和移除会更新独立的鼠标候选，不写入 `NOCLICK`，不影响世界查询、碰撞、生长或存档。验证示例：`c_spawn("evergreen_short"); c_spawn("rock1"); c_spawn("skeleton"); c_give("axe"); c_give("shovel"); c_give("pickaxe"); c_give("hammer"); c_give("torch")`；空手时可点击穿过只支持工具的目标，装备匹配工具后恢复选取。`c_save()` 继续保存实体与掉落结果，命令语法、参数和支持 ID 不变。

树木与花的点燃：装备 `torch` 后右键 `evergreen`、`deciduoustree`、`moon_tree` 的任一阶段树木、树桩以及已种下的 `flower`，沿用通用 `LIGHT` 动作（`canlight` 标签）。树使用 `MakeLargeBurnable(TREE_BURN_TIME = 45)` + `MakeMediumPropagator`，火焰取 `fire.zip` 的 `firelevels[5]`（`level4` 动画、`dontstarve/common/forestfire`、照明半径 6）；树桩和小型火焰按各自 FX 等级取对应项；月树按大小为 22.5／45／67.5 秒，树桩 10／20／30 秒（常青、桦树树桩 10 秒），花 10 秒。烧完的树立即切到 `burnt_*` 并带 `burnt` 标签，0.5 秒后移除 `burnable`／`propagator`／生长／`shelter`，只剩 1 次工作量：砍下播放 `treeCrumble`，掉落 `charcoal`（常青 10% 松果、桦树 10% 桦栗果，另在烧毁 10 秒后各掉一次）并在 `chop_burnt_*` 结束后移除；月树只掉木炭。树桩和花烧完生成 1 个 `ash` 并移除。离开加载范围时，燃烧中的树按 `OnEntitySleep` 直接变为 burnt、燃烧中的树桩直接变灰烬。`c_save()` 对燃烧中或已烧毁的树写入 `evergreen.burnt` / `deciduoustree.burnt` / `moonTree.burnt`（及常青、桦树的 `burntcone`），生长组件只保留 `stage`，读档直接显示烧毁树；燃烧中的树桩仍按树桩保存，燃烧中的花不写入存档。测试：`c_spawn("evergreen_normal")` 后 `c_give("torch")`、装备并右键点燃，等待 45 秒后砍烧毁的树取得 `charcoal`。

鹤嘴锄可用 `c_give("pickaxe")`（或 `c_give("goldenpickaxe")`）获取，`c_spawn("pickaxe")` / `c_spawn("goldenpickaxe")` 生成地面工具，每格一把。普通鹤嘴锄满耐久可开采 33 次，黄金鹤嘴锄可开采 132 次，开采效率相同；内部满耐久均为 33，成功开采分别扣 1 / 0.25，库存及装备槽显示剩余百分比，耗尽后自动卸下并移除。拖到手部装备槽后显示原版手持外观。用 `c_spawn("rock1")` 等命令生成岩石后，手持鹤嘴锄右键岩石会自动走近并播放 `anim/player_actions_pickaxe.zip` 的开采挥镐动画，在 `pickaxe_loop` 第 7 帧执行 MINE 工作、消耗耐久并播放原版 `dontstarve/wilson/use_pick_rock`；两种鹤嘴锄使用同一音效。动作由 `MINE_tool` / `MINE_workable` 标签选择，并在命中时重新验证组件。移动、Esc、卸下或更换鹤嘴锄可取消尚未命中的开采及音效；取消、目标失效或超出距离不消耗耐久。剩余耐久、实体身份和皮肤随掉落、拾取、换肤及 `c_save()` 保存恢复。

岩石按 `rocks.lua` 的 `workable` 处理：`rock1`、`rock2`、`rock_flintless` 需 6 次成功开采，`rock_flintless_med` 需 4 次，`rock_flintless_low` 需 2 次；按剩余工作量切换原版 `full` / `med` / `low` 外观，完成后播放碎石声、按原版概率表逐件抛出石头、燧石、硝石或金块，并从场景、交互目标和存档移除。未挖完的岩石读档后恢复各自初始工作量，符合 Lua workable 默认不保存进度的行为。

八种岩石（上述五种及 `cavein_boulder`、`rock_moon_shell`、`rock_moon`）均支持装备鹤嘴锄后右键开采，沿用走近、缓冲动作、第 7 帧提交、取消和耐久消耗流程。月岩与月岩壳需 6 次，切换 `full/med/low`；落石需 3 次，开采期间保持 `idle` 外形，抬高的 `idle_raised` 不可开采。月岩掉石头、燧石和月岩；落石按原表掉 2 个石头，另有 40% 石头和 10% 燧石。月岩壳先掉石头、燧石及 3 个必掉月岩（另有 30% 月岩），随后同步生成 1 个 `moonrockseed`，加 `NOCLICK`，播放 `break`，2 个游戏秒后开始侵蚀，1 秒后移除；已破碎的壳不入档，宝球与矿物正常保存。所有存活矿石按 Lua 不持久化开采工作量，落石仍保存外形编号与抬高／组合姿态；搬运、组合落石及宝球交互仍未接入，`moonrockseed` 只显示静态美术。

这些岩石使用 `createSharedArchiveSprite()` 的 `instancedAnimations: 'all'` 合批绘制，保留 Lua 原有播放语义、逐实体明暗、侵蚀状态与 alpha 拾取。`c_spawn("cavein_boulder")`、`c_spawn("rock_moon_shell")`、`c_spawn("rock_moon")` 和 `c_spawn("moonrockseed")` 均无额外参数，在玩家脚下生成；命令语法与支持 ID 不变，未开放落石／宝球的 `c_give`。例如 `c_spawn("rock_moon_shell"); c_give("pickaxe")`，装备后右键开采，再执行 `c_save()`；导出后重载保留剩余实体及掉落物。落石使用 `cavein_boulder.zip` 的动画和 `swap_cavein_boulder.zip` 的 build／符号覆盖；月岩为 `rock7.zip` 的 `rock5` bank。资源导入及原路径／字节检查：`python3 packages/prefab/scripts/import-rocks.py`、同命令加 `--check`。

重生护符使用实际 prefab ID `amulet`（`prefabs/amulet.lua` 的红色护符，其余颜色是独立 prefab，未移植）：`c_give("amulet")` 获取，`c_spawn("amulet")` 生成地面物品，可穿在身体槽（右键物品槽穿戴／卸下），带 `resurrector` 标签、20 次耐久（`REDAMULET_USES`）和 4 款来源皮肤（可用 `reskin_tool` 换肤）。穿着时每 30 游戏秒（`REDAMULET_CONVERSION_TIME`，游戏时间调度器）在生命未满且饥饿值大于 5 时转换 5 点饥饿为生命并消耗 1 次耐久，耐久用完自行移除；卸下即停止，该定时器不存档，读档后重新穿戴时重新计时。死亡后的幽灵左键点击地面上的护符（只有 `ghost_valid` 的作祟动作可用）触发 `HAUNT`，`hauntable` 的 `HAUNT_INSTANT_REZ` 发出 `respawnfromghost`：9 帧后幽灵隐藏并移到护符处，再过 51 帧（`DoRezDelay` 每 .35 秒检查护符仍在地面）复活，护符被装备到身体槽并进入 `amulet_rebirth`（动画 `player_amulet_resurrect`、`staff_castinglight` 红色光、`rebirth_amulet_raise` / `rebirth_amulet_poof` 音效），状态内无敌、护符被消耗，80 帧时 10 单位内的 `sleeper` 入睡 20 秒；没有蜗壳／传送门的生命上限惩罚。未移植：摄像机拉远（`SetCameraDistance`）和 HUD 之外的用户会话保存。复活期间物品栏栏随幽灵模式信号隐藏／显示。

蜗壳护甲使用实际 prefab ID `armorsnurtleshell`：`c_give("armorsnurtleshell")` 获取，`c_spawn("armorsnurtleshell")` 生成地面物品，每格一件。拖到身体装备槽后穿上，外观来自 `armor_slurtleshell` 的 `swap_body_tall`；穿着时右键该物品槽（`USEITEM`）进入 `shell_enter` → `shell_idle` 缩壳姿态（动画 `hideshell` / `hideshell_idle`，音效 `foley/hideshell`），此时护甲吸收由 0.6 变为 `FULL_ABSORPTION`（1）。在壳内收到 `blocked` 事件时播放 `shell_hit`（`hitshell`）并发出 `hit_armour` 音效；移动、执行其他动作或卸下护甲都会离开缩壳姿态并恢复 0.6 吸收。护甲耐久为 `150 * 7 * 0.7`，磨损与保存通过 `armor` 组件（`OnSave` / `OnLoad`）完成；目前没有敌对目标攻击玩家，因此原版缩壳 5 秒后让敌人放弃目标的分支（`droptargets`）尚未实现。

暗夜剑使用实际 prefab ID `nightsword`：`c_give("nightsword", 2)` 获取两把，每把占一格；`c_spawn("nightsword")` 在玩家当前位置生成一把地面暗夜剑。拖到手部装备槽显示原版手持外观，Shift + 右键物品槽可丢到地上，点击地面暗夜剑可拾回。库存默认图标为 `images/inventoryimages.xml` 的 `nightsword.tex`；地面使用 `anim/nightmaresword.zip` 的 `nightmaresword` bank/build 和 `idle` 姿态；手持使用独立的 `anim/swap_nightmaresword.zip`，覆盖玩家 `swap_object`。装备清洁扫把后右键地面暗夜剑，依次切换 `nightsword_cotl`、`nightsword_curve`、`nightsword_lightsbane`、`nightsword_sharp`、`nightsword_wizard`，最后恢复默认外观；皮肤库存图标来自 `images/inventoryimages2.xml`，地面和手持均使用对应原版动态 build。换肤、丢弃、拾取及 `c_save()` 保留实体 ID、位置、数量、皮肤和已有物品状态，读档恢复地面及手部装备。已实现手持、地面外观及装备理智消耗；攻击、耐久消耗和皮肤攻击粒子待战斗功能接入。









`c_give("farm_plow_item")` 获取耕地机，第二个参数可指定数量，每台占一格、初始 4 次使用。左键物品栏中的耕地机进入部署预览，右键可种植的空地部署；预览和落点吸附到整格地皮中心（`TILE_SIZE = 12`），显示原版 `tile_outline` 使用的 `anim/gridplacer.zip`、bank/build `gridplacer`、`anim` 地皮边框。不能部署到已耕地地皮或有阻挡物的格子。成功部署时由物品实体的 `finiteuses.use(1)` 消耗一次使用，保存扣减后的完整物品快照；钻地 15 秒后将该格改为 `WORLD_TILES.FARMING_SOIL`（ID `47`），从快照折回物品，第 4 次用完后不再返还。`c_spawn("farm_plow_item")` 只生成 `idle_packed` 地面物品；`c_spawn("farm_plow")` 直接生成工作中的调试耕地机，完成后不返还物品。`c_save()` 将耕地机进度及完整物品快照保存到 `components.farmPlow.deployItem`，包含物品 ID、数量及组件状态；完成或被锤毁时恢复该快照，保留物品 ID 和剩余使用次数。地面物品加载成功前保留返还快照。旧存档的 `returnUses` 自动迁移；`c_spawn("farm_plow")` 的快照为 `null`。耕地结果及原地皮 ID 保存到 `world.map.tiles`，加载后恢复。

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

蘑菇数值来自 `prefabs/mushrooms.lua` 的生／熟数据。`c_give("red_cap", 2)` 等命令获取蘑菇，数量可省略，默认一份；`c_spawn("blue_cap_cooked")` 等命令在玩家脚下生成地面物品，支持表中六个 `*_cap` / `*_cap_cooked` ID。库存图标均来自 `images/inventoryimages.xml`，地面使用原版 `anim/mushrooms.zip` 的 `mushrooms` bank/build 和与物品 ID 同名的静态姿态，无原版皮肤。右键进食使用 `quick_eat_pre → quick_eat`，第 12 帧扣除一份后结算属性，结果限制在玩家属性范围；取消时不消耗、不结算。现有物品栏转移、丢弃、拾取和 `c_save()` 继续适用，保留实体身份、位置、数量及食用后的属性；暂不实现蘑菇采集、烹饪、种植或其他专属交互。


通用 `Perishable` 通过游戏时间调度器每 10 个游戏秒结算新鲜度，`updateTimer` 提供周期任务的只读状态，等待期间不逐帧改写；长帧跨过多个周期时依次处理各个到期点，停止腐烂或永久释放时取消任务，恢复时从当前游戏时间重新计时：世界 `WorldPerishClock` 按实际 `dt × 温度倍率` 记录累计刻度，组件 `Update({ time, total })` 扣除前后累计量之差，再应用持有者、湿润和本地倍率。世界私有 `watchSignal` 同步温度，纯 memo 推导冷热倍率；温度变化本身不扣减新鲜度。重设保鲜时长／百分比、改变湿润状态或切换世界前先结清尾帧，若已腐烂并被替换则停止修改旧实体；总时长和满新鲜度原子提交。示例：`c_give("red_cap", 2); c_spawn("red_cap"); c_save()`，保存和读档保留身份、数量、位置与新鲜度，读档在当前游戏时间建立新的累计基准。累计刻度是本项目为休眠补算引入的方案，Lua 原版每次 `Update(inst, dt)` 使用当时温度处理整段 `dt`。命令语法、参数和支持的 prefab/item ID 不变；早晨统一结算与 tile 管理器仍待接入，见 [tile 生命周期](docs/tile-lifecycle.md#腐烂累计刻度与早晨快照)。

| `red_cap` 阶段 | 生命 | 饥饿 | 理智 |
| --- | --- | --- | --- |
| 新鲜 | -20 | +12.5 | 0 |
| 不新鲜（饥饿 ×0.667） | -20 | +8.3375 | 0 |
| 腐烂（饥饿 ×0.5，理智固定 -`SANITY_SMALL`） | -20 | +6.25 | -10 |

负的生命值不受腐烂影响。`bananapop`（香蕉冻）按 `prefabs/preparedfoods.lua` 使用配方的 `perishtime = PERISH_SUPERFAST`（3 天，1440 秒），其余规则与 `red_cap` 相同，腐烂后同样替换为 `spoiled_food`；`c_give("bananapop", count)` 放入物品栏，`c_spawn("bananapop")` 在玩家脚下生成，烹饪锅采收的产物也以满新鲜度开始。香蕉冻可食用（生命 +20、饥饿 +12.5、理智 +33，随腐烂阶段折算；`temperature` 降温效果尚未实现），锅内成品腐烂和食材新鲜度传递仍待实现。新鲜度以 `freshnessPercent` 随库存和地面存档保存，读档后从中恢复剩余时间并继续腐烂。`c_spawn("spoiled_food")` 在玩家脚下生成腐烂物，`c_give("spoiled_food", count)` 放入物品栏。

`c_give("meatballs", 2)` 获取两份肉丸，第二个参数可省略，默认一份；`c_spawn("meatballs")` 在玩家脚下生成可拾取的一份。右键物品栏肉丸播放 `quick_eat_pre → quick_eat`，第 10 帧播放 `dontstarve/wilson/eat`，第 12 帧成功扣除一份后恢复表中的属性，超过 Wilson 上限的部分截断。取消或物品被替换时不消耗、不恢复属性。图标来自 `images/inventoryimages.xml:meatballs.tex`，地面使用原版 `anim/cook_pot_food.zip` 的 `cook_pot_food` bank/build、`idle` 和 `swap_food:meatballs` 符号覆盖，无原版皮肤。支持 Shift + 右键丢弃和左键拾回；数量、实体身份、地面位置及食用后的属性随 `c_save()` 保存恢复。

`c_give("bananajuice", 2)` 获取两份香蕉奶昔，第二个参数可省略，默认一份；`c_spawn("bananajuice")` 在玩家脚下生成可拾取的一份。右键物品栏香蕉奶昔按原版 `preparedfoods.lua` 的 `fooddrink` 标签播放 `anim/player_actions_eat.zip` 中的 `quick_drink_pre → quick_drink`：第 10 帧播放 `dontstarve/wilson/sip`，第 12 帧成功扣除一份后增加 **33 理智、25 饥饿、8 生命**，Wilson 上限分别为 200、150、150。生命通过 `playerStats.health.DoDelta()` 结算，饥饿、理智分别通过 `playerStats.hunger.DoDelta()`、`playerStats.sanity.DoDelta()` 结算，HUD 订阅生命组件的只读 `current` 和另两项组件的只读 `value`，低理智滤镜订阅理智比例更新；提前按 Esc、移动或跳跃取消时不消耗、不恢复属性，物品实体或所在槽位被替换时也不提交。基础图标使用 `images/inventoryimages1.xml:bananajuice.tex`，地面仍使用 `cook_pot_food.zip` 的 `idle` 和 `cook_pot_food10.zip:bananajuice` 符号覆盖，无原版皮肤。支持 Shift + 右键丢弃和左键拾回；剩余数量、实体身份、地面位置及食用后的玩家属性随 `c_save()` 保存恢复。当前按新鲜食物的基础数值结算，尚未接入腐败、调味和角色专属食物加成。

`c_give("seeds", 10)` 获取种子，`c_spawn("seeds")` 在玩家脚下生成可拾取的原版地面种子（`anim/seeds.zip`，bank/build `seeds`，`idle`；物品图标来自 `images/inventoryimages.xml`）。Shift + 右键丢弃、左键拾回；右键物品栏种子播放 `quick_eat_pre → quick_eat`，第 12 帧消耗一粒并增加 4.6875 饥饿，上限 150，健康和理智不变。左键物品栏种子选中种植，鼠标跟随原版种子图标及剩余数量，种子仍保留在原槽；左键耕地机完成后农田 tile 上的完整坑（`farm_soil`）自动走近，在 `pickup → pickup_pst` 的第 6 帧消耗一粒，替换为原版 `farm_plant_randomseed`（`anim/farm_soil.zip` 的 `sow → sow_idle`）。正在耕地的坑、破损坑和空地不可种植；移动、跳跃、Esc、点击空地或切换物品取消未提交的操作，失败不消耗种子。`c_spawn("farm_plant_randomseed")` 直接生成播种后的外观；地面种子及已播种实体的 ID、位置和数量随 `c_save()` 保存并恢复。本次仅实现种子地面美术、进食和坑内播种，播种后保持种子阶段。

`veggies.lua` 的静态内容：`c_give("<id>", n)` / `c_spawn("<id>")` 支持 20 种蔬菜的生/熟形态（`carrot`、`corn`、`pumpkin`、`eggplant`、`durian`、`pomegranate`、`dragonfruit`、`watermelon`、`tomato`、`potato`、`asparagus`、`onion`、`garlic`、`pepper`、`cave_banana`、`berries`、`berries_juicy`、`fig`、`cactus_meat`、`kelp`，熟食加 `_cooked`）、`kelp_dried`，以及 14 种 `<name>_seeds`（`carrot_seeds`、`corn_seeds`、`pumpkin_seeds`、`eggplant_seeds`、`durian_seeds`、`pomegranate_seeds`、`dragonfruit_seeds`、`watermelon_seeds`、`tomato_seeds`、`potato_seeds`、`asparagus_seeds`、`onion_seeds`、`garlic_seeds`、`pepper_seeds`）。地面美术、图标、饥饿/生命/理智、腐败时间和堆叠上限均按 `veggies.lua` 与 `tuning.lua`；`pumpkin`、`eggplant`、`durian`、`watermelon` 生品堆叠 20，其余 40；万圣节的南瓜保鲜加成不启用。种子用 `farm_plant_seeds` 的同名 clip，左键选中后点击完整的耕地坑，行为与普通种子相同：第 6 帧消耗一粒，替换为 `farm_plant_<name>` 的种子阶段（`grow_seed → crop_seed`，底部覆盖 `farm_soil` 的 `soil01`），`c_spawn("farm_plant_<name>")` 可直接生成，随 `c_save()` 保存恢复。**未实现**：植物生长、巨型作物（`*_oversized*`，需重物携带）、胡萝卜旋转、晾晒/烹饪、海钓饵、月亮变异、西瓜降温、胡萝卜/海带修补。


火魔杖 `firestaff` 装备到手部后，右键点击可燃物（`canlight`，如树、草、营火残骸等带 `burnable` 的实体）执行远程点燃：走进 `weapon:SetRange(8, 10)` 的攻击距离后挥杖，约 7 帧后发射 `fire_projectile`（`staff_projectile.zip` 的 `fire_spin_loop`，速度 50，追踪目标），命中时 `onattack_red` 点燃目标、唤醒睡眠者、解冻并扣 1 点精神，杖耐久 -1；目标已在燃烧时不可选；目标在飞行中消失则落空，不耗耐久也不扣精神。未点燃的命中会留下 `fire_fail_fx`。投射物的追踪、命中与落空由 `packages/componets/src/projectile.ts` 实现，`Weapon.LaunchProjectile` 与 `Combat.DoAttack(target, weapon, projectile)` 按源码分支处理远程武器。带 `lighter` 的火把仍使用原有右键 `LIGHT` 近战点燃。






`c_give("book_silviculture")` 获取《应用造林学》，`c_spawn("book_silviculture")` 在玩家脚点生成地面书本；每格只放一本，满耐久 5 次。玩家按需求带有 `reader` 组件与标签，右键物品栏中的书执行原版 `READ`（`componentactions.lua` 的 INVENTORY `book` 动作）：`book` 状态播放 `player_actions_uniqueitem.zip` 的 `action_uniqueitem_pre` 并生成 `book_fx`，`book2` 播放 `book`，`book_open` / `book_closed` 覆盖为 `swap_books.zip` 的 `book_silviculture_open/closed`（皮肤 `book_silviculture_livinglog` 使用皮肤 build），根须特效 `fx_books.zip:roots` 跟随 `swap_book_fx_under`。声音按源时间线：第 17 帧 `wickerbottom_rework/book_spells/silviculture`（两层），第 19 帧翻页 `use_book_light`，第 50 帧 `book_spell` 并提交，第 51 帧合书 `use_book_close`。提交时以玩家为中心 30 单位（90 场景单位）查找带 `silviculture/tree` 等标签、已被采摘的植物，其中一株立即完成再生，其余在 `1 - 1/(n+1)` 秒内随机完成；成功扣 1 次耐久与 33 理智，最后一次使用移除书本。范围内没有可催生的植物时返回 `NOSILVICULTURE`，`book_fx` 播放失败动画和 `book_spells/fail`，不扣耐久或理智。第 50 帧移除 `busy` 前移动被阻止，之后移动或跳跃会结束状态；选槽、右键其他物品、制作或表情与进食一样随时取消阅读。退出时未播放的层音效取消，已在播放的降为一半音量。可用 `c_spawn("grass")` 后采摘草丛来验证催生。`c_save()` 保存书本实体 ID、皮肤、剩余次数与地面位置，读档恢复。当前项目草丛、树苗与猴尾草具备 `pickable` 催生分支；树木、作物、蘑菇农场和树精分支，以及 `talker` 的失败台词、`aspiring_bookworm` 浏览和骑乘尚未接入（书架见下）；书本作为燃料的 `fuel` 组件也未接入（目前仅接入提灯的 `CAVE` 燃料）。

`c_spawn("turf_id")` 在玩家脚点生成地皮物品；`c_give("turf_id", count)` 获取地皮，`count` 可省略（默认 1），每叠最多 20 个。例：`c_spawn("turf_woodfloor"); c_give("turf_cotl_brick", 25); c_save()`。40 种地皮均使用 `turfs.lua` / `tiledefs.lua` 指定的地面动画和实际库存图集，支持丢弃、拾取及 `c_save()` 导出／读档，保留实体 ID、数量和地面位置；原版没有地皮物品皮肤或装备外观。左键物品栏拿起地皮到鼠标，再右键草叉挖出的裸土格铺设：显示原版 `gridplacer` 整格边框，走近后通过 `DEPLOY` 的 `doshortaction` 在第 6 帧铺地并消耗一块；已有地皮、海洋和越界位置拒绝铺设，取消或失败保留鼠标物品。再次用草叉挖起会恢复裸土并掉落对应地皮。铺地使用各自原版地面噪声、48 格边缘图集及小地图纹理；修改格及其八邻格的完整地皮和边缘遮罩按源渲染顺序重绘，使新旧地皮交界混合，低层地皮的外沿不会盖住高层原地皮，`c_save()` 保存铺好的地形和鼠标剩余物品，读档恢复。对应铺地噪声纹理和 48 格边缘图集由 `import-ground-tiles.py` 导入，可通过 `loadGroundTileAssets` / `createTurfGround` 使用，地形 ID 按源 TileManager 从 256 起分配新增陆地类型，保留旧地形 ID（`turf_cotl_brick` 为 `COTL_BRICK=256`，`turf_vault` 对应 `VAULT_CLEAN`）。支持以下全部源 prefab ID（两种命令均可用）：

- `turf_road`、`turf_cotl_brick`、`turf_pebblebeach`、`turf_monkey_ground`、`turf_shellbeach`、`turf_marsh`、`turf_rocky`、`turf_savanna`
- `turf_forest`、`turf_grass`、`turf_deciduous`、`turf_desertdirt`、`turf_cave`、`turf_fungus`、`turf_fungus_red`、`turf_fungus_green`
- `turf_fungus_moon`、`turf_sinkhole`、`turf_underrock`、`turf_vent`、`turf_mud`、`turf_archive`、`turf_vault`、`turf_ruinsbrick_glow`
- `turf_ruinsbrick`、`turf_ruinstiles_glow`、`turf_ruinstiles`、`turf_ruinstrim_glow`、`turf_ruinstrim`、`turf_meteor`、`turf_dragonfly`、`turf_woodfloor`
- `turf_cotl_gold`、`turf_checkerfloor`、`turf_mosaic_grey`、`turf_mosaic_red`、`turf_mosaic_blue`、`turf_carpetfloor2`、`turf_carpetfloor`、`turf_beard_rug`






### c_spawn 支持的对象

`c_spawn("chessjunk1")`、`c_spawn("chessjunk2")`、`c_spawn("chessjunk3")` 分别在玩家脚点生成三种棋械残骸；都是世界 prefab，不支持 `c_give`。三者使用 `chessmonster_ruins.zip`，初始声明非循环 `idle1/2/3`；已修复记录按 Lua `OnLoad` 恢复循环 `hit1/2/3`。`c_save()` 保留 ID、位置和已修复记录中的 `repaired`、`repairerid`、`repairerchar`。洞穴导入分别含 23、33、25 个。无皮肤；修复、敲击、战利品及重生行为未接入。

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

`c_spawn("multiplayer_portal_moonrock")` 在玩家当前位置生成月岩多人传送门，使用原版 `anim/portal_moonrock.zip` 的 bank `portal_moonrock_dst` 和 build `portal_moonrock`，`light`、`portalbg`、`spiralfx1` 符号覆盖自 `anim/portal_stone.zip`；FX 子实体隐藏 `portal` 层并覆盖 `FX_ray1`。循环播放 `idle_loop` 待机动画；每圈动画为 60 帧 / 2 秒，在第 0 帧（进入待机或循环回到起点）和第 30 帧各播放一次 `spawnportal_jacob` 鸟叫声；音效跟随动画实际跨过的帧触发，丢帧或大时间步进也不会使用独立计时器提前播放，移除实体时停止最近一次鸟叫。月岩传送门无环境循环音效（Lua `idle_loop = nil`）。位置和实体 ID 随 `c_save()` 保存，下载的存档加载后会恢复传送门及其 FX 子实体。当前仅实现外观与音效，不包含建造系统、月球商人或玩家传送。

用 `c_spawn("wall_stone")`、`c_spawn("wall_wood")`、`c_spawn("wall_hay")`、`c_spawn("wall_ruins")`、`c_spawn("wall_moonrock")` 或 `c_spawn("wall_dreadstone")` 生成建成墙；`wall_*_item` 别名仍生成建成墙。`c_give("wall_stone_item", 10)` 等命令获取可放置的墙物品，库存图标、掉落地面的 `idle` 动画与建成墙的 `half` 外观分别使用各自原版资源。装备 `c_give("reskin_tool")` 获取的清洁扫把，右键建成墙可按下表循环换肤，最后回到默认外观；原有地面墙物品也可换肤。放置带皮肤的墙物品会映射到对应的建成墙皮肤，保留正面/斜面随相机朝向切换、受击动画和绝望石墙的红色覆盖层。换肤保留实体 ID、地面落点及已保存的健康状态；建成墙皮肤随 `c_save()` 保存并恢复，旧的无皮肤墙存档仍可加载。档案馆墙 `wall_stone_2` / `wall_ruins_2` 和废料墙 `wall_scrap` 没有原版皮肤，不提供换肤。

墙体与栅栏的 display 使用动画包的 `ResidentSpriteController` 与共享精灵工厂；离开活动区只释放 visual，唤醒后恢复当前朝向、皮肤和姿态，实体 ID、脚点、健康／工作组件、物理登记和存档状态继续保留。栅栏燃烧计时在休眠时继续，到期仍移除实体。调试命令语法、参数与支持的 `c_spawn` / `c_give` ID 不变，`c_save()` 可继续保存休眠实体。

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

栅栏带 `wall`、`fence`、`alignwall`、`rotatableobject` 等标签与半径 0.5 的障碍物理；按源码拥有 3 次工作量的 `HAMMER`：每次命中播放 `hit → idle`，第三次掉落 1 个 `twigs`、播放 `collapse_small` 及 `destroy_smoke` / `destroy_wood` 后移除；`health`（最大值 1、吸收 100%）与 `combat` 让攻击折算成一次锤击。栅栏按 `MakeMediumBurnable`（20 游戏秒、火焰等级 3）与中型热传播燃烧，烧尽留下 1 个 `ash`；燃烧中的栅栏不写入存档，熄灭后恢复保存。13 款源皮肤 `fence_ancient`、`fence_factory`、`fence_fantasy`、`fence_gingerbread`、`fence_gothic`、`fence_picketbrown`、`fence_pickettan`、`fence_picketwhite`、`fence_rose`、`fence_shell`、`fence_victorianblack`、`fence_victorianbrass`、`fence_victorianbronze` 可用 `reskin_tool` 依次切换，物品皮肤为对应的 `<皮肤>_item`；换肤保留实体身份、位置和旋转。`c_save()` 的 `world.entities.fence` 记录 `components.fence`：`rot`（`CalcRotationEnum`，0 省略）和 `skinId`，读档按 `rot * 45` 恢复旋转与 bank。示例：`c_give("fence_item", 6); c_give("reskin_tool"); c_spawn("fence"); c_save()`。木门 `fence_gate`、电栅栏、`fence_rotator` 与垃圾栅栏 `fence_junk` 不在当前范围内，战斗伤害对栅栏无效（吸收 100%）。

每道栅栏由一个 `PrefabInstance` 声明皮肤、旋转、bank、透明度与动画，直接使用实例的 `physics` 和组件；`PrefabDisplay` 使用已有的世界相机输入选择八向 art 与镜像，`PrefabDisplayGroup` 与 `SpriteResources` 管理场景、绘制排序、共享资源和休眠重建，燃烧与火焰复用 `BurnableBinding` 和 `FireFxHost`。预览仅按源码使用相机 heading 计算放置旋转；切换 bank 与扫把换肤均保留同一实例和 sprite 状态。栅栏逻辑不再读写模型 `userData`，上述调试命令的语法、参数、支持 ID 和 `components.fence.skinId` 存档字段不变。




`c_give("rock_avocado_fruit", 3)` 与 `c_spawn("rock_avocado_fruit")` 支持硬壳石果，每叠 40 个，库存图标为 `images/inventoryimages3.xml` 的 `rock_avocado_fruit_rockhard.tex`，地面使用 `rock_avo_fruit_master/idle` 与 `rock_avocado_fruit_build`。装备 `pickaxe` / `goldenpickaxe` 后右键地面硬壳石果执行通用 `MINE`，在 `pickaxe_loop` 第 7 帧提交；每次普通命中消耗 1 个石果和 1 次镐耐久，按每个消耗的石果独立抽签：65% 掉 `rock_avocado_fruit_ripe`、1% 掉 `rock_avocado_fruit_sprout`、34% 掉 `rocks`，提升开采效率时按实际工作量处理并将同种产物合叠。剩余石果播放 `mined → idle`，开出的熟石果播放 `split_open → idle_split_open`；产物按源码 `LaunchAt` 背离采矿者散落。取消、无效目标或工具失效不消费石果和耐久。熟石果支持食用（生命 +1、饥饿 +12.5）与 3 天基础保鲜期；烤熟石果 `rock_avocado_fruit_ripe_cooked` 生命 +3、饥饿 +12.5，基础保鲜期 2 天，地面保鲜倍率沿用现有组件。两者与石果芽均可用 `c_spawn` / `c_give` 获取，库存图标使用导入器核对的实际 atlas。

将 `rock_avocado_fruit_sprout` 拿到鼠标后右键种植：原版 placer 使用 `rock_avo_fruit_master/idle_buried_seed`（动画来自 `rock_avocado_fruit.zip`，build 为 `rock_avocado_fruit_build`），默认 2 DST 单位间距，提交 `DEPLOY` 后只消耗 1 个芽并播放 `plant_tree`。世界幼苗 ID 为 `rock_avocado_fruit_sprout_sapling`，也可直接 `c_spawn`，不能 `c_give`。幼苗不受冬季停长或春季倍率影响，经过 1500 游戏秒后播放 `seed_growth`，动画时长结束时由游戏时间调度器替换成原生石果灌木（随机 1–4 阶段，无需移植施肥），并播放 `treeGrow`。铲挖幼苗返还 1 个芽并取消所有生长／破土任务；点燃时取消生长计时，熄灭后重新从 1500 秒计时，燃烧 7.5 秒后留下灰烬。按源码，生长计时的剩余时间和暂停状态写入存档，破土动画进度不保存；生长计时已取消／结束时读档重新登记 1500 秒。


`c_give("marblebean", 3)` 获取大理石豌豆（每叠 40 个，地面使用 `marblebean/marblebean/idle`，库存图标为 `images/inventoryimages.xml` 的 `marblebean.tex`），`c_spawn("marblebean")` 生成地面种子；`c_spawn("marblebean_sapling")` 生成树苗，`c_spawn("marbleshrub")`（等同 `marbleshrub_short`）、`marbleshrub_normal`、`marbleshrub_tall` 生成对应阶段的灌木，世界实体不能 `c_give`。拿到鼠标后右键种植：预览为 `marblebean/idle_planted`，默认 2 DST 单位间距，成功只消耗 1 个并播放 `plant_tree`。树苗防火，不可点燃；`grow` 计时为 225 ± 75 游戏秒（`PINECONE_GROWTIME`），到期由游戏时间调度器原地换成随机外形 / 明度的 `marbleshrub` 短阶段并播放 `grow_seed_to_short`。装备铲子右键挖起树苗掉落 1 个 `marblebean` 并取消计时。灌木按 `idle_short → idle_normal → idle_tall → idle_short` 循环，每阶段约 2700 ± 300 游戏秒，进入阶段播放对应生长动画和 `marble_shrub` 音效。装备 `pickaxe` / `goldenpickaxe` 右键执行 `MINE`：短 / 中 / 大阶段分别需 6 / 8 / 10 次工作，命中播放 `hit_*`，完成后播放 `mined_*` 并掉落——短阶段 1 个 `marble`；中阶段 `marble`，25% 额外 `marblebean`；大阶段 `marble` + 50% `marble` / 50% `marblebean`。开采后立即取消碰撞且不再存档。灌木带 `SnowCovered` 标签：世界积雪量 ≥ 0.015 时显示共享 `snow.zip` 的 `snow` 层，低于时隐藏；小地图图标为 `marbleshrub1～3.png`（与外形编号一致，优先级 -1），树苗没有小地图图标。`beeswax_spray` 打蜡和猫玩具 / 鼹鼠诱饵标签暂未移植。`c_save()` 保留灌木 / 树苗 ID、脚点、阶段与剩余生长时间、外形编号和明度，以及物品栏中种子的身份和数量。示例：`c_give("marblebean", 2); c_give("shovel"); c_give("pickaxe"); c_spawn("marblebean_sapling"); c_spawn("marbleshrub_tall"); c_save()`。








`c_spawn("lightning_rod")` 在玩家前方生成避雷针（`lightningrod.lua`，`anim/lightning_rod.zip`），也可在制作栏用 4 金块和 1 切石制作后摆放（放置时播放 `place` 与 `lightning_rod_craft`）；支持 `lightning_rod_adventure`、`lightning_rod_gothic`、`lightning_rod_nautical`、`lightning_rod_retro`、`lightning_rod_robot` 五款皮肤并可用清洁扫把换肤。避雷针带 `structure`／`lightningrod` 标签，挂载 `battery`（`CanBeUsed`／`OnUsed`／`ResolvePartialChargeMult`，部分电量按「3 天衰减 1 点」换算）和 `inspectable`（充电时状态 `CHARGED`）；锤击 4 次拆除，掉落配方材料并播放金属 `collapse_small`。被闪电击中（`lightningstrike` 事件）时播放 `hit → idle`，点亮橙色局部光（半径 1.5、强度 0.5、衰减 1）并充入 3 天电量；每次 `dozap` 播放 `lightningrod` 音效和 `lightning_rod_fx`，之后 10～40 游戏秒再放电一次。`WatchWorldState("cycles")` 以游戏时间调度器上的离散每日计时器实现（世界注入 `secondsUntilNextDay`），每天放电并减 1 天电量，耗尽后熄灯并停止放电和计时；拆除即取消任务。`c_save()` 只保存充电状态 `lightningrod.charged/chargeleft`（计时器不保存，读档按当前世界时间重新登记并重放一次 `dozap`）及皮肤。`c_lightning()` 等价于对玩家位置推送 `ms_sendlightningstrike`：40 单位内第一个带 `lightningrod` 标签的避雷针会接管落点并同步触发 `lightningstrike`，否则落在玩家处；随即生成 `lightning` 特效并播放 `thunder_close`，特效美术按需加载；`lightningblocker`、`playerlightningtarget`、月亮风暴闪电以及雷击点燃／电击尚未移植，天气系统也不会自动触发雷击；发光 bloom 着色器没有对应的渲染通道，仅保留局部光。

`c_spawn("firepit")` 在玩家前方生成燃烧的火坑（也可制作后摆放），无额外参数，不能 `c_give`；10 款原版皮肤均可换肤，换肤后火焰按皮肤偏移重新点燃。按 `firepit.lua` 以初始燃料一半起燃，燃料分 4 段决定 `campfire_fire` 的 `level1`–`level4` 火焰、局部光半径（2–5 DST 单位，本场景 ×3）与亮度；燃尽熄灭。火坑带 `BURNABLE_fueled` 标签并实现 `TakeFuelItem`（`bonusmult` 2，加燃料后重新点燃），但 `log`、`cutgrass` 等物品尚未挂载 `fuel` 组件，目前还不能实际添加燃料。`c_save()` 保存剩余燃料（`firepit.fueled.fuel`，满燃料按原版省略）与待掉落木炭标记，读档恢复火焰等级；燃烧中的火坑不会存成烧毁。




草丛、树苗、浆果丛、石果灌木、猴尾草、蘑菇、仙人掌和洞穴蕨的逻辑状态由 `PickablePlantInstance` 持有：组件、皮肤、存档身份和 `persists` 不再由植物逻辑写入 `model.userData`。`PrefabDisplay` 负责共享 archive sprite 的绘制、相机朝向和活动区卸载／恢复；燃烧复用通用火焰 FX，休眠只释放 visual，采摘再生、枯萎和燃烧计时继续。`c_spawn("grass")`、`c_spawn("berrybush")`、`c_give("dug_berrybush")` 等现有命令的语法、参数和支持 ID 不变，`c_save()` 继续保留身份、脚点、皮肤及组件计时状态。

| 类型 | prefab_id |
| --- | --- |
| 建筑 | `cookpot`、`firepit`、`icebox`、`treasurechest`、`tent`、`moonbase`、`moondial`、`wardrobe`、`dragonflychest`、`bookstation`、`campfire`、`saltbox`、`nightlight`、`pighouse`、`sculptingtable`、`winterometer`、`lightning_rod`、`pighead`、`mermhead`、`birdcage`、`mushroom_light`、`mushroom_light2` |
| 科技建筑 | `researchlab`、`researchlab2`、`researchlab3`、`researchlab4` |
| 墙 | `wall_stone`、`wall_stone_2`、`wall_wood`、`wall_hay`、`wall_ruins`、`wall_ruins_2`、`wall_moonrock`、`wall_dreadstone`、`wall_scrap`，以及各自的 `wall_*_item`（两种 ID 均生成建成的墙） |
| 洞穴植物 | `flower_cave`、`flower_cave_double`、`flower_cave_triple`、`lightflier_flower`（采摘或亮灯计时结束释放 `lightflier`，虫在外时暂停生长，回巢立即恢复；`idle` 使用共享 InstancedMesh） |
| 光照星体 | `stafflight`、`staffcoldlight` |
| 岩石 | `rock1`、`rock2`、`rock_flintless`、`rock_flintless_med`、`rock_flintless_low`、`cavein_boulder`、`rock_moon_shell`、`rock_moon` 均可开采；`moonrockseed` 仅静态地面美术；均支持 `c_spawn("ID")` |
| 草丛 | `grass`（共享 archive sprite，`instancedAnimations: 'all'` 合批；命令与 ID 不变） |
| 石果灌木及幼苗 | `rock_avocado_bush`、`rock_avocado_fruit_sprout_sapling` |
| 大理石灌木及幼苗 | `marbleshrub`、`marbleshrub_short`、`marbleshrub_normal`、`marbleshrub_tall`、`marblebean_sapling` |
| 洞穴入口 | `cave_entrance`（封闭，装备 `pickaxe` 右键 `MINE`，6 次工作后掉落 2 个 `rocks`、3 个 `flint` 并原地变为 `cave_entrance_open`）、`cave_entrance_open`（背景层；`worldmigrator` 目的地为 `Caves`，目的地可用时播放 `open` 循环，左键点击走近后执行 `MIGRATE` 并跳转到 `?save=Cluster_1/Caves.json`；蝙蝠、玩家背包／状态随行、地表存档保存尚未接入）；无 `c_give`，`c_save()` 保留 ID 与位置，未挖完的入口重载后恢复满工作量 |
| 月亮洞穴水池 | `grotto_pool_big`（半径 5.5 障碍物理，发光，小地图 `grotto_pool_big.png`，约 0 帧后在 `prefab_layout` 位置生成 `grotto_waterfall_big` 和 3 种 `grotto_moonglass_*`）、`grotto_pool_small`（半径 2，生成随机 `grotto_waterfall_small1` 或 `grotto_waterfall_small2`）；子物件也可单独 `c_spawn`：`grotto_waterfall_big`（NOCLICK 瀑布）、`grotto_moonglass_1` / `grotto_moonglass_3` / `grotto_moonglass_4`、`grotto_waterfall_small1` / `grotto_waterfall_small2`（镐 `MINE` 6 次，掉落 `moonglass`；挖空后在洞穴满月夜晚每次变化有 10% 概率恢复并生成 `halloween_moonpuff`）；水池无 `c_give`，`c_save()` 保留子物件 ID、位置和剩余工作量 |
| 月亮碎片 | `moonglass`（`c_give("moonglass", 40)` / `c_spawn("moonglass")`，叠加上限 40，地面固定 `f1` 姿态）；`halloween_moonpuff` 特效可 `c_spawn`，不入档 |
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
| 长成的蜂后蜂巢 | `beequeenhivegrown`（`c_spawn("beequeenhivegrown")`，无参数；世界实体无 `c_give`。源 `prefabs/beequeenhive.lua` 使用 `anim/bee_queen_hive.zip`，bank/build 均为 `bee_queen_hive`，生成时播放非循环 `large`，锤击声明 `large_hit` → 非循环 `large`；`c_save()` 保留 ID、脚点、`workable` 的 16 次最大工作量与剩余量，以及存在时的 `hiveregen` 计时器。源无皮肤；`beequeenhive` 基座生成蜂巢、蜂后生成与锤击掉落尚未接入） |
| 龙蝇与生成器 | `dragonfly`、`dragonfly_spawner`（均可 `c_spawn("ID")`，无 `c_give`。生成器是不可见的 `CLASSIFIED` 实体；原始地表存档导入 1 个，保存着 `childspawner.childreninside=1` 和 `queued_spawn=true`，玩家进入活动区后释放排队的龙蝇。生成器按源 Lua 的子代计数、定时生成与 20 游戏日再生计时器保存／恢复；`c_save()` 保留生成器与龙蝇的 ID、位置及组件状态。龙蝇使用 bank `dragonfly`、通常 build `dragonfly_build`、循环 `idle`；原版节日活动还会选用 `dragonfly_yule_build`，源未定义皮肤。战斗行为尚未实现） |
| 洞穴蕨 | `cave_fern`、`cave_fern_withered`（bank `ferns`，build 分别为 `cave_ferns` / `cave_ferns_withered_build`，生成时随机选 `f1`～`f10` 姿态；快速 `PICK` 分别得 `foliage` / `cutgrass`，采后按 `remove_when_picked` 直接移除，无 `workable` 不能铲；可燃烧；通过共享 archive sprite 的 `instancedAnimations: 'all'` 合批，使用 `ResidentSprite` 随活动区卸载／重建 visual，保留实体、组件与姿态，重建后恢复相机朝向；无 `c_give`，`c_save()` 保留 ID、位置与姿态） |
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
| 蝴蝶种花及掉落 | `planted_flower`（运行时为 `flower`）、`butterfly`、`butterflywings`、`butter` |
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

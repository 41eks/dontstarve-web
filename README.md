# dontstarve-web

https://41eks.github.io/dontstarve-web/

场景实体后续的活动区域与资源管理方案见 [按 tile 管理生命周期](docs/tile-lifecycle.md)：每个 tile 持有活动 signal，玩家跨 tile 时更新区域差集，prefab 用 `createMemo` 派生活动状态。该方案尚未接入运行时。

DST Lua 的世界／局部环境温度、实体升降温与暖石档位、耐久和保存机制见 [温度系统源码总结](docs/dst-temperature.md)。昼夜和季节使用 signal，`WorldTemperature` 通过 `createMemo` 派生环境温度；主循环每 60 个活动帧按累计实际 `dt` 结算昼夜进度和世界温度。


## 调试命令（debugCommand）

采摘产物统一交给 `Inventory.GiveItem()` 处理：先填充可用槽位和堆叠，背包满时把余量掉在玩家脚边，采摘仍然成功；采摘入口不再预加载或手动生成地面产物。地面贴图加载期间，掉落实体的 ID、数量、位置和组件状态仍可由 `c_save()` 保存。调试命令的语法、参数和支持的 prefab/item ID 不变。

草丛 `grass` 和洞穴花 `flower_cave` 的采摘／再生、灰烬 `ash` 的生成／拾取／移除，以及矮星 `stafflight` 的生成／消失／注销如何映射到 signal，见 [DST 事件与 signal 映射](docs/dst-event.md)。矮星已接入：私有 signal 保存寿命与移除标记，`createMemo` 派生 `active → disappearing → removed`，effect 只同步消失表现；计时和永久移除同步执行。远离卸载模型时释放表现绑定，保留逻辑状态与 memo；永久移除直接清理资源并释放 memo。草丛和洞穴花的再生／灯光 timer 已接入 signal：共享游戏时间调度器在设置、暂停、恢复、取消或到期时提交，等待期间不扣减 timer，memo 派生状态。灰烬消散的 timer signal 仍是后续方案。实体表现 effect 用 `get()` 订阅自身状态，用 `peek()` 读取环境，包含同步调用的辅助函数。调试命令语法和参数保持不变；补齐 `c_spawn("stafflight")`／`c_spawn("staffcoldlight")` 的注册入口。

`c_spawn("stafflight")` 在玩家位置生成一颗矮星，`c_spawn("staffcoldlight")` 生成极光，均无额外参数；也可用 `c_give("yellowstaff")`／`c_give("opalstaff")` 获取法杖施放。寿命分别保留 24／16 分钟，每 60 个有效游戏帧按累计实际 `dt` 结算，到期同步禁止保存，表现播放消失动画，实际到期点 1 秒后永久移除；消失动画完成只停止循环声。`c_save()` 无参数，先结算尾帧与远处经过的时间，只保存阶段为 `active` 的星体（包括远处未加载模型的星体）的 ID、位置与剩余寿命，读档恢复待机，不重播出现动画／音效。`getStaffLightState(model)` 提供寿命、移除标记与阶段的只读视图；管理器 `haunt(model)` 进入同一消失流程（幽灵输入尚未接入），`remove(model)` 显式移除，均不新增控制台命令。

库存实体直接提供数量、耐久、新鲜度和湿润状态的只读 signal，物品栏、装备、背包和容器 UI 订阅同一份组件状态；数值变化无需替换整份 UI item，数量接收动画读取实时 count。新鲜度和湿润显示使用原版 meter，缺少新鲜度状态时隐藏对应显示。可用 `c_give("torch", 2)` 检查燃料百分比，用 `c_save()` 保存并恢复库存组件状态；已提供的新鲜度与潮湿值也随库存／地面物品保存恢复。腐败／受潮模拟尚未接入，命令语法、参数和支持的 prefab/item ID 不变。详见 [容器 DTO 与 UI signal](docs/inventory-architecture.md#容器-dto-与-ui-signal)。

地面物品的位置统一由 `entity.transform.position` 决定：移动与抛落写入实体，模型、脚点、拾取距离、换肤和保存读取实体坐标；修改模型位置不会覆盖实体。用 `c_spawn("log")`、`c_spawn("butterfly")` 或 Shift + 右键丢弃物品可验证原有交互，`c_save()` 导出当前实体位置，读档恢复；抛落高度仍是视觉偏移。命令语法、参数和支持的 prefab/item ID 不变，详见 [地面坐标的权威来源](docs/inventory-architecture.md#地面坐标的权威来源)。

物品栏右键参考 Lua `widgets/invslot.lua:OnControl/DropItem/UseItem` 的分工：UI 将右键输入写入 input signal，读取 slot 的只读 `item` signal，并同步发布 `drop/use` 请求；应用验证物品实体后执行丢弃、进食、种花或背包装卸。连续右键分别处理，槽位投影更新不会重放动作；UI 断开和场景停止时释放对应订阅。`game:slot-context-menu` 仍跨 shadow root 冒泡；沿用网页已有的 Shift + 右键丢弃一个物品。`c_give`、`c_spawn`、`c_save` 的语法、参数和支持 ID 保持不变。

世界时钟直接读取世界 signal，已删除 `setClock()` 状态转发接口。指针和日期仍每 60 个活动帧结算刷新；装饰动画逐活动游戏帧播放，暂停时停止，不累计第二份世界时间。以下调试命令的语法、参数和支持 ID 不变。

建筑容器面板的开关与屏幕定位由 `packages/ui/src/chest-inventory-panel.ts` 负责；`src/registerDisposal.ts` 创建面板、动作控制器、库存接收动画订阅、表情轮盘和右键菜单订阅，统一注册帧更新与场景内显式释放。`src/main.ts` 只注入依赖，在场景加载后完成注册；容器面板的帧回调也随释放移除。调试命令的语法、参数、行为和支持 ID 不变。

`c_save()` 会先结算尚未满 60 帧的昼夜／温度时间，再把当前季节温度、昼夜温度和噪声时间保存到 `world.systems.worldtemperature`，读档后继续计算。昼夜、季节和月相使用 `packages/signals` 导出的全局唯一单例 `clockstate`、`seasonstate`、`moonphasestate`，读档恢复现有单例的值，月相按累计游戏时间和现有 20 天周期恢复。`DstLightingRenderer` 用 `createEffect` 读取三个 signal 更新光照，不复制它们的状态；夜晚且月相为 `full` 时显示满月光照。旧存档缺少温度字段时，使用存档季节（默认春季）的中点温度，并以已保存的累计游戏时间初始化噪声时间。当前季节仍需显式修改 signal，尚未自动推进；这里保存的是环境温度，HUD 的角色体温尚未接入。`c_save()` 无参数，命令语法和支持 prefab/item ID 不变。

`c_spawn("cookpot")` 生成烹饪锅；`c_give("twigs", 4)` 准备四份树枝，或用 `c_give("twigs")` 与 `c_give("red_cap", 3)` 准备树枝和红蘑菇。靠近并点击锅，把材料放入四个格子；烹饪按钮按 Lua `containers.lua` 只检查容器是否装满，原料由容器按 `cooking.IsCookingIngredient()` 限制。UI 提交 `COOK` 请求，动作检查正在烹饪、其他开启者和满容器状态，再调用锅自己的 `stewer.StartCooking()`：读取真实原料实体，计算配方与时间，关闭容器、销毁原料并禁止打开。`main.ts` 只接入通用容器与动作服务，不保存锅列表、判断配方或扣材料。`packages/componets/src/cooking.ts` 与 `preparedfoods.ts` 按源 Lua 定义食材标签、别名和 68 条普通料理；不再限定最终产物为 `beefalofeed`。四根树枝和树枝加三个红蘑菇约 10 秒后得到蒸树枝；一根树枝、两个红蘑菇和一份怪物肉按更高优先级得到肉串。锅内食物按 recipe 的 `overridebuild`、`overridesymbolname` 和 `potlevel` 选择原版图层，完成时播放 `cooking_pst → idle_full`。`c_save()` 保存产物、剩余烹饪时间、原料记录、身份、位置及锅皮肤；读档和清洁扫把换肤保留组件与状态，兼容已有蒸树枝存档。完成后左键点击锅采收；装备锤子或清洁扫把时右键仍执行工具动作。玩家自动走近锅的地面脚点，按原版 `HARVEST → dolongaction` 播放 `build_pre → build_loop`，1 秒后交付配方产物，再播放 `build_pst`；配方的产出数量保留（如糖豆为 3 份）。移动、跳跃、Esc、点击其他目标或开始其他动作取消未提交的采收，食物仍留在锅内。采收成功播放空锅动画和关闭声、清除 `donecooking` 并允许重新打开；库存包先填充可用物品槽和堆叠，放不下的余量落在玩家脚边，预先准备美术后同步提交，因此立即 `c_save()` 也能保存。采收后的空锅身份、位置、皮肤及库存/地面产物身份、数量随保存与读档保留。锅内腐败、食材新鲜度传递、食谱学习和厨师专属配方仍待实现。命令语法、参数及支持的 `c_give` / `c_spawn` ID 不变。

建筑和建成墙的 `skinId` 使用 signal，`reskinTargets.prepareNextSkin()` 先准备原版资源，成功提交时设置皮肤 signal。表现订阅替换美术、保留动画进度与地面脚点，并释放旧资源；根实体、容器、烹饪组件及墙的血量、战斗和敲击组件保持不变。墙的皮肤准备只创建美术资源，皮肤初始化映射由 `packages/animation/src/prefabskin.ts` 的 Lua 对应函数提供，包括共享 build 的 alternate 皮肤。取消准备、加载失败或移除实体不改变皮肤，准备资源只释放一次；保存读取当前 signal。用 `c_give("reskin_tool")` 装备清洁扫把后，按现有换肤方式操作建筑和墙，并可用 `c_save()` 保存选中的皮肤。命令语法、参数和支持 ID 不变。

`c_give("backpack")` 获取背包，第二个参数为数量（默认 `1`，例如 `c_give("backpack", 2)`），每个占一格。拖到身体装备槽或右键背包即可装备，角色显示 `swap_backpack.zip` 的原版外观；右侧播放 `anim/ui_backpack_2x4.zip` 的 `open` 动画并显示 2 列 × 4 行的 8 个储物格，可与物品栏、其他容器拖放物品，材料可用于制作。Shift + 右键丢弃时使用原版 `anim/backpack.zip` 的 bank `backpack1`、`anim` 地面姿态和 `anim/swap_backpack.zip` 的 build，点击可拾回。支持 36 个原版皮肤及其实际库存图标 atlas；可在制作面板选择皮肤，或装备清洁扫把右键地面背包循环换肤。拾回和重新装备保留皮肤，隐形皮肤仅隐藏穿戴外观，地面姿态仍可见。卸下时播放 `close` 并隐藏储物格，再次装备时恢复内容；每个背包实体独立持有自己的 8 个格子，换包时面板切换到对应容器；未装备背包的材料不可用于制作。背包不能放入背包或箱子。内容随背包丢弃、拾回、换肤及 `c_save()` 保存和恢复，存档嵌套在该背包的 `item.container` 中。容器逻辑由 `packages/componets/src/container.ts` 的 Lua 风格 `Container` 组件负责，装备和卸下调用 `Open/Close`，内容经 `OnSave/OnLoad` 保存恢复。`toSignal()` 将容器 DTO 提供给背包面板，事务提交后统一刷新数量、皮肤和耐久，换包或关闭面板时释放订阅；沿用玩家物品栏的槽位 signal 和渲染器。旧 `player:backpack` 存档仅在归属明确时迁移到对应背包。

在游戏页面按反引号键（`Backquote`，通常与 `~` 共用）打开或关闭调试控制台，输入命令后按 `Enter` 执行。执行后控制台自动关闭；`Esc` 可关闭，`↑` / `↓` 可浏览最近 50 条历史命令。执行结果或错误显示在浏览器开发者工具的 Console 中。

`src/InputManager.ts` 使用 signal 保存按键状态，`isManualMovement` 通过 `createMemo` 判断 WASD，`isActionInterrupting` 包含 WASD 与 Space，供动作控制器共用。重复按键不重复发布状态；调试控制台等输入框（包括 shadow DOM 内的输入框）不会触发移动，窗口失焦或表情轮盘切换时清空按键，输入管理器的 `dispose()` 用于页面内显式释放监听和 memo；`pagehide` 不执行资源清理。调试命令语法、参数和支持 prefab/item ID 保持不变。

| 命令 | 参数与作用 | 示例 |
| --- | --- | --- |
| `c_give("item_id", count)` | 向物品栏添加物品。`count` 可省略，默认 `1`，必须为正的安全整数；按堆叠上限分配。未知物品或物品栏空间不足时失败。 | `c_give("torch")`、`c_give("opalstaff")`、`c_give("pitchfork")`、`c_give("hammer")`、`c_give("book_silviculture")`、`c_give("meatballs", 10)` |
| `c_spawn("prefab_id")` | 生成一个当前支持的场景对象。建筑和墙生成在玩家前方，洞穴植物、萤火虫、伯尼、岩石、草、树苗、池塘、虫洞、留声机、唱片和梦魇疯长生成在玩家当前位置，皮弗娄牛生成在玩家附近的空地。 | `c_spawn("cookpot")`、`c_spawn("beefalo")`、`c_spawn("bernie_inactive")`、`c_spawn("rock1")`、`c_spawn("grass")`、`c_spawn("sapling")`、`c_spawn("pond")`、`c_spawn("wormhole")`、`c_spawn("nightmaregrowth")` |
| `c_save()` | 无参数。将当前游戏状态（包括挖过的地皮、耕地地皮和月岩多人传送门）校验后导出并下载为 `initial-world.json`，同时在画面上方偏右显示原版 `anim/saving.zip` 的保存动画（`save_pre` → `save_loop` → `save_post`），结束后隐藏；保存超过 0.5 秒显示“正在保存…”。快速保存也会完整播放一轮动画；校验失败时结束提示，并在浏览器 Console 报告“保存失败”及具体字段路径，下载不会开始。要作为初始存档加载，将下载文件放到 `public/saves/initial-world.json` 后重新加载页面。 | `c_save()` |
| `c_setsanity(percent)` | 设置 Wilson 的理智比例；`percent` 为必填的 `0` 到 `1` 数字（上限 200），写入理智 signal，由订阅同步状态栏和低理智滤镜，并随 `c_save()` 保存。调色按每 10% 一档四舍五入；实际理智、晃动速度和幅度保留连续值。 | `c_setsanity(0)`、`c_setsanity(0.175)`、`c_setsanity(1)` |

物品栏左键点击普通物品时，将整叠实体从原槽转移到真实鼠标槽 `player:cursor/0`，图标、数量和耐久跟随鼠标。再点击空槽放下，点击已占用槽则交换鼠标槽与目标槽的整叠物品（包括同类物品），换出的物品继续由鼠标持有；拖放仍执行移动或合堆。失败时保留鼠标物品；`Esc` 尝试放回来源槽，再尝试普通物品栏，无法完整放回时继续持有。鼠标槽不作为 `c_give`、普通拾取或制造产物的自动接收槽，也不自动消耗其中的制造材料。`c_save()` 保存鼠标槽内的实体 ID、数量、皮肤、燃料和容器等状态，读档恢复鼠标持有；旧存档缺少该容器时初始化为空。调试命令语法、参数和支持 prefab/item ID 不变。

手部拿出／收起动画统一由 `src/playerHandEquipment.ts` 订阅装备 signal：装备时播放 `item_out`，正常卸装时播放 `item_in`，换成另一实体时播放新装备的 `item_out`，同一实体换肤不重复播放。动画等待手持美术加载完成，并跳过已被后续换装或关闭取消的请求；读档初始化和物品耗尽移除不播放转移动画。主程序只处理库存转移结果与燃料结算。`c_give`、`c_spawn`、`c_save` 的语法、参数和支持 ID 不变。

命令支持单引号或双引号、英文或中文括号（也可混用）、额外空白及末尾分号；`c_give` 的参数分隔符也支持中文逗号。一次可提交多条命令，用英文分号 `;` 分隔，例如 `c_give("phonograph");c_give("record");`，或 `c_spawn("phonograph");c_give("record");c_save()`。整行语法检查通过后按顺序执行，并等待生成和保存完成；语法无效时整行不执行，执行失败时停止后续命令，已完成的操作保留，Console 显示执行结果及错误。支持的物品及 `c_spawn` ID 不变，见下方清单。

玩家动作控制器统一由 `@dontstarve-web/stategraphs` 导出，实现在 `packages/stategraphs/src`：锤击、采矿、捕虫、铲地、园艺锄耕坑、铲垃圾、种子交互、换肤及法杖施法输入。锤子、镐、干草叉、铲子、园艺锄、捕虫网、清洁扫把和光照法杖控制器接收只读 `inventory.handEquipment` signal，在内部读取装备实体的能力；锤子、捕虫网和清洁扫把按组件及标签选择动作，其他手部工具保留其已支持的 ID 分支；卸装、换成另一实体或换肤会立即取消旧动作，控制器销毁时释放订阅。同一装备实体和皮肤的状态更新不重复取消，控制器不写入装备 signal。光照法杖按召唤目标 `stafflight/staffcoldlight` 选择 `yellowstaff/opalstaff`，更换装备后原先预加载或排入时间线的施法不会生成新光源。`src/main.ts` 注入装备 signal、`registerFrameTask` 帧调度服务、移动、动画和目标操作接口；控制器根据 signal 自行注册／移除帧任务，每帧只更新当前装备对应的手部动作控制器，读档后已有装备也立即注册。卸装和销毁会移除任务，同一身份重复发布不重复注册；法杖由输入事件与状态图时间线驱动，无独立帧任务。`packages/prefab` 负责工具美术、目标实体与特效，`SGwilson` 负责动作状态和提交帧。`c_give`、`c_spawn` 和 `c_save` 的语法与参数保持不变；当前支持 ID 见下方对象表。

`SGwilson` 的已支持源状态按 Lua 顺序显式写成 `State({ name, tags, onenter, onupdate, timeline, ontimeout, events, onexit })`，仅填写已实现的回调；标签使用源定义，浏览器动作身份另行维护。状态图的外部状态请求使用 `request…`，进入状态后的回调使用 `onEnter…`。`ActionHandler` 支持源动态目标函数和可选条件：采矿、锤击、挖掘、捕虫读取前摇/工作标签决定拒绝、前摇或动作循环；扫把换肤使用 `CASTSPELL`，由工具的 `veryquickcast` 标签选择快施法状态。浏览器跳跃、制作和半速拾取以 `busy` 阻止新动作，跳跃期间所有动作等待落地；表情检查源 `busy/nopredict/sleeping/floating` 标签，可以打断未被这些标签阻止的工作状态。动画完成事件与状态超时独立，采矿、锤击、挖掘及耕坑的收尾动画在 `idle` 内继续播放。种植使用 `doshortaction`，第 6 帧提交，第 10 帧超时进入待机并保留动画队列，退出仅清理自己的缓冲动作。采收使用 `dolongaction`，第 4 帧移除 `busy`，1 秒后提交并播放 `build_pst`，退出清理自己的缓冲动作和制作声。浏览器适配及暂缺的 Lua 分支见 [状态图源码核对](docs/dst-stategraphs.md)。`c_spawn`、`c_give`、`c_emote` 和 `c_save` 的语法、参数及支持 ID 保持不变。

悬停文字按 Lua 的动作选择与 `hoverer` 分工统一显示：共享鼠标命中，按源优先级分别选择左右键动作，文字取自源简体中文字符串；控制器只注册动作候选。左键显示原版左键图标及动作文字，右键显示原版右键图标及 `: 动作文字`，可以同时显示两条；建造预览提示优先，鼠标位于 UI 上时隐藏世界提示，文字限制在屏幕边界内。用 `c_give("bugnet")`、`c_give("hammer")`、`c_give("reskin_tool")` 获取并装备相应工具后，目标上分别显示“捕捉”“敲”“打扫”；播种提示为“栽种”，铲子/干草叉为“挖”。选中唱片后，仅在靠近且可插片的留声机上显示“放置唱片”。卸装或目标失效后提示自动清除。详见 [鼠标悬停动作文字](docs/dst-hover-text.md)。这些命令的参数和支持 prefab/item ID 保持不变。


物品现在按 Lua 的 `Inventory:GiveItem/Equip/DropItem` 与 `Stackable:Get/Put` 交接实体：背包、装备槽和地面持有同一物品实体，整件转移、拾取、丢弃和换肤保留 ID 与组件；拆堆创建新实体，合堆保留接收方实体。火把控制器随实体保留，卸下只停止燃烧，耗尽才移除实体。`c_save()` 的库存物品快照新增可选 `entityId`，地面仍保存记录 `id`；旧存档缺少物品 ID 时自动分配。`c_give`、`c_spawn` 和 `c_save` 的语法、参数和支持 ID 保持不变，细节见 [库存架构](docs/inventory-architecture.md)。

`c_give("torch", 2)` 获取两把满耐久火把，每把占一格；`c_spawn("torch")` 在玩家脚下生成可拾取的满耐久火把。物品栏、装备槽和储物格在图标下方显示燃料百分比，按原版 `widgets/itemtile.lua:SetPercent()` 四舍五入，未耗尽时最低显示 `1%`。基础燃料为 `TUNING.TORCH_FUEL = 75` 秒，由 torch prefab 的 `onequip()` / `onunequip()` 管理燃烧：装备到手部时点燃并消耗，卸下或普通丢弃后停止；装备火把耗尽时校验仍属于当前绑定装备，再将该库存的 `handEquipmentExistenceState` 设为 `null`；玩家 `InventoryStore` 订阅该变化，清空手部槽并清理实体，随后清除手持外观和照明。燃料随转移、丢弃、拾取、清洁扫把换肤及 `c_save()` 保存恢复；旧存档未记录燃料的火把按满耐久加载。燃料每 60 个燃烧帧结算一次，扣减这段时间累计的实际 `dt`，UI 随结算刷新；转移、丢弃、拾取、换肤、熄灭和 `c_save()` 前会结算不足 60 帧的部分，保留已经消耗的燃料。当前使用基础燃烧速率，尚未接入雨水、技能加成和投掷后持续燃烧。

`c_give("lantern", count)` 获取满燃料提灯，每盏占一格；`c_spawn("lantern")` 在玩家脚下生成已点亮的提灯。燃料与开关按 `prefabs/mininglantern.lua` 的 `fueled` / `machine` 组件挂在物品实体上：满燃料 `TUNING.LANTERN_LIGHTTIME = (night_time + dusk_time) × 2.6 = 468` 秒；装备时有燃料就开灯，卸下或放入物品栏关灯，掉在地上关灯后再开灯；只有开着时耗油。开灯按 `SetFirstPeriod` 额外扣一次首段燃料（满燃料 1/60 秒，否则 0.5 秒）。燃料每 60 个活动帧结算一次，转移、丢弃、拾取和 `c_save()` 前结算未满一批的部分。光照半径和亮度随燃料百分比从 3→5、0.4→0.6 插值，并从同一实体的开关与燃料 signal 派生。与火把不同，燃料耗尽只关灯，提灯以 0% 燃料保留在手上、物品栏或地面，并以 `remainingFuel: 0` 保存；空提灯无法再点亮。地面提灯另存 `lantern: { ison }`，读档时按 `machine:OnLoad` 恢复开关（旧存档缺少该字段时视为开启）。尚未实现加燃料（`CAVE` 燃料）、手动开关、开关音效与循环音效，以及耗尽时的 `torchranout` 自动换装。

手部装备变化在库存事务成功提交后发布到 `handEquipmentExistenceState`，同时携带对应的物品实体引用。[packages/signals](packages/signals/README.md) 提供 `createHandEquipmentExistenceState()` 工厂，每个 `InventoryStore` 默认创建独立实例，也可通过构造函数第五个参数的 `{ handEquipmentExistenceState }` 对象注入；`InventoryStore.handEquipment` 是该实例的只读接口。应用必须通过 `bindPlayerHandEquipment({ handEquipmentExistenceState, ... })` 显式传入同一实例。存在状态只表示当前装备身份，不表示燃烧状态或燃料数量；Store 只监听槽位清空，不监听各 prefab 的动态状态。先在 `src/playerHandEquipment.ts` 注册注入 signal 的订阅，再由 `InventoryStore.replaceState()` 恢复存档并写入 signal；该次写入直接触发装备生命周期和手持动画，订阅注册时不回放当前值，也没有单独的初始同步。后续变化使用同一订阅，通过 prefab 注册表依次执行旧装备卸下、新装备装备，并接入手持外观、照明和光标。`main.ts` 只接入订阅器的帧更新、结算、成功转移动画和释放。燃料及其他库存更新不重新发布装备。prefab 的 `onequip(handEquipmentExistenceState)` 接收具体槽位，torch 通过独立的 `burning` signal 同步照明，`extinguish()` 只停止燃烧，保留装备和剩余燃料；只有燃尽才校验装备引用并请求清空 signal。`InventoryStore` 在手部槽位成功注册后、发布初始装备状态前自动建立唯一的清空监听，应用无需手动绑定；监听随 `dispose()` 释放。应用随后注册动画订阅，耗尽时库存先提交手部槽移除；`onunequip()` 和释放停止燃烧并解除绑定，不修改槽位值。地面火把没有槽位绑定，熄灭不会修改玩家装备。库存自身的转移或读档已清空手部槽时不会重复移除，其他库存或旧装备也不能清除当前槽位。手动将当前装备 signal 设为 `null` 表示移除当前手部物品，正常卸下应使用库存转移；未耗尽时显式熄灭保留装备及燃料。旧 torch 不会清空新装备。signal 不写入存档；UI 操作、命令及读档仍由库存提交装备结果。

头部和身体装备采用相同的工厂与订阅流程：`createHeadEquipmentExistenceState()` / `createBodyEquipmentExistenceState()` 创建每个库存独立的 `headEquipmentExistenceState` / `bodyEquipmentExistenceState`，Store 注册对应槽位时自动绑定清空监听，并在装备事务成功提交后发布身份。`src/playerHeadEquipment.ts` / `src/playerBodyEquipment.ts` 在读档前注册订阅，帽子与背包外观、背包面板开关和材料可访问性都由 signal 更新驱动；不再通过 `syncHeadEquipment()` / `syncBodyEquipment()` 读取库存同步。三种绑定共用 `src/playerEquipment.ts` 的生命周期切换与释放逻辑。普通物品或组件更新不重新装备，正常卸下仍保留物品；手动清空对应存在状态表示移除该槽位物品，结果随 `c_save()` 保存恢复。

手部 signal 的非空值必须声明 `EQUIPSLOTS = "HANDS"`，同时受 TypeScript 类型和 setter 运行时校验限制；身体装备或缺少槽位声明的对象不能写入。torch 公开只读的 `EQUIPSLOTS: "HANDS"` 属性。`c_give`、`c_spawn` 和 `c_save` 的命令参数及支持 ID 不变。

火把点燃播放原版 `dontstarve/wilson/torch_swing`（两段样本随机选择），卸下、燃尽或成功拾取正在燃烧的地面火把时播放一次 `dontstarve/common/fireOut`。`OnPutInInventory()` 恢复 `idle`、停止燃烧与地面音源，保留剩余燃料和皮肤；普通未点燃火把拾取不播放熄灭声。地面实体接收 `onextinguish` 事件后调用 `OnExtinguish()`：熄灭照明、恢复 `idle`，按 Lua 的小范围随机水平速度和向上速度弹离地面，保留燃料、实体 ID 与皮肤，不修改玩家手部装备。声音在装备或生成前预加载，真实鼠标或键盘输入恢复音频上下文。

地面燃烧状态保存到 `ground_item.components.torch.lit`，剩余燃料仍保存在 `stack.remainingFuel`；换肤保留燃烧和最新燃料，读档恢复燃烧但不重播点燃声。`c_spawn("torch")` 和普通丢弃仍生成未点燃火把。当前接入这两个回调及地面照明/弹跳，不包含投掷输入、飞行/插地动作、雨水/技能修正及原版火焰粒子；外部游戏逻辑可通过地面模型的 `userData.torch.ignite()` 点燃，通过 `onextinguish` 事件熄灭。

装备 `torch` 后，鼠标悬停可燃建筑显示右键“点燃”，右键自动走近地面脚点并执行原版 `LIGHT → catchonfire`：播放 `light_fire` → `light_fire_pst`，第 13 帧调用火把的 `lighter` 和目标的 `burnable`，不额外扣除火把燃料。当前可燃建筑为木箱 `treasurechest` 和烹饪锅 `cookpot`；例如执行 `c_give("torch");c_spawn("treasurechest");`，或 `c_spawn("cookpot")`，再把火把装备到手部槽并右键建筑。移动、跳跃、Esc、更换装备或操作其他目标会取消未提交的点燃；燃料耗尽、目标移除或已经燃烧时不能提交。

木箱燃烧 10 秒、锅燃烧 20 秒，使用 `anim/fire.zip` 的 `level2` / `level3` 原版火焰、局部照明及独立循环火声；附近已接入燃烧组件的建筑和地面物品按原版热量传播和阴燃分支受热。烧毁后显示原版 `burnt` 残骸、掉出容器中的真实物品，锅掉出已有料理并停止烹饪；残骸不能打开，再锤击一次即可拆除。建筑提供只读 `userData.burningSignal` 和 `userData.burntSignal`，火焰表现和容器 UI 订阅状态更新，烧毁主动关闭已打开的面板；换肤保留根实体、组件、signal、位置和燃烧进度，移除实体或关闭面板时释放订阅。`c_save()` 按原版将正在燃烧或已烧毁的建筑保存为 `building.burnt: true`，读档直接恢复残骸，保留实体 ID、位置、皮肤以及掉出物品的身份、数量和组件状态。当前接入这些建筑和下述材料的普通点火、烧毁及干燥天气传播分支，其他植物/物品、雨水和角色技能修正仍未接入。命令语法和参数不变；材料新增的 `c_spawn` 入口见下文。

地面上的干草 `cutgrass`、木头 `log` 和草簇 `dug_grass` 同样支持手持 `torch` 右键点燃。可执行 `c_give("torch");c_spawn("cutgrass");`，装备火把后右键地面干草；`c_spawn("log")` 生成木头，也可将 `c_give("cutgrass", 3)` / `c_give("log", 7)` 得到的物品丢到地上再点燃。干草燃烧 7.5 秒、木头燃烧 15 秒、草簇燃烧 30 秒，整叠烧毁后在原脚点生成同数量的一叠灰烬 `ash`（原版上限 40），原物品移除；灰烬美术提前准备，烧毁后立即 `c_save()` 即可保存灰烬实体、位置和数量并读档恢复。物品通过只读 `burningSignal`、`burntSignal` 和 `persistenceSignal` 通知表现及存档状态。正在燃烧时不能拾取，按原版 `DefaultBurnFn` 不写入存档；熄灭后重新可保存、可拾取，身份、数量和已有组件状态不变，拾回再丢弃保留同一份燃烧组件和 signal。石头等未声明燃烧组件的物品不提供“点燃”。新增 `c_spawn("cutgrass")`、`c_spawn("log")`、`c_spawn("ash")`，均生成在玩家脚点；`c_give` 已支持这三个 ID，语法与数量参数不变。

原版 Lua 中哪些 prefab 可用 `c_spawn`、哪些可通过 `c_give` 入栏，见 [prefab 命令静态核对表](docs/dst-prefab-console.md)。该表记录源码调查结果；本项目当前支持的 ID 以本文下方对象列表及物品定义为准。

低理智滤镜使用原版 `images/colour_cubes/insane_day_cc.tex`、`insane_dusk_cc.tex` 和 `insane_night_cc.tex`，按昼夜与季节调色同步渐变。调色将理智比例四舍五入到最近的 10% 档位（0%、10%、…、100%），再按 `colourcube.lua` 的平方曲线计算 `(1 - 档位比例)²`；例如 `c_setsanity(0.175)` 保留理智 35/200，调色按 20% 计算，强度为 0.64；`c_setsanity(0.149)` 按 10% 计算，强度为 0.81。原版 Lua 的曲线未作这种分档。世界画面边缘按 `postprocess_distort.ksh` 晃动，速度和幅度仍使用实际理智比例，速度为原版扭曲系数 `1` 时的一半，中心保持稳定；HUD 不受滤镜影响。旧存档未提供理智时沿用状态栏的 35/200，`c_setsanity(1)` 可恢复满理智画面。 `playerStats.sanity` 是工厂创建的理智点数 signal，可通过 `set(value)` 更新有限数值并自动限制在 0 到 200；`percent` 是同一状态的只读比例视图。滤镜在创建时接收并订阅该视图，状态栏独立订阅理智变化；直接写入 signal 也会更新两处，调试命令无需手动刷新。保存通过 `getPlayerStats()` 导出纯数值快照，读档先创建 signal，再初始化滤镜；滤镜 `dispose()` 用于页面内显式释放订阅及渲染资源；`pagehide` 不执行清理。

调色资源由 `src/main.ts` 显式调用 `DstLightingRenderer.create()` 并行加载，完成后通过 `game:lighting-ready` 事件发布实例，`src/universal.ts` 接收后供场景使用。场景在事件完成后启动；加载失败会中止启动。单独导入 `universal.ts` 不会请求调色资源或读取存档。




`c_give("bernie_inactive")` 获取伯尼，数量可指定为 `c_give("bernie_inactive", 2)`，每只占一格。Shift + 右键物品槽放到地面，也可用 `c_spawn("bernie_inactive")` 直接在玩家位置生成。地面形态按玩家实际理智比例切换：低于 15%（Wilson 理智低于 30/200）显示 `bernie_big`，其余显示 `bernie_active`；`c_setsanity(0.1)` 和 `c_setsanity(0.175)` 可验证两种形态。变大播放大伯尼的 `activate`；变小依次播放大伯尼的 `deactivate`、`deactivate_pst` 和小伯尼的 `activate`。起身结束后先播放 0.5 秒 `idle_loop_nodir`，保留播放时间切回 `idle_loop`。变身期间再次改变理智，会在当前动画流程完成后按最新理智切换。使用原版 `bernie.zip` / `bernie_big.zip` 动画和共享 `bernie_build.zip`，大伯尼保持 Lua 的 0.7 缩放，支持艾希莉、小火花两种皮肤。点击任一形态拾回时立即取消动画，仍为 `bernie_inactive`；位置、实体 ID、皮肤和物品数量随 `c_save()` 保存，恢复时根据玩家理智直接显示待机形态。当前按请求让 Wilson 也能触发两种地面形态，实现待机、大小切换动画与拾取，不包含原版 Willow 限制、技能、跟随、战斗、耐久和变身冷却。




用 `c_spawn("icebox")` 或 `c_spawn("treasurechest")` 生成冰箱或木箱后，走近并左键点击可打开，再次点击关闭。开关动画开始时分别播放原版 `dontstarve/common/icebox_open` / `icebox_close` 或 `dontstarve/wilson/chest_open` / `chest_close`；走远自动关闭时也播放关闭声。恢复存档时不重放开门声。

`c_spawn("moonbase")` 在玩家前方生成月亮石，使用原版 `anim/moonbase.zip` 的 bank/build `moonbase` 和初始 `med` 破损姿态，默认不发光。用 `c_give("moonrocknugget", 2)` 获取月岩，左键拿到鼠标上，再右键月亮石：玩家自动走近，按 `REPAIR → dolongaction` 在 1 秒后消耗一块月岩，修复值从 4 增加到 6，播放 `fix_full → full` 及原版三层 `moonbase/repair` 音效；修复完成后不再接受月岩。用 `c_give("yellowstaff")` 获取唤星者魔杖，拿到鼠标上后左键已修复的月亮石，玩家走近并按 `GIVE → give/give_pst` 在第 13 帧插杖；已有魔杖时拒收。空鼠标左键月亮石用 `PICK` 取回魔杖，插入与取回均播放 `moonbase/moonstaff_place`，修复、插杖和取杖在提交前可用移动、跳跃或 Esc 取消，物品不会提前扣除。插杖外观使用 `staffs.zip` 的 `yellowstaff` 符号覆盖 `swap_staffs`，保留四款原版魔杖皮肤、身份和剩余耐久；可先用已有清洁扫把流程给地面魔杖换肤。`c_save()` 保存月亮石身份、脚点、修复值及所持魔杖完整状态，读档恢复修复状态和魔杖覆盖；恢复插杖音效沿用 Lua 的 `OnStaffGiven`。已接入满月充能：满月夜开始后等待 10 秒（满月中途插杖至少等 1 秒），充能持续 49.9 秒；18.7 秒进入第二阶段、37.4 秒进入第三阶段，播放原版光束、脉冲和阶段音乐。第二、三阶段带 `intense` 标签，暂时不能取杖；提前取回或月落会停止充能并清空进度，重新插入从头开始。完成后按 Lua 创建新的满耐久 `opalstaff`（50 次），对应皮肤由原版 `granted_items` 映射，例如 `starstaff_crystal → moonstaff_crystal`；旧魔杖实体移除，新魔杖身份随保存读档保留。转化后出现 `staffcoldlightfx`，取回时移除其光照和独立循环声。保存时记录各具名计时的剩余时间和暂停状态，读档重建截止时间，恢复当前阶段、取杖锁定、音效及特效；瞬时 FX 不单独入档。可直接插入已有 `opalstaff`，它只显示冷星、不再次充能。默认世界在第 11、31 等天的夜间满月；需要快速准备测试场景时，可用 `c_save()` 导出存档，将 `world.elapsedSeconds` 改为 `5220`（第 11 天夜晚开始），再加载该存档。月兽暂未实现。`c_spawn("moonrocknugget")` 生成月岩地面物品，使用原版 `anim/moonrock_nugget.zip` 的 bank `moonrocknugget`、build `moonrock_nugget`、`idle` 和实际库存图标 atlas；地面数量、身份、位置随保存读档保留。

`c_spawn("sculptingtable")` 在玩家前方生成陶轮，也可在制作栏用 2 石砖、2 木板和 4 树枝制作后摆放（摆放时播放 `place` 与 `sculpting_table/craft`）。美术使用原版 `anim/sculpting_station.zip`，支持 `sculptingtable_gothic`、`sculptingtable_swamp` 两款皮肤并可用清洁扫把换肤。准备 `c_give("marble")` 或 `c_give("cutstone")`，拿到鼠标上后走近陶轮左键点击：玩家自动走近并按 `GIVE` 第 13 帧提交，由 `sculptingtable.lua` 的 `trader` / `pickable` 组件接收一块材料（`marble` 覆盖 `marble.zip` 的 `marble01`，`cutstone` 覆盖 `cutstone.zip` 的 `cutstone01`），已有材料时拒收（`SLOTFULL`），其他物品拒收（`NOTSCULPTABLE`）。放入、取回材料时播放原版 `moonbase/moonstaff_place`（木质放置声叠加随机石块碰撞声）；读档恢复已有材料时也按 Lua `giveitem` 播放，换肤不播放。陶轮上的材料可左键走近取回，也会随锤击（4 次）与配方材料一起掉出；`c_save()` 保存 `sculptingtable.itemname`，读档恢复显示且不扣除物品。当前未接入原版的素描收录、雕刻科技、月圆夜棋子掉落、燃烧和月亮玻璃。`c_spawn("cutstone")`、`c_spawn("marble")` 生成对应地面物品。

`c_spawn("wardrobe")` 在玩家前方生成衣柜，使用原版 `anim/wardrobe.zip` 的 bank/build `wardrobe` 和 `closed` 外观。当前仅实现贴图显示，无开关门、换装或锤击交互；位置随 `c_save()` 保存并在加载时恢复。


`c_give("reskin_tool")` 获取清洁扫把，`c_spawn("reskin_tool")` 生成地面扫把；数量可用 `c_give` 的第二个参数指定，例如 `c_give("reskin_tool", 2)`；每把占一格。支持原版物品图标、手部装备外观、4 个皮肤，以及 Shift + 右键丢弃和点击拾回。装备到手部后，右键有可用皮肤的建筑或地面物品进行换肤，超出施法距离时自动走近；每把扫把按 prefab 维护自己的皮肤缓存：目标与缓存相同时选择下一种支持的皮肤，循环后回到基础外观；另一把没有缓存的扫把先移除目标现有皮肤。准备被取消时不修改缓存。玩家按原版 `veryquickcastspell` 播放 `anim/player_attacks.zip` 的 `atk_pre → atk`，开始时播放挥动声，第 9 帧提交换肤并在目标位置播放 `reskin_tool_fx.zip` 的 `puff` 及换肤音效；清洁扫把的 4 个皮肤使用各自的特效外观，幽灵画笔使用独立音效。移动、跳跃、左键、Esc、卸下或更换扫把可取消未提交的换肤；取消后不出现换肤特效或结果音效。换肤保留实体 ID、位置、物品数量及容器内容，皮肤随 `c_save()` 保存和恢复；暂不处理背包内目标、角色胡须及原版皮肤所有权筛选。

锤子可用 `c_give("hammer")` 获取，`c_spawn("hammer")` 生成地面锤子；每格只能放一把，满耐久 75 次，拖到手部装备槽后显示原版手持外观。Shift + 右键物品槽可放到地上，点击地面锤子可拾回。用 `c_spawn("treasurechest")` 等命令生成建筑后，手持锤子右键建筑会自动走近并播放挥锤及对应受击动画，在 `pickaxe_loop` 第 7 帧播放原版 `dontstarve/wilson/hit`（两段样本随机选择）；移动、Esc 或卸下锤子可取消尚未命中的挥锤及音效。科技建筑 `researchlab`、`researchlab2`、`researchlab3`、`researchlab4` 按 Lua 需要 4 次成功命中：前三次播放 `hit` 后恢复靠近/待机动画，第四次触发 `onhammered`，按配方各材料的 50% 向上取整掉落物品，播放原版 `collapse_small` 木质坍塌特效和声音，并从场景、交互目标和存档中移除。材料按 `lootdropper.lua:FlingItem()` 逐件抛向随机方向，水平速度 `0–2`、向上速度 `8±4` 按场景比例换算，起点避开建筑碰撞半径；使用简化抛物线与落地弹跳，最后停在各自落点。飞行中也可拾取，保存当前地面位置，读档不重播抛出过程。可用 `c_spawn("researchlab")` 后手持锤子右键 4 次验证；未销毁的建筑读档后恢复 4 次锤击，符合 Lua workable 默认不保存进度的行为。冰箱、木箱、龙鳞宝箱和盐盒需要 2 次命中；蘑菇灯需要 3 次；烹饪锅、火坑、帐篷、暗夜照明灯和猪舍需要 4 次。工作量归 `workable` 组件管理，耗尽后执行各 prefab 的掉落、坍塌和移除回调；冰箱、箱子和盐盒受击时按 Lua 掉出容器物品并关闭，容器物品交接保留实体身份和组件状态。普通墙需 3 次，月岩墙、绝望石墙需 25 次，废料墙需 10 次；锤击不扣墙体生命，完成时按当前生命比例掉落材料并移除墙。墙体锤毁回调 `onhammered` 显式声明在 `packages/prefab/src/walls.ts`，通过墙定义接入 `workable.SetOnFinishCallback`；`wallPlacement.ts` 提供地面位置、掉落、特效创建和实体移除服务。墙实例使用 `Set` 维护，锤击、攻击和换肤目标的成员校验用 `has()`，集合移除用 `delete()`，均为平均 O(1)；保存导出保留墙的生成顺序。`workable.workleft` 是只读 signal，启用状态、动作和实体移除信号共同派生可工作能力及 `HAMMER_workable` 等标签；检查能力使用实体 `hasTag()` 或组件视图，不读取 `model.userData.tags` 中的工作标签副本。成功工作显式执行 Lua 的事件和完成回调顺序；取消、禁用或载入零工作量不会触发锤毁。墙换肤保留原有工作信号，普通墙读档仍恢复初始工作量，永久移除及预览取消会释放组件 memo。营火没有 HAMMER 动作。每次成功命中消耗锤子 1 次耐久，取消或目标失效不消耗；剩余耐久随掉落、拾取、换肤和 `c_save()` 保存恢复。

捕捉和锤击按 Lua 的组件动作规则选择目标：工具的 `tool` 组件维护 `NET_tool` / `HAMMER_tool`，目标的 `workable` 动态维护 `NET_workable` / `HAMMER_workable`；命中时重新检查组件状态。`c_give("bugnet")` 获取捕虫网，`c_spawn("bugnet")` 生成地面捕虫网，满耐久为 10 次。捕捉蝴蝶、萤火虫成功执行工作后消耗 1 次，完整库存下按 Lua 再次掉落生物并恢复可捕捉状态。萤火虫隐藏、淡出及延迟禁用工作时更新能力标签。`CASTSPELL` 由 `spellcaster` 的 `castontargets` 标签提供，`nomagic` 目标不提供该动作；提交前还要通过清洁扫把的换肤校验。目标列表只提供场景/渲染引用，不按物品 ID 或受击动画推断动作能力。

`c_give("dreadstone", 3)` / `c_give("wagpunk_bits", 3)` 获取墙体拆除材料，`c_spawn("dreadstone")` / `c_spawn("wagpunk_bits")` 在玩家位置生成一份。库存图标使用各自真实 atlas，地面使用源动画的 `idle`；数量、实体 ID 和落点随 `c_save()` 保存恢复。

蝴蝶 `butterfly` 与月蛾 `moonbutterfly` 现在按 Lua 的实体结构运行：行为树在 `packages/brains/src`（`behaviourtree.ts` 对应 `behaviourtree.lua`，`behaviours/{runaway,wander,doaction,findflower,panic,avoidelectricfence}.ts`、`braincommon.ts`、`butterflybrain.ts`、`moonbutterflybrain.ts` 逐一对应同名 Lua），状态图在 `packages/stategraphs/src/SGbutterfly.ts`，`locomotor`、`pollinator`、`knownlocations` 组件在 `packages/componets/src`，`packages/prefab/src/butterfly.ts` 只负责实体、世界适配和美术。蝴蝶的优先级为 恐慌 → 电栅栏 → `RunAway`（`scarytoprey`，5 单位内逃离、10 单位外停止）→ 夜晚回家 → 采满花粉回家 → `FindFlower` → `Wander`；因 `PriorityNode` 的评估周期散布和 `Wander` 的初始等待，生成后约 2–4 秒才开始飞行（`random` 固定为 0 的测试可复现），`idle` 状态只在 `idle_flight_loop` 播完一轮后才转入 `moving`。到花朵的到达距离按 `locomotor.lua` 的 `ARRIVE_STEP + 物理半径` 计算，而不再直接贴到花心；`POLLINATE` 落地后授粉 2 秒（`GetRandomWithVariance(3, 1)`）再起飞，访问过的花不会再访问，`GOHOME` 落地播放完后移除。月蛾使用 `anim/butterfly_basic.zip` 的 `butterfly` bank 与 `butterfly_moon` build，移动速度 `MOONBUTTERFLY_SPEED = 2.5`，没有授粉组件，行为树是 恐慌 → 电栅栏 → `RunAway` → 围绕 `knownlocations` 的 `home`（掉落时位置）`Wander`（最大 20 单位）；带半径 0.5、强度 0.5 并随 `OnUpdateFlicker` 闪烁的月光（颜色 0.3/0.55/0.45）和 0.15 的光照覆盖。月蛾寿命 `TOTAL_DAY_TIME / 2`，在物品栏里按 0.25 倍速腐败，在物品栏里腐败直接消失，在地面腐败则关闭光、禁用捕虫网并进入 `death`（掉落 `moonbutterflywings`），3 秒后移除。月树砍倒时的 `moonbutterfly` 掉落（100% 一只，50% 第二只）现在是真实的月蛾。`c_spawn("butterfly")`、`c_spawn("moonbutterfly")`、`c_spawn("moonbutterflywings")` 和对应的 `c_give` 都可用；月蛾翅膀可食用并会腐败。尚未接入：冻结/电击状态（`CommonStates.AddFrozenStates` / `AddElectrocuteStates`）、`Pollinator:CreateFlower`、蝴蝶种花与月蛾种植 `moonbutterfly_sapling`、蝴蝶生成器、`MakeFeedableSmallLivestock` 喂食与腐败、燃烧与万圣节月亮变异、墙体视线检查（`FindWalkableOffset` 的 `check_los`）和 `RunAway` 的 `safe_point_fn` / 回家分支。

斧头可用 `c_give("axe")`、`c_give("goldenaxe")` 或 `c_give("moonglassaxe")` 获取，`c_spawn` 同名 ID 生成地面工具，每格一把。三种斧头满耐久均为 `TUNING.AXE_USES = 100`，每次成功砍伐分别消耗 1 / 0.25 / 1.25，月光玻璃斧的 `CHOP` 效率为 2.5；拖到手部装备槽后显示 `swap_axe` / `swap_goldenaxe` / `swap_glassaxe` 手持外观，耗尽后自动卸下并移除。月树 `moon_tree` 是已有场景森林中的 `tall` 阶段：装备斧头后右键月树（与镐子相同，使用右键），玩家自动走近并播放 `anim/player_actions_axe.zip` 的 `chop_pre → chop_loop`，第 2 帧执行 `CHOP` 工作并消耗耐久；`CHOP_tool` / `CHOP_workable` 标签选择动作，命中时重新验证组件，移动、Esc、卸下或更换斧头可取消尚未命中的砍伐。月树需要 `TUNING.MOON_TREE_CHOPS_TALL = 16` 次工作量，每次命中播放 `dontstarve/wilson/use_axe_tree`（FEV 两层：`chop_tree_V2_*` 与 `branchfoley_v2_*`）、`chop_tall` 与花瓣特效 `tree_petal_fx`；最后一击播放 `dontstarve/forest/treeFall`，按玩家相对相机右向量选择 `fallleft_tall` / `fallright_tall`，在倒下一侧抛出 4 个 `log`、2 个 `moon_tree_blossom` 和 1–2 只 `moonbutterfly`（第二只 50%），随后保持 `stump_tall` 树桩（移除 `shelter` 并标记 `stump`）。砍伐进度与 Lua `workable` 一样不写入存档，但加载/卸载月树模型时保留；`c_save()` 对树桩保存 `moon_tree.components.moonTree.stump`，读档直接显示树桩。`moon_tree_blossom` 为 `PERISH_FAST` 的月树花（`HEALING_TINY`），可用 `c_give("moon_tree_blossom")` 或 `c_spawn("moon_tree_blossom")` 获取。当前未接入：树桩铲除与腐朽计时、燃烧、阶段生长、小/中阶段月树、技能与角色专属伐木分支。

鹤嘴锄可用 `c_give("pickaxe")`（或 `c_give("goldenpickaxe")`）获取，`c_spawn("pickaxe")` / `c_spawn("goldenpickaxe")` 生成地面工具，每格一把。普通鹤嘴锄满耐久可开采 33 次，黄金鹤嘴锄可开采 132 次，开采效率相同；内部满耐久均为 33，成功开采分别扣 1 / 0.25，库存及装备槽显示剩余百分比，耗尽后自动卸下并移除。拖到手部装备槽后显示原版手持外观。用 `c_spawn("rock1")` 等命令生成岩石后，手持鹤嘴锄右键岩石会自动走近并播放 `anim/player_actions_pickaxe.zip` 的开采挥镐动画，在 `pickaxe_loop` 第 7 帧执行 MINE 工作、消耗耐久并播放原版 `dontstarve/wilson/use_pick_rock`；两种鹤嘴锄使用同一音效。动作由 `MINE_tool` / `MINE_workable` 标签选择，并在命中时重新验证组件。移动、Esc、卸下或更换鹤嘴锄可取消尚未命中的开采及音效；取消、目标失效或超出距离不消耗耐久。剩余耐久、实体身份和皮肤随掉落、拾取、换肤及 `c_save()` 保存恢复。

岩石按 `rocks.lua` 的 `workable` 处理：`rock1`、`rock2`、`rock_flintless` 需 6 次成功开采，`rock_flintless_med` 需 4 次，`rock_flintless_low` 需 2 次；按剩余工作量切换原版 `full` / `med` / `low` 外观，完成后播放碎石声、按原版概率表逐件抛出石头、燧石、硝石或金块，并从场景、交互目标和存档移除。未挖完的岩石读档后恢复各自初始工作量，符合 Lua workable 默认不保存进度的行为。

暗夜剑使用实际 prefab ID `nightsword`：`c_give("nightsword", 2)` 获取两把，每把占一格；`c_spawn("nightsword")` 在玩家当前位置生成一把地面暗夜剑。拖到手部装备槽显示原版手持外观，Shift + 右键物品槽可丢到地上，点击地面暗夜剑可拾回。库存默认图标为 `images/inventoryimages.xml` 的 `nightsword.tex`；地面使用 `anim/nightmaresword.zip` 的 `nightmaresword` bank/build 和 `idle` 姿态；手持使用独立的 `anim/swap_nightmaresword.zip`，覆盖玩家 `swap_object`。装备清洁扫把后右键地面暗夜剑，依次切换 `nightsword_cotl`、`nightsword_curve`、`nightsword_lightsbane`、`nightsword_sharp`、`nightsword_wizard`，最后恢复默认外观；皮肤库存图标来自 `images/inventoryimages2.xml`，地面和手持均使用对应原版动态 build。换肤、丢弃、拾取及 `c_save()` 保留实体 ID、位置、数量、皮肤和已有物品状态，读档恢复地面及手部装备。已实现手持、地面外观及装备理智消耗；攻击、耐久消耗和皮肤攻击粒子待战斗功能接入。

暗夜剑的降理智效果按原版 `equippable.dapperness = TUNING.CRAZINESS_MED` 实现：干燥时每分钟降低装备者 20 点理智，潮湿时叠加原版湿装备惩罚，每分钟共降低 26 点，最低到 0。只在手部装备槽中生效；卸下、更换或丢弃后停止，库存、鼠标槽和地面暗夜剑不会影响附近玩家。默认外观和皮肤共用该规则。通用 `sanity` 组件按活跃游戏帧的实际 `dt` 汇总装备 `GetDapperness()` 并更新玩家理智 signal、HUD 和理智滤镜；显式场景销毁解除更新任务。`c_save()` 保存当前理智和装备，读档后继续按装备状态消耗，不补算离线时间。可用 `c_setsanity(1); c_give("nightsword")` 后拖到手部装备槽验证。

干草叉可用 `c_give("pitchfork")`（或 `c_give("goldenpitchfork")`）获取，每格一把。拖到手部装备槽后，右键地面会自动走近目标地皮中心，播放 `anim/player_actions_shovel.zip` 的 `shovel_pre` → `shovel_loop` → `shovel_pst`，在动作开始后第 25 帧将整格地皮改成 `WORLD_TILES.DIRT`（原版泥土贴图）；猪王周围的木地板也可挖，泥土不可重复挖。移动、跳跃、左键、Esc 或卸下工具可取消尚未完成的挖地。支持原版地面和手持外观及皮肤；Shift + 右键物品槽可丢弃，点击地面物品可拾回。挖地变化会随 `c_save()` 保存并在加载时恢复；当前不消耗耐久或生成挖出的地皮物品。




`c_spawn("phonograph")` 在玩家当前位置生成留声机；`c_give("phonograph", 2)` 获取两台，每台占一格。`c_give("record")` 获取唱片，`c_spawn("record")` 生成地面唱片。唱片由 `packages/prefab/src/records.ts` 初始化 `cattoy` 和 `phonograph_record` 标签及源曲目；库存与地面使用同一初始化，留声机按 `phonograph_record` 判断能否插片。走近留声机后，左键物品栏中的唱片拿到鼠标槽，再左键留声机插入；插片播放 `open` → `play_loop`，旧唱片原样掉落。右键已装唱片的留声机开关播放，空机不能开启；播放 64 秒后回到 `idle` 并播放原版结束声。只有鼠标槽中的唱片可用于插片；插入成功后消耗，目标不可用或鼠标物品已更换时保留物品。`Esc` 尝试将唱片放回物品栏。左键地面留声机拾回时停止播放，保留唱片；Shift + 右键丢弃后保持关闭，可再右键开启。留声机和唱片均使用各自源动画及实际库存 atlas，不可装备。

装备清洁扫把后右键留声机，可循环原版 6 种皮肤（`decor_phonograph_cawnival`、`decor_phonograph_fantasy`、`decor_phonograph_hallowed`、`decor_phonograph_handmade`、`decor_phonograph_rose`、`decor_phonograph_western`）；地面唱片支持 4 种皮肤（`record_creepyforest`、`record_drstyle`、`record_efs`、`record_hallowednights`）及对应歌曲。换肤保留实体 ID、位置、已装唱片及播放进度。手持锤子右键留声机，一次成功命中即锤毁，掉出已装唱片并播放木质坍塌特效和声音。`c_save()` 保存地面位置、皮肤、库存中的已装唱片和地面播放剩余时间，读档按进度恢复；各留声机音源独立，拾取、锤毁或显式销毁场景时停止；`pagehide` 不停止或释放音源。当前未接入农作物照料、家具摆放和内部 `SetRecord("balatro")` 变体。

`c_give("farm_plow_item")` 获取耕地机，第二个参数可指定数量，每台占一格、初始 4 次使用。左键物品栏中的耕地机进入部署预览，右键可种植的空地部署；预览和落点吸附到整格地皮中心（`TILE_SIZE = 12`），显示原版 `tile_outline` 使用的 `anim/gridplacer.zip`、bank/build `gridplacer`、`anim` 地皮边框。不能部署到已耕地地皮或有阻挡物的格子。成功部署时由物品实体的 `finiteuses.use(1)` 消耗一次使用，保存扣减后的完整物品快照；钻地 15 秒后将该格改为 `WORLD_TILES.FARMING_SOIL`（ID `47`），从快照折回物品，第 4 次用完后不再返还。`c_spawn("farm_plow_item")` 只生成 `idle_packed` 地面物品；`c_spawn("farm_plow")` 直接生成工作中的调试耕地机，完成后不返还物品。`c_save()` 将耕地机进度及完整物品快照保存到 `components.farmPlow.deployItem`，包含物品 ID、数量及组件状态；完成或被锤毁时恢复该快照，保留物品 ID 和剩余使用次数。地面物品加载成功前保留返还快照。旧存档的 `returnUses` 自动迁移；`c_spawn("farm_plow")` 的快照为 `null`。耕地结果及原地皮 ID 保存到 `world.map.tiles`，加载后恢复。

`c_give("farm_hoe")` / `c_give("golden_farm_hoe")` 获取园艺锄 / 黄金园艺锄，数量由第二个参数指定，每把占一格；`c_spawn("farm_hoe")` / `c_spawn("golden_farm_hoe")` 在玩家脚下生成可拾取的地面工具。地面美术分别使用 `anim/quagmire_hoe.zip` / `anim/goldenhoe.zip` 的 `idle`，基础图标均来自 `images/inventoryimages2.xml`；手持符号分别来自 `quagmire_hoe.zip:swap_quagmire_hoe` / `swap_goldenhoe.zip:swap_goldenhoe`。拖到手部装备后，右键耕地机生成的农田 tile，在鼠标落点耕坑，距离较远时自动走近；播放原版 `player_actions_till.zip` 的 `till_pre → till_loop → till_pst`，`till_loop` 第 11 帧生成 `farm_soil` 的 `till_rise → till_idle`。可重新整理破损坑或调整完整坑的位置，附近旧坑按原版坍塌规则移除或变为破损状态；普通地皮、杂物和已播种位置不允许耕坑。移动、跳跃、左键、Esc、卸下工具或切换物品取消未提交的动作。支持 Shift + 右键丢弃、左键拾回、现有清洁扫把换肤，以及皮肤和坑的 ID/位置随存档保存恢复。园艺锄支持 `farm_hoe_invisible`、`farm_hoe_rustic`；黄金园艺锄支持 `golden_farmhoe_garden`、`golden_farmhoe_invisible`，拟真皮肤隐藏手持工具。本次仅接入地面与手持美术和农田耕坑，不处理耐久或战斗。

`c_give("shovel")` / `c_give("goldenshovel")` 获取铲子 / 黄金铲子，数量可由第二个参数指定，例如 `c_give("goldenshovel", 2)`，每把占一格；`c_spawn("shovel")` / `c_spawn("goldenshovel")` 在玩家脚下生成可拾取的地面工具。地面分别使用 `anim/shovel.zip` / `anim/goldenshovel.zip` 的同名 bank/build 和 `idle`，基础物品图标均来自 `images/inventoryimages.xml`；手持资源分别为 `anim/swap_shovel.zip:swap_shovel` / `anim/swap_goldenshovel.zip:swap_goldenshovel`。拖到手部装备后，右键耕地机生成的农田 tile 上的垃圾（`farm_soil_debris`）自动走近，播放原版 `shovel_pre → shovel_loop → shovel_pst`，在 `shovel_loop` 第 15 帧挖掉该堆垃圾并显示 `dirt_puff`。按原版基础 25% 概率掉落一份材料，树枝 / 石头 / 燧石 / 硝石 / 金块权重为 40 / 25 / 20 / 10 / 5。清理保留农田地皮、坑、已播种实体和其他垃圾；移动、跳跃、左键、Esc、切换物品或卸下工具可取消未提交的挖掘。支持 Shift + 右键丢弃、左键拾回和现有清洁扫把换肤；铲子有 7 个原版皮肤，黄金铲子支持 `goldenshovel_invisible`、`goldenshovel_northern`，拟真皮肤隐藏手持工具。物品皮肤、地面实体 ID/位置/数量及垃圾清理结果随 `c_save()` 保存并恢复。普通铲子每次成功 `DIG` 消耗 1 点，共 25 次；黄金铲子同样保存 25 点原始耐久，每次消耗 0.25 点，共 100 次。取消或失败不消耗耐久，耗尽后移除装备；剩余耐久随存档恢复。原生草丛也支持同一 `DIG` 动作，战斗和其他挖掘目标尚未接入。



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

`red_cap` 按 `prefabs/mushrooms.lua` 接入 `components/perishable.lua`：腐烂时间 `PERISH_MED`（10 天，4800 秒），生成或 `c_give` 时为满新鲜度。剩余时间保存在组件私有的 timer signal（腐烂中／暂停／未设置／已腐烂四种状态）中，新鲜度百分比和 `fresh`（≥50%，绿）/ `stale`（>20%，黄）/ `spoiled`（≤20%，红）三个阶段都由 `createMemo` 从该 signal 派生；物品栏格子的原版 `spoiled_meter` 读取同一百分比。帧任务只累计时间，每 60 个活动帧按实际 `dt` 结算一次；转移、拾取、丢弃、进食和 `c_save()` 前先结算未满一批的时间。地面腐烂速度为 1.5 倍，潮湿再乘 1.3，世界温度低于 0 ℃ 乘 0.75、高于 70 ℃ 乘 1.25；冰箱和盐盒的保鲜倍率尚未接入。堆叠合并按 `perishable:Dilute` 以数量加权平均新鲜度。腐烂完成后整堆在原格子替换为同数量的 `spoiled_food`，地面上则在同一脚点替换。进食按 `components/edible.lua` 在扣除前读取当前阶段：

| `red_cap` 阶段 | 生命 | 饥饿 | 理智 |
| --- | --- | --- | --- |
| 新鲜 | -20 | +12.5 | 0 |
| 不新鲜（饥饿 ×0.667） | -20 | +8.3375 | 0 |
| 腐烂（饥饿 ×0.5，理智固定 -`SANITY_SMALL`） | -20 | +6.25 | -10 |

负的生命值不受腐烂影响。`bananapop`（香蕉冻）按 `prefabs/preparedfoods.lua` 使用配方的 `perishtime = PERISH_SUPERFAST`（3 天，1440 秒），其余规则与 `red_cap` 相同，腐烂后同样替换为 `spoiled_food`；`c_give("bananapop", count)` 放入物品栏，`c_spawn("bananapop")` 在玩家脚下生成，烹饪锅采收的产物也以满新鲜度开始。香蕉冻尚未接入食用（属性、降温效果），锅内成品腐烂和食材新鲜度传递仍待实现。新鲜度以 `freshnessPercent` 随库存和地面存档保存，读档后从中恢复剩余时间并继续腐烂。`c_spawn("spoiled_food")` 在玩家脚下生成腐烂物，`c_give("spoiled_food", count)` 放入物品栏。

`c_give("meatballs", 2)` 获取两份肉丸，第二个参数可省略，默认一份；`c_spawn("meatballs")` 在玩家脚下生成可拾取的一份。右键物品栏肉丸播放 `quick_eat_pre → quick_eat`，第 10 帧播放 `dontstarve/wilson/eat`，第 12 帧成功扣除一份后恢复表中的属性，超过 Wilson 上限的部分截断。取消或物品被替换时不消耗、不恢复属性。图标来自 `images/inventoryimages.xml:meatballs.tex`，地面使用原版 `anim/cook_pot_food.zip` 的 `cook_pot_food` bank/build、`idle` 和 `swap_food:meatballs` 符号覆盖，无原版皮肤。支持 Shift + 右键丢弃和左键拾回；数量、实体身份、地面位置及食用后的属性随 `c_save()` 保存恢复。

`c_give("bananajuice", 2)` 获取两份香蕉奶昔，第二个参数可省略，默认一份；`c_spawn("bananajuice")` 在玩家脚下生成可拾取的一份。右键物品栏香蕉奶昔按原版 `preparedfoods.lua` 的 `fooddrink` 标签播放 `anim/player_actions_eat.zip` 中的 `quick_drink_pre → quick_drink`：第 10 帧播放 `dontstarve/wilson/sip`，第 12 帧成功扣除一份后增加 **33 理智、25 饥饿、8 生命**，Wilson 上限分别为 200、150、150。生命、饥饿、理智分别写入 `playerStats.health`、`playerStats.hunger`、`playerStats.sanity` signal，HUD 订阅三项属性更新，低理智滤镜订阅理智比例更新；提前按 Esc、移动或跳跃取消时不消耗、不恢复属性，物品实体或所在槽位被替换时也不提交。基础图标使用 `images/inventoryimages1.xml:bananajuice.tex`，地面仍使用 `cook_pot_food.zip` 的 `idle` 和 `cook_pot_food10.zip:bananajuice` 符号覆盖，无原版皮肤。支持 Shift + 右键丢弃和左键拾回；剩余数量、实体身份、地面位置及食用后的玩家属性随 `c_save()` 保存恢复。当前按新鲜食物的基础数值结算，尚未接入腐败、调味和角色专属食物加成。

`c_give("seeds", 10)` 获取种子，`c_spawn("seeds")` 在玩家脚下生成可拾取的原版地面种子（`anim/seeds.zip`，bank/build `seeds`，`idle`；物品图标来自 `images/inventoryimages.xml`）。Shift + 右键丢弃、左键拾回；右键物品栏种子播放 `quick_eat_pre → quick_eat`，第 12 帧消耗一粒并增加 4.6875 饥饿，上限 150，健康和理智不变。左键物品栏种子选中种植，鼠标跟随原版种子图标及剩余数量，种子仍保留在原槽；左键耕地机完成后农田 tile 上的完整坑（`farm_soil`）自动走近，在 `pickup → pickup_pst` 的第 6 帧消耗一粒，替换为原版 `farm_plant_randomseed`（`anim/farm_soil.zip` 的 `sow → sow_idle`）。正在耕地的坑、破损坑和空地不可种植；移动、跳跃、Esc、点击空地或切换物品取消未提交的操作，失败不消耗种子。`c_spawn("farm_plant_randomseed")` 直接生成播种后的外观；地面种子及已播种实体的 ID、位置和数量随 `c_save()` 保存并恢复。本次仅实现种子地面美术、进食和坑内播种，播种后保持种子阶段。

`veggies.lua` 的静态内容：`c_give("<id>", n)` / `c_spawn("<id>")` 支持 20 种蔬菜的生/熟形态（`carrot`、`corn`、`pumpkin`、`eggplant`、`durian`、`pomegranate`、`dragonfruit`、`watermelon`、`tomato`、`potato`、`asparagus`、`onion`、`garlic`、`pepper`、`cave_banana`、`berries`、`berries_juicy`、`fig`、`cactus_meat`、`kelp`，熟食加 `_cooked`）、`kelp_dried`，以及 14 种 `<name>_seeds`（`carrot_seeds`、`corn_seeds`、`pumpkin_seeds`、`eggplant_seeds`、`durian_seeds`、`pomegranate_seeds`、`dragonfruit_seeds`、`watermelon_seeds`、`tomato_seeds`、`potato_seeds`、`asparagus_seeds`、`onion_seeds`、`garlic_seeds`、`pepper_seeds`）。地面美术、图标、饥饿/生命/理智、腐败时间和堆叠上限均按 `veggies.lua` 与 `tuning.lua`；`pumpkin`、`eggplant`、`durian`、`watermelon` 生品堆叠 20，其余 40；万圣节的南瓜保鲜加成不启用。种子用 `farm_plant_seeds` 的同名 clip，左键选中后点击完整的耕地坑，行为与普通种子相同：第 6 帧消耗一粒，替换为 `farm_plant_<name>` 的种子阶段（`grow_seed → crop_seed`，底部覆盖 `farm_soil` 的 `soil01`），`c_spawn("farm_plant_<name>")` 可直接生成，随 `c_save()` 保存恢复。**未实现**：植物生长、巨型作物（`*_oversized*`，需重物携带）、胡萝卜旋转、晾晒/烹饪、海钓饵、月亮变异、西瓜降温、胡萝卜/海带修补。


矮星与极光可分别用 `c_give("yellowstaff")`、`c_give("opalstaff")` 获取法杖后施放，寿命分别为 24 分钟、16 分钟。法杖装备到手部后右键地面，通用 `spellcaster` 通过 `castonpoint` / `castonpointwater` 标签提供 `CASTSPELL`；原版距离 20 单位换算为 60 场景单位，超出距离时先走近。黄法杖满耐久 20 次，蓝法杖 50 次；`staff_pre → staff` 第 13 帧播放法杖配置的 `staffteleport`，第 53 帧同步生成星体、扣一次耐久与 20 理智，第 69 帧恢复世界输入和移动。提前取消、替换装备或落点无效时不生成、不消耗；最后一次使用通过库存移除法杖并播放宝石碎裂声。UI 显示剩余耐久比例；`c_save()` 保留法杖实体 ID、数量、皮肤、剩余次数、玩家理智和星体位置／寿命，旧存档缺省剩余次数按满耐久加载。玩家位置每帧读取一次，所有星体共享该位置进行 XZ 距离判断。玩家在星体地面 XZ 距离 10 格（120 场景单位）内时，每 60 个有效游戏帧结算一次寿命，按累计实际 `dt` 扣减；附近的动画和光照脉动仍逐帧更新。远离时结算不足 60 帧的部分，将星体移出场景，销毁独立动画模型的网格并停止、断开音源，仅保留位置、实体 ID 和寿命等逻辑状态；同类星体共享的纹理和材质由管理器缓存，退出时统一释放。寿命按游戏时间继续流逝；再次靠近时先统一补算，已过期的直接清除逻辑状态，未过期的在原位置重建待机模型和独立循环音效，不重播出现动画或音效。`c_save()` 会补算所有星体（包括远处星体），保存实体 ID、位置和最新剩余时间，过期星体不写入存档；读档不重播出现音效。游戏暂停期间不扣寿命。

`c_give("greenstaff", count)` 获取拆解魔杖，`count` 可省略（默认 1），每把占一格；`c_spawn("greenstaff")` 生成地面魔杖。装备到手部后右键有可拆解配方的地面物品或已支持的动画建筑，超出 60 场景单位时先走近。使用原版 `staff_pre → staff` 动画和绿色施法光，第 53 帧拆解，成功后消耗一次耐久与 20 理智，满耐久为 5 次；最后一次使用移除法杖并播放宝石碎裂声。Esc、换装、目标被拾取或移除会阻止未提交的拆解，不扣耐久或理智。材料按目标剩余耐久比例、配方产量向上取整，每种非零材料至少返还 1 个；普通宝石不返还，彩虹宝石属于例外。拆堆目标只移除一件，容器物品与已烹饪完成的料理先掉落。

可用 `c_spawn("opalstaff")` 生成极光法杖作为拆解目标；满耐久拆解返还 4 个噩梦燃料、2 个活木和 1 个彩虹宝石 `opalpreciousgem`。彩虹宝石支持 `c_spawn("opalpreciousgem")` 和 `c_give("opalpreciousgem", count)`，地面使用 `gems.zip` 的 `opalgem_idle`，库存使用其实际 atlas。绿法杖支持原版 `greenstaff_an`、`greenstaff_clockwork`、`greenstaff_planet` 三款皮肤，通过清洁扫把换肤，地面、库存与手持外观分别使用源资源。`c_save()` 无新增参数，导出并恢复法杖实体 ID、数量、皮肤、剩余次数与理智，以及掉落材料的实体 ID、数量和位置；拆解的目标不再保存。旧存档缺省剩余次数时按满耐久加载。

`c_give("nightmarefuel", count)` 获取噩梦燃料，`count` 可省略（默认 1）；Shift + 右键物品槽可丢到地面，也可通过绿法杖拆解获得。地面使用 `anim/nightmarefuel.zip` 的 `idle_loop`，保留源 `SetMultColour(1, 1, 1, 0.5)`（纹理 alpha 再乘以 0.5）与 `UsePointFiltering(true)`，呈半透明黑烟；库存图标使用独立 atlas，不套用地面透明度。数量、实体 ID 与位置照常随 `c_save()` 恢复，透明度及采样设置由源资源目录重建。命令语法、参数与支持 ID 保持不变。

`c_give("book_silviculture")` 获取《应用造林学》，`c_spawn("book_silviculture")` 在玩家脚点生成地面书本；每格只放一本，满耐久 5 次。玩家按需求带有 `reader` 组件与标签，右键物品栏中的书执行原版 `READ`（`componentactions.lua` 的 INVENTORY `book` 动作）：`book` 状态播放 `player_actions_uniqueitem.zip` 的 `action_uniqueitem_pre` 并生成 `book_fx`，`book2` 播放 `book`，`book_open` / `book_closed` 覆盖为 `swap_books.zip` 的 `book_silviculture_open/closed`（皮肤 `book_silviculture_livinglog` 使用皮肤 build），根须特效 `fx_books.zip:roots` 跟随 `swap_book_fx_under`。声音按源时间线：第 17 帧 `wickerbottom_rework/book_spells/silviculture`（两层），第 19 帧翻页 `use_book_light`，第 50 帧 `book_spell` 并提交，第 51 帧合书 `use_book_close`。提交时以玩家为中心 30 单位（90 场景单位）查找带 `silviculture/tree` 等标签、已被采摘的植物，其中一株立即完成再生，其余在 `1 - 1/(n+1)` 秒内随机完成；成功扣 1 次耐久与 33 理智，最后一次使用移除书本。范围内没有可催生的植物时返回 `NOSILVICULTURE`，`book_fx` 播放失败动画和 `book_spells/fail`，不扣耐久或理智。第 50 帧移除 `busy` 前移动被阻止，之后移动或跳跃会结束状态；选槽、右键其他物品、制作或表情与进食一样随时取消阅读。退出时未播放的层音效取消，已在播放的降为一半音量。可用 `c_spawn("grass")` 后采摘草丛来验证催生。`c_save()` 保存书本实体 ID、皮肤、剩余次数与地面位置，读档恢复。当前项目只有草丛具备 `pickable` 催生分支；树木、作物、蘑菇农场和树精分支，以及 `talker` 的失败台词、`aspiring_bookworm` 浏览、骑乘和书架尚未接入；书本作为燃料的 `fuel` 组件也未接入（项目尚无燃料添加动作）。

### c_spawn 支持的对象

通过 `c_give` 获取工具或放置物品后，动作切换由共享的 `action:begin` / `action:interrupt` 事件通知各模块取消自身工作；选槽、制作和表情轮保留各自的打断范围。开始事件排除发起者，异步加载被打断后不再提交旧动作；`PICK` 在请求动作时发送开始事件，走近和资源准备均受同一取消机制管理。事件与清理规则见 [库存与动作接线](docs/inventory-architecture.md)。

`c_spawn("flower_cave")`、`c_spawn("flower_cave_double")`、`c_spawn("flower_cave_triple")` 生成单头、双头和三头灯草。按 Lua 的 `plant` / `pickable` 标签提供通用左键 `PICK` 动作；燃烧（`fire`）或 `intense` 状态不可采集。采集分别获得 1、2、3 个 `lightbulb`，灯草立即熄灭并播放 `picking` → `picked`；再生时间分别为 1440、2160、2880 游戏秒，再生后恢复 `pickable` 标签并开始充能。提交前取消或资源准备失败时保留灯草状态；库存满时产物通过共享 `GiveItem` 路径落地，采摘仍成功。`c_save()` 保存实体 ID、位置、外观变体、光照状态与采集后的剩余再生时间，读档后恢复相应标签和计时。

`c_spawn("wormhole")` 在玩家当前位置生成虫洞，使用原版 `anim/teleporter_worm.zip` 的 bank `teleporter_worm` 和 `anim/teleporter_worm_build.zip` 的 build `teleporter_worm_build`。玩家进入 12 个场景单位内（原版 4 单位）播放 `open_pre` → `open_loop`，超过 15 个场景单位（原版 5 单位）播放 `open_pst` → `idle_loop`；距离只计算地面 XZ 平面。开口第 10 帧切入地面背景层，闭合第 4 帧恢复以地面原点排序的世界层，所有状态保持原版 billboard 朝向。用 `c_give("reskin_tool")` 获取清洁扫把并装备到手部，右键虫洞按 `wormhole_claw`、`wormhole_fantasy`、`wormhole_gothic`、`wormhole_lureplant`、`wormhole_spider`、`wormhole_worm` 顺序换肤，再回到默认外观；资源为原版 `anim/dynamic/wormhole_*.zip` / `.dyn`。换肤保留实体 ID、位置和当前动画进度；位置、实体 ID 和皮肤随 `c_save()` 保存，读档后根据玩家距离重新决定开闭。虫洞属于场景实体，通过 `c_spawn` 生成；当前不包含传送、配对、物品投喂或虫洞音效。

`c_spawn("multiplayer_portal_moonrock")` 在玩家当前位置生成月岩多人传送门，使用原版 `anim/portal_moonrock.zip` 的 bank `portal_moonrock_dst` 和 build `portal_moonrock`，`light`、`portalbg`、`spiralfx1` 符号覆盖自 `anim/portal_stone.zip`；FX 子实体隐藏 `portal` 层并覆盖 `FX_ray1`。循环播放 `idle_loop` 待机动画；每圈动画为 60 帧 / 2 秒，在第 0 帧（进入待机或循环回到起点）和第 30 帧各播放一次 `spawnportal_jacob` 鸟叫声；音效跟随动画实际跨过的帧触发，丢帧或大时间步进也不会使用独立计时器提前播放，移除实体时停止最近一次鸟叫。月岩传送门无环境循环音效（Lua `idle_loop = nil`）。位置和实体 ID 随 `c_save()` 保存，下载的存档加载后会恢复传送门及其 FX 子实体。当前仅实现外观与音效，不包含建造系统、月球商人或玩家传送。

用 `c_spawn("wall_stone")`、`c_spawn("wall_wood")`、`c_spawn("wall_hay")`、`c_spawn("wall_ruins")`、`c_spawn("wall_moonrock")` 或 `c_spawn("wall_dreadstone")` 生成建成墙；`wall_*_item` 别名仍生成建成墙。`c_give("wall_stone_item", 10)` 等命令获取可放置的墙物品，库存图标、掉落地面的 `idle` 动画与建成墙的 `half` 外观分别使用各自原版资源。装备 `c_give("reskin_tool")` 获取的清洁扫把，右键建成墙可按下表循环换肤，最后回到默认外观；原有地面墙物品也可换肤。放置带皮肤的墙物品会映射到对应的建成墙皮肤，保留正面/斜面随相机朝向切换、受击动画和绝望石墙的红色覆盖层。换肤保留实体 ID、地面落点及已保存的健康状态；建成墙皮肤随 `c_save()` 保存并恢复，旧的无皮肤墙存档仍可加载。档案馆墙 `wall_stone_2` / `wall_ruins_2` 和废料墙 `wall_scrap` 没有原版皮肤，不提供换肤。

墙按 `prefabs/walls.lua` 拥有 `health` 与 `combat` 组件：最大生命为草墙 100、木墙 200、石墙与档案馆石墙 400、铥矿墙 800、月岩墙 600、绝望石墙 800、废料墙 600，新建成的墙以一半生命开始；月岩墙、绝望石墙和废料墙按 `SetAbsorptionAmountFromPlayer(.25)` 减免 25% 玩家伤害。外观由生命 signal 派生：≤0 `broken`、≤40% `onequarter`、≤50% `half`（原有静态图）、<99% `threequarter`、满血按世界坐标稳定选择 `fullA` / `fullB` / `fullC`；受击播放对应的 `*_hit` 再停在该姿态，同时播放材质的 `destroy_*` 音效。生命为 0 的墙显示破损外观，不再是攻击目标，但仍可锤毁（按 0 生命掉落 1 份材料）。墙的当前生命随换肤保留，并以 `health: { current, maximum }` 随 `c_save()` 保存恢复；旧存档缺少该字段时按一半生命加载。

按 F 攻击附近的敌对目标，按住 Ctrl + F 强制攻击：墙不是敌对目标，只能强制攻击（游戏会拦截浏览器的 Ctrl+F 查找）。按 `playercontroller.lua:GetAttackTarget` 在攻击距离外加 6 个单位的范围内选最近的可攻击目标，自动走到攻击距离内，按 `SGwilson.lua` 的 attack 状态出手并在第 8 帧结算：空手为 `punch` 和 `attack_whoosh`、伤害 `UNARMED_DAMAGE = 10`、冷却 24 帧；武器为 `atk_pre → atk` 和 `attack_weapon`（暗夜剑为 `attack_nightsword`）、冷却 13 帧；提灯（`light`）、清洁扫把与各法杖（`nopunch`）使用武器动作但造成空手伤害。武器伤害取源码 `weapon` 组件：火把、锤子、铲子、草叉、园艺锄 17，鹤嘴锄 27.2，捕虫网 4.25，暗夜剑 68；攻击按 `attackwear` 消耗有耐久的工具（捕虫网 3 次，金色工具 0.25 次，暗夜剑新增原版 100 次耐久）。最小攻击间隔为 `WILSON_ATTACK_PERIOD = 0.4` 秒，按住 F 会在每次攻击的冷却结束后连续攻击；移动、Esc 或鼠标点击取消尚未出手的攻击。修理墙、墙体碰撞与寻路、火把点燃可燃墙及生物战斗尚未实现。

| 建成墙 prefab_id | 皮肤循环顺序 |
| --- | --- |
| `wall_stone` | `wall_stone_an`、`wall_stone_ancient`、`wall_stone_ancient_alt`、`wall_stone_gothic`、`wall_stone_rose`、`wall_stone_shell`、`wall_stone_victorian` |
| `wall_wood` | `wall_wood_ornate` |
| `wall_hay` | `wall_hay_corn` |
| `wall_ruins` | `wall_ruins_thulecite`、`wall_ruins_thulecite2`、`wall_ruins_thulecite2_alt`、`wall_ruins_thulecite_alt`、`wall_ruins_victorian` |
| `wall_moonrock` | `wall_moonrock_victorian` |
| `wall_dreadstone` | `wall_dreadstone_relic` |

`c_spawn("grass")` 无额外参数，在玩家当前位置生成原生草丛，使用原版 `grass.lua` 的 bank `grass`（`anim/grass.zip`）与 build `grass1`（`anim/grass1.zip`），循环播放 84 帧 `idle`。左键通过通用 `PICK` 动作走近并执行采摘，普通角色默认 1 秒后提交，获得 1 个 `cutgrass`；成功后播放 `picking → picked` 和原版采摘声，库存无法容纳的产物落在玩家脚点。基础再生为 1440 游戏秒，春季登记任务时乘 0.75（1080 秒）；冬季暂停已有再生任务，但成熟草丛仍可采摘，冬季采下的草在恢复生长时才登记任务。离开冬季按 Lua `Resume()` 对剩余时间应用当时的春季倍率；暂停游戏不推进再生。到期同步恢复 `pickable` 标签并播放 `grow → idle`。原生草丛不会因采摘消耗移植后的 20 次额度。可用 `c_give("cutgrass", 2)` 获取草材料；`c_save()` 无参数，保存并恢复草丛 ID、脚点、采摘／暂停状态和剩余再生时间，以及产物 ID、数量和位置；读档重建 timer 截止时间，不重播采摘／生长过渡。旧存档的空组件草丛恢复为成熟状态。装备 `shovel` / `goldenshovel` 后右键草丛，在 `shovel_loop` 第 15 帧提交 `DIG`：成熟草丛掉落 1 个 `cutgrass` 和 1 个 `dug_grass`，已采摘草丛只掉落 1 个 `dug_grass`，随后移除草丛并取消再生任务。产物按原版 loot fling 向外散落，成功挖掘才消耗耐久。装备 `torch` 后右键“点燃”，燃烧 20 游戏秒后在原脚点生成 1 个 `ash` 并移除草丛；燃烧期间不可采摘且不写入存档，熄灭后恢复可保存状态及已有再生进度。燃烧、闷烧和传播使用组件 timer signal。`c_spawn("dug_grass")` 生成草簇地面物品，`c_give("dug_grass", 2)` 给予草簇，每叠最多 10 个；产物身份、数量、位置与铲子耐久均可通过 `c_save()` 保存恢复。重新栽种、施肥、夏季枯萎和变色蜥蜴转换尚未接入，详见 [timer signal 与派生状态](docs/dst-event.md)。

`c_spawn("sapling")` 和 `c_spawn("sapling_moon")` 在玩家当前位置生成树苗，分别使用原版 `anim/sapling.zip` 与 `anim/sapling_moon.zip` 中与 prefab 同名的 bank 和 build，按 `sapling.lua` 从随机帧开始循环播放 80 帧 `sway`。树苗与草丛共用 `packages/prefab/src/pickablePlant.ts` 的组件实现，只在 prefab 定义上不同：左键通用 `PICK` 获得 1 个 `twigs` 并播放 `picked`（玩家采摘不播放 `picksound`，该字段只由 WX-78 状态图读取）；再生为 `TUNING.SAPLING_REGROW_TIME` 1920 游戏秒，春季登记任务时乘 0.75，冬季暂停，到期播放 `grow → sway`。装备 `shovel` / `goldenshovel` 右键 `DIG`：成熟树苗掉落 `twigs` 和 `dug_sapling`（月亮树苗为 `dug_sapling_moon`），已采摘的只掉落挖起的树苗。装备 `torch` 右键“点燃”，燃烧 20 游戏秒后生成 1 个 `ash` 并移除，燃烧期间不可采摘也不写入存档。`c_save()` 保存树苗 ID、脚点、采摘／暂停状态和剩余再生时间，读档按 `Pickable:OnLoad` 直接显示 `empty`；旧存档的空组件树苗恢复为成熟状态。`c_give("dug_sapling", 2)` / `c_give("dug_sapling_moon")` 给予挖起的树苗，每叠最多 10 个，`c_spawn("dug_sapling")` / `c_spawn("dug_sapling_moon")` 生成地面物品（`dropped` 姿态，库存图标分别来自 `inventoryimages.xml` / `inventoryimages2.xml`），也可点燃。已采摘的树苗带 `silviculture` 标签，可被《应用造林学》催生。重新栽种、枯萎和万圣节月亮转换尚未接入。

`c_spawn("pond")` 在玩家当前位置生成池塘，使用原版 `anim/marsh_tile.zip` 的 bank/build `marsh_tile` 和循环 `idle` 动画，贴图平铺在地面上并绘制在角色下方。当前仅实现池塘外观，不包含交互、碰撞、鱼蛙生成、岸边植物或季节变化；位置随 `c_save()` 保存并在加载时恢复。

`c_spawn("nightmaregrowth")` 在玩家当前位置生成梦魇疯长，使用原版 `anim/nightmaregrowth.zip` 的 bank/build `nightmaregrowth`：主体显示 `idle`，地面裂纹显示 `crack_idle` 并随机旋转。当前仅实现外观；位置和裂纹朝向随 `c_save()` 保存并在加载时恢复。

| 类型 | prefab_id |
| --- | --- |
| 建筑 | `cookpot`、`firepit`、`icebox`、`treasurechest`、`tent`、`moonbase`、`wardrobe`、`dragonflychest`、`campfire`、`saltbox`、`nightlight`、`pighouse`、`sculptingtable`、`mushroom_light`、`mushroom_light2` |
| 科技建筑 | `researchlab`、`researchlab2`、`researchlab3`、`researchlab4` |
| 墙 | `wall_stone`、`wall_stone_2`、`wall_wood`、`wall_hay`、`wall_ruins`、`wall_ruins_2`、`wall_moonrock`、`wall_dreadstone`、`wall_scrap`，以及各自的 `wall_*_item`（两种 ID 均生成建成的墙） |
| 洞穴植物 | `flower_cave`、`flower_cave_double`、`flower_cave_triple` |
| 光照星体 | `stafflight`、`staffcoldlight` |
| 岩石 | `rock1`、`rock2`、`rock_flintless`、`rock_flintless_med`、`rock_flintless_low` |
| 草丛 | `grass` |
| 树苗 | `sapling`、`sapling_moon` |
| 池塘 | `pond` |
| 场景装饰 | `nightmaregrowth`、`wormhole`、`multiplayer_portal_moonrock` |
| 耕地机及耕地装饰 | `farm_plow`、`farm_plow_item`（未部署物品）、`farm_soil`、`farm_soil_debris`、`farm_plant_randomseed`、`farm_plant_<carrot|corn|pumpkin|eggplant|durian|pomegranate|dragonfruit|watermelon|tomato|potato|asparagus|onion|garlic|pepper>`（播种后外观） |
| 种子地面物品 | `seeds`、`<veggie>_seeds` |
| 蘑菇地面物品 | `red_cap`、`red_cap_cooked`、`green_cap`、`green_cap_cooked`、`blue_cap`、`blue_cap_cooked` |
| 腐烂物 | `spoiled_food` |
| 料理地面物品 | `meatballs`、`bananajuice`、`bananapop` |
| 手部工具地面物品 | `torch`、`lantern`、`hammer`、`bugnet`、`pickaxe`、`goldenpickaxe`、`axe`、`goldenaxe`、`moonglassaxe`、`reskin_tool`、`greenstaff`、`opalstaff` |
| 武器地面物品 | `nightsword` |
| 书本地面物品 | `book_silviculture` |
| 彩虹宝石地面物品 | `opalpreciousgem` |
| 墙体拆除材料 | `dreadstone`、`wagpunk_bits` |
| 石材地面物品 | `cutstone`、`marble`、`moonrocknugget` |
| 月树花 | `moon_tree_blossom` |
| 可燃材料、草簇及灰烬 | `cutgrass`、`log`、`dug_grass`、`dug_sapling`、`dug_sapling_moon`、`ash` |
| 园艺锄地面物品 | `farm_hoe`、`golden_farm_hoe` |
| 铲子地面物品 | `shovel`、`goldenshovel` |
| 可拾取家具及唱片 | `phonograph`、`record` |
| 生物 | `fireflies`、`beefalo`、`bernie_inactive`（地面形态由理智决定） |

`c_give` 可用的物品 ID 由 [src/inventoryItems.ts](src/inventoryItems.ts) 汇总的物品定义决定；命令解析见 [src/debugCommands.ts](src/debugCommands.ts)，场景与存档共享 [src/prefabDefinitions.ts](src/prefabDefinitions.ts) 的 prefab 注册定义，统一声明持久化 ID、`c_spawn` ID/别名及组件校验规则；[src/sceneEntities.ts](src/sceneEntities.ts) 将创建、恢复、导出、更新和销毁绑定到同一份定义，由 [src/entityRegistry.ts](src/entityRegistry.ts) 调度。新增 prefab 无需再维护存档 ID 白名单；启动时会检查共享定义是否都已绑定场景处理函数。`c_spawn` 的支持 ID 来自定义的 `debugSpawnIds`，落点规则由对应创建函数决定。

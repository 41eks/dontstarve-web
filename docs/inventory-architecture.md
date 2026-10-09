# 物品栏架构与交互

开发约束见 [AGENTS.md](../AGENTS.md)。本文介绍当前状态来源、UI 事件和游戏行为；物品图标与地面 art 的具体资产见 [DST 物品资产](dst-item-assets.md)。

## 状态与模块职责

| 模块 | 职责 |
| --- | --- |
| `packages/inventory` | 权威库存状态、领域类型、槽位、堆叠限制与原子操作 |
| `packages/signals` | UI、库存与 prefab 共用的 signal、effect 与订阅原语，不依赖 DOM |
| `src/inventoryItems.ts` | 合并库存显示元数据、帽子元数据、皮肤及领域限制，提供应用层物品规格与覆盖 |
| `src/inventory.ts` | 创建玩家的 15 个物品槽和 `hand`、`body`、`head` 三个装备槽，组合为 `InventoryStore` |
| `packages/ui/src/inventory-bar.ts` | 根据应用传入的状态显示物品与装备槽，发出交互事件 |
| `packages/ui/src/chest-inventory-panel.ts` | 控制建筑容器面板开关和屏幕定位；相机、画布及玩家对象由应用注入，`main.ts` 注册逐帧 `update()` |
| `src/main.ts` | 将 store 通知同步到 UI，将 UI 事件转为库存操作或游戏动作 |

`InventorySlot`、`HandSlot`、`BodySlot`、`HeadSlot` 各自实现具体槽位行为，不共享实现父类。`InventorySlot` 提供物品堆叠上限；纯函数 `craft()` 根据配方输入及槽位计算新库存结果，`InventoryStore` 原子提交。

应用中的 `createInventoryStore()` 默认建立空玩家槽位；`src/main.ts` 从 `src/save/initialSave.ts` 读取的 `public/saves/initial-world.json` 恢复库存，通过 `inventoryStateFromSave()` 和 `replaceState()` 应用。初始物品不再硬编码在 `src/inventoryItems.ts` 中。存档设计见 [存档文档](dst-save-system.md)。

玩家槽位由 Store 通知驱动 UI 的 `setSlot()` 更新，背包容器通过 DTO signal 驱动相同 UI 槽位模型；这些模型都是显示镜像。槽位地址使用稳定的 `{ containerId, slotKey }`，玩家槽位通过 `inventorySlotAddress()`、`equipmentSlotAddress()` 创建，其他容器使用其对应地址助手。

## 物品实体与归属

实现参考源 Lua 的 `components/inventory.lua:GiveItem/Equip/RemoveItem/DropItem`、`components/inventoryitem.lua:OnPutInInventory/OnDropped` 和 `components/stackable.lua:Get/Put`。库存槽和装备槽持有同一个 `inst`；进入库存时设置 owner、移出场景，丢弃时清除 owner、返回场景。整叠移动保留实体，拆出部分才生成新实体；合堆保留接收方实体，完全合入的实体被移除。

`packages/inventory/src/entity.ts` 的 `ItemEntity` 保存稳定 ID、prefab、skin、transform、stackable/fueled/finiteuses 状态、inventoryitem owner 和运行时组件。各具体槽位直接保存实体引用，`getEntity()` 返回引用，`get()` 返回用于 UI 与领域计算的独立快照。`InventoryStack` 是快照类型，不再是槽位中的另一份可变权威状态。`ItemEntityRegistry` 由库存和 `GroundItemManager` 共用。

`InventoryStore.transfer()` 从源实体取得完整状态，验证后原子提交；整件转移使用同一个引用。`extract()` 交出整件原实体或创建部分堆叠的新实体，`receive()` 接收地面的实体并按需合堆。空间不足、目标不接受或源实体已被替换时不改变归属。消耗和移除仍由 store 提交，entity 的 owner 回调检查槽位是否还持有自己，避免旧实体影响替代物。制造仍先使用纯函数计算快照，提交时复用剩余材料的实体并为新产品创建实体。

地面模型属于实体的表现资源。拾取移除模型，换肤替换模型，但保留实体；火把的运行时组件也保留。其他已有 prefab 的模型专用控制器仍由各自 factory 管理。`exportState()` 在结算组件后导出含 `entityId` 的快照；地面实体继续使用记录的 `id`。旧库存存档缺少 ID 时在加载时分配，后续保存保持稳定；读取拒绝重复物品 ID 以及与世界实体冲突的 ID。

## 每个背包的容器

源 Lua `prefabs/backpack.lua` 为每个背包添加 `container`，装备时 `Open(owner)`，卸下时 `Close(owner)`；`components/inventory.lua:GetOverflowContainer()` 返回当前 BODY 装备的容器。`inventory:OnSave()` 保存装备实体的 `GetSaveRecord()`，`container:OnSave()` 再保存其中各物品的记录，所以地面上的多个背包各自保留内容。`inventoryitem.cangoincontainer = false` 禁止把背包放进其他容器。

`packages/componets/src/container.ts` 的 `Container` 对应 Lua `components/container.lua`，负责 `SetNumSlots`、槽位查询、`Open/Close`、打开者集合和 `OnSave/OnLoad`；保存只包含物品，打开者不持久化。组件通过注入槽位和物品加载函数保持独立，不依赖具体物品或 UI。Lua 方法和 `OnSave().items` 使用一基槽号，`ItemEntity` 在存档边界转换为项目的零基 `slotKey`。

`ItemEntity.components.container` 持有实际 `Container` 实例，`container.slots` 持有该背包的 8 个 `StorageSlot`，Store 将同一批槽位注册到 `backpackSlotAddress(entityId, index)`，容器 ID 为 `item:backpack:<entityId>`。Store 在装备提交后对当前背包调用 `Open(store)`、对旧背包调用 `Close(store)`，只有当前可打开的背包材料可访问；面板根据身体装备 signal 的实体 ID 切换，关闭的背包仍持有内容。整件转移、丢弃、拾取、换肤都保留父子实体。`exportState()` 只导出玩家与建筑的顶层槽，背包内容通过该物品的 `container: { slotCount, slots }` 快照嵌套保存；地面 `components.stack.container` 使用相同结构，避免重复保存子物品。读档验证子槽范围、数量、皮肤、组件状态和全局身份唯一性，再重建容器。旧共享 `player:backpack` 只迁移到已装备的背包或唯一候选；非空且归属不明时拒绝加载。

## 容器 DTO 与 UI signal

玩家物品栏的权威 `InventorySlot` 保存 `ItemEntity`，Store 提交后由应用调用 UI 的 `setSlot()`。UI 的 `createSlotContainer()` / `createSlot()` 持有显示用 signal，`createSlotRenderer()` 通过 effect 更新 DOM。容器面板复用这套槽位模型、渲染器和输入事件。

`Container.toDTO()` 返回纯显示快照 `{ slotCount, slots }`，`slots` 是零基数组，空格保留为 `null`，物品仅包含快照字段，不携带实体、owner 或控制器。`toSignal()` 延迟创建并复用该 DTO 的只读 signal，UI 用 `peek()` 初始化并订阅变化；它不提供 `set()`，也不参与存档。`SetNumSlots()`、`OnLoad()` 和释放组件在完整更新后发布 DTO；已注册槽位的转移、数量和燃料等组件变化，由 Store 在事务提交后调用 `publishDTO()`，每个受影响容器只发布一次完整快照。直接操作底层槽位的调用方也需要在提交后发布。

`DstChestPanelElement.bindContainer(signal, toItem)` 接收 DTO signal，应用提供物品快照到 `SlotItem` 的元数据转换。面板仍调用现有 UI 槽位的 `setItem()`，数量、皮肤和耐久沿用共享 renderer；槽数改变时重建对应 UI 槽位。关闭、换容器和移除面板时取消旧订阅。`main.ts` 将装备背包的 `container.toSignal()` 交给面板，玩家物品栏和容器共用 `inventorySlotItem()` 的显示转换；背包内容刷新由 DTO signal 驱动，其他玩家槽仍使用原来的 Store 通知路径。

## 装备存在状态与表现

手部、头部、身体装备分别使用工厂创建的 `handEquipmentExistenceState`、`headEquipmentExistenceState`、`bodyEquipmentExistenceState`，非空值的 `EQUIPSLOTS` 分别为 `HANDS`、`HEAD`、`BODY`。每个 Store 默认创建独立实例，构造函数第五个参数接受可选的状态对象，例如 `{ headEquipmentExistenceState, bodyEquipmentExistenceState }`；`handEquipment`、`headEquipment`、`bodyEquipment` 为对应的只读接口。

每个装备槽位成功注册后，Store 在发布初始状态前自动建立该槽位唯一的清空监听，释放 Store 时统一取消。转移、提取、消耗或读档成功提交后，仅为被替换的装备槽发布新身份；普通组件变化或其他槽位更新不重新装备。主动清空 signal 表示移除对应槽位的当前物品，Store 核对旧实体身份后提交；普通卸下使用库存转移保留实体、皮肤和组件状态。

`src/playerEquipment.ts` 统一处理同步订阅、生命周期切换、重入和释放。`src/playerHandEquipment.ts`、`src/playerHeadEquipment.ts`、`src/playerBodyEquipment.ts` 注入各自存在状态并更新玩家表现。`main.ts` 在恢复存档前注册三种绑定，移除了 `syncHeadEquipment()`、`syncBodyEquipment()` 以及库存 UI 通知里的装备轮询；初始外观也由存档提交的 signal 写入驱动。帽子继续使用 `setHat()`，背包继续使用 `setBackpack()`；身体装备绑定同时通知应用打开或关闭背包面板、恢复储物格显示并更新材料可访问性。玩家物品栏槽位同步仍由库存通知驱动，背包内容通过容器 DTO signal 同步。

## 火把燃料与百分比

源文件位于 DST 的 `databundles/scripts_unpacked/scripts/`：`prefabs/torch.lua` 初始化 `fueled`，装备时点燃、卸下时熄灭；`components/burnable.lua` 的点燃/熄灭分别调用 `StartConsuming()` / `StopConsuming()`。`tuning.lua` 定义 `TORCH_FUEL = night_time * 1.25`，默认夜晚为 `30 * 2` 秒，因此满燃料为 75 秒。普通丢弃不点燃；投掷是独立的 `IgniteTossed()` 路径。

`components/fueled.lua` 以 `currentfuel / maxfuel` 计算比例，并发出 `percentusedchange`；`widgets/itemtile.lua` 初次刷新从 `fueled:GetPercent()` 读取比例，后续监听该事件，`SetPercent()` 用 `NUMBERFONT`、42 号字及位置 `(5, -17)` 在物品图标下方显示百分比。显示为四舍五入的整数，`0 < percent * 100 < 1` 时强制显示 `1%`；普通燃料耐久使用文字，腐败度另由 `SetPerishPercent()` 显示背景动画。

本项目的 `InventoryItemSpec.maxFuel` 保存满燃料秒数，`ItemEntity.components.fueled.remaining` 保存每把火把的实际剩余秒数，快照以 `InventoryStack.remainingFuel` 序列化；缺省表示满燃料，兼容旧存档与新制造物品。燃烧生命周期由 `packages/prefab/src/torch.ts` 的 `TorchController` 管理，`getTorchController(entity)` 为每个实体只创建一个控制器：`onequip(slotSignal)` 绑定具体槽位并调用 `ignite()`，`onunequip()` 停止燃烧并解除绑定，`extinguish()` 只停止燃烧，保留装备及燃料；`update()` 只在燃烧时扣减，并在耗尽时移除物品、熄灭照明。满燃料常量 `TORCH_FUEL` 也由该 prefab 提供。`onFrame(dt)` 每个燃烧帧仅累计帧数和秒数，每 60 帧才调用 `update()` 扣减全部累计秒数；`flushFuel()` 在停止生命周期、UI 手部转移、丢弃提交、换肤、拾取和保存前结算不足 60 帧的部分，防止燃料回升或丢失。

`packages/signals/src/handEquipment.ts` 提供 `createHandEquipmentExistenceState()` 工厂，不导出全局装备状态。每个 `InventoryStore` 默认创建独立的 `handEquipmentExistenceState`，也可通过构造函数第五个参数的 `{ handEquipmentExistenceState }` 对象注入；`InventoryStore.handEquipment` 是该实例的只读接口。应用通过 `bindPlayerHandEquipment({ handEquipmentExistenceState: inventory.handEquipmentExistenceState, ... })` 显式注入，再通过 `onequip(handEquipmentExistenceState)` 将具体槽位传给 torch。存在状态表示当前装备身份，燃烧和燃料由 prefab 与实体管理；Store 只订阅槽位清空，不监听所有 prefab 的动态状态。装备流为 UI / 命令 / 读档 → `InventoryStore` 完成提交 → 该库存的 signal 更新 → 旧 torch `onunequip()`、新 torch `onequip(handEquipmentExistenceState)`。该 signal 的 `HandEquipment` 对象引用代表一次装备实例，成功转移或同 prefab 替换会创建新引用；失败事务不发布变化。燃料及其他库存变化不重新发布手部状态，避免显式熄灭后自动重新装备。signal 的 `entity` 引用指向已提交的手部物品实例，不复制动态组件值；signal 对象表示一次装备关系，物品实体表示持续的物品身份。signal 不序列化，存档仍保存物品快照。读档从已恢复的手部实体建立运行时组件。

`HandEquipment` 要求公开字面量属性 `readonly EQUIPSLOTS: 'HANDS'`，共享 setter 同时做运行时校验；身体装备或缺少该属性的对象不能写入，失败不修改状态、不通知订阅者，`null` 仍可清空。torch 实现该结构类型，公开 `itemId = 'torch'` 与 `EQUIPSLOTS = 'HANDS'`；库存只为成功提交到手部槽的物品发布此属性，存档仍使用库存领域字段，不保存运行时槽位声明。

手部动作控制器接收只读 `InventoryStore.handEquipment`，在控制器内部判断工具 ID，不接收应用层的 `isEquipped()` 或过滤后的物品查询函数。镐、干草叉、铲子和园艺锄分别接受其普通／金制 ID；锤子、捕虫网和清洁扫把分别检查 `hammer`、`bugnet`、`reskin_tool`。法杖实体由 prefab 配置 `SpellCaster` 和 `castonpoint` / `castonpointwater` 标签；通用 `SpellCastActionController` 读取真实装备实体的组件与能力，法术函数按法杖自身 prefab 选择星体。施法输入不含法杖 ID 或星体管理器，取消只针对自己持有的 `BufferedAction`。控制器直接读取 signal 中的皮肤和实体身份，在卸装、实体替换（即使 ID 和皮肤相同）或换肤时同步取消旧动作，阻止已经排入时间线或正在异步预加载的旧动作提交。`packages/stategraphs/src/handEquipment.ts` 仅共享身份变化的订阅判断，不维护工具 ID 清单；同一实体、同一 ID 和同一皮肤的重新发布不触发取消。`dispose()` 或施法输入的返回清理函数释放装备订阅和输入监听，控制器从不修改注入的只读 signal。

主程序通过 `ActionWorldContext.registerFrameTask` 注入 `registerFrontTask()`，不逐帧遍历所有手部动作控制器。锤子、镐、干草叉、铲子、园艺锄、捕虫网和清洁扫把在内部通过 `bindHandEquipmentUpdate()` 按装备 signal 注册／移除自己的帧任务，只有当前匹配工具的控制器参加物理更新前的逐帧调度。构造时同步当前装备，支持读档后已装备的工具；同一身份重复发布不重复注册。卸装、替换或换肤时先移除旧任务并取消旧动作，再根据最新 signal 注册任务，`dispose()` 同时移除任务和订阅。法杖施法仍由输入事件及状态图时间线驱动，无需独立帧任务。未注入调度服务的独立宿主可显式调用控制器的 `update()`。

前置任务按本帧快照执行。注册函数返回的移除回调会同时停用任务包装函数，确保帧中换装不会执行已缓存的旧任务，也不会因数组变化跳过其他任务；新注册的任务从下一帧开始执行。

动作间的打断使用 `packages/signals/src/EventEmitter.ts` 的类型化同步事件。`src/view.ts` 创建玩家场景的 `actionEvents` 并通过 `ActionWorldContext` 注入；动作验证成功后发送 `action:begin`，包含动作类别与发起者 `owner`，其他订阅者先取消自己的工作，随后发起者设置新目标、动画或异步加载。`PICK` 在背包接收成功后才发送事件，失败时保留现有动作。选槽、右键物品、丢弃、制作和表情轮发送带原因的 `action:interrupt`；`packages/stategraphs/src/actionEvents.ts` 保留不同操作的打断范围，例如普通选槽不取消捕捉或建筑预览，表情轮打断全部交互并停止移动。控制器通过 `bindActionCancellation()` 订阅自身所属类别，跳过自己的开始事件，取消逻辑及加载版本校验仍由各模块管理。`main.ts` 不保留 `cancelHandTool`、`cancelNetCapture` 或动作控制器的逐项取消回调；控制器 `dispose()`、施法输入的清理函数与场景显式销毁释放事件订阅、输入监听和帧任务。

torch 的只读 `burning` signal 独立表示燃烧状态，`onequip()` 点燃时设为 `true`，卸下、释放或耗尽后设为 `false`。`onunequip()` 和 `dispose()` 不修改 `handEquipmentExistenceState`，切换装备时不会清掉新值。燃尽时停止燃烧并校验绑定 signal 仍包含自己的装备引用，再调用 `slotSignal.set(null)`。`InventoryStore` 在手部槽位成功注册后、发布初始状态前自动建立唯一的清空监听，包括构造时和后续 `registerSlots()` 注册；注册失败或仅注册其他槽位不会重复建立手部监听，应用无需手动绑定。监听核对旧 signal 的实体就是当前手部物品，原子清空槽位并清理实体，并随 Store 的 `dispose()` 释放；库存自身已完成的转移、空槽位和其他实体的请求跳过。普通 `extinguish()` 不改变装备 signal。未绑定槽位的地面火把不修改玩家状态；未耗尽的燃料保留在库存中。装备火把耗尽由 signal 清空请求触发库存移除；地面或没有库存 owner 的本地火把仍移除自己的实体。旧绑定已经被替换时，不清空新装备；旧物品通过自己的 owner 移除。`src/playerHandEquipment.ts` 先注册注入手部 signal 的 `subscribe()`，直接使用 signal 中的实体引用；随后 `InventoryStore.replaceState()` 从存档恢复库存并写入 signal，由该次写入触发生命周期和手持动画。订阅不回放当前值，也没有单独的初始同步。`packages/prefab/src/handEquipment.ts` 注册各手部 prefab 的手持外观、光标与生命周期工厂；torch 的装备工厂负责绑定控制器、声音位置及燃烧订阅。`main.ts` 只注入玩家表现接口、调度统一订阅器的帧更新和结算、初始化时显式抑制转移动画，并保留页面内显式释放接口；卸下不销毁实体上的控制器。同步订阅处理同一任务内的装备变化；生命周期回调导致嵌套转移时，先完成旧生命周期，再处理最新装备，避免重入时旧回调清理或覆盖新实例。UI 的 `createEffect()` 仍在微任务中合并刷新。页面内显式销毁装备绑定或库存时释放对应订阅；`pagehide` 不执行资源清理。手动 `set(null)` 移除手部物品；正常卸下使用库存转移，保留实体及状态。

inventory 负责权威状态和原子写入，`InventoryStore.setRemainingFuel()` 不决定燃烧或耗尽行为，也不写入零燃料的临时库存物品；玩家装备火把的耗尽路径通过 signal 请求清空，实际移除由库存订阅执行。应用将比例同步到 UI 的 `SlotItem.durabilityPercent`，共享 slot renderer 在物品、装备和储物槽中显示相同百分比。燃料字段随库存转移、地面掉落、换肤、拾取与存档保存保留；异步加载掉落美术时，原实体继续消耗燃料，实际提交丢弃时先结算再交接引用。

torch 的专用 ground factory 注册 `onputininventory` 和 `onextinguish`。只有库存接收成功后才执行 `OnPutInInventory()`：设置持有状态、恢复 `idle`、停止燃烧，播放玩家位置的熄灭声并释放地面音源。`OnExtinguish()` 只处理未持有、未耗尽且有火焰状态的地面火把，熄灭照明、播放地面位置的声音、恢复 `idle` 并按源 Lua 的随机速度弹起；持有或耗尽时走各自清理路径。弹跳的高度只影响 visual，脚点、存档位置与拾取使用地面坐标。两次回调不重复播放熄灭声，也不清除其他玩家装备。

`GroundItemVisual.setDefinition()` 将异步准备的模型绑定到最终提交的实体。torch factory 到 `ondropped/onload` 才绑定实体上的同一控制器；准备或取消换肤不修改控制器，提交前结算并保留燃烧状态，旧模型只释放自己的表现订阅和声音位置绑定。地面燃烧状态为可选 `components.torch = { lit: true }`，仅 torch 可携带；旧存档无该字段时保持未点燃。恢复 lit 的地面火把使用 `ignite(false)`，继续消耗燃料但不播放点燃音效。

## 耕地机 finiteuses 与部署快照

`ItemEntity.components.finiteuses` 由 `FiniteUsesComponent` 实现，库存从物品规格配置最大次数。`use(amount)` 在组件内扣减，剩余次数改变时通知当前 owner；耗尽通过 `entity.remove()` 交由库存 owner 原子移除，不发布零耐久库存快照，已移除实体不能消耗替代物品的耐久。

耕地机遵循 `prefabs/farm_plow.lua:item_ondeploy`：准备模型并检查落点后，应用通过 `InventoryStore.extract()` 交出原物品；prefab 调用 `finiteuses.use(1)`，保存仍有效物品的完整 `snapshot()`，再移除原物品实体。工作实体保存 `components.farmPlow.deployItem`，值为包含 `entityId/itemId/count` 与全部已支持组件状态的物品快照；最后一次使用耗尽或直接 `c_spawn("farm_plow")` 时为 `null`。

完成或被锤毁时，地面管理器从部署快照恢复新的运行时物品，沿用快照 ID 和剩余次数。返还模型异步准备期间，工作实体保留快照和可恢复的 `collapse` 阶段，成功加入地面后才移除工作实体，避免保存遗漏正在返还的物品。导出快照与运行时记录分离。读取旧存档的 `returnUses` 时转换为不带历史 ID 的物品快照；新存档只写 `deployItem`，读取器校验物品类型、数量、已消耗的耐久和身份唯一性。

## UI 事件与放置

| 事件 | 触发方式 | 应用处理 |
| --- | --- | --- |
| `game:slot-transfer-request` | 拖放，或点击拿起／放下鼠标物品 | 使用真实鼠标槽转移；点击占用槽时携带 `swapWith` 并原子交换，成功后触发对应装备动画 |
| `game:slot-select` | 点击选择槽位 | 在转移拾取之前运行；可放置物品通过 `preventDefault()` 接管点击并进入放置模式 |
| `game:slot-context-menu` | 右键槽位 | 根据物品与修饰键执行吃东西、装备或丢弃等动作 |

鼠标槽使用 `cursorSlotAddress()` 的稳定地址 `{ containerId: "player:cursor", slotKey: "0" }`，由应用注册一个 `InventorySlot`，权威实体仍归 `InventoryStore` 管理。左键拿起立即执行原槽到鼠标槽的整叠转移，UI 只订阅投影并绘制鼠标图标。点击空槽放下；点击占用槽使用 `InventoryStore.swap()` 原子交换鼠标与目标，目标原物品继续由鼠标持有。`completeTransfer()` 仅确认成功后记录来源地址并刷新投影；失败不清空鼠标槽。Esc 通过冒泡的 `game:cursor-return-request` 请求 `InventoryStore.returnCursor()`，优先完整放回来源槽，其次普通物品栏；没有可接受的完整空位时保持持有。鼠标槽不参与自动接收、制造产物分配或自动材料消耗，拖放继续使用直接移动和合堆。未持有物品时，可取消的 `game:slot-select` 仍先于转移请求执行，建造和播种可认领点击进入自己的动作预览。

唱片插入直接读取鼠标槽，移除专用 `selectedRecordSlot` 和唱片右键选择分支。插入前捕获实际实体与皮肤，提交前核对鼠标槽仍持有同一实体，并由库存事务扣除一张；异步加载或目标校验失败不会消耗物品。

`game:cursor-return-request` 携带可选的来源地址，请求归还鼠标槽内物品；这些事件均穿过 inventory bar 的 shadow root 冒泡。`game:slot-select` 可取消，使点击建筑物品时先启动放置，而不会先把整叠物品拿起来拖放。

网页屏蔽浏览器原生右键菜单，游戏使用自己的右键映射。

右键输入参考 `widgets/invslot.lua:OnControl()` → `DropItem()` / `UseItem()` → `components/inventory_replica.lua` 的职责边界：`SlotModel.item` 暴露只读 UI 投影 signal，renderer 将右键和修饰键写入 input signal，`bindSlotContextMenuInput()` 在每次输入时读取槽位投影并产生 `drop/use` 请求。`inventoryBar.contextMenu` 同步发布请求，应用订阅后核对实际物品实体、类型和皮肤，再调用库存和场景动作。输入使用同步 `subscribe()`，避免 effect 合并连续点击；槽位投影变化不触发操作，重新连接不重放旧请求。renderer 断开时释放输入订阅，场景显式停止时释放应用订阅。原有 `game:slot-context-menu` 事件及其 `{ slot, shiftKey }` detail 继续跨 shadow root 冒泡，网页的 Shift + 右键仍丢弃一个物品。

## 当前动作与动画

`packages/prefab/src/food.ts` 定义已接入食物的源 Lua 数值：种子为 4.6875 饥饿，香蕉奶昔为 8 生命、25 饥饿、33 理智。`bananajuice` 来自 `preparedfoods.lua:571`，数值分别为 `TUNING.HEALING_MEDSMALL`、`CALORIES_MED`、`SANITY_LARGE`；共享 `prefabs/preparedfoods.lua` 将这些数值装到 edible 组件，`fooddrink` 标签决定喝饮料动画。

`FoodActionController` 共用进食与种植的取消/预加载流程，原种子控制器已泛化为 `packages/stategraphs/src/food.ts`。应用从点击时的槽位捕获实际物品实体及皮肤；第 12 帧提交前再核对实体仍在原槽，库存扣除成功后才调用 `applyPlayerFoodEffects()`。生命与饥饿上限 150，理智通过 signal 限制到 200；直接修改同 ID 的另一实体不能让旧动作误消耗替代物。`SGwilson` 的 EAT 使用同一个 quickeat 时间线，根据 `foodDrink` 选择 `quick_drink_pre → quick_drink` 或 `quick_eat_pre → quick_eat`；饮料与进食动画均来自 `player_actions_eat.zip`，第 10 帧分别播放 sip / eat。预加载前后取消、动作取消或物品失效都不会产生食用效果。

右键 `meatballs` 调用 `WilsonAnimationController.playEat()`，播放 `anim/player_actions_eat.zip`；当前只播放动作，不消耗该堆物品。

手部拿出／收起动画集中在 `src/playerHandEquipment.ts`，从装备 signal 的前后状态派生：`null → 装备` 播放新物品的 `item_out`，`装备 → null` 播放旧物品的 `item_in`，更换装备实体播放新物品的 `item_out`。动画使用 `anim/player_actions_item.zip`，具体手持物品由 prefab 的手部定义解析；同一实体换肤或重复发布身份仅同步外观，不重复播放转移动画。

绑定器等待 `setCarryItem()` 完成美术加载后才播放动画，并核对表现请求版本及当前 signal；被后续换装、耗尽或销毁覆盖的异步完成不会播放旧动画。已移除的旧物品（包括燃料耗尽）不播放 `item_in`。初始化通过 `handEquipmentBinding.withoutTransitions(() => inventory.replaceState(...))` 保持生命周期和外观同步，抑制读档时的拿出／收起动画；失败的库存事务不会改变装备 signal，因此也不会触发动画。`src/main.ts` 只提交转移、报告结果和结算燃料，不再按转移方向选择动画。

Shift + 右键已占用的库存或装备槽，在玩家当前地面位置丢弃一个物品。帽子及注册的目录物品使用源动画/build，其他未注册物品回退到其库存图标。普通掉落物点击拾取成功后回到物品栏；专用生物 prefab 可定义不同捕获或交互行为。

成功丢弃或普通拾取都播放 `anim/player_actions_item.zip` 的 `pickup`。`packages/stategraphs/src/SGwilson.ts` 为 `pickup` 设置 `playbackRate: 0.5`，即源动画的一半速度。

地面模型的源原点是脚点，供排序、拾取与存档使用；不能因为图片较高或有多层部件而改用图片中心。

## 锅组件与烹饪请求

世界建筑的 container 在 prefab 初始化时建立，并注册其实际 slots 到 InventoryStore；读档阶段先注册的槽位通过 BindSlots() 交给同一个 container 使用，避免双份库存。容器 DTO signal 直接绑定面板，事务完成后发布投影。

Lua 链路是 containers.lua:buttoninfo.fn → ACTIONS.COOK.fn → stewer:StartCooking()。UI 只提交请求，按钮按容器满格状态启用；动作检查其他开启者与可烹饪状态，已在烹饪的重复请求不重新计时。stewer 从自己的 container 读取原料实体，经 cooking.CalculateRecipe() 得到产物和时间，在开始回调后关闭容器、销毁内容并禁止打开。DestroyContents() 通过实体的库存 owner 移除材料，UI 投影不参与权威消耗。

components/stewer.ts 管理烹饪任务、readytocook/donecooking 标签、原料与厨师记录及保存恢复；prefab/cook_pot.ts 将开始、继续、完成回调接到动画和声音，并按配方的 build、symbol 和 potlevel 显示锅中产物。外部存档仍保留 product/phase/remainingSeconds 的已有格式，新增可选 ingredient_prefabs 与 chef_id，旧存档可继续读取。目前的分支覆盖开始、完成和恢复，收获及锅内腐败另行实现。

建筑换肤的逻辑状态由 skinId signal 持有；prepareNextSkin() 准备美术，apply() 校验当前皮肤和交互状态后只 set()。表现订阅同步替换已准备的美术，保留实体根、组件、脚点和动画进度。取消、失效或移除释放待用资源及订阅，保存读取 skinId.peek()。

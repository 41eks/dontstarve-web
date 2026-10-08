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
| `src/main.ts` | 将 store 通知同步到 UI，将 UI 事件转为库存操作或游戏动作 |

`InventorySlot`、`HandSlot`、`BodySlot`、`HeadSlot` 各自实现具体槽位行为，不共享实现父类。`InventorySlot` 提供物品堆叠上限；纯函数 `craft()` 根据配方输入及槽位计算新库存结果，`InventoryStore` 原子提交。

应用中的 `createInventoryStore()` 默认建立空玩家槽位；`src/main.ts` 从 `src/save/initialSave.ts` 读取的 `public/saves/initial-world.json` 恢复库存，通过 `inventoryStateFromSave()` 和 `replaceState()` 应用。初始物品不再硬编码在 `src/inventoryItems.ts` 中。存档设计见 [存档文档](dst-save-system.md)。

Store 通知驱动 UI 的 `setSlot()` 更新；UI 槽位模型是显示镜像。槽位地址使用稳定的 `{ containerId, slotKey }`，玩家槽位通过 `inventorySlotAddress()`、`equipmentSlotAddress()` 创建，其他容器使用其对应地址助手。

## 物品实体与归属

实现参考源 Lua 的 `components/inventory.lua:GiveItem/Equip/RemoveItem/DropItem`、`components/inventoryitem.lua:OnPutInInventory/OnDropped` 和 `components/stackable.lua:Get/Put`。库存槽和装备槽持有同一个 `inst`；进入库存时设置 owner、移出场景，丢弃时清除 owner、返回场景。整叠移动保留实体，拆出部分才生成新实体；合堆保留接收方实体，完全合入的实体被移除。

`packages/inventory/src/entity.ts` 的 `ItemEntity` 保存稳定 ID、prefab、skin、transform、stackable/fueled/finiteuses 状态、inventoryitem owner 和运行时组件。各具体槽位直接保存实体引用，`getEntity()` 返回引用，`get()` 返回用于 UI 与领域计算的独立快照。`InventoryStack` 是快照类型，不再是槽位中的另一份可变权威状态。`ItemEntityRegistry` 由库存和 `GroundItemManager` 共用。

`InventoryStore.transfer()` 从源实体取得完整状态，验证后原子提交；整件转移使用同一个引用。`extract()` 交出整件原实体或创建部分堆叠的新实体，`receive()` 接收地面的实体并按需合堆。空间不足、目标不接受或源实体已被替换时不改变归属。消耗和移除仍由 store 提交，entity 的 owner 回调检查槽位是否还持有自己，避免旧实体影响替代物。制造仍先使用纯函数计算快照，提交时复用剩余材料的实体并为新产品创建实体。

地面模型属于实体的表现资源。拾取移除模型，换肤替换模型，但保留实体；火把的运行时组件也保留。其他已有 prefab 的模型专用控制器仍由各自 factory 管理。`exportState()` 在结算组件后导出含 `entityId` 的快照；地面实体继续使用记录的 `id`。旧库存存档缺少 ID 时在加载时分配，后续保存保持稳定；读取拒绝重复物品 ID 以及与世界实体冲突的 ID。

## 火把燃料与百分比

源文件位于 DST 的 `databundles/scripts_unpacked/scripts/`：`prefabs/torch.lua` 初始化 `fueled`，装备时点燃、卸下时熄灭；`components/burnable.lua` 的点燃/熄灭分别调用 `StartConsuming()` / `StopConsuming()`。`tuning.lua` 定义 `TORCH_FUEL = night_time * 1.25`，默认夜晚为 `30 * 2` 秒，因此满燃料为 75 秒。普通丢弃不点燃；投掷是独立的 `IgniteTossed()` 路径。

`components/fueled.lua` 以 `currentfuel / maxfuel` 计算比例，并发出 `percentusedchange`；`widgets/itemtile.lua` 初次刷新从 `fueled:GetPercent()` 读取比例，后续监听该事件，`SetPercent()` 用 `NUMBERFONT`、42 号字及位置 `(5, -17)` 在物品图标下方显示百分比。显示为四舍五入的整数，`0 < percent * 100 < 1` 时强制显示 `1%`；普通燃料耐久使用文字，腐败度另由 `SetPerishPercent()` 显示背景动画。

本项目的 `InventoryItemSpec.maxFuel` 保存满燃料秒数，`ItemEntity.components.fueled.remaining` 保存每把火把的实际剩余秒数，快照以 `InventoryStack.remainingFuel` 序列化；缺省表示满燃料，兼容旧存档与新制造物品。燃烧生命周期由 `packages/prefab/src/torch.ts` 的 `TorchController` 管理，`getTorchController(entity)` 为每个实体只创建一个控制器：`onequip(slotSignal)` 绑定具体槽位并调用 `ignite()`，`onunequip()` 停止燃烧并解除绑定，`extinguish()` 只停止燃烧，保留装备及燃料；`update()` 只在燃烧时扣减，并在耗尽时移除物品、熄灭照明。满燃料常量 `TORCH_FUEL` 也由该 prefab 提供。`onFrame(dt)` 每个燃烧帧仅累计帧数和秒数，每 60 帧才调用 `update()` 扣减全部累计秒数；`flushFuel()` 在停止生命周期、UI 手部转移、丢弃提交、换肤、拾取和保存前结算不足 60 帧的部分，防止燃料回升或丢失。

`packages/signals/src/handEquipment.ts` 提供 `createHandEquipmentExistenceState()` 工厂，不导出全局装备状态。每个 `InventoryStore` 默认创建独立的 `handEquipmentExistenceState`，也可通过构造函数第五个参数注入；`InventoryStore.handEquipment` 是该实例的只读接口。应用通过 `bindPlayerHandEquipment({ handEquipmentExistenceState: inventory.handEquipmentExistenceState, ... })` 显式注入，再通过 `onequip(handEquipmentExistenceState)` 将具体槽位传给 torch。存在状态表示当前装备身份，燃烧和燃料由 prefab 与实体管理；Store 只订阅槽位清空，不监听所有 prefab 的动态状态。装备流为 UI / 命令 / 读档 → `InventoryStore` 完成提交 → 该库存的 signal 更新 → 旧 torch `onunequip()`、新 torch `onequip(handEquipmentExistenceState)`。该 signal 的 `HandEquipment` 对象引用代表一次装备实例，成功转移或同 prefab 替换会创建新引用；失败事务不发布变化。燃料及其他库存变化不重新发布手部状态，避免显式熄灭后自动重新装备。signal 的 `entity` 引用指向已提交的手部物品实例，不复制动态组件值；signal 对象表示一次装备关系，物品实体表示持续的物品身份。signal 不序列化，存档仍保存物品快照。读档从已恢复的手部实体建立运行时组件。

`HandEquipment` 要求公开字面量属性 `readonly EQUIPSLOTS: 'HANDS'`，共享 setter 同时做运行时校验；身体装备或缺少该属性的对象不能写入，失败不修改状态、不通知订阅者，`null` 仍可清空。torch 实现该结构类型，公开 `itemId = 'torch'` 与 `EQUIPSLOTS = 'HANDS'`；库存只为成功提交到手部槽的物品发布此属性，存档仍使用库存领域字段，不保存运行时槽位声明。

torch 的只读 `burning` signal 独立表示燃烧状态，`onequip()` 点燃时设为 `true`，卸下、释放或耗尽后设为 `false`。`onunequip()` 和 `dispose()` 不修改 `handEquipmentExistenceState`，切换装备时不会清掉新值。燃尽时停止燃烧并校验绑定 signal 仍包含自己的装备引用，再调用 `slotSignal.set(null)`。`InventoryStore` 在手部槽位成功注册后、发布初始状态前自动建立唯一的清空监听，包括构造时和后续 `registerSlots()` 注册；注册失败或仅注册其他槽位不会建立新监听，应用无需手动绑定。监听核对旧 signal 的实体就是当前手部物品，原子清空槽位并清理实体，并随 Store 的 `dispose()` 释放；库存自身已完成的转移、空槽位和其他实体的请求跳过。普通 `extinguish()` 不改变装备 signal。未绑定槽位的地面火把不修改玩家状态；未耗尽的燃料保留在库存中。装备火把耗尽由 signal 清空请求触发库存移除；地面或没有库存 owner 的本地火把仍移除自己的实体。旧绑定已经被替换时，不清空新装备；旧物品通过自己的 owner 移除。`src/playerHandEquipment.ts` 先注册注入手部 signal 的 `subscribe()`，直接使用 signal 中的实体引用；随后 `InventoryStore.replaceState()` 从存档恢复库存并写入 signal，由该次写入触发生命周期和手持动画。订阅不回放当前值，也没有单独的初始同步。`packages/prefab/src/handEquipment.ts` 注册各手部 prefab 的手持外观、光标与生命周期工厂；torch 的装备工厂负责绑定控制器、声音位置及燃烧订阅。`main.ts` 只注入玩家表现接口、调度统一订阅器的帧更新和结算、请求成功转移动画并在关闭时释放；卸下不销毁实体上的控制器。同步订阅处理同一任务内的装备变化；生命周期回调导致嵌套转移时，先完成旧生命周期，再处理最新装备，避免重入时旧回调清理或覆盖新实例。UI 的 `createEffect()` 仍在微任务中合并刷新。页面关闭时释放装备、燃烧和库存对手部 signal 的订阅。手动 `set(null)` 移除手部物品；正常卸下使用库存转移，保留实体及状态。

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
| `game:slot-transfer-request` | 拖放物品 | 提交库存转移，成功后触发对应装备动画 |
| `game:slot-select` | 点击选择槽位 | 在转移拾取之前运行；可放置物品通过 `preventDefault()` 接管点击并进入放置模式 |
| `game:slot-context-menu` | 右键槽位 | 根据物品与修饰键执行吃东西、装备或丢弃等动作 |

三个事件均穿过 inventory bar 的 shadow root 冒泡。`game:slot-select` 可取消，使点击建筑物品时先启动放置，而不会先把整叠物品拿起来拖放。

网页屏蔽浏览器原生右键菜单，游戏使用自己的右键映射。

## 当前动作与动画

右键 `meatballs` 调用 `WilsonAnimationController.playEat()`，播放 `anim/player_actions_eat.zip`；当前只播放动作，不消耗该堆物品。

将火把移入手部装备槽播放 `item_out`，移回物品栏播放 `item_in`，两者均使用 `anim/player_actions_item.zip`。应用也对当前支持的部分手持工具使用此转移动画；具体物品判断位于 `src/main.ts`。动画只在库存转移成功后播放。

Shift + 右键已占用的库存或装备槽，在玩家当前地面位置丢弃一个物品。帽子及注册的目录物品使用源动画/build，其他未注册物品回退到其库存图标。普通掉落物点击拾取成功后回到物品栏；专用生物 prefab 可定义不同捕获或交互行为。

成功丢弃或普通拾取都播放 `anim/player_actions_item.zip` 的 `pickup`。`packages/stategraphs/src/SGwilson.ts` 为 `pickup` 设置 `playbackRate: 0.5`，即源动画的一半速度。

地面模型的源原点是脚点，供排序、拾取与存档使用；不能因为图片较高或有多层部件而改用图片中心。

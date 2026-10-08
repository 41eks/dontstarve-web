# @dontstarve-web/signals

UI、库存和 prefab 共用的响应式原语、装备协议与状态工厂，无 DOM 或游戏包依赖。

- `createSignal(value)` 返回 `get()`、`peek()`、`set(value)` 和 `subscribe(listener)`。
- `get()` 收集当前 effect 的依赖，`peek()` 仅读取值；`set()` 同步写入。
- `subscribe((value, previous) => ...)` 同步观察每次变化，返回取消订阅函数；适合装备与燃烧生命周期。不会在订阅时立即调用，初始化可用 `peek()`。
- `createEffect(fn)` 立即执行一次，后续在微任务中合并更新；返回释放函数，同时取消排队执行并运行 `onCleanUp(fn)` 注册的清理。
- `createMemo(fn)` 返回派生值的读取函数。
- `readonlySignal(signal)` 暴露没有 `set()` 的读取和订阅接口，状态写入由拥有者负责。

装备存在状态由工厂创建，包内没有全局装备状态：

| 工厂 | Store 的可写状态 | 只读接口 | 非空装备的 `EQUIPSLOTS` |
| --- | --- | --- | --- |
| `createHandEquipmentExistenceState()` | `handEquipmentExistenceState` | `handEquipment` | `HANDS` |
| `createHeadEquipmentExistenceState()` | `headEquipmentExistenceState` | `headEquipment` | `HEAD` |
| `createBodyEquipmentExistenceState()` | `bodyEquipmentExistenceState` | `bodyEquipment` | `BODY` |

每次工厂调用返回独立、初始为 `null` 的 signal。每个 `InventoryStore` 默认创建三种状态，也可通过构造函数第五个参数的对象注入，例如 `{ handEquipmentExistenceState, headEquipmentExistenceState, bodyEquipmentExistenceState }`。对应槽位成功注册后、发布初始装备状态前，Store 自动建立该槽位唯一的存在状态监听；构造时和后续 `registerSlots()` 注册都适用。失败注册或仅注册非装备槽位不会建立新监听。收到 `null` 时核对旧值的实体与当前槽位，再原子移除并清理该实体；库存转移或读档自身已清空槽位时跳过。订阅由库存 `dispose()` 统一释放。

存在状态表示当前装备身份，燃烧及燃料由 prefab 与实体管理，Store 只监听槽位清空。共享的 `Equipment`、`EquipmentEntity`、`EquipmentLifecycle` 协议以及三种槽位的具体类型也在本包定义。库存成功提交装备变化后写入 `{ itemId, EQUIPSLOTS, skinId?, entity }`；`entity` 是已提交的物品实例引用，signals 仅定义其身份结构，不依赖库存类型或 prefab。

应用通过 `bindPlayerHandEquipment`、`bindPlayerHeadEquipment`、`bindPlayerBodyEquipment` 显式传入所属库存的对应状态，三者使用 `src/playerEquipment.ts` 的同一订阅与生命周期切换逻辑。先注册全部订阅，再调用 `InventoryStore.replaceState()` 恢复库存，由该次 signal 写入触发手持、帽子、背包外观，以及背包面板和材料可访问性。订阅不会回放当前值，也不手动调用回调初始化。手部 prefab 注册表仍提供物品生命周期；`onequip(slotSignal)` 注入具体槽位。头部和身体装备保留现有帽子与背包表现行为。

装备 prefab 不导入全局玩家装备状态；torch 燃尽时校验当前绑定装备引用并写入 `null`，普通 `extinguish()` 只更新燃烧状态。`onunequip()` 停止燃烧并解除绑定，不写入槽位 signal；旧 torch 通过引用检查避免清空新装备，未绑定槽位的地面火把不会修改玩家装备。

非空装备必须公开对应槽位的 `readonly EQUIPSLOTS`：手部为 `HANDS`，头部为 `HEAD`，身体为 `BODY`。TypeScript 类型与 setter 的运行时检查都执行此约束；缺少该属性或声明为其他槽位时，setter 抛出 `TypeError`，保留原值且不通知订阅者。`null` 表示当前槽位没有装备；绑定库存后，prefab 主动清空表示该装备耗尽并请求移除。普通卸下必须通过库存转移；解除生命周期绑定只释放信号引用，不改值。该约束通过结构类型实现，signals 不依赖具体 prefab；torch 公开 `itemId` 和 `EQUIPSLOTS` 并实现 `HandEquipment`，可直接传入 setter。

每次成功的装备替换创建新的对象引用，燃料及其他库存更新不重新发布装备，避免已熄灭的 torch 被自动重新装备。torch 的 `burning` 是独立 signal；未耗尽时显式熄灭保留装备及库存燃料，装备火把耗尽由 signal 的清空请求触发库存移除。手动 `set(null)` 同样移除对应槽位的当前物品，普通卸下通过库存转移保留实体。

存在状态 signal 及其实体引用不序列化，存档仍由库存导出物品快照。生命周期切换先完成旧实例清理；回调同步发布新的装备时，统一订阅器在清理结束后处理最新值，避免旧回调覆盖新装备。


生命、饥饿和理智分别使用 `createHealthState(initialValue, maximum)`、`createHungerState(initialValue, maximum)` 和 `createSanityState(initialValue, maximum)` 创建每个角色独立的状态。`get()` / `peek()` 读取属性点数，`set(value)` 拒绝非有限值并将其限制到 `[0, maximum]`，同值不通知；`maximum` 为正的有限数值。`percent` 是同一状态派生的只读比例视图，支持 `get()`、`peek()` 和同步 `subscribe()`，不额外保存一份比例。其订阅不会回放，消费方用 `peek()` 初始化，并持有返回的取消函数管理生命周期。

应用的 `playerStats.health`、`playerStats.hunger` 和 `playerStats.sanity` 持有 Wilson 的状态，上限分别为 150、150、200；HUD 订阅三项属性点数，游戏退出时取消订阅。`DstLightingRenderer` 接收理智的只读 `percent` 并订阅滤镜强度与扭曲速度变化。`c_setsanity(percent)` 只写入理智状态，`getPlayerStats()` 导出用于 HUD 与存档的纯数值快照。滤镜释放时取消订阅，signal 和监听器不写入存档。

# @dontstarve-web/signals

UI、库存和 prefab 共用的响应式原语、装备协议与状态工厂，无 DOM 或游戏包依赖。

- `createSignal(value)` 返回 `get()`、`peek()`、`set(value)` 和 `subscribe(listener)`。
- `get()` 收集当前 effect 的依赖，`peek()` 仅读取值；`set()` 同步写入。
- `subscribe((value, previous) => ...)` 同步观察每次变化，返回取消订阅函数；适合装备与燃烧生命周期。不会在订阅时立即调用，初始化可用 `peek()`。
- `createEffect(fn)` 立即执行一次，后续在微任务中合并更新；返回释放函数，同时取消排队执行并运行 `onCleanUp(fn)` 注册的清理。
- `createMemo(fn)` 返回派生值的读取函数。
- `readonlySignal(signal)` 暴露没有 `set()` 的读取和订阅接口，状态写入由拥有者负责。

`createHandEquipmentExistenceState()` 每次返回独立、初始为 `null` 的 `handEquipmentExistenceState`，包内没有全局装备状态。每个 `InventoryStore` 默认创建自己的实例，也可通过构造函数第五个参数注入；`InventoryStore.handEquipment` 是该实例的只读接口。存在状态表示当前装备身份，燃烧及燃料由 prefab 与实体管理，Store 只监听槽位清空；`HandEquipment`、`HandEquipmentEntity` 和 `HandEquipmentLifecycle` 协议也在本包定义。库存成功提交装备变化后写入 `{ itemId, EQUIPSLOTS, skinId?, entity }`，其中 `entity` 是已提交的物品实例引用；signals 仅定义其身份结构，不依赖库存类型或 prefab。应用必须通过 `bindPlayerHandEquipment({ handEquipmentExistenceState, ... })` 显式传入所属库存的实例，先通过该 signal 的 `subscribe()` 注册同步订阅，再恢复存档；`InventoryStore.replaceState()` 提交恢复结果并写入 signal，直接触发生命周期及动画。订阅不会回放当前值，也不手动调用一次回调初始化。应用的 `src/playerHandEquipment.ts` 从 prefab 注册表取得生命周期和表现配置，通过 `onequip(slotSignal)` 注入具体槽位；库存在手部槽位成功注册后、发布初始装备状态前自动建立唯一的存在状态监听；构造时和后续 `registerSlots()` 注册都适用，应用无需手动绑定。注册失败或仅注册其他槽位不会建立新监听。收到 `null` 时核对旧值的实体与当前手部槽，再原子移除并清理该实体；库存转移或读档自身已清空槽位时跳过，订阅由库存 `dispose()` 释放。torch 不导入共享装备状态，燃尽时校验当前绑定装备引用并写入 `null`；普通 `extinguish()` 只更新燃烧状态，不修改装备 signal。`onunequip()` 停止燃烧并解除绑定，不写入槽位 signal；旧 torch 通过装备对象引用检查避免清空新装备。未绑定槽位的地面火把不会修改玩家装备。

非空手部状态必须公开 `readonly EQUIPSLOTS: 'HANDS'`。TypeScript 类型与 setter 的运行时检查都执行此约束；缺少该属性或声明为 `BODY` 等其他槽位时，setter 抛出 `TypeError`，保留原值且不通知订阅者。`null` 表示当前槽位没有装备；绑定库存后，prefab 主动清空表示该装备耗尽并请求移除。普通卸下必须通过库存转移；解除生命周期绑定只释放信号引用，不改值。该约束通过结构类型实现，signals 不依赖具体 prefab；torch 公开 `itemId` 和 `EQUIPSLOTS` 并实现 `HandEquipment`，可直接传入 setter。

每次成功的装备替换创建新的对象引用，燃料及其他库存更新不重新发布装备，避免已熄灭的 torch 被自动重新装备。torch 的 `burning` 是独立 signal；未耗尽时显式熄灭保留装备及库存燃料，装备火把耗尽由 signal 的清空请求触发库存移除。手动 `set(null)` 同样移除当前手部物品，普通卸下通过库存转移保留实体。

存在状态 signal 及其实体引用不序列化，存档仍由库存导出物品快照。生命周期切换先完成旧实例清理；回调同步发布新的装备时，统一订阅器在清理结束后处理最新值，避免旧回调覆盖新装备。

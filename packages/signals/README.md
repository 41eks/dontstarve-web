# @dontstarve-web/signals

UI、库存和 prefab 共用的响应式原语与客户端共享状态，无 DOM 或游戏包依赖。

- `createSignal(value)` 返回 `get()`、`peek()`、`set(value)` 和 `subscribe(listener)`。
- `get()` 收集当前 effect 的依赖，`peek()` 仅读取值；`set()` 同步写入。
- `subscribe((value, previous) => ...)` 同步观察每次变化，返回取消订阅函数；适合装备与燃烧生命周期。不会在订阅时立即调用，初始化可用 `peek()`。
- `createEffect(fn)` 立即执行一次，后续在微任务中合并更新；返回释放函数，同时取消排队执行并运行 `onCleanUp(fn)` 注册的清理。
- `createMemo(fn)` 返回派生值的读取函数。
- `readonlySignal(signal)` 暴露没有 `set()` 的读取和订阅接口，状态写入由拥有者负责。

`handEquipmentState` 是包内创建并导出的客户端共享 signal，`handEquipment` 是它的只读接口；`HandEquipment` 类型也在本包定义。库存成功提交装备变化后写入该 signal，应用通过 `torch.onequip(handEquipmentState)` 将具体槽位注入 torch；torch 不导入共享装备状态，只在 `extinguish()` 时清空绑定槽位。`onunequip()` 停止燃烧并解除绑定，不写入槽位 signal；旧 torch 通过装备对象引用检查避免清空新装备。未绑定槽位的地面火把不会修改玩家装备。

非空手部状态必须公开 `readonly EQUIPSLOTS: 'HANDS'`。TypeScript 类型与 setter 的运行时检查都执行此约束；缺少该属性或声明为 `BODY` 等其他槽位时，setter 抛出 `TypeError`，保留原值且不通知订阅者。`null` 可用于清空。该约束通过结构类型实现，signals 不依赖具体 prefab；torch 公开 `itemId` 和 `EQUIPSLOTS` 并实现 `HandEquipment`，可直接传入 setter。

每次成功的装备替换创建新的对象引用，燃料及其他库存更新不重新发布装备，避免已熄灭的 torch 被自动重新装备。torch 的 `burning` 是独立 signal；未耗尽时显式熄灭保留库存燃料，耗尽则移除库存物品。

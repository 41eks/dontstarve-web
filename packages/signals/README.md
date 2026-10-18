# @dontstarve-web/signals

UI、库存和 prefab 共用的响应式原语、装备协议与状态工厂，无 DOM 或游戏包依赖。

- `createSignal(value)` 返回 `get()`、`peek()`、`set(value)` 和 `subscribe(listener)`。
- `get()` 收集当前 effect 的依赖，`peek()` 仅读取值；`set()` 同步写入。
- `subscribe((value, previous) => ...)` 同步观察每次变化，返回取消订阅函数；适合装备与燃烧生命周期。不会在订阅时立即调用，初始化可用 `peek()`。
- `createEffect(fn)` 立即执行一次，后续在微任务中合并更新；返回释放函数，同时取消排队执行并运行 `onCleanUp(fn)` 注册的清理。
- `createMemo(fn)` 返回派生值的读取函数。
- `readonlySignal(signal)` 暴露没有 `set()` 的读取和订阅接口，状态写入由拥有者负责。
- `watchSignal(source, registerCleanup)` 返回标准可写 signal，接口仍为 `get()`、`set()`、`peek()`、`subscribe()`，没有 `.effect()` 或 `.dispose()`。每个 class 对同一世界输入创建一个本地 signal，源 signal 只登记一条同步 effect；class 的多个普通 `createEffect` / memo 和 subscriber 都登记在本地 signal 中。
- 本地 `get()` 除了正常跟踪依赖，还登记所属消费者的生命周期；本地 `subscribe()` 登记取消函数。class 不需要逐个保存这些消费者的释放函数。effect 之后因条件变化改为读取其他输入，也仍归原本的 class 管理；手动释放 effect／subscriber 时会同时从本地生命周期记录中移除。
- `registerCleanup(stop)` 只登记一份统一清理：取消本地 subscriber、停止本地消费者的完整 effect（包括其其他输入依赖）、取消排队执行并运行 effect cleanup，最后断开源同步。重复清理无影响；其他 class 的本地实例及源 signal 保持工作。批量事务中停止时，本地 signal 保留最后的源值。
- 同步沿用现有同步／批量结算规则；普通 `createEffect` 仍在微任务中合并执行。本地 `set()` 不回写源 signal，源后续更新会覆盖本地值。对象值不深拷贝；断开生命周期后返回的对象仍是普通 signal，可独立读写。

```ts
class SeasonObserver {
  private readonly cleanups: (() => void)[] = [];
  private readonly season: Signal<SeasonState>;

  constructor(source: ReadonlySignal<SeasonState>, onChange: (season: SeasonState) => void) {
    this.season = watchSignal(source, stop => { this.cleanups.push(stop); });
    createEffect(() => onChange(this.season.get()));
    createEffect(() => console.log(this.season.get().season));
  }

  dispose(): void {
    for (const stop of this.cleanups.splice(0).reverse()) stop();
  }
}
```

本地 signal 应保持为所属 class 的私有输入；消费者一旦读取它，就归这个 class 生命周期管理，停止时整个 effect 会被清理。不要把同一个本地 signal 交给生命周期独立的其他 class；其他 class 应分别从世界 signal 创建自己的本地 signal。普通 JavaScript class 没有自动析构回调，仍由实体移除／场景销毁调用 class 的 `dispose()`。`DeciduousTreeLeaves` 只保存本地 signal 的统一清理函数，季节回调继续用普通 `createEffect`，季节转换、初始化／读档和调试命令行为不变。

`WorldContentKey` 统一定义 `Cycle`、`Season`、`Temperature`、`Wind`、`PerishClock` 与 `SnowLevel`；`Cycle` 是世界从 `clock.phase` 纯派生的 `'day' | 'dusk' | 'night'`，不另存可写阶段。`WorldContentContext` 定义世界来源、共享调度器和 `getWatchWorldContent` 契约，应用的 `WorldState` 与 prefab 的 `WorldContext` 共用它，prefab 不再重复定义昼夜、季节信号的类型。`WorldContext` 另补充场景、相机和物理接口。

世界提供绑定自身原始来源的 `getWatchWorldContent(key, registerCleanup)` 函数，内部调用 `watchSignal`，返回保留 `get()`／`set()`／`peek()`／`subscribe()` 的本地 signal，并附带只读的 `scheduler` 引用。同一世界的 所有世界内容键以及不同消费者取得的 scheduler 都是同一实例。Mole 将同一个函数直接传给 Sleeper；函数没有绑定 Mole 的清理列表，Sleeper 用自己的清理注册创建私有 `cycle`，移除时独立释放。Sleeper 的测试回调接收阶段值 `(inst, cycle)`，无需暴露或转交组件的本地 signal。
`getWatchWorldContent(key, registerCleanup, { tile })` 可选传入实体私有的 `TileTracker.tile`：对应 tickingarea memo 为 `false` 时，本地 signal 不读取全局源（不订阅），保留最后一次同步的值；变回 `true` 时重新订阅并立即同步。tile 的刷新由实体自己负责（位置赋值后调 `tracker.moved()`，累计 60 次刷新一次）。tile 在网格外或世界未提供 tickingarea 时不门控；清理时一并释放该 memo，所以 tile signal 只能给一个消费者使用。萤火虫是当前的使用者。

```ts
// Sleeper 内部；getWatchWorldContent 是世界注入的函数。
this.cycle = getWatchWorldContent(WorldContentKey.Cycle, stop => this.cleanups.push(stop));
const { scheduler } = this.cycle; // 和世界、Mole、Molehill 共用同一个实例
this.test = new ComponentTimer(scheduler, () => this.runTest());
createEffect(() => this.runTest(this.cycle.get()));
```

包导出的同名函数也可通过 `bindWorldContent(sources)` 解析当前世界，或用第三个参数显式指定包含 `scheduler` 的世界来源。应用注入的函数始终绑定所属世界；旧世界的清理不会解除新世界的绑定。组件释放只停止自身的监听和 timer，不释放 scheduler；世界状态负责创建、恢复游戏时间起点和销毁该实例。`GameTimeScheduler` 的实现位于本包，原 `componets/src/gameTimeScheduler.ts` 路径保留重新导出，类身份及调度行为一致。

`GameTimeScheduler` 使用带任务索引的最小堆：注册、取消及取出到期任务为 `O(log N)`，无到期任务时推进时间为 `O(1)`，不扫描等待中的任务。任务先按截止时间、再按登记顺序排序，同一截止时间保持 FIFO；长帧追赶时，回调读取到自己的实际截止时间，回调新建的到期任务继续在同一次推进中执行。取消立即从堆中移除任务并释放回调，不积累取消标记；执行、取消或销毁后的旧取消句柄重复调用无副作用。组件 timer 的暂停、恢复、到期及保存规则、普通 effect 的微任务调度均保持原有语义。

世界温度 signal 由 `packages/componets/src/worldtemperature.ts` 的 `WorldTemperature` 组件创建、计算和释放，保持 Lua 的职责边界；组件管理季节项、昼夜项、噪声时间、温度修正和存档，对共享昼夜、季节输入分别创建私有 `watchSignal`。世界初始化完成恢复后，把该温度 signal 的只读视图注入 `WorldContentEnvironment.temperature`，与 Cycle、Season 和共享 scheduler 一起绑定。`worldContent.ts` 只定义 Temperature 的类型、解析枚举键并创建私有监听，不计算或复制温度。消费方使用 `getWatchWorldContent(WorldContentKey.Temperature, registerCleanup)`；60 帧结算、部分结算和保存／恢复沿用现有行为。

`WorldWind` 和 `WorldPerishClock` 同样保留组件内的计算、计时和清理。世界 init 创建两者并注入原有来源：`Wind`（`wind`）对应 `worldwind.windchange` 的 `{ angle, velocity }`，重复角度仍因新对象而通知；`PerishClock`（`perishTick`）对应 `perishClock.snapshot` 的已结算 `{ time, total }`。风滚草在游戏场景内通过 `getWatchWorldContent(WorldContentKey.Wind, registerCleanup)` 创建私有监听，保留初始风向与后续变风的区别。

`Moon`（`moon`）对应 `{ phase, waxing }`，在世界 init 时注入原有月相 memo 的只读视图；月相和盈亏状态一起发布。月晷通过 `getWatchWorldContent(WorldContentKey.Moon, registerCleanup)` 创建私有监听；月台各自监听 Moon 与 Cycle，并用纯 memo 派生满月夜。月之魔典只在一次阅读动作内创建并释放 Moon 监听，写入仍走 `SetMoonPhase`，保存与恢复仍由世界时钟负责。

蝴蝶与萤火虫各自通过 `WorldContentKey.Cycle` 读取世界昼夜，不再从光照渲染器的 phase 反推。满月仍是 `night`；蝴蝶在行为树检查 `isday` 时读取私有信号，萤火虫在普通 effect 中统一处理光照显隐：读取私有昼夜／位置输入、放置状态及检查 timer 的只读状态；昼夜切换和丢弃后的 2～3 秒检查由游戏时间调度器推进，淡出后的 NET 禁用也由调度器完成，入栏／移除取消任务。逐帧更新只推进动画与光照插值。

天气信号 `Moisture`、`MoistureCeil`、`MoistureFloor`、`PrecipType`、`PeakPrecipitationRate`、`PrecipitationRate`、`RainRate`、`SnowRate`、`SnowCover` 同样在世界 init 时注入 `Weather` 的原有只读信号，经 `getWatchWorldContent` 取得私有本地信号，传入 `{ tile }` 时受 tickingarea 门控；没有 `Weather` 的独立世界用 `createIdleWeatherSources()` 提供干燥默认值。

`SnowLevel`（`snowLevel`）在世界 init 时注入 `Weather.snowLevel` 的原有只读信号，计算、保存和恢复由天气组件负责。Pond 接收 `getWatchWorldContent` 并自行创建私有 SnowLevel signal，用普通 effect 的 `get()` 调用冻结／解冻方法；清理统一登记到池塘管理器。天气和世界时间仍按 60 活动帧结算。

`PlayerPositions`（`playerpositions`）对应 `Vector3[]` 玩家位置快照。场景初始化时发布当前玩家位置，之后每 60 个活动游戏帧发布新的数组与位置副本；暂停帧不计数，时钟的保存／停止部分结算不会提前刷新位置或重置位置采样计数。当前场景记录本地玩家，协议支持多名玩家，不写入存档。萤火虫在 controller 中通过 getter 创建私有位置监听，用普通 effect 的 `get()` 响应位置快照变化，先按 Cycle 短路，白天不读取位置输入；便便苍蝇则由 `playerprox` 组件创建自己的私有监听，并调用组件方法刷新靠近／离开状态。位置查询使用 `Vector3.distanceToSquared()`，范围按 `TILE_SIZE / 4` 缩放；监听随拥有者的显式释放清理。

`GetTileStateAtPoint(tile, radius = 10)`（`tile` 为 `TileTracker.tile`，即实体私有的 tile key 数字 signal，同一 tile 内移动不通知）查询当前绑定世界的活动状态，返回缓存的 `Memo<boolean> | undefined`；`world.tickingarea` 是固定绑定所属世界的同一查询服务。世界 init 通过 `tileManager.GetTileStateAtPoint(playerPosition)` 柯里化绑定来源，向 `WorldContentEnvironment.tickingarea` 注入查询函数，调用方无需传递 `playerPosition`。signals 仅定义 `TileStateQuery` 协议并解析服务，不依赖游戏组件或计算网格。当前世界从上述快照纯派生首个玩家位置，无玩家时 inactive，采样频率不变；多人并集尚未接入。相同世界、tile 和半径共享一个 memo，消费者只释放自己的订阅；世界 dispose 统一释放网格缓存、排队的 effect 和位置派生 memo。半径为非负整数，默认使用方形范围；无效目标或网格外返回 `undefined`，未绑定 tile 服务时抛错。详见 [tile 生命周期](../../docs/tile-lifecycle.md)。

本地 signal 同时附带只读 `perishClock` 服务引用（独立上下文可缺省），实际世界传入同一个组件的 `GetTick()`／`GetFrozenTick()` 接口，支持尚未发布及历史时间段的查询。快照只在 60 帧结算或显式 Flush 时发布；逐帧累计不写 signal。释放本地监听不会销毁这些共享服务，世界负责停止风向 timer、释放腐烂时钟的温度输入和共享 scheduler。数据／服务协议在本包定义，组件路径保留类型重新导出；组件实现仍在 `packages/componets`。

世界昼夜与季节由 `clockstate`、`seasonstate` 两个全局唯一单例持有，从本包统一导出。初始值分别为 `{ phase: 'day', timeinphase: 0 }` 和 `{ season: 'autumn', progress: 0.5 }`。`set()` 校验阶段／季节、有限数值及 `[0, 1]` 进度，保存不可变快照；无效写入保留原值且不通知订阅者。读档可写入 `{ phase, temperature }` 或 `{ season, temperature }`，保留源保存的温度项。创建 `WorldTemperature` 不重置这两个状态；场景加载恢复它们，温度、光照和牛的行为共享同一份输入。场景销毁只释放消费者的订阅，单例保留。

月相由同一模块导出的全局唯一单例 `moonphasestate` 持有，初始为 `'new'`，支持 `'new'`、`'quarter'`、`'half'`、`'threequarter'`、`'full'`。世界时钟按现有 20 天周期每 60 个活动帧结算更新，从存档累计游戏时间恢复；同值不通知，无效月相保留原值并抛出 `RangeError`。光照用 `createEffect` 读取三个世界 signal，夜晚且月相为 `'full'` 时派生满月外观，不复制昼夜、季节或月相状态。

`clockstate` 的可选 `cycles`、`time`、`daySegments`、`duskSegments`、`waxing`、`playerAge` 字段用于时钟表现；世界时钟在初始化、60 帧结算和部分结算时发布日历快照。天数和段数须为非负整数，昼夜段数之和不超过 16，全天进度 `time` 位于 `[0, 1]`，`waxing` 为布尔值。UI 直接通过 memo/effect 消费世界状态；装饰动画逐活动帧推进，指针和日期仍只由 signal 更新。

装备存在状态由工厂创建，包内没有全局装备状态：

| 工厂 | Store 的可写状态 | 只读接口 | 非空装备的 `EQUIPSLOTS` |
| --- | --- | --- | --- |
| `createEquipmentExistenceState('HANDS')` | `handEquipmentExistenceState` | `handEquipment` | `HANDS` |
| `createEquipmentExistenceState('HEAD')` | `headEquipmentExistenceState` | `headEquipment` | `HEAD` |
| `createEquipmentExistenceState('BODY')` | `bodyEquipmentExistenceState` | `bodyEquipment` | `BODY` |

每次工厂调用返回独立、初始为 `null` 的 signal。每个 `InventoryStore` 默认创建三种状态，也可通过构造函数第五个参数的对象注入，例如 `{ handEquipmentExistenceState, headEquipmentExistenceState, bodyEquipmentExistenceState }`。对应槽位成功注册后，Store 在发布初始装备状态时写入该状态；构造时和后续 `registerSlots()` 注册都适用。存在状态只由库存发布，不是移除请求：写入 `null` 不会移除任何物品。

存在状态表示当前装备身份，燃烧及燃料由 prefab 与实体管理。共享的 `Equipment`、`EquipmentEntity`、`EquipmentLifecycle`、`EquipmentOwner` 协议以及 `HandEquipment`、`HeadEquipment`、`BodyEquipment` 三种槽位类型都在 `equipment.ts` 定义。库存成功提交装备变化后写入 `{ itemId, EQUIPSLOTS, skinId?, entity }`；`entity` 是已提交的物品实例引用，signals 仅定义其身份结构，不依赖库存类型或 prefab。

应用通过 `bindPlayerHandEquipment`、`bindPlayerHeadEquipment`、`bindPlayerBodyEquipment` 显式传入所属库存的对应状态和装备者（`owner`），三者使用 `src/playerEquipment.ts` 的同一订阅与生命周期切换逻辑。先注册全部订阅，再调用 `InventoryStore.replaceState()` 恢复库存，由该次 signal 写入触发手持、帽子、背包外观，以及背包面板和材料可访问性。订阅不会回放当前值，也不手动调用回调初始化。手部 prefab 注册表仍提供物品生命周期；`onequip(owner)` 注入装备者，`onunequip()` 释放。头部和身体装备保留现有帽子与背包表现行为。

装备 prefab 不导入全局玩家装备状态，也不写存在状态。torch 燃尽时先 `entity.remove()`（经 `inventoryitem.owner` 由库存清空槽位，对应 Lua 的 `inst:Remove()`），再向 owner 推送 `itemranout`，使玩家自动换上同 prefab 的下一件装备；普通 `extinguish()` 只更新燃烧状态。`onunequip()` 停止燃烧并释放 owner；未装备的地面火把没有 owner，只移除自己。

非空装备必须公开对应槽位的 `readonly EQUIPSLOTS`：手部为 `HANDS`，头部为 `HEAD`，身体为 `BODY`。TypeScript 类型与 setter 的运行时检查都执行此约束；缺少该属性或声明为其他槽位时，setter 抛出 `TypeError`，保留原值且不通知订阅者。`null` 表示当前槽位没有装备。普通卸下通过库存转移，耗尽由 prefab 移除自己的实体。该约束通过结构类型实现，signals 不依赖具体 prefab；torch 公开 `itemId` 和 `EQUIPSLOTS` 并实现 `HandEquipment`。

每次成功的装备替换创建新的对象引用，燃料及其他库存更新不重新发布装备，避免已熄灭的 torch 被自动重新装备。torch 的 `burning` 是独立 signal；未耗尽时显式熄灭保留装备及库存燃料，装备火把耗尽由 prefab 移除自己的实体触发库存清槽。

存在状态 signal 及其实体引用不序列化，存档仍由库存导出物品快照。生命周期切换先完成旧实例清理；回调同步发布新的装备时，统一订阅器在清理结束后处理最新值，避免旧回调覆盖新装备。


生命、饥饿和理智分别使用 `createHealthState(initialValue, maximum)`、`createHungerState(initialValue, maximum)` 和 `createSanityState(initialValue, maximum)` 创建每个角色独立的状态。`get()` / `peek()` 读取属性点数，`set(value)` 拒绝非有限值并将其限制到 `[0, maximum]`，同值不通知；`maximum` 为正的有限数值。`percent` 是同一状态派生的只读比例视图，支持 `get()`、`peek()` 和同步 `subscribe()`，不额外保存一份比例。其订阅不会回放，消费方用 `peek()` 初始化，并持有返回的取消函数管理生命周期。

应用的 `playerStats.health`、`playerStats.hunger` 和 `playerStats.sanity` 持有 Wilson 的状态，上限分别为 150、150、200；HUD 订阅三项属性点数，游戏退出时取消订阅。`DstLightingRenderer` 接收理智的只读 `percent` 并订阅滤镜强度与扭曲速度变化。`c_setsanity(percent)` 只写入理智状态，`getPlayerStats()` 导出用于 HUD 与存档的纯数值快照。滤镜释放时取消订阅，signal 和监听器不写入存档。

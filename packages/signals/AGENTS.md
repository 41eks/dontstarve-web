# Signals package instructions

适用于 `packages/signals` 及所有消费信号的代码：effect 调度、`watchSignal` 与世界输入。组件计时规则见 [componets](../componets/AGENTS.md)。

## Effect scheduling

下表即 `src/signal.ts` 的调度契约，由 `tests/schedulingContract.test.ts` 逐行固定。以此表为准，编写或审查 effect 代码时不需要再读 `signal.ts` 确认；修改调度时必须同时修改本表和该测试。

| API | 首次执行 | 依赖变化后 | 在 `batch()` 内的变化 |
| --- | --- | --- | --- |
| `createEffect` | 同步，在创建调用内 | 微任务：同一轮的多次变化合并为一次重跑，读最后的值 | 仍在微任务，不在 batch 提交时 |
| `createRenderEffect` | 同步 | 同步，每次变化一次 | batch 提交后执行一次 |
| `createMemo` | 同步 | 同步，读取总是当前值：写入返回前，受影响的 memo 在一个循环里结算完（链条不逐级嵌套调用栈），所以 `value` 是普通字段；循环中计算的 memo 读到待算的 memo 时先结算它，所以菱形依赖下游的 memo 只计算一次。这期间被触发的 render effect 推迟到循环结束后执行，只看到结算后的值 | 同 batch 外：每次写入返回前就结算，读到的 `get`／`value` 都是当前值（同一输入在 batch 内写几次，memo 就算几次）。读它的 render effect 在提交后执行一次 |
| `watchSignal` 的源桥 | 同步取源值 | 同步写入本地 signal | 同 `createRenderEffect` |

- 只有 `createEffect` 的重跑是异步的；它的首次执行是同步的。`createEffect` 只接受 `fn`，没有同步参数：需要同步重跑时用 `createRenderEffect(fn)`，让调用处直接写明时序意图。
- 微任务队列循环到清空为止：effect 写入的 signal 触发的其他 `createEffect` 在同一次清空中结算，等一个微任务即可看到整条链的结果。
- `set()` 写入 `===` 相同的值时直接返回，不通知任何 effect 或 memo；对象值按引用比较，不深比较。
- effect 写入自己正在读取的 signal 不会触发自身重跑。
- signal 没有监听接口（没有 `subscribe`）。要在变化时同步做事，用 `createRenderEffect` 读取它：只响应之后的变化时，先用 `value` 记下当前值，effect 里遇到相等的值就返回；要上一次的值就自己记。effect 里真正做的事放进 `untrack(fn)`，它读到的 signal 不会成为依赖，effect 也不会被那些 signal 背后的 `watchSignal` 作用域收养。batch 内的多次变化在提交后合并为一次。
- 释放 `createEffect` 会取消它已排队的重跑。

选用规则：
- 业务状态转换、计时到期和实体移除不依赖 effect 的执行时机：交给组件方法、game-time scheduler，或同步的 `createMemo`／`createRenderEffect`。如果某段逻辑的正确性取决于 effect 何时重跑，说明它放错了位置，不要用改调度或补偿时序来修。
- 显示与同步副作用用 `createEffect`，晚一个微任务不影响结果；只有确实需要在变化的同一同步任务内执行时才用 `createRenderEffect`。

## Effects and watched signals

- `createEffect` 回调按同步代码编写，调度语义见上表；观察 effect 更新结果时在后续宏任务断言，专门验证同步契约的测试除外。宏任务也覆盖由 effect 发起的 Promise（如美术加载）。宏任务等待示例：`await new Promise(resolve => setTimeout(resolve, 0))`。
- Do not refactor global signals, change effect scheduling, or add timing compensation merely because an effect update takes a microtask. For plant growth and other game-time behavior, use the component's scheduler and deadlines; a negligible microtask delay does not justify a global timing change. Keep fixes within the requested feature and its necessary owning components.
- Classes and components consuming global/world signals or injected shared signals must create one private local signal per source with `watchSignal(source, registerCleanup)` from `packages/signals`. Do not use the source's `value` as a substitute for lifecycle-managed state access, or register the class's multiple consumers directly on the shared source. Use the local signal's `get()` inside ordinary `createEffect` / pure `createMemo` computations; local `value` remains valid for intentional non-reactive reads, including initialization and timer callbacks.
- Register each `watchSignal` cleanup with the owning class and invoke it on entity/component removal or explicit disposal. That cleanup owns the source bridge and all local effects/memos that read `get()`, including effects that later switch dependencies; do not separately collect every consumer's cleanup. Keep watched signals private to their owner, and let other classes create their own watched signals from the shared source. Returned signals retain the standard `get()` / `set()` / `value` interface; use ordinary `createEffect`, not signal `.effect()` / `.dispose()` methods. Authoritative shared state remains owned by its original source.
- 实体上多数实体用不到的特性（`inst.Physics`、`inst.Light`、`inst.MiniMapEntity`、挂载的 FX、跟随的动画源）用 `LazySignal`（`src/lazySignal.ts`）保存：首次声明前只是普通字段，没有 signal。`LazySignal` 本身实现 `Signal<T>`，属主直接把它作为 `ReadonlySignal` 返回；`get()` 会立即声明，只读当前值用 `value`。它的方法在原型上、不绑定 `this`，不要解构出 `get`。消费者在属主的 `whenDeclared` 回调里再 `watchSignal`，未声明的特性因此也没有订阅、effect 和 memo。给每个实体新增这类可选特性时沿用这个写法，不要在构造时创建 signal 或在构造时订阅。

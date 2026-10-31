# Signals package instructions

适用于 `packages/signals` 及所有消费信号的代码：effect 调度、`watchSignal` 与世界输入。组件计时规则见 [componets](../componets/AGENTS.md)。

## Effect scheduling

下表即 `src/signal.ts` 的调度契约，由 `tests/schedulingContract.test.ts` 逐行固定。以此表为准，编写或审查 effect 代码时不需要再读 `signal.ts` 确认；修改调度时必须同时修改本表和该测试。

| API | 首次执行 | 依赖变化后 | 在 `batch()` 内的变化 |
| --- | --- | --- | --- |
| `createEffect` | 同步，在创建调用内 | 微任务：同一轮的多次变化合并为一次重跑，读最后的值 | 仍在微任务，不在 batch 提交时 |
| `createRenderEffect` | 同步 | 同步，每次变化一次 | batch 提交后执行一次 |
| `createMemo` | 同步 | 同步，读取总是当前值 | batch 内读到 batch 前的值，提交后更新 |
| `signal.subscribe` | 订阅时不调用 | 同步，每次变化一次，参数 `(next, previous)` | batch 提交后按顺序补发每次变化 |
| `watchSignal` 的源桥 | 同步取源值 | 同步写入本地 signal | 同 `createRenderEffect` |

- 只有 `createEffect` 的重跑是异步的；它的首次执行是同步的。
- 微任务队列循环到清空为止：effect 写入的 signal 触发的其他 `createEffect` 在同一次清空中结算，等一个微任务即可看到整条链的结果。
- `set()` 写入 `===` 相同的值时直接返回，不通知任何 effect、memo 或 subscriber；对象值按引用比较，不深比较。
- effect 写入自己正在读取的 signal 不会触发自身重跑。
- 释放 `createEffect` 会取消它已排队的重跑。

选用规则：
- 业务状态转换、计时到期和实体移除不依赖 effect 的执行时机：交给组件方法、game-time scheduler，或同步的 `createMemo`／`subscribe`。如果某段逻辑的正确性取决于 effect 何时重跑，说明它放错了位置，不要用改调度或补偿时序来修。
- 显示与同步副作用用 `createEffect`，晚一个微任务不影响结果；只有确实需要在变化的同一同步任务内执行时才用 `createRenderEffect`。

## Effects and watched signals

- `createEffect` 回调按同步代码编写，调度语义见上表；观察 effect 更新结果时在后续宏任务断言，专门验证同步契约的测试除外。宏任务也覆盖由 effect 发起的 Promise（如美术加载）。宏任务等待示例：`await new Promise(resolve => setTimeout(resolve, 0))`。
- Do not refactor global signals, change effect scheduling, or add timing compensation merely because an effect update takes a microtask. For plant growth and other game-time behavior, use the component's scheduler and deadlines; a negligible microtask delay does not justify a global timing change. Keep fixes within the requested feature and its necessary owning components.
- Classes and components consuming global/world signals or injected shared signals must create one private local signal per source with `watchSignal(source, registerCleanup)` from `packages/signals`. Do not use the source's `peek()` as a substitute for lifecycle-managed state access, or register the class's multiple consumers directly on the shared source. Use the local signal's `get()` inside ordinary `createEffect` / pure `createMemo` computations; local `peek()` remains valid for intentional non-reactive reads, including initialization and timer callbacks.
- Register each `watchSignal` cleanup with the owning class and invoke it on entity/component removal or explicit disposal. That cleanup owns the source bridge and all local effects/memos that read `get()` and local `subscribe()` listeners, including effects that later switch dependencies; do not separately collect every consumer's cleanup. Keep watched signals private to their owner, and let other classes create their own watched signals from the shared source. Returned signals retain the standard `get()` / `set()` / `peek()` / `subscribe()` interface; use ordinary `createEffect`, not signal `.effect()` / `.dispose()` methods. Authoritative shared state remains owned by its original source.

# Signals package instructions

适用于 `packages/signals` 及所有消费信号的代码：effect 调度、`watchSignal` 与世界输入。组件计时规则见 [componets](../componets/AGENTS.md)。

## Effects and watched signals

- `createEffect` 回调按同步代码编写，调度语义保持现状；观察 effect 更新结果时在后续宏任务断言，专门验证同步契约的测试除外。宏任务等待示例：`await new Promise(resolve => setTimeout(resolve, 0))`。
- Do not refactor global signals, change effect scheduling, or add timing compensation merely because an effect update takes a microtask. For plant growth and other game-time behavior, use the component's scheduler and deadlines; a negligible microtask delay does not justify a global timing change. Keep fixes within the requested feature and its necessary owning components.
- Classes and components consuming global/world signals or injected shared signals must create one private local signal per source with `watchSignal(source, registerCleanup)` from `packages/signals`. Do not use the source's `peek()` as a substitute for lifecycle-managed state access, or register the class's multiple consumers directly on the shared source. Use the local signal's `get()` inside ordinary `createEffect` / pure `createMemo` computations; local `peek()` remains valid for intentional non-reactive reads, including initialization and timer callbacks.
- Register each `watchSignal` cleanup with the owning class and invoke it on entity/component removal or explicit disposal. That cleanup owns the source bridge and all local effects/memos that read `get()` and local `subscribe()` listeners, including effects that later switch dependencies; do not separately collect every consumer's cleanup. Keep watched signals private to their owner, and let other classes create their own watched signals from the shared source. Returned signals retain the standard `get()` / `set()` / `peek()` / `subscribe()` interface; use ordinary `createEffect`, not signal `.effect()` / `.dispose()` methods. Authoritative shared state remains owned by its original source.

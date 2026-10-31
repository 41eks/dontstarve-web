# Stategraphs package instructions

适用于 `packages/stategraphs`：controller、动作选取、`BufferedAction`、共享动作执行入口与 stategraph。全仓库分工和通用规则见[根 AGENTS.md](../../AGENTS.md)。

## Controller forwarding and prefab callbacks

- controller 只做输入／动作请求和真实 `doer`、`target`、`invobject` 实例引用的转发，交给通用动作选取、缓冲和提交入口；不得拼装代理实例来承载 prefab 的业务行为。
- 严禁在 controller 中用 `if`／`switch`、prefab 分发表或根据 tag／组件组合判断的特殊分支实现 prefab 专属行为。不得把这些分支藏进 controller 的闭包、helper 或注入的业务回调中。
- prefab 自己的特殊回调必须放回所属 prefab 模块，按 Lua 绑定到实例或组件；具体归属要求见 [prefab callbacks](../prefab/AGENTS.md#prefab-callbacks)。共享 `ACTIONS.fn` 访问真实实例的组件，由组件执行通用规则并触发 prefab 回调；stategraph 按 Lua 的时间点提交动作。

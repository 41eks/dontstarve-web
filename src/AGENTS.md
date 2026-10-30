# Application layer instructions

适用于应用层 `src`：构造世界，注入 scheduler、世界信号、库存和查询接口，连接输入／UI／存档，注册控制器与显式释放。不在这里增加 prefab 专用规则、备用控制器或资源加载流程。

## World time and temperature

- Refresh day/night progress and world temperature once every 60 active game frames. Accumulate the actual `dt` of those frames and apply the whole elapsed time in each settlement; never assume a fixed frame rate or replace this with a fixed wall-clock interval. Per-frame scheduling must not write day/night progress or world temperature signals, or refresh their UI, between settlements.
- Settle any partial batch before saving or stopping/disposing the scene. Initialize and restore clock/temperature state immediately on load, preserving elapsed game time, seasonal temperature, and noise time through save/load. Season changes remain explicit signal updates; they must not trigger redundant per-frame writes.
- Keep day/night and season inputs as signals and derive world temperature with `createMemo`. Release memo dependencies and clock/season presentation subscriptions when disposing the scene.

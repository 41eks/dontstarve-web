# Display package instructions

适用于 `packages/display`：`PrefabDisplay`、`PrefabDisplayGroup`、`SpriteResources` 与 FX／跟随动画显示。prefab 侧的声明约定见 [prefab](../prefab/AGENTS.md)，实际 sprite 与渲染见 [animation](../animation/AGENTS.md)。

## Residency and release

- sprite 驻留：需要按 tile 活动状态卸载／重建 visual 的 prefab，由 `PrefabInstance`（逻辑实体）声明状态、动画与 FX，`packages/display` 的 `PrefabDisplay` 订阅并绘制；tile 活动通过 `watchTileActivity()` 写入 `instance.setActive()`。`PrefabDisplay` 内部复用 `packages/animation/src/residentSprite.ts` 的 `ResidentSprite`（`ArchiveSprite` 路径）或 `ResidentSpriteController`（factory／`SpriteController` 路径）；创建回调仍须使用 [prefab](../prefab/AGENTS.md) 中“sprite 创建与共享”规定的共享入口。它负责稳定根节点、场景挂载、逻辑播放记录及实体 visual 的释放，不创建独立资源缓存，也不选择 prefab 动作或承载组件规则。此通用生命周期封装不属于禁止的 prefab 动作名称包装层。
- 驻留状态：卸载 visual 时保留实体身份、脚点、组件和逻辑 timer，重建时恢复记录的 clip 与外观。沿用现有 resident 实现：卸载时正在进行或未加载时请求的过渡动画直接结算至完成状态，执行其完成回调，重新加载后不重播；不保证卸载前的精确播放进度。此为项目资源生命周期约定，不归因于 Lua；游戏时间到期、消耗及实体移除仍由所属组件和调度器负责，不得依赖 visual 重建或卸载来完成。
- 资源释放：asleep 只释放实体 visual（display 内部的 `sprite.dispose()` 或通过注入的 release 回调调用 `factory.disposeSprite(sprite)`），并把 model 移出场景；共享资源保留供其他实体及再次唤醒复用。永久移除时 prefab 把 `status` 写为 `removed`（`instance.remove()`），display 释放 visual、model 并清理实体订阅；prefab 不绕过 display 直接释放 sprite 或 model。资源所有者须先释放全部实体，再统一调用 `assets.dispose()` 或 `factory.dispose()`，不得在单实体休眠或移除时销毁共享资源。

## AnimState declarations and slots

prefab 如何声明 `AnimState` 与使用插槽见 [prefab](../prefab/AGENTS.md)；此处只规定 display 的合并与订阅。

- 合并顺序：display 先绘制实体自己的 `anim-state`，再按插槽首次声明的顺序叠加 `anim-state:<key>`；同一 key 再次声明保持原位，移除后再声明则排到最后。后者的 override、显示／隐藏的图层与符号覆盖前者，其余（light override、bloom、symbol animation、attachment）叠加；`shownLayers`／`shownSymbols` 使上层显示下层隐藏的部分，未提及的沿用下层。
- 订阅：`PrefabDisplay` 像 `FxAttachments` 跟随 `active` 一样，用 `watchSignal` 跟随每个声明的信号，信号变化时重新合并并绘制，声明被移除或 display 释放时停止跟随；每帧 `sync()` 也会比较快照，赶上尚未运行的 effect。每个声明从自己的 `art` 加载缺失的 build／anim，加载完成后按当前声明重新合并。display 不复制声明，也不向任何 `AnimState` 写入。

## Tickingarea and visibility

- `tickingarea` is this project's own mechanism with no Lua counterpart; do not describe it or justify behavior with Lua semantics. Animation playback must not be decided by `tickingarea`: whether and which animation plays follows the source Lua and the entity's own state, and `tickingarea` only gates resource loading, subscriptions and logical activity as in [tile lifecycle](../../docs/tile-lifecycle.md). Camera culling is separate from both.
- Prefab visibility follows `tickingarea`: an entity is drawn while its tile is active and not drawn once it sleeps and releases its sprite. Do not add other ways of deciding whether a prefab is drawn, such as per-frame parent-chain/ancestor visibility checks in render batches, distance- or focus-radius hiding, or per-prefab show/hide toggles, and do not add culling. An entity whose source AnimState plays no animation (only a bank and build, as fireflies before `fadein`) declares that state with `SpriteState` `none` / `clearAnimation()`, and no sprite is built until a clip plays; this is animation state from the source Lua, not a visibility toggle.

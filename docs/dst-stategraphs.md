# Wilson 状态图源码核对

源码位于 `/data/copy/AssetArchive-Dev/data/DST/data/databundles/scripts_unpacked/scripts/stategraphs/SGwilson.lua`；运行器对应同一 `scripts` 目录下的 `stategraph.lua`。

`packages/stategraphs/src/SGwilson.ts` 的 `states` 按源文件顺序显式声明 `State({ name, tags, onenter, onupdate, timeline, ontimeout, events, onexit })`，只填写已实现的回调。不使用状态工厂、循环生成状态或统一注入生命周期回调。状态内直接展示动画队列、提交帧、标签变化和 `goToState()`，便于以状态名搜索 Lua 后逐项对照。

当前移植的是项目已接入动作所需的分支，并非整个 SGwilson。补充组件支持时，应把对应分支放回原状态的回调中，保留源标签与时序；暂缺的分支必须注明，不能以空回调表示已经实现。

| Lua 状态 | 当前实现的主要时序 |
| --- | --- |
| `idle` | `idle, canrotate`；普通进入播放 `idle_loop`，进入参数 `true` 时保留当前动画队列并追加待机 |
| `mine_start` / `mine` | `pickaxe_pre → pickaxe_loop`；loop 第 7 帧提交，第 9 帧移除 `premine`；完成后播放 `pickaxe_pst` 并进入 `idle, true` |
| `hammer_start` / `hammer` | 与采矿分别声明；使用 `prehammer, hammering, working`，第 7 帧声音及提交、第 9 帧移除 `prehammer` |
| `terraform` | `shovel_pre → shovel_loop` 共用状态时钟，第 25 帧提交、移除 `busy` 并播放挖地声；队列完成后在 `idle` 播放 `shovel_pst` |
| `dig_start` / `dig` | `shovel_pre → shovel_loop`；loop 第 15 帧移除 `predig`、播放挖掘声并提交；收尾动画留在 `idle` |
| `bugnet_start` / `bugnet` | `bugnet_pre → bugnet`；第 10 帧提交、移除 `prenet` 并播放默认挖掘声 |
| `eat` | 保留现有 `playEat()` 的单段视觉接口；完整 Lua 吃食状态尚未移植，库存食用走 `quickeat` |
| `quickeat` | 根据饮品选择 `quick_drink_pre → quick_drink` 或 `quick_eat_pre → quick_eat`；第 10 帧声音、第 12 帧提交并移除 `busy` |
| `doshortaction` | `pickup → pickup_pst`；第 6 帧移除 `busy` 并提交，第 10 帧状态超时进入 `idle, true`；退出仅清理该状态自己的缓冲动作 |
| `item_in` / `item_out` | 源标签 `idle, nodangle, keepchannelcasting`；动画完成后进入待机 |
| `castspell` | `staff_pre → staff`；第 13 帧声音、第 53 帧提交并释放光效取消所有权、第 69 帧移除 `busy` 并恢复控制；提交前退出清理照明 |
| `veryquickcastspell` | `atk_pre → atk`；进入时声音，第 9 帧提交并移除 `busy` |
| `emote` | 播放传入动画队列，仅最后一段可循环；0.5 秒移除 `busy, pausepredict` |
| `till_start` / `till` | `till_pre → till_loop`；loop 第 4 帧挖掘声、第 11 帧提交、第 12 帧出土声、第 22 帧移除 `busy`；在 `idle` 播放 `till_pst` |

原 Lua 没有 `mine_pst`、`hammer_pst`、`terraform_pst`、`dig_pst` 或 `till_pst` 状态。这些名称只能表示动画，不能再创建同名状态代替 Lua 的 `GoToState("idle", true)`。

## 运行器与浏览器适配

`StateGraphInstance` 支持进入参数、每次更新末尾的 `onupdate(inst, dt)`、状态时间线、状态超时和 `onexit(inst, nextState)`。`statemem` 在旧状态退出后、新状态进入前重置。同一时刻先处理超时，再处理时间线；状态切换会丢弃旧状态尚未执行的时间线、超时和更新回调。执行回调发生状态切换后，剩余时间交给新状态。

动画完成由独立的引擎计时任务触发 `animover` / `animqueueover`，不占用状态的 `setTimeout()`。动画时钟不随状态切换清零；替换动画会取消旧任务，保留动画队列则保留其进度。事件处理器保留源 `AnimDone()` 检查，避免提前发送完成事件跳过动画。

`applicationStates` 单独列出浏览器现有的 `walk`、`run`、`jump`、`build`、半速 `pickup`。它们保留浏览器的简化实现；其中 `run` 与源状态同名，但尚未移植 Lua 的 `run_start/run/run_stop` 生命周期。浏览器输入仍记录动作期间请求的移动/制作状态，普通动作完成后恢复请求，保留收尾动画时在收尾结束后恢复。

浏览器 `jump`、`build` 和半速 `pickup` 使用 `busy` 标签表示占用状态，动作请求按 `PlayerController:IsBusy()` 的含义拦截；跳跃期间所有动作都等待落地，不再为 `NET/CASTSPELL` 设置例外。表情入口按源事件检查 `busy/nopredict/sleeping/floating`；没有这些标签的工作状态可以被表情打断，浏览器适配会取消它们尚未提交的缓冲动作。

`WilsonStateGraph` 的命名区分调用方向：外部使用 `requestMovement(state)`、`requestCrafting(boolean)`、`requestOneShot(state)`、`requestEmote(names, loop)` 发起状态请求；状态的 `onenter` 调用 `onEnterIdle(pushanim)`、`onEnterQuickEat()`、`onEnterEmote()` 执行进入后的处理。`onEnterIdle()` 调用时已经处于 `idle`；`requestCrafting()` 更新持续的制作意图；`requestEmote()` 校验条件并准备动画队列，进入 `emote` 后由 `onEnterEmote()` 播放。底层实际状态切换仍使用 `StateGraphInstance.goToState()`。玩家动画控制器向 UI 提供 `start()`、`setCrafting()`、`playEmote()` 等接口，再转交给状态图的请求方法。

应用通过 `isPerformingAction("MINE")` 等方法判断和取消自己发起的动作；`cancelAction()` 可取消当前动作，`cancelAction("DIG")` 只取消该动作。换肤使用源 `CASTSPELL` 动作，`isPerformingAction("CASTSPELL", "reskin_tool")` 区分扫把换肤和其他法杖施法。`hasStateTag()` 报告源标签及明确声明的浏览器状态标签，不再附加 `action`、`oneshot`、`casting`、`reskinning`、`planting` 等应用标记。手部装备替换的统一取消策略放在浏览器适配中，不注入每个 Lua 状态的 `events`。

## 动作入口

`ActionHandler(action, state, condition?)` 与 Lua 一样，将字符串目标包装为恒定的 `deststate` 函数，也可直接接收 `(inst, bufferedAction) => state | null | undefined`。先检查可选 `condition(inst)`，通过后调用目标函数；返回空值或未实现的目标时拒绝转换。`StateGraphInstance.getActionState()` 解析目标，`startAction()` 解析后切换；浏览器 `pushBufferedAction()` 先解析一次，接受后才替换缓冲动作并进入目标状态，避免拒绝请求时丢失原动作。

`BufferedAction` 的第四个构造参数可提供 `{ invobject, target }`，对象提供源 `hasTag()` 查询与可选 `prefab` 身份。浏览器为当前工具传入 `invobject`；`NET_tool` 来自 `bugnet.lua` 的 tool 组件，`veryquickcast` 来自 `reskin_tool.lua`。

| 动作 | 支持的源目标选择 |
| --- | --- |
| `MINE` | 有 `premine` 时拒绝，否则根据 `mining` 选择 `mine` / `mine_start` |
| `HAMMER` | 有 `prehammer` 时拒绝，否则根据 `hammering` 选择 `hammer` / `hammer_start` |
| `DIG` | 有 `predig` 时拒绝，否则根据 `digging` 选择 `dig` / `dig_start` |
| `NET` | 无 `NET_tool` 的对象走 `doshortaction`；有该标签时按 `prenet/netting` 选择动作循环或前摇 |
| `CASTSPELL` | 工具有 `veryquickcast` 时进入 `veryquickcastspell`，普通法杖进入 `castspell`；未实现的特殊工具分支拒绝 |
| `EAT` | 检查源 `busy` 条件；当前已验证的库存食物仍进入 `quickeat` |
| `PLANT` / `TERRAFORM` / `TILL` | 源 Lua 本身使用固定目标：`doshortaction` / `terraform` / `till_start` |

不再提供自定义 `RESKIN` 动作或基于 `isOneShot/crafting/isJumping` 的 `canStartAction()` 白名单。工作动作在源前摇标签移除后，可由新的显式请求直接回到动作循环；按住输入自动重复仍依赖尚未移植的控制器分支。

普通法杖由 `SpellCastActionController` 从共享 `PlayerActionPicker` 的标签候选构造 `CASTSPELL`。真实 `ItemEntity` 作为 `invobject`，动作有效性核对原实体仍被持有且 `spellcaster.CanCast` 通过；执行时调用实体组件的 `CastSpell`，原始落点随动作保持。`castspell.onenter` 停止移动并禁用世界控制，声音与光色来自实际 `invobject.castsound/fxcolour`。第 13 帧播声，第 53 帧在 `PerformBufferedAction` 前释放光效取消所有权，避免最后一次耐久引起的卸装清掉已提交光效；第 69 帧恢复控制，退出状态也恢复控制。`isActionActive(bufferedAction)` 按动作引用核对归属，旧控制器不能取消替换动作。

## 尚未移植的源分支

- 骑乘、重物、变身、特殊角色、预测、天气及其他组件驱动的待机分支和 `idle.onupdate`。
- `mine` / `hammer` 第 14 帧、`dig` 第 35 帧的按住控制键重复动作，以及实体级 `AddTag/RemoveTag`、反冲和完整采矿特效。
- `bugnet.onenter` 的 `dontstarve/wilson/use_bugnet` 声音和工具专属声音覆盖；当前只使用已映射的默认提交声音。
- `NET` 的 `nabbag` 目标，以及 `CASTSPELL` 的独角鲸角、吉他、抛币、粉碎物品、`quickcast` 和鱼人增益分支；这些工具标签不会误走普通施法状态。
- 翻转工具的 `till2_*` 动画分支、完整 `eat` 状态、喂食、暂停饥饿、齿轮食物音效选择、进食后状态队列及口袋翻找。
- `doshortaction` 的静默、海狸和按住动作分支；`castspell` 的完整 `staffcastfx` 网格、骑乘和额外目标特效；表情的额外特效、声音、镜头和装备回调；`item_in` 的跟随特效清理。

验证使用 `pnpm --filter @dontstarve-web/stategraphs test`，覆盖代表性的提交、取消、跨状态动画保留和运行器回调顺序；实际动画/装备接线由 `packages/animation/tests` 的玩家与动作测试覆盖。

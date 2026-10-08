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
| `doshortaction` | `pickup → pickup_pst`；第 6 帧移除 `busy` 并提交，第 10 帧状态超时进入 `idle, true`；退出清理尚未提交的缓冲动作 |
| `item_in` / `item_out` | 源标签 `idle, nodangle, keepchannelcasting`；动画完成后进入待机 |
| `castspell` | `staff_pre → staff`；第 13 帧声音、第 53 帧提交、第 69 帧移除 `busy`；退出释放浏览器施法照明 |
| `veryquickcastspell` | `atk_pre → atk`；进入时声音，第 9 帧提交并移除 `busy` |
| `emote` | 播放传入动画队列，仅最后一段可循环；0.5 秒移除 `busy, pausepredict` |
| `till_start` / `till` | `till_pre → till_loop`；loop 第 4 帧挖掘声、第 11 帧提交、第 12 帧出土声、第 22 帧移除 `busy`；在 `idle` 播放 `till_pst` |

原 Lua 没有 `mine_pst`、`hammer_pst`、`terraform_pst`、`dig_pst` 或 `till_pst` 状态。这些名称只能表示动画，不能再创建同名状态代替 Lua 的 `GoToState("idle", true)`。

## 运行器与浏览器适配

`StateGraphInstance` 支持进入参数、每次更新末尾的 `onupdate(inst, dt)`、状态时间线、状态超时和 `onexit(inst, nextState)`。同一时刻先处理超时，再处理时间线；状态切换会丢弃旧状态尚未执行的时间线、超时和更新回调。执行回调发生状态切换后，剩余时间交给新状态。

动画完成由独立的引擎计时任务触发 `animover` / `animqueueover`，不占用状态的 `setTimeout()`。动画时钟不随状态切换清零；替换动画会取消旧任务，保留动画队列则保留其进度。事件处理器保留源 `AnimDone()` 检查，避免提前发送完成事件跳过动画。

`applicationStates` 单独列出浏览器现有的 `walk`、`run`、`jump`、`build`、半速 `pickup`。它们保留浏览器的简化实现；其中 `run` 与源状态同名，但尚未移植 Lua 的 `run_start/run/run_stop` 生命周期。浏览器输入仍记录动作期间请求的移动/制作状态，普通动作完成后恢复请求，保留收尾动画时在收尾结束后恢复。

应用通过 `isPerformingAction("MINE")` 等方法判断和取消自己发起的动作；`cancelAction()` 可取消当前动作，`cancelAction("DIG")` 只取消该动作。`hasStateTag()` 只报告 Lua 状态标签，不再附加 `action`、`oneshot`、`casting`、`reskinning`、`planting` 等应用标记。手部装备替换的统一取消策略放在浏览器适配中，不注入每个 Lua 状态的 `events`。

## 尚未移植的源分支

- 骑乘、重物、变身、特殊角色、预测、天气及其他组件驱动的待机分支和 `idle.onupdate`。
- `mine` / `hammer` 第 14 帧、`dig` 第 35 帧的按住控制键重复动作，以及实体级 `AddTag/RemoveTag`、反冲和完整采矿特效。
- `bugnet.onenter` 的 `dontstarve/wilson/use_bugnet` 声音和工具专属声音覆盖；当前只使用已映射的默认提交声音。
- 翻转工具的 `till2_*` 动画分支、完整 `eat` 状态、喂食、暂停饥饿、齿轮食物音效选择、进食后状态队列及口袋翻找。
- `doshortaction` 的静默、海狸和按住动作分支；`castspell` 的完整源特效及玩家控制器；表情的额外特效、声音、镜头和装备回调；`item_in` 的跟随特效清理。

验证使用 `pnpm --filter @dontstarve-web/stategraphs test`，覆盖代表性的提交、取消、跨状态动画保留和运行器回调顺序；实际动画/装备接线由 `packages/animation/tests` 的玩家与动作测试覆盖。

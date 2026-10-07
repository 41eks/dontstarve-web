# 物品栏架构与交互

开发约束见 [AGENTS.md](../AGENTS.md)。本文介绍当前状态来源、UI 事件和游戏行为；物品图标与地面 art 的具体资产见 [DST 物品资产](dst-item-assets.md)。

## 状态与模块职责

| 模块 | 职责 |
| --- | --- |
| `packages/inventory` | 权威库存状态、领域类型、槽位、堆叠限制与原子操作 |
| `src/inventoryItems.ts` | 合并库存显示元数据、帽子元数据、皮肤及领域限制，提供应用层物品规格与覆盖 |
| `src/inventory.ts` | 创建玩家的 15 个物品槽和 `hand`、`body`、`head` 三个装备槽，组合为 `InventoryStore` |
| `packages/ui/src/inventory-bar.ts` | 根据应用传入的状态显示物品与装备槽，发出交互事件 |
| `src/main.ts` | 将 store 通知同步到 UI，将 UI 事件转为库存操作或游戏动作 |

`InventorySlot`、`HandSlot`、`BodySlot`、`HeadSlot` 各自实现具体槽位行为，不共享实现父类。`InventorySlot` 提供物品堆叠上限；纯函数 `craft()` 根据配方输入及槽位计算新库存结果，`InventoryStore` 原子提交。

应用中的 `createInventoryStore()` 默认建立空玩家槽位；`src/main.ts` 从 `src/save/initialSave.ts` 读取的 `public/saves/initial-world.json` 恢复库存，通过 `inventoryStateFromSave()` 和 `replaceState()` 应用。初始物品不再硬编码在 `src/inventoryItems.ts` 中。存档设计见 [存档文档](dst-save-system.md)。

Store 通知驱动 UI 的 `setSlot()` 更新；UI 槽位模型是显示镜像。槽位地址使用稳定的 `{ containerId, slotKey }`，玩家槽位通过 `inventorySlotAddress()`、`equipmentSlotAddress()` 创建，其他容器使用其对应地址助手。

## 火把燃料与百分比

源文件位于 DST 的 `databundles/scripts_unpacked/scripts/`：`prefabs/torch.lua` 初始化 `fueled`，装备时点燃、卸下时熄灭；`components/burnable.lua` 的点燃/熄灭分别调用 `StartConsuming()` / `StopConsuming()`。`tuning.lua` 定义 `TORCH_FUEL = night_time * 1.25`，默认夜晚为 `30 * 2` 秒，因此满燃料为 75 秒。普通丢弃不点燃；投掷是独立的 `IgniteTossed()` 路径。

`components/fueled.lua` 以 `currentfuel / maxfuel` 计算比例，并发出 `percentusedchange`；`widgets/itemtile.lua` 初次刷新从 `fueled:GetPercent()` 读取比例，后续监听该事件，`SetPercent()` 用 `NUMBERFONT`、42 号字及位置 `(5, -17)` 在物品图标下方显示百分比。显示为四舍五入的整数，`0 < percent * 100 < 1` 时强制显示 `1%`；普通燃料耐久使用文字，腐败度另由 `SetPerishPercent()` 显示背景动画。

本项目的 `InventoryItemSpec.maxFuel` 保存满燃料秒数，`InventoryStack.remainingFuel` 保存每把火把的实际剩余秒数；缺省表示满燃料，兼容旧存档与新制造物品。`InventoryStore.consumeFuel()` 原子扣减，耗尽即清空槽位；`src/main.ts` 仅推进当前手持火把，并将比例同步到 UI 的 `SlotItem.durabilityPercent`。共享 slot renderer 在物品、装备和储物槽中显示相同百分比。燃料字段随库存转移、地面掉落、换肤、拾取与存档保存保留；异步加载掉落美术时，在实际提交丢弃的时刻捕获燃料。

## UI 事件与放置

| 事件 | 触发方式 | 应用处理 |
| --- | --- | --- |
| `game:slot-transfer-request` | 拖放物品 | 提交库存转移，成功后触发对应装备动画 |
| `game:slot-select` | 点击选择槽位 | 在转移拾取之前运行；可放置物品通过 `preventDefault()` 接管点击并进入放置模式 |
| `game:slot-context-menu` | 右键槽位 | 根据物品与修饰键执行吃东西、装备或丢弃等动作 |

三个事件均穿过 inventory bar 的 shadow root 冒泡。`game:slot-select` 可取消，使点击建筑物品时先启动放置，而不会先把整叠物品拿起来拖放。

网页屏蔽浏览器原生右键菜单，游戏使用自己的右键映射。

## 当前动作与动画

右键 `meatballs` 调用 `WilsonAnimationController.playEat()`，播放 `anim/player_actions_eat.zip`；当前只播放动作，不消耗该堆物品。

将火把移入手部装备槽播放 `item_out`，移回物品栏播放 `item_in`，两者均使用 `anim/player_actions_item.zip`。应用也对当前支持的部分手持工具使用此转移动画；具体物品判断位于 `src/main.ts`。动画只在库存转移成功后播放。

Shift + 右键已占用的库存或装备槽，在玩家当前地面位置丢弃一个物品。帽子及注册的目录物品使用源动画/build，其他未注册物品回退到其库存图标。普通掉落物点击拾取成功后回到物品栏；专用生物 prefab 可定义不同捕获或交互行为。

成功丢弃或普通拾取都播放 `anim/player_actions_item.zip` 的 `pickup`。`packages/stategraphs/src/SGwilson.ts` 为 `pickup` 设置 `playbackRate: 0.5`，即源动画的一半速度。

地面模型的源原点是脚点，供排序、拾取与存档使用；不能因为图片较高或有多层部件而改用图片中心。

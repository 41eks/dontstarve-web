# DST 温度系统源码总结

本文记录本地 DST Lua 的世界环境温度、实体温度更新和暖石（`heatrock`）机制，作为移植的源码参考。项目实现进度见下方“世界温度组件”；其余章节描述源 Lua 行为。

源码根目录：`/data/copy/AssetArchive-Dev/data/DST/data/databundles/scripts_unpacked/scripts/`。下文路径均相对于该目录，行号对应本次核对的本地版本。

## 源码入口

| 文件 | 主要入口 | 职责 |
| --- | --- | --- |
| `components/worldtemperature.lua` | `CalculateSeasonTemperature`（103）、`CalculatePhaseTemperature`（110）、`CalculateTemperature`（114）、`OnUpdate`（233） | 世界基础温度、噪声与同步 |
| `components/seasons.lua` | `UpdateSeasonMode`、`OnSeasonDirty`（241）、`OnAdvanceSeason`（265） | 季节进度、开局处理和季节推进 |
| `components/clock.lua` | `clocktick` 事件（422） | 当前昼夜阶段及阶段进度 |
| `components/worldstate.lua` | `OnTemperatureTick`（134） | 写入 `TheWorld.state.temperature` |
| `components/temperatureoverrider.lua` | `GetTemperatureAtXZ`（14）、`GetLocalTemperature`（34） | 获取当前位置的环境温度 |
| `components/fumarolelocaltemperature.lua` | `CalculateTemperature`（100）、`GetTemperatureAtXZ`（140） | 喷气孔区域的局部温度 |
| `components/temperature.lua` | `GetInsulation`（254）、`OnUpdate`（311）、`SetTemperature`（166） | 实体自身温度、热源影响、升降温速率和伤害 |
| `components/heater.lua` | `GetHeat`（53）、`GetCarriedHeat`（72） | 热源／冷源对外输出接口 |
| `components/inventoryitemtemperature.lua` | `UpdateTemperature`（297） | 显式启用的库存物品温度扩展 |
| `components/preserver.lua` | `GetTemperatureRateMultiplier`（20） | 容器对温度变化速率的倍率 |
| `prefabs/heatrock.lua` | `GetRangeForTemperature`（41）、`HeatFn`（54）、`TemperatureChange`（115） | 暖石档位、热量输出、外观和耐久 |
| `prefabs/cave_network.lua` | `custom_postinit`（8） | 洞穴世界温度倍率 |
| `tuning.lua` | 温度／保温常量（2248 起）、`HEATROCK_NUMUSES`（1729） | 默认阈值、速率和暖石使用次数 |

## 世界温度组件

[packages/componets/src/worldtemperature.ts](../packages/componets/src/worldtemperature.ts) 提供 `WorldTemperature` 类，移植世界温度的季节项、昼夜项、噪声时间、全局修正及保存／恢复逻辑。昼夜与季节输入使用 [packages/signals/src/world.ts](../packages/signals/src/world.ts) 导出的全局唯一单例 `clockstate`、`seasonstate`，环境温度由 `createMemo` 派生，并作为只读 signal 提供给宿主。

[src/worldState.ts](../src/worldState.ts) 创建会话的温度组件、恢复全局昼夜与季节输入，并将 `worldState.clock`、`worldState.season` 指向上述单例；`worldState.moonPhase` 指向同模块的月相单例 `moonphasestate`，从累计游戏时间恢复并按现有 20 天周期推进。[src/scene.ts](../src/scene.ts) 导出运行时 `worldState` 并接入主循环。每 60 个活动游戏帧累计实际 `dt`，统一更新昼夜进度、月相 signal 和噪声时间；中间帧只累计时间，不写这些输入，也不刷新时钟 UI。保存或停止场景前结算不足 60 帧的部分。昼夜与季节的光照使用同一份 signal，温度和光照 effect 在场景销毁时释放，单例保留；满月照明由夜晚和月相派生，温度的昼夜阶段保持 `night`。规则记录在 [AGENTS.md](../AGENTS.md) 的“World time and temperature”中。

现阶段季节没有自动推进组件。旧存档使用 `world.systems.season.name`（默认春季）的中点温度，并以 `world.elapsedSeconds` 初始化噪声时间；新存档恢复保存的季节温度和噪声时间，再按累计游戏时间恢复当前昼夜进度。修改季节 signal 会立即派生温度并更新季节光照，不需要逐帧重复写入。环境温度尚未接入 HUD 的角色体温显示。

```ts
import { WorldTemperature } from '../packages/componets/src/worldtemperature';
import { clockstate, seasonstate } from '@dontstarve-web/signals';

const worldtemperature = new WorldTemperature();

seasonstate.set({ season: 'spring', progress: 0.5 });
clockstate.set({ phase: 'day', timeinphase: 0.5 });
worldtemperature.OnUpdate(1); // 宿主传入这一批活动帧累计的实际秒数
console.log(worldtemperature.temperature.peek());

const saved = worldtemperature.OnSave();
worldtemperature.OnLoad(saved);
worldtemperature.dispose();
```

| 接口 | 行为 |
| --- | --- |
| `new WorldTemperature({ perlin?, onTemperatureTick? })` | 使用单例的当前季节／昼夜状态，噪声时间初始为 0；可选回调收到初始温度及后续温度变化 |
| `seasonstate` / `clockstate`（signals 包） | 全局唯一的可写输入 signal；按季节／阶段进度赋值，也支持加载保存的温度项 |
| `temperature` | 可调用的只读 memo，支持 `get/peek/subscribe`；读取缓存，不重复计算 |
| `OnSeasonTick({ season, progress })` | Lua 风格的 `seasonstate.set()` 适配接口 |
| `OnClockTick({ phase, timeinphase })` | Lua 风格的 `clockstate.set()` 适配接口 |
| `OnUpdate(dt)` / `LongUpdate(dt)` | 按宿主结算的累计秒数推进噪声时间，自动重新派生温度；`dt = 0` 不推进时间 |
| `SetTemperatureMod(multiplier, locus)` | 设置全局倍率和中心值，自动重新派生；洞穴使用 `(0.6, 0)` |
| `GetTemperature()` | 读取温度 memo |
| `OnSave()` / `OnLoad(data)` | 导出／恢复 Lua 字段 `daylight/season/seasontemperature/phasetemperature/noisetime` |
| `GetDebugString()` | 返回当前温度、全局倍率和中心值 |
| `dispose()` | 释放温度 memo 的输入订阅和可选温度回调 |

`createMemo` 保持可调用的原接口，并提供只读 signal 方法与 `dispose()`。依赖改变时同步更新派生缓存，确保同一帧的其他实体和保存操作能读取最新值；普通 `createEffect` 仍按微任务批量执行。每次 60 帧结算使用 `batch()` 同时写入昼夜进度和噪声时间，使温度 memo 在批次结束后只重新计算一次；加载也批量恢复各输入，避免发布中间温度。主循环读取的是 `worldState.temperature`，不维护第二份温度数值。

`c_save()` 将结算后的组件快照写入可选字段 `world.systems.worldtemperature`，反序列化校验并恢复这些值。缺少该字段的旧存档保持兼容；信号、memo 和订阅不进入 JSON。加载时允许以 `{ season, temperature }` 或 `{ phase, temperature }` 恢复源温度项，避免根据温度猜测日历进度；后续正常更新使用 `{ season, progress }` 和 `{ phase, timeinphase }`。

进度必须在 `[0, 1]` 内，`dt` 和噪声时间必须非负，数值必须有限。无效输入在修改状态前拒绝；保存数据缺失字段时按 Lua 默认值恢复。全局倍率与中心值属于宿主世界配置，和 Lua 一样不写入组件存档，加载时保留宿主设置。

默认噪声使用项目已有的 Three.js `ImprovedNoise`，归一化为 `(noise + 1) / 2`，再代入 Lua 温度公式。它是确定性平滑噪声，但 Lua 没有提供 DST 原生 `perlin` 的实现，因此不保证与原版同一时刻的噪声样本一致。构造参数 `perlin(x, y, z)` 可注入确定性、返回 `[0, 1]` 的替代实现，温度计算始终采样 `(0, 0, noisetime * 0.025)`。

组件没有独立定时器；结算帧数和累计时间由宿主的 `createWorldClockUpdater` 管理。本阶段不移植网络同步和 `overridecolourmodifier` 夏季 bloom 事件。代表性单元测试位于 [worldtemperature.test.ts](../packages/animation/tests/worldtemperature.test.ts) 和 [worldState.test.ts](../packages/animation/tests/worldState.test.ts)，覆盖公式组合、极端温度与倍率、60 帧结算和部分结算、JSON 保存恢复、响应式清理及无效输入时的状态保留。此次修改不改变调试命令语法、参数或支持 ID。

## 三种不同的温度

| 数值 | 保存／获取方式 | 含义 |
| --- | --- | --- |
| 世界／局部环境温度 | `TheWorld.state.temperature`、`GetLocalTemperature(inst)` | 季节和昼夜产生的背景温度，可被特殊区域覆盖 |
| 实体自身温度 | `inst.components.temperature.current` | 玩家、暖石等实体当前的连续温度 |
| 热源／冷源输出 | `heater:GetHeat()`、`GetCarriedHeat()` | 对其他实体产生影响的数值，可与自身温度不同 |

普通火堆通过 `heater` 参与实体温度计算，不直接改写 `GetLocalTemperature()`。这些 Lua 实现按环境值与热源贡献计算实体升降温，没有通过普通火堆模拟一张随空间扩散的空气温度网格。

## 世界环境温度

### 季节项

`worldtemperature.lua` 使用季节进度 `p` 计算季节温度。`Lerp(a, b, p) = a + (b - a) * p`。

| 季节 | 季节温度公式 | 从季初到季末的趋势 |
| --- | --- | --- |
| 秋季 | `55 - 50 * p` | 55°C → 5°C |
| 冬季 | `5 - 30 * sin(PI * p)` | 5°C → 季中 −25°C → 5°C |
| 春季 | `5 + 50 * p` | 5°C → 55°C |
| 夏季 | `55 + 40 * sin(PI * p)` | 55°C → 季中 95°C → 55°C |

`seasons.lua` 发出 `seasontick`，其中：

```lua
progress = 1 - remainingdaysinseason / totaldaysinseason
```

普通季节循环按天推进剩余天数，因此季节项按天变化；昼夜项和噪声项随时间连续更新。表中季末值是公式在 `p = 1` 时的值，普通循环可能在到达该点前就切换季节。

首次开局处于春季或秋季时，`UpdateSeasonMode` 把总天数设为配置长度的两倍、剩余天数设为配置长度，使进度从 `0.5` 开始，对应季节项 30°C。之后正常切换季节使用配置长度。永久季节模式使用中点进度；无尽季节有单独的过渡和停留逻辑。

### 昼夜项

`clocktick` 提供当前 `phase` 和阶段进度 `q = timeinphase`：

```lua
q = 1 - remainingtimeinphase / totaltimeinphase
```

| 阶段 | 昼夜温度公式 | 阶段中点的修正 |
| --- | --- | --- |
| 白天 `day` | `5 * sin(PI * q)` | +5°C |
| 黄昏 `dusk` | `0` | 0°C |
| 夜晚 `night` | `-6 * sin(PI * q)` | −6°C |

阶段两端的修正为 0，昼夜长度决定曲线持续时间。这些系数来自 `worldtemperature.lua` 的 `PHASE_TEMPERATURES`，不应替换为 `tuning.lua` 中的 `DAY_HEAT = 8` 或 `NIGHT_COLD = -10`。

### 噪声与全局修正

```lua
noise = 16 * perlin(0, 0, noisetime * 0.025) - 8
base = season_temperature + phase_temperature + noise
world_temperature = (base - locus) * multiplier + locus
```

噪声项约在 −8～+8°C 内平滑波动，`noisetime` 按模拟 `dt` 累加。噪声的空间参数固定为 `(0, 0)`，因此这一项是全局随时间变化的噪声。

地表默认 `multiplier = 1`、`locus = 0`。洞穴在 `cave_network.lua` 中设置 `multiplier = 0.6`、`locus = 0`，把基础温度乘以 0.6，缩小冷热幅度。昼夜项仍读取 `clocktick` 的阶段，不能只凭洞穴的显示状态认定该项始终为夜晚。

季节公式中的 −25°C 和 95°C 不是最终环境温度的硬限制；昼夜、噪声和全局倍率在其后参与计算。世界温度公式没有实体温度的 −20～90°C 限幅。

### 更新、同步和保存

`worldtemperature` 安装在 `TheWorld.net` 上，监听 `seasontick` 和 `clocktick`。每次 `OnUpdate(dt)` 推进噪声时间、计算温度并向世界发送 `temperaturetick`；`worldstate` 收到后写入 `TheWorld.state.temperature`。

客户端和服务器各自推进计算，噪声时间使用 `net_float`，每跨过 30 秒同步区间时由服务器同步；解除暂停也会强制重同步。存档保存季节、昼夜标记、季节项、昼夜项和噪声时间，加载后重新发出温度事件。

## 局部环境温度

`GetLocalTemperature(inst)` 读取实体世界坐标后调用 `GetTemperatureAtXZ(x, z)`。返回值依次选择：

1. 最近的有效 `temperatureoverrider`：位置必须落在其活动半径内，直接使用该覆盖器的设定温度。多个覆盖器不叠加。
2. 喷气孔区域温度：若 `fumarolelocaltemperature` 对该位置有贡献，使用它返回的插值温度。
3. `TheWorld.state.temperature`：没有局部覆盖时使用世界温度。

喷气孔组件另有季节曲线：秋季 90→75°C、冬季 75→70→75°C、春季 75→90°C、夏季 90→125→90°C，叠加幅度约 ±16°C、时间尺度为 `0.05` 的 Perlin 噪声，不叠加昼夜项。

它检查当前位置地块周围 `9×9` 地块，以可通行地块中带 `fumarolearea` 标签的比例 `w` 作为权重，按地块缓存权重：

```lua
local_temperature = Lerp(world_temperature, fumarole_temperature, w)
```

`w = 0` 时返回 `nil`，由调用方回退到世界温度。

## 实体自身温度

### 基础状态与变化方向

`temperature.lua` 默认初温 35°C、最低 −20°C、最高 90°C、过热阈值 70°C；prefab 可以覆盖这些值。组件通过 `StartUpdatingComponent` 更新。

普通路径先取当前位置环境温度 `A` 和实体自身温度 `T`：

```lua
delta = A + totalmodifiers + moisture_penalty - T
```

`moisture_penalty` 来自实体的 `moisture` 组件；没有该组件时为 0。睡袋可指定环境温度，较高级遮蔽也可以限制用于实体计算的环境值。口袋维度容器中的物品使用世界温度，并跳过附近热源搜索。

`delta` 再叠加有效的携带、装备和附近热源贡献，以及温度食物、树荫等修正。它用于确定变化方向和速率，不会直接把实体温度设置为环境温度或热源输出值。

### 地面热源／冷源

搜索半径为 10 个世界单位，要求 `HASHEATER` 标签，默认排除 `INLIMBO` 和组件配置的忽略标签。必须先调用 `GetHeat(observer)` 再检查供热／制冷属性，因为暖石等 prefab 会在回调中更新属性。

默认距离系数：

```lua
f = 1 - distance_squared / 100
```

热源可以禁用距离衰减，也可以设置额外的半径截断。观察者湿润时还会修正 `f`：正输出值乘以 `WET_HEAT_FACTOR_PENALTY`，负输出值除以该倍率（倍率非零时）。

| 类型 | 有效输出温度 | 加入 `delta` 的条件与贡献 |
| --- | --- | --- |
| 供热 `exothermic` | `H = heat * f` | `H > T` 时加入 `H - T` |
| 制冷 `endothermic` | `C = (heat - overheattemp) * f + overheattemp` | `C < T` 时加入 `C - T` |

多个有效来源的贡献逐个相加，不是只选择最强来源。制冷衰减相对于过热阈值计算，不能直接套用供热的乘法。

### 携带和装备热源

玩家温度组件分别检查装备槽、物品栏、当前溢出容器（通常为背包）和鼠标吸附物品。装备读取 `GetEquippedHeat()`，其他位置读取 `GetCarriedHeat()`。

供热来源只有在 `heat > T` 时生效，制冷来源只有在 `heat < T` 时生效：

```lua
delta = delta + (heat - T) * carriedmult
```

这一分支不使用地面距离衰减。

### 保温与变化速率

保温值由实体固有值、装备、胡须、遮蔽和修正器累计，最后限制为非负。胡须增加冬季保温、减少夏季隔热；非洞穴的黄昏和夜晚分别额外增加 60、120 夏季隔热。

令 `Iw` 为冬季保温、`Is` 为夏季隔热，`SEG_TIME = 30`。普通路径使用以下速率：

| 环境与方向 | `rate` |
| --- | --- |
| `A >= 35` 且 `delta > 0` | `min(delta, 30 / (30 + Is))` |
| `A >= 35` 且 `delta <= 0` | `max(delta, T >= overheattemp 时为 -5，否则为 -1)` |
| `A < 35` 且 `delta < 0` | `max(delta, -30 / (30 + Iw))` |
| `A < 35` 且 `delta >= 0` | `min(delta, T <= 0 时为 5，否则为 1)` |

随后乘以直接所属容器的 `preserver:GetTemperatureRateMultiplier(item)`（默认 1），并执行：

```lua
T_new = clamp(T + rate * dt, mintemp, maxtemp)
```

保温控制速率，不直接改变自身温度或暖石输出。`SetTemp()` 锁温、传送中或带 `health` 组件且无敌时，`OnUpdate` 会提前返回。

### 冰箱、事件、伤害与存档

直接所属容器带 `fridge` 且没有 `nocool` 标签时，跳过普通温差／热源计算，持续按 −1°C/s 降温；`lowcool` 容器使用 −0.5°C/s。最低温度改为：

```lua
mintemp = max(default_mintemp, min(0, ambient_temperature))
```

因此冰箱通常冷到 0°C；环境低于 0°C 时可继续冷却，仍受默认最低温度约束。容器温度速率倍率同样适用。

`SetTemperature()` 限制温度并发出 `temperaturedelta`，数据包含 `last`、`new` 和 `hasrate = (rate ~= 0)`；越过 0°C 或过热阈值时发送开始／停止冻结或过热事件。带生命组件的实体在 `T < 0` 或 `T > overheattemp` 时按 `dt` 扣血。

组件保存当前温度及尚未结束的温度食物效果。非玩家（包括暖石）读档恢复保存温度；玩家有针对离线季节变化的特殊恢复逻辑，不总是照搬旧体温。

### 库存物品温度扩展

`InventoryItem:EnableTemperature()` 可显式添加 `inventoryitemtemperature`。这是独立的库存扩展；暖石使用的是 `temperature`，不能把两者的更新规则混用。

该扩展通常每 1 秒结算，接近平衡后改为每 3 秒检查；实体睡眠时停止任务，唤醒后补算经过时间。默认温差阈值为 0.25°C，目标为整数温度时另有到达目标的处理。普通升温和降温分别使用夏季／冬季保温限制，冰箱则向 0°C 靠近。堆叠合并按数量加权混合温度，存档保存温度。

## 暖石 `heatrock`

### 初始化与自身温度

暖石创建时把 `temperature.current` 设置为世界温度，而非局部覆盖温度。固有冬季保温和夏季隔热均为 `INSULATION_MED = 120`；默认自身温度范围为 −20～90°C。

它调用 `temperature:IgnoreTags("heatrock")`，使附近热源搜索排除所有暖石，因此暖石不会互相供热或制冷。它本身没有玩家的 `inventory` 组件，也不会通过携带来源分支读取玩家体温。

白天地表受保温限制的方向，最大变化速率为 `30 / (30 + 120) = 0.2°C/s`。黄昏／夜晚会增加夏季隔热，不能把全部升降温过程都固定为 0.2°C/s；实际规则见前面的速率表。

### 五档状态与对外输出

令 `D = 暖石自身温度 - GetLocalTemperature(inst)`。源码按严格的 `temp > ambient + threshold` 判断档位，边界属于较低档：

| 档位 | 温差 `D` | 检查状态 | `HeatFn` 返回温度 | 供热／制冷 |
| --- | --- | --- | --- | --- |
| 1 | `D <= -30` | `FROZEN` | −10°C | 制冷 |
| 2 | `-30 < D <= -10` | `COLD` | 10°C | 制冷 |
| 3 | `-10 < D <= 10` | 默认（返回 `nil`） | 25°C | 两者都关闭 |
| 4 | `10 < D <= 30` | `WARM` | 40°C | 供热 |
| 5 | `D > 30` | `HOT` | 60°C | 供热 |

地面 `heatfn` 和携带 `carriedheatfn` 都使用 `HeatFn`，每次调用重新按当前自身温度和局部环境计算档位，并通过 `SetThermics()` 设置供热／制冷属性。第 3 档虽然返回 25°C，但两种属性均关闭，所以不影响其他实体。

携带倍率为 `HEAT_ROCK_CARRIED_BONUS_HEAT_FACTOR = 2.1`。例如环境为 0°C、暖石为 50°C 时处于第 5 档，对外输出为 60°C；玩家体温为 20°C 时，携带贡献为 `(60 - 20) * 2.1 = 84`。84 是加入玩家 `delta` 的贡献，不是每秒升温量，玩家速率仍由自己的温度组件计算。

### 外观和发光

暖石监听 `temperaturedelta`，每次事件重新判断档位，档位变化时：

- 播放 `anim/heat_rock.zip` 的 bank/build `heat_rock` 中对应的 `1`～`5` 循环动画。
- 库存图标切换为 `(skinname or "heat_rock") .. range`，保留皮肤对应的温度档位。
- 第 5 档开启 bloom 和独立的 `heatrocklight`；其他档位关闭。

第 5 档亮度按温差计算：`clamp(0.5 * (D - 30) / 50, 0, 0.5)`。灯光跟随最外层物品所有者，口袋维度容器或埋藏状态会隐藏灯光。换档不等于自身温度发生跳变；环境变化也可能触发换档。

### 耐久消耗

暖石使用 `fueled` 的 `USAGE` 类型，初始值 100；此 prefab 没有启动持续燃料消耗任务。耐久由极端温度循环扣除：

1. 第 1 档记录最低温度 `lowTemp`（向下取整），清除 `highTemp`；第 5 档记录最高温度 `highTemp`（向上取整），清除 `lowTemp`。
2. 中间档位先按当前环境重新判断历史极值。如果历史最低温度已经属于第 3 档或以上，或者历史最高温度已属于第 3 档或以下，清除对应记录。
3. 档位发生变化、事件 `hasrate` 为真且记录仍有效时，冷循环到达第 3 档或以上，或热循环到达第 3 档或以下，扣除 `1 / HEATROCK_NUMUSES`。

`HEATROCK_NUMUSES = 8`，所以每次有效循环扣除 12.5% 耐久，并清除极值记录；耗尽时移除实体。普通中间档位变化不扣耐久，也不是每次加热或每次冷却都扣。极值记录会先按当前环境检查，避免把环境变化导致的所有换档都当作完整使用循环。

### 保存与恢复

| 状态 | 保存位置 |
| --- | --- |
| 当前连续温度 | `temperature:OnSave()` 的 `current` |
| 剩余耐久 | `fueled:OnSave()` 的 `fuel`（非满值时保存） |
| 未完成循环的最高／最低温度 | 暖石 `OnSave()` 的 `highTemp` 或 `lowTemp` |

动画档位和灯光是派生状态，温度事件重新计算它们。移植时应同时保留自身温度、耐久和未完成循环的极值记录，不能仅保存图标档位。

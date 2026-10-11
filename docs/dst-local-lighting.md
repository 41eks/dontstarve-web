# DST 局部光源实现：火把、衰减与光照贴图

本文总结本地 DST 资源中已经确认的局部光源代码，以普通火把为例。环境光和 Colour Cube 的说明见 [DST 灯光原理](dst-lighting.md)。前面各节记录原版实现依据，末节记录当前项目已接入的局部光照贴图及其估计参数。

## 源码位置

本地源资源根目录为 `/data/copy/AssetArchive-Dev/data/DST/data`。以下路径均相对该目录：

| 路径 | 关键代码 |
|---|---|
| `databundles/scripts_unpacked/scripts/prefabs/torch.lua` | 装备、卸下、投掷、收回和熄灭时管理火焰与灯光 |
| `databundles/scripts_unpacked/scripts/prefabs/torchfire_common.lua` | 创建 `Light`，绑定父实体，同步范围档位，移除光源 |
| `databundles/scripts_unpacked/scripts/prefabs/torchfire.lua` | 普通火把的火焰、烟雾粒子和 Bloom 设置 |
| `databundles/scripts_unpacked/scripts/tuning.lua` | `TORCH_RADIUS`、`TORCH_FALLOFF`、Wilson 技能档位 |
| `databundles/shaders.zip` → `shaders/lighting.ksh` | 根据地面距离计算局部光源颜色 |
| `databundles/shaders.zip` → `shaders/ground.ksh` | 地面按世界 XZ 坐标采样光照贴图 |
| `databundles/shaders.zip` → `shaders/anim.ksh` | 动画精灵采样光照贴图，并应用 `LIGHT_OVERRIDE` |
| `databundles/shaders.zip` → `shaders/vfx_particle.ksh` | 火把粒子使用的 shader，也采样光照贴图 |
| `databundles/shaders.zip` → `shaders/postprocess_bloom.ksh` | 原画面与 Bloom 缓冲相加 |

`.ksh` 是带二进制元数据的容器，内部保留顶点和片元 GLSL 文本，不能直接把整个文件当成纯文本 shader 提交给 WebGL。可以用 `unzip -l` 查看归档条目，用 `unzip -p ... shaders/lighting.ksh | strings` 快速查看可读内容；准确提取 shader 时还需处理容器中的段名、长度和元数据。

若以后将这些资源导入项目，应保持原路径：`databundles/shaders.zip` 对应 `public/dst/data/databundles/shaders.zip`，运行时 URL 为 `${import.meta.env.BASE_URL}dst/data/databundles/shaders.zip`。

## 火把的实体与生命周期

火把道具、可见火焰和照明实体分别承担不同职责：

```text
torch 道具
  └─ 装备时创建 torchfire 特效
       ├─ 火焰和烟雾：Follower 跟随角色的 swap_object 符号
       └─ _light：独立 Light 实体，父实体设为角色
```

`torch.lua` 的 `onequip()`（130～164 行）先点燃道具，再为普通皮肤创建 `torchfire`；皮肤可以通过 `SKIN_FX_PREFAB` 指定其他特效。核心调用为：

```lua
local fx = SpawnPrefab(fx_prefab)
fx.entity:SetParent(owner.entity)
fx.entity:AddFollower()
fx.Follower:FollowSymbol(owner.GUID, "swap_object",
    fx.fx_offset_x or 0, fx.fx_offset, 0)
fx:AttachLightTo(owner)
```

`torchfire_common.lua` 的 `AttachLightTo()`（22～29 行）执行的是 `inst._light.entity:SetParent(target.entity)`，没有给光源添加 Follower 或设置火焰符号偏移。因此这条代码路径中，火焰跟随手部动画，照明实体位于目标实体的原点；不能把火焰粒子的位置直接当作照明中心。父实体是玩家时，光源还会添加 `playerlight` 标签。

卸下、放入背包等路径会删除 `inst.fires` 中的特效。每个特效的 `OnRemoveEntity()` 随之删除 `_light`，避免遗留照明实体。燃料耗尽和外部熄灭也会进入相应的移除流程。

投掷路径 `IgniteTossed()`（279～302 行）将特效挂到火把道具自身，火焰跟随其 `swap_torch` 符号，光源通过 `AttachLightTo(inst)` 绑定道具。投掷落地后可以继续照明；普通丢弃行为不能仅凭这一投掷路径推定为持续燃烧。

## 光源参数与技能档位

`torchfire_common.lua` 的 `CreateLight()`（1～20 行）创建非网络同步、不可持久保存的光源实体：

```lua
inst.entity:AddTransform()
inst.entity:AddLight()

inst.Light:SetIntensity(0.75)
inst.Light:SetColour(180 / 255, 195 / 255, 150 / 255)
inst.Light:SetFalloff(TUNING.TORCH_FALLOFF[1])
inst.Light:SetRadius(TUNING.TORCH_RADIUS[1])
```

默认 RGB 约为 `(0.706, 0.765, 0.588)`，并非直接取火焰粒子的橙红色。`tuning.lua`（7029～7052 行）定义以下档位：

| 范围档位 | 半径 | Falloff | 来源 |
|---:|---:|---:|---|
| 1 | 2 | 0.5 | 默认 |
| 2 | 3 | 0.6 | `wilson_torch_4` |
| 3 | 4 | 0.75 | `wilson_torch_5` |
| 4 | 5 | 0.9 | `wilson_torch_6` |

`torch.lua` 的 `applyskillbrightness()` 调用各特效的 `SetLightRange(value)`。这里的 `value` 是表索引，不是直接的亮度或半径乘数；设置范围时同时更新半径和 Falloff，强度仍为 `0.75`。

特效用 `net_tinybyte` 同步 `_lightrange`。客户端监听 `lightrangedirty` 更新本地光源，并在 `OnEntityReplicated()` 中根据特效的父实体重新绑定 `_light`。光源本身无需作为网络实体复制。

## 局部光源的 shader 衰减

`shaders/lighting.ksh` 的顶点 shader 将顶点变换到世界坐标并传给 `PS_POS`。片元 shader 的核心代码如下，保留原有变量和公式：

```glsl
uniform vec3 LIGHT_POS;
uniform vec3 LIGHT_COLOUR;
uniform vec3 LIGHT_PARAMETERS;
uniform vec3 LIGHT_CONSTANTS;

#define FC LIGHT_PARAMETERS.x
#define RC LIGHT_PARAMETERS.y
#define S LIGHT_PARAMETERS.z
#define K0 LIGHT_CONSTANTS.x
#define K1 LIGHT_CONSTANTS.y

void main()
{
    float dist = distance(PS_POS.xz, LIGHT_POS.xz);
    float t = clamp(exp(K0 * pow((dist / RC), -K1)), 0.0, 1.0);
    vec3 colour = mix(vec3(0, 0, 0), LIGHT_COLOUR.rgb, t);
    gl_FragColor = vec4(colour, 1);
}
```

可以直接确认：

- 距离取世界 XZ 平面，不包含 Y 高度。
- 输出 RGB 等价于 `LIGHT_COLOUR * t`，其中 `t` 被限制到 `[0, 1]`。
- 公式使用指数和幂函数，没有使用常见的 `1 / distance²` 点光源衰减。
- `FC` 和 `S` 虽被定义，但没有在这个片元公式中直接使用。

不能仅凭变量名把 `RC` 认定为 Lua 的 `SetRadius()` 原值，也不能把 `SetIntensity(0.75)` 直接当成最终 RGB 乘数。当前查到的 Lua 与 shader 中没有给出半径、Falloff、Intensity 到 `RC`、`K0`、`K1` 的转换公式。距离为零时公式的处理同样未在这里显式保护；移植时需明确数值边界处理。

## 地面、角色与粒子如何使用光照

`ground.ksh`、`anim.ksh` 和 `vfx_particle.ksh` 内嵌了同一套光照贴图采样函数：

```glsl
uniform vec4 LIGHTMAP_WORLD_EXTENTS;
#define LIGHTMAP_TEXTURE SAMPLER[3]

vec3 CalculateLightingContribution()
{
    vec2 uv = (PS_POS.xz - LIGHTMAP_WORLD_EXTENTS.xy)
        * LIGHTMAP_WORLD_EXTENTS.zw;
    return texture2D(LIGHTMAP_TEXTURE, uv.xy).rgb;
}
```

采样 UV 由世界 XZ 坐标计算，与屏幕 UV 无关。虽然源码注释将 `LIGHTMAP_WORLD_EXTENTS` 写为“xy = min, zw = max”，实际代码对 `zw` 做乘法；复现时应按公式提供相应的坐标缩放系数，不能直接套用未经转换的世界最大坐标。

地面先读取基础纹理和噪声，再乘光照：

```glsl
base_colour.rgb *= CalculateLightingContribution();
```

动画精灵还支持最低光照覆盖：

```glsl
vec3 light = CalculateLightingContribution();
gl_FragColor.rgb *= max(light.rgb,
    vec3(LIGHT_OVERRIDE, LIGHT_OVERRIDE, LIGHT_OVERRIDE));
```

因此这些 shader 的逐像素照明主要由光照贴图提供。内嵌函数中接收 `vec3 normal` 的重载直接返回 `vec3(1, 1, 1)`，不能据此宣称已经实现了基于法线的漫反射或实时阴影。

结合局部光源 shader 的颜色输出和这些材质的采样代码，可以推断引擎会先生成供场景使用的世界平面光照贴图。但这些文件没有说明多个光源如何混合、环境光如何写入贴图、贴图分辨率及更新调度；这些仍是引擎侧待确认内容。`ground_lights.ksh` 虽然名称带有 lights，片元代码主要使用基础纹理和噪声输出颜色，并非上述距离衰减公式的来源。

## 火焰粒子与 Bloom

`torchfire.lua` 的 `common_postinit()`（109～178 行）创建两个粒子发射器，使用 `shaders/vfx_particle.ksh`：

| 发射器 | 纹理 | 混合 | 最长生命周期 | 目标发射率 |
|---|---|---|---:|---:|
| 烟雾 | `fx/smoke.tex` | `BLENDMODE.Premultiplied` | 0.7 秒 | 80 个/秒 |
| 火焰 | `fx/torchfire.tex` | `BLENDMODE.Additive` | 0.3 秒 | 40 个/秒 |

两者都调用 `EnableBloomPass(..., true)`。粒子的颜色和缩放随生命周期由 EnvelopeManager 控制；普通火焰特效的跟随偏移 `fx_offset` 为 `-110`。专用服务器跳过本地粒子创建，但仍保留光源创建路径。

`vfx_particle.ksh` 把纹理色乘粒子色和透明度，再乘光照贴图采样结果。`postprocess_bloom.ksh` 的合成则是原画面 RGB 加 Bloom 缓冲 RGB。Bloom 的完整提取、模糊和调度流程不由这一个合成 shader 说明。

因此，局部照明、火焰粒子和 Bloom 应作为三个环节处理；光源的半径不会直接控制粒子大小，粒子的加法混合也不能替代照亮地面和角色的光照贴图。

## 当前项目的实现与估计参数

[`src/dstLocalLighting.ts`](../src/dstLocalLighting.ts) 已实现一张 256×256 的世界 XZ 光照贴图，支持玩家手持火把、手持和地面的提灯，以及地面的荧光果。默认环境是春季夜晚，原始环境 RGB 为零；春季夜晚按原版约定复用黄昏 LUT。

灯光开关由 [`src/playerHandEquipment.ts`](../src/playerHandEquipment.ts) 订阅共享手部 signal，调用 torch prefab 的装备生命周期工厂，并由其燃烧 signal 通过应用注入的 `DstLightingRenderer.setTorchOwner(player | null)` 绑定或关闭光源。先注册订阅，再从存档恢复并写入 signal，动画和灯光都由该次写入触发；后续使用成功转移后的装备实体引用。未装备的背包火把和普通丢到地面的火把不亮。角色每帧的世界原点决定贴图中心，照明不依赖手部动画、镜头朝向或屏幕坐标。

当前使用以下估计规则，**它们不是已确认的 DST 引擎参数转换**：

| 项目 | 当前取值或规则 |
|---|---|
| 世界尺寸换算 | DST 地皮宽 4，本项目 `TILE_SIZE = 12`，比例为 3 |
| `RC` | 默认半径 2 × 世界比例 3 × 范围倍率 1.5 = 9（扩大 50%） |
| `K0` | `log(0.5)`，在距离 `RC` 处保留一半的衰减系数 |
| `K1` | `-2`，因此采用 `exp(log(0.5) * (distance / RC)²)` |
| 局部光源颜色 | 原版 `(180, 195, 150) / 255` × 强度 `0.75` |
| 环境与局部光合成 | `clamp(ambient + local, 0, 1)` |
| 贴图覆盖范围 | 只有手持火把时以角色为中心，边长 54 世界单位；多光源时覆盖各光源 `3RC` 范围的并集 |
| 有限范围处理 | 距离 `2.5RC` 至 `3RC` 用 smoothstep 将局部光平滑降为零，贴图外仅用环境光 |
| 光源中心保护 | 归一化距离下限 `0.0001`，避免零距离的幂函数边界问题 |

材质在显示颜色空间将自身 RGB 乘光照，再转回线性颜色供透明合成。世界坐标变换包含 instance/batching 矩阵，保证实例化对象不会共享错误的原点。新加载的帽子、建筑、地面物品及树木材质会在渲染前自动接入；已有共享材质只补丁一次。深度预通道的 `colorWrite = false` 材质不改动，保留原有几何分组、材质顺序及深度策略。

[`src/dstLighting.ts`](../src/dstLighting.ts) 的全屏 shader 只执行 LUT 调色，不再重复乘环境色。背景颜色则单独应用环境乘色并在场景渲染后恢复原对象，避免夜晚的天空仍亮。这样环境为零时，局部光源照亮的材质仍能进入调色阶段。

火把接入的是局部照明；原版火焰/烟雾粒子、Bloom、技能档位、燃料消耗和投掷后持续照明尚未接入该控制器。引擎参数转换、多光源合成和贴图调度的精确规则仍待确认。

浏览器回归测试位于 `packages/ui/tests/dst-lighting.spec.ts`，检查默认春季夜晚、地面衰减、后加入的透明实例受光、光源移动、关闭后恢复夜色，以及切回白天的全局照明。

### 提灯的手持与地面照明

[`packages/prefab/src/lantern.ts`](../packages/prefab/src/lantern.ts) 根据
`mininglantern.lua` 创建提灯的视觉与光源状态：装备时使用 `swap_lantern` 和
`lantern_overlay`，地面亮灯使用 `lantern` bank/build 的 `idle_on`。放回背包或
燃料比例为零时关闭，地面关闭状态为 `idle_off`。基础动画和 12 个皮肤 ID 均保持源路径，
不以背包图标代替地面或手持外观。

`LanternLightController` 将光源描述挂到角色或地面提灯根实体，通过
`getPrefabLocalLight()` 供应用读取。原版随燃料比例变化的半径 3～5 换算为 9～15
世界单位，强度为 0.4～0.6，Falloff 固定 0.9；颜色与火把相同。
本项目额外扩大 50% 的范围倍率仅用于火把，不额外扩大提灯范围。

应用每帧收集场景中的提灯光源，将环境色写入贴图后，为每个光源使用一次加法混合
绘制，并在 RGBA8 目标中限制到 `[0,1]`。提灯同样暂用 `K0 = log(falloff)`、
`K1 = -2` 的估计衰减公式。每盏灯以自己的实体原点为照明中心；多盏地面提灯可以
同时照明，远离玩家的灯不会因火把贴图范围而被裁掉。移除地面模型后，对应光源自动
退出收集，不影响剩余灯。贴图仍为固定分辨率，大范围分散光源会降低其空间采样精度。

当前应用按满燃料展示，不消耗燃料；Prefab 提供 `setFuelPercent()` 和 `setLit()`
接口，但背包和地面存档尚未增加逐件燃料或开关状态。地面保存的提灯在恢复时默认点亮。
`packages/ui/tests/lantern.spec.ts` 检查手持符号、皮肤别名、地面亮／灭姿态、
燃料耗尽、多个光源、失败的转移、拾回关闭及存档恢复。

### 荧光果的地面照明

[`packages/prefab/src/lightbulb.ts`](../packages/prefab/src/lightbulb.ts) 根据
`prefabs/lightbulb.lua` 实现 `createLightbulbGroundSprite()`。地面使用 `anim/bulb.zip`
的 bank/build `bulb` 和 `idle` 动画，创建时默认开启局部光源；对应源文件的
`OnDropped()` 开启、`OnPutInInventory()` 关闭行为。

原版参数为半径 0.5、强度 0.5、Falloff 0.7、颜色 `(237,237,209)/255`。
项目按世界比例将半径换算为 1.5，不应用火把额外的范围倍率。衰减仍用通用估计
`K0 = log(0.7)`、`K1 = -2`；多颗荧光果与提灯可共同写入光照贴图。

应用的地面物品管理器仅在成功丢弃后把模型加入场景，成功拾回后调用 `dispose()`
移除模型及光源。丢弃或拾取失败不会造成物品或照明丢失；保存和恢复沿用地面物品
的真实脚点与堆叠记录。背包中的荧光果不作为场景光源。Prefab API 另提供
`setLit()`，可以单独控制开关。

源 Lua 还调用 `SetBloomEffectHandle("shaders/anim.ksh")` 并添加腐坏、食物和燃料组件，
这些尚未移植到当前荧光果实现。`packages/ui/tests/lightbulb.spec.ts` 验证原版地面资源、
照明范围、开关、失败的转移、拾回熄灭和存档恢复。

### 唤星者魔杖与矮星

`prefabs/staff.lua` 的 `yellow()` 使用 `swap_staffs` build 中的
`swap_yellowstaff` 替换玩家 `swap_object`。它的 `createlight()` 在施法位置生成
`stafflight`，显示名为 Dwarf Star（矮星）。物品本身不提供持续的手持照明。

[`packages/prefab/src/yellowstaff.ts`](../packages/prefab/src/yellowstaff.ts) 提供手持
资源解析和右键地面施法绑定。玩家控制器播放 `player_staff.zip` 的
`staff_pre → staff`，按 `SGwilson.lua` 的第 53 帧提交召唤；施法期间停止移动，
卸下或其他动作取消尚未提交的召唤，已经生成的矮星独立存在。
临时施法光源按 `staff_castinglight.lua` 更新：延迟 0.33 秒，随后 1.9 秒内
使用 `k = progress^5`，半径 `0.3 + 10k`、强度 `0.8 - 0.6k`、
Falloff `0.9 - 0.4k`；颜色为 `(223,208,69)/255`，半径乘场景单位比例 3。

[`packages/prefab/src/stafflight.ts`](../packages/prefab/src/stafflight.ts) 使用
`star_hot.zip` 的 bank/build `star_hot`，播放 `appear → idle_loop → disappear`。
保留源原点为地面脚点，将矮星作为独立实体参与相机深度排序。
按源 Lua 的 `s = abs(sin(PI * ageSeconds * 0.05))` 更新照明：

| 参数 | 原版值 | 当前场景值 |
|---|---|---|
| 半径 | `11 + s` | `33 + 3s` 世界单位 |
| 强度 | `0.8 - 0.1s` | 相同 |
| Falloff | `0.8 - 0.1s` | 相同 |
| 颜色 | `(223,208,69)/255` | 相同 |
| 寿命 | `480 * 3.5` 秒（1680 秒） | 按项目要求：24 分钟（1440 秒） |

范围不额外增加火把的 50% 倍率。引擎 shader 常数仍沿用通用估计
`K0 = log(falloff)`、`K1 = -2`；矮星与火把、提灯、荧光果共同写入局部光照贴图。
每颗矮星固定在右键 raycaster 命中的地面点，鼠标移动、角色移动和卸下魔杖
不改变已经召唤的矮星位置。矮星独立计时 24 分钟，到期播放消失动画，
1 秒后移除模型及光源。保存记录使用
`world.entities.stafflight[].components.timer.remainingSeconds`；恢复时由剩余寿命
推算脉动相位并继续计时，已经进入消失阶段的矮星不再保存。

应用中执行 `c_give("yellowstaff")`，装备到手部后右键地面。当前不消耗耐久和理智，
矮星的加热、烹饪、引燃、声音、独立施法特效与 Bloom 尚未接入。
`packages/ui/tests/yellowstaff.spec.ts` 验证基础及 4 个皮肤手持、多方向、施法时序、
重复点击、取消与卸下、夜间照明、独立寿命和销毁；保存读写测试验证计时记录及范围。

矮星 ID 使用 `saveRecord.ts` 的 `newEntityId()`，兼容没有 `crypto.randomUUID()`
的 HTTP 开发环境。浏览器回归测试同时禁用该接口验证召唤成功；避免施法光能显示，
却因创建矮星时报错而没有持续照明。

### 建造预览与鼠标提示

原版 `prefabutil.lua` 的 `MakePlacer()` 创建世界实体，并调用
`AnimState:SetLightOverride(1)`。当前 `BuildCursor` 同样保留预览的世界坐标、
地面吸附、面向相机和脚点深度排序；预览继续参与世界遮挡。
`setPrefabLightOverride(model, 1)` 为预览根节点设置最低材质亮度，
`dstLocalLighting.ts` 将它传给各子网格材质的 `dstLightOverride` uniform，
用 `max(dstLight, vec3(dstLightOverride))` 覆盖光照下限。
这只改变预览本身，不产生局部光源；季节颜色校正仍作用于世界预览。
落地或取消时清除覆盖，后续动画帧恢复普通环境光和局部光照。
预览使用独立的动画/皮肤 atlas 材质，不修改其他世界实体的共享材质。

鼠标 label 的 DOM、样式与按钮字形由 `packages/ui/src/cursor-label.ts`
管理，prefab 通过 `WorldContext.createCursorLabel` 注入显示接口。
label 不经过世界光照贴图或季节 LUT。建造提示优先于手持动作提示；
手持 `yellowstaff` 时显示右键图标和 `: 施放法术`，卸下后清除。
鼠标在游戏 UI 上方时隐藏提示。

左右键图标来自原版 `fonts/controllers.zip` 的 `font.fnt` 和 `font.tex`，
字形分别为 `U+E100` 与 `U+E101`。中文文案使用中文字体回退。
归档从 `databundles/fonts.zip` 按原路径、原始字节导入
`public/dst/data/fonts/controllers.zip`，可执行
`python3 packages/ui/scripts/import-controller-font.py --check` 校验。
`packages/ui/tests/cursor-preview.spec.ts` 验证夜间亮度、光照覆盖清除、
世界实体放置/取消、按钮字形、UI 提示优先级及隐藏规则。

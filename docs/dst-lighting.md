# 《饥荒联机版》灯光原理

本文总结《饥荒联机版》（DST）地表世界的环境灯光机制，以及当前项目对这套机制的实现方式。结论来自以下 Lua 源码：

- `scripts/components/ambientlighting.lua`
- `scripts/components/weather.lua`
- `scripts/components/colourcube.lua`
- `scripts/postprocesseffects.lua`
- `scripts/prefabs/forest.lua`
- `scripts/main.lua`

## 总体结论

DST 的昼夜照明并不是通过一个会移动的太阳方向光实现的。地表的主要视觉效果由两层组成：

1. **全局环境光**：根据白天、黄昏、夜晚、季节、月相和天气计算一个 RGB 乘色。
2. **Colour Cube 后处理**：使用季节和时段对应的颜色查找表（LUT），通过全屏 shader 对最终画面调色。

火把、营火和发光生物等局部光源使用实体上的 `Light` 组件，属于另一套局部光照机制，不负责世界整体的昼夜颜色。

整体渲染关系可以概括为：

```text
昼夜阶段 + 季节 + 月相
          │
          ▼
    选择环境光 RGB ────── 天气亮度
          │                  │
          └────── 相乘 ──────┘
                    │
                    ▼
          设置世界全局环境颜色
                    │
                    ▼
       渲染地面、角色、建筑和局部光源
                    │
                    ▼
       使用季节 Colour Cube 全屏调色
                    │
                    ▼
                 最终画面
```

## 全局环境光

`ambientlighting.lua` 保存当前时段、季节、月相、天气亮度和夜视状态，并把计算后的颜色交给引擎：

```lua
TheSim:SetAmbientColour(r, g, b)
TheSim:SetVisualAmbientColour(r, g, b)
```

其中维护了两套颜色：

- `realcolour`：实际世界环境亮度，也供 `LightWatcher` 等游戏逻辑使用。
- `overridecolour`：玩家最终看到的环境颜色，可以被夜视等玩家视觉效果覆盖。

正常状态下两套颜色相同。专用服务器仍会创建 `ambientlighting`，因为服务端的光照判定需要它；纯视觉的 `colourcube` 则只在客户端创建。

### 昼夜颜色

普通季节使用以下环境颜色：

| 阶段 | RGB（0～255） | 归一化 RGB | 过渡时间 |
|---|---:|---:|---:|
| 白天 | `(255, 230, 158)` | `(1.000, 0.902, 0.620)` | 4 秒 |
| 黄昏 | `(150, 150, 150)` | `(0.588, 0.588, 0.588)` | 6 秒 |
| 夜晚 | `(0, 0, 0)` | `(0, 0, 0)` | 8 秒 |

春季单独覆盖了白天和黄昏颜色：

| 阶段 | RGB（0～255） | 特征 |
|---|---:|---|
| 春季白天 | `(255, 244, 213)` | 比普通白天更白、更柔和 |
| 春季黄昏 | `(171, 146, 147)` | 带淡红紫色 |

因此 DST 白天常见的暖黄色并不是来自太阳光的色温，而是整个世界统一乘上的环境颜色。

### 满月、洞穴和夜视

特殊状态会覆盖普通昼夜颜色：

| 状态 | RGB（0～255） | 过渡时间 |
|---|---:|---:|
| 满月 | `(84, 122, 156)` | 8 秒 |
| 洞穴默认环境 | `(0, 0, 0)` | 2 秒 |
| 夜视白天/夜晚 | `(200, 200, 200)` | 对应阶段时间 |
| 夜视黄昏 | `(120, 120, 120)` | 6 秒 |

满月使用偏蓝的环境色。洞穴的全局环境光为黑色，可见区域主要依赖洞穴光源及其他视觉覆盖。夜视不会简单地添加一盏灯，而是切换玩家使用的视觉环境颜色，并可进一步覆盖 Colour Cube。

### 颜色过渡

阶段变化时，组件记录起始颜色、目标颜色和剩余时间，每帧执行线性插值：

```text
current = from × (1 - t) + to × t
```

进入白天、黄昏和夜晚分别使用 4、6、8 秒，避免昼夜边界发生瞬间跳色。闪电等屏幕闪光会暂时接管环境颜色，保持数帧后再用约 0.5 秒恢复到当前阶段颜色。

## 天气如何影响亮度

天气组件不会另建一套天空灯，而是计算一个 `light` 系数，再由环境光组件乘到 RGB 上：

```text
最终环境光 = 阶段环境颜色 × weatherLight
```

白天允许的最大变暗范围如下：

| 季节 | 动态范围 `D` | 最低亮度 `1 - D` |
|---|---:|---:|
| 秋季 | 0.40 | 0.60 |
| 冬季 | 0.05 | 0.95 |
| 春季 | 0.40 | 0.60 |
| 夏季 | 0.30 | 0.70 |

黄昏和夜晚使用另一组范围：

| 季节 | 动态范围 `D` | 最低亮度 `1 - D` |
|---|---:|---:|
| 秋季 | 0.25 | 0.75 |
| 冬季 | 0 | 1.00 |
| 春季 | 0.25 | 0.75 |
| 夏季 | 0.20 | 0.80 |

动态天气下，源码先根据世界湿度求出归一化的剩余晴朗程度 `p`。降水已经开始时，还会应用二次缓动：

```text
p = p²
weatherLight = p × D + 1 - D
```

因此降水增强时画面不会线性变暗，而是更快趋近该季节允许的最低亮度。下雪时采用冬季动态范围，所以雪天仍然很明亮。

例如秋季暴雨白天达到最暗状态时：

```text
(1.000, 0.902, 0.620) × 0.60
= (0.600, 0.541, 0.372)
```

## Colour Cube 调色

环境光决定全局明暗和基础色调，Colour Cube 则负责最终画面的颜色风格。它是一张把输入 RGB 映射到输出 RGB 的三维颜色查找表，在 DST 中以横向展开的二维 `.tex` 纹理保存。

地表各季节使用的 LUT 如下：

| 季节 | 白天 | 黄昏 | 夜晚 |
|---|---|---|---|
| 秋季 | `day05_cc.tex` | `dusk03_cc.tex` | `night03_cc.tex` |
| 冬季 | `snow_cc.tex` | `snowdusk_cc.tex` | `night04_cc.tex` |
| 春季 | `spring_day_cc.tex` | `spring_dusk_cc.tex` | `spring_dusk_cc.tex` |
| 夏季 | `summer_day_cc.tex` | `summer_dusk_cc.tex` | `summer_night_cc.tex` |
| 满月 | `purple_moon_cc.tex` | `purple_moon_cc.tex` | `purple_moon_cc.tex` |

春季夜晚有意复用春季黄昏 LUT。阶段 LUT 的混合时间仍为白天 4 秒、黄昏 6 秒、夜晚和满月 8 秒；季节切换使用 10 秒。

### Shader 调用链

客户端启动时，`main.lua` 创建 `PostProcessor`，然后调用 `BuildColourCubeShader()`。`postprocesseffects.lua` 明确注册了两个 shader：

```text
shaders/combine_colour_cubes.ksh
shaders/postprocess_colourcube.ksh
```

前者组合和插值多张 Colour Cube，后者把结果应用到完整画面。Colour Cube 系统有三个通道：

| 通道 | 用途 |
|---:|---|
| 0 | 环境、季节和昼夜 LUT |
| 1 | 理智值降低时的疯狂视觉 LUT |
| 2 | 启蒙值、月亮风暴等月亮视觉 LUT |

Lua 通过纹理采样器传入源 LUT 和目标 LUT，并通过 uniform 设置混合比例。实际逐像素采样发生在 `.ksh` shader 中。

`scripts_unpacked` 只包含 Lua 调用和 shader 文件名，不包含 Klei 引擎内部代码及 `.ksh` 的可读着色器源码。因此可以确定环境色和 Colour Cube 的参数与调用顺序，但不能仅凭这些 Lua 文件还原引擎材质 shader 的全部实现细节。

## 局部光源与环境光的区别

火把、营火、灯笼和发光生物等预制体通常会执行：

```lua
inst.entity:AddLight()
inst.Light:SetColour(r, g, b)
inst.Light:SetRadius(radius)
inst.Light:SetFalloff(falloff)
inst.Light:SetIntensity(intensity)
```

它们具有世界坐标、半径、衰减和强度，只影响附近区域。昼夜环境光则没有位置、方向或半径，统一作用于整个画面和世界亮度判定。

这意味着：

- 白天不是一盏覆盖全地图的点光源。
- Lua 中没有为白天配置太阳位置或方向。
- 角色脚下常见的椭圆阴影主要是独立阴影贴图，不等于太阳实时投影。
- 局部光源可以叠加在当前环境光之上。

## 当前项目中的实现

当前项目在 [`src/dstLighting.ts`](../src/dstLighting.ts) 中实现了对应机制：

- 使用 DST 原始环境颜色和过渡时间。
- 使用全屏 shader 统一影响地面和 `MeshBasicMaterial` 精灵。
- 从 `public/dst/data/images/colour_cubes/` 加载原始季节 LUT。
- 在 shader 中对横向展开的 32×32×32 Colour Cube 做三线性采样。
- 支持四季、白天、黄昏、夜晚、满月以及降水亮度。
- 默认状态为秋季晴朗白天。

由于项目中的 DST 动画精灵多数使用不接受 Three.js 灯光的 `MeshBasicMaterial`，仅添加 `THREE.AmbientLight` 无法让角色和树木获得环境乘色。因此当前实现先把场景渲染到离屏纹理，再统一执行环境乘色和 Colour Cube 调色。这也更接近 DST“全局环境颜色 + 全屏后处理”的结构。

渲染入口位于：

- [`src/universal.ts`](../src/universal.ts)：初始化中性基础光和 DST 灯光渲染器。
- [`src/animate.ts`](../src/animate.ts)：每帧更新颜色过渡并通过后处理输出场景。
- [`packages/animation/src/parseKtex.ts`](../packages/animation/src/parseKtex.ts)：解析 LUT 使用的 KTEX RGB 纹理。

控制器提供以下接口：

```ts
dstLighting.setSeason('winter');
dstLighting.setPhase('dusk');
dstLighting.setWeatherLight(0.8);
dstLighting.setPrecipitation(1);
```

## 小结

DST 的整体灯光风格来自三类效果的组合：

1. **环境光乘色**控制昼夜基础亮度和冷暖倾向。
2. **天气亮度系数**根据季节和降水程度压暗环境。
3. **Colour Cube shader**统一调整最终画面的颜色分布。

所以要复现 DST 的白天效果，不能只设置一盏黄色方向光。至少需要让所有可见对象共享暖色环境乘色，并在最终画面上应用原版季节 LUT；局部灯光则作为独立系统按需叠加。

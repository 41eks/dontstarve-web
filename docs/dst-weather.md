# 雨雪天气实现约束

本文记录当前雨、雪的代码分工、已确认的画面参数和生命周期约束。后续修改应保留这些行为；调整画面参数、状态规则或保存字段时，同步更新本文和相关代表性测试。原版逻辑参考 DST `components/weather.lua`、`prefabs/rain.lua`、`prefabs/raindrop.lua`、`prefabs/snow.lua` 和 `shaders/ground_overlay.ksh`。下文标明的透视镜头适配、随机大小、边缘柔化和雪花最前层绘制是当前浏览器实现的约束。

## 代码责任边界

| 责任 | 实现入口 |
| --- | --- |
| 湿度、降水类型、强度、雨雪转换、积雪与融雪 | [Weather](../packages/componets/src/weather.ts) |
| 世界温度注入、加载、60 帧结算 | [worldState.ts](../src/worldState.ts) |
| 雨丝、水花对象池、雨声强度 | [RainEffect](../packages/prefab/src/rain.ts) |
| 雪花粒子、大小、柔边、覆盖层、积雪美术 | [SnowEffect](../packages/prefab/src/snow.ts) |
| 雨雪注册、每帧表现更新和场景清理 | [sceneEntities.ts](../src/sceneEntities.ts)、[scene.ts](../src/scene.ts) |
| 求雨书发起降水请求 | [books.ts](../packages/prefab/src/books.ts)、[Book](../packages/componets/src/book.ts) |
| 音效事件映射、预加载、播放及释放 | [sound.ts](../packages/prefab/src/sound.ts) |
| 天气保存字段与校验 | [types.ts](../src/save/types.ts)、[deserialize.ts](../src/save/deserialize.ts)、[serialize.ts](../src/save/serialize.ts) |

- 天气领域状态只由 `Weather` 持有。表现层接收 `rainRate`、`snowRate`、`snowCover` 的只读视图及玩家位置、相机等依赖，不另建湿度、季节或降水状态控制器。
- 湿度、上下限、降水类型、峰值强度和积雪量各自使用私有可写 signal，公开只读视图。强度及覆盖量必须由纯 `createMemo` 派生，不维护可写副本。
- 天气组件通过 `createEffect`、`get()` 读取季节和注入的温度，调用组件方法执行雨雪转换。`worldState.ts` 注入的温度函数必须读取 `worldtemperature.temperature.get()`，保持外部状态订阅。
- 表现 effect 只同步发射率、材质、可见性或声音，不执行开始／停止降水、积雪、融雪或世界保存等领域动作。
- 雨雪粒子的年龄、位置、几何更新及水花动画属于每帧表现。不能把粒子年龄误当成领域计时器，也不能让粒子动画驱动天气状态或实体移除。需要新增领域定时行为时，遵守 [组件 timer 约束](dst-event.md)。

## 天气状态与游戏时间

### 结算与触发

天气与昼夜、世界温度一起每 **60 个活动游戏帧**结算一次，累计这些帧的实际 `dt`。中间帧只累积时间，不改写湿度、积雪或世界温度；不得用固定帧率估算时间，也不得改为固定墙钟间隔。保存和显式场景停止／销毁前必须先 `flush()` 剩余不足 60 帧的时间。

`Weather.ForcePrecipitation(enable)` 对应 `ms_forceprecipitation`：`true` 把湿度设为当前上限，`false` 设为下限，之后由 `OnUpdate()` 开始或停止降水。求雨书只调用这个入口，不直接指定雨／雪，也不直接启动粒子或循环雨声。

`OnUpdate()` 保留当前顺序：先取结算前的 `precipitationRate`，再更新湿度并判断降水开始／结束，随后按更新后的降水类型结算积雪／融雪，最后执行温度引起的雨雪转换。不要在 memo 或表现 effect 中补做这些结算。

当前 `MOISTURE_RATE = 0`，干燥时湿度不会自行积累。已保存的降水可以继续消散；结束后需要再次触发降水。季节尚未自动推进，不能把当前实现描述为完整的季节天气循环。

### 强度与季节参数

无降水时 `precipitationRate = 0`；有降水时：

```text
p = clamp((moisture - moisturefloor) / (moistureceil - moisturefloor), 0, 1)
precipitationRate = min(0.1 + 0.9 × sin(PI × p), peakprecipitationrate)
rainRate = preciptype == "rain" ? precipitationRate : 0
snowRate = preciptype == "snow" ? precipitationRate : 0
```

开始降水时把湿度设为上限，按当前季节随机下限与峰值；湿度按 `precipitationRate × dt × 10` 消散，降到下限后停止并重新随机上限。

| 季节 | 上限倍数 | 下限倍数 | 峰值强度范围 | 开始下雪／雨转雪 | 雪转雨 |
| --- | --- | --- | --- | --- | --- |
| 秋 | 8 | 1 | 0.1～0.66 | `temperature < -5` | `temperature > 0` |
| 冬 | 3 | 1 | 0.1～0.8 | `temperature < 5` | `temperature > 10` |
| 春 | 5.5 | 0.25 | 0.5～1 | `temperature < -5` | `temperature > 0` |
| 夏 | 13 | 1.5 | 1 | `temperature < -5` | `temperature > 0` |

上限为 `(1 + random()) × totalDayTime × 上限倍数`；下限为 `(0.25 + random() × 0.5) × 开始降水时的湿度 × 下限倍数`。这些世界参数属于天气组件，不得放进雨雪 prefab。

转换采用严格不等号和不同的开始／停止阈值。到达阈值本身不转换；迟滞区间内保留当前类型，避免雨雪反复切换。温度或季节变化只影响已有降水的类型，不凭空开始降水。

### 积雪与融雪

```text
下雪：snowlevel = min(snowlevel + precipitationRate × dt / 300, 1)
未下雪且温度 > 0：
  meltRate = 1/120 + min(temperature / 20, 1) / 20
  snowlevel = max(snowlevel - meltRate × dt, 0)
snowCover = snowlevel × 3
```

`snowLevel` 在 0～1，`snowCover` 在 **0～3**，表示三层遮罩的开启程度，不能把它提前限制到 0～1。停雪不清除积雪；零度及以下不融雪。下雨时也可保留或融化既有积雪，取决于温度。

## 雨丝、水花与雨声

### 当前参数

数值中的长度、速度和重力先按 DST 单位表示，再乘 `WORLD_SCALE = TILE_SIZE / 4`（当前为 3）。

| 项目 | 当前实现 |
| --- | --- |
| 雨丝纹理 | `fx/rain.tex` |
| 水花美术 | `anim/raindrop.zip`，bank/build `raindrop`，动画 `anim` |
| 发射频率 | 30 Hz；每 tick 雨丝 `5 × rainRate`，水花 `2 × rainRate` |
| 粒子上限／寿命 | 4800／2 游戏秒 |
| 雨丝发射区 | 玩家 XZ 周围 ±7；高度 20，当前绝对世界 Y |
| 水花区域 | 玩家 XZ 周围 ±10；地面 Y = 0 |
| 初速 | 沿屏幕向下方向，系数 `(2 + 8 × UnitRand()) × WORLD_SCALE` |
| 重力／阻力 | 9.8／0.2；阻力按 `exp(-0.2 × dt)` 应用 |
| 形状 | 源缩放 `0.1 × 10`，宽度再乘 0.12、长度再乘 0.4 |
| 透明度 | `200/255 × 0.5` |
| 材质／顺序 | `MeshBasicMaterial`，透明、`DoubleSide`、`toneMapped = false`；`depthTest = true`、`depthWrite = false`；mesh 的 `renderOrder = 1_000_000` |

当前 `UnitRand()` 为 −1～1，因此初速系数实际为 −6～10，不能把代码公式记录成只取 2～10。雨丝当前没有显式设置 `premultipliedAlpha` 或 `forceSinglePass`；源码的预乘混合设置与浏览器材质的实际字段应分别记录。

雨丝沿相机 `-up` 方向运动，替代源码固定的世界下落／横向漂移。后续视觉调整应保留各镜头朝向下以屏幕竖直下落为主的效果，不改回朝画面中心汇聚的轨迹。

近景尺寸当前按粒子到相机的距离与玩家到相机的距离之比缩小，并限制该比例不超过 1；它与雪花的相机空间深度算法不同。低于地面的雨丝在写几何时裁掉，并同步调整 UV，不能依赖地皮写深度来裁雨。

雨丝共用一个 mesh 和预分配的几何缓冲，不为每个粒子创建 Object3D。当前每帧发射 tick 累积最多保留 10 个，物理／年龄仍按本帧 `dt` 更新；不要将这个表现限额应用到天气领域的累计时间结算。

### 水花与声音生命周期

- 水花通过 `playOnce("anim")` 播放，动画结束回到对象池；停雨清理空闲池，正在播放的水花自然完成。水花从实际地面位置参与共享的实体脚点排序，不能随雨丝一起放进雪花覆盖层。
- 停雨立即停止循环雨声及新发射，既有雨丝自然到期；重新下雨创建新的雨声播放句柄，不重用已停止的音源。
- 雨声使用 `dontstarve/AMB/rain`，由共享 `PreloadSounds`、`PlaySound` 播放，持续更新 `intensity = rainRate`。重／中／轻三层循环分别来自 `forest_stream.fsb-74.wav`、`forest_stream.fsb-76.wav`、`forest_stream.fsb-75.wav`，按 FEV 包络混合，不能按文件名猜映射或每帧重播。
- 预加载／解码及用户手势恢复音频使用共享音频设施。详细映射和提取约束见 [雨声](vgmstream-cli-guide.md#雨声)。

## 雪花的画面约束

### 发射、运动与尺寸

| 项目 | 当前实现／必须保留的行为 |
| --- | --- |
| 纹理／发射频率 | `fx/snow.tex`；30 Hz，每 tick `20 × snowRate` |
| 粒子上限 | 4800 |
| 发射区 | 玩家 XZ 周围 ±20 DST 单位；玩家 Y 上方 8 DST 单位，透视适配源码的高度 20 |
| 寿命 | 保留 `4.5 + (7.5 - 4.5) × UnitRand()`；当前实际范围为 1.5～7.5 游戏秒 |
| 初速／重力／阻力 | 零／9.8／0.8；解析积分重力与阻力，保持帧率独立 |
| 下落 | 沿相机 `-up`，位移取重力／阻力模拟的 0.1 倍 |
| 横向摆动 | 沿相机 `right`；独立随机相位、振幅 0.06～0.12 DST 单位、周期 3～6 秒，并随下落速度渐入 |
| 最小尺寸 | 源缩放包络 1 按场景乘 0.16；当前最小完整边长为 `0.16 × WORLD_SCALE`，即 0.48 场景单位 |
| 随机尺寸 | 在该最小值的 **1～2 倍**间均匀随机，每颗雪花生成时确定 |
| 颜色／淡出 | 白色、alpha `200/255`；最后 10% 寿命淡出到零 |

雪花应主要向屏幕下方缓慢飘落，横向只有轻微往返摆动。不得恢复固定的世界横向风向，导致所有粒子随镜头朝向统一向左下或右下移动。

近景尺寸和位移同时乘 `min(1, particleCameraDepth / focusCameraDepth)`。负深度粒子不绘制；接近镜头时不能突然变成大白点或快速横穿画面。尺寸范围是在已有透视校准基础上的 1～2 倍，不意味着远近所有雪花使用固定屏幕像素直径。

发射与物理模拟按 30 Hz 小步交错处理，长帧不能先发射整帧粒子再让它们一起老化。粒子紧凑池用最后一个活粒子填补空位时，必须一起迁移位置、速度、年龄、寿命、大小、柔化资格、摆动相位／振幅／周期，保留每颗粒子的身份对应关系。

### 镜头边缘的概率柔化

每颗雪花生成时有 **40%** 概率获得柔化资格；这个资格和尺寸一样在整个寿命内稳定，不能每帧重新随机或因镜头移动闪烁。

柔化在雪花 shader 中根据屏幕位置计算，保持原版纹理及中央清晰度：

```text
edge = max(abs(screenNdc.x), abs(screenNdc.y))
softness = eligible × smoothstep(0.65, 0.95, edge)
radius = length(uv - 0.5) × 2
softAlpha = 1 - smoothstep(0.45, 1.0, radius)
textureAlpha *= mix(1, softAlpha, softness)
```

即从每侧外部 17.5% 的区域开始逐渐柔化，最外部 2.5% 达到完整柔边；无资格的粒子保持原纹理。当前做法是粒子轮廓 alpha 柔化，不是全屏模糊。只减小纹理已有 alpha，不能给透明黑色 texel 增加 alpha 而产生黑边。

### 雪花必须绘制在场景最前面

- 雪花放进独立的 `SnowWeatherOverlay` Group，**Group 和粒子 mesh 都设置 `renderOrder = Number.MAX_SAFE_INTEGER`**。Three 的透明排序先比较 Group 顺序，仅把 mesh 的顺序调大不足以盖过已排序的动画实体 Group。
- 粒子材质固定 `transparent = true`、`premultipliedAlpha = true`、`DoubleSide`、`forceSinglePass = true`、`depthTest = false`、`depthWrite = false`、`toneMapped = false`。
- 雪花最后绘制，覆盖地皮、积雪、森林和其他场景物体；不能参与普通世界实体的脚点排序，不能塞进地皮层之间，也不能让森林深度预渲染挡住雪花。
- 所有雪花共用一个 mesh、纹理、索引和预分配的动态 position／color／snowBlur 缓冲，不逐颗创建 mesh 或材质。低于地面的粒子仍在写几何时裁掉，停雪后既有粒子自然到期。

普通动画实体与水花仍遵守 [Billboard 绘制顺序](dst-billboard-rendering.md)，上述最前层规则专用于雪花。

## 积雪地表美术

积雪美术与雪花粒子分开。`SnowGroundOverlay` 使用 `levels/textures/snow.tex`，该纹理的 **RGB 是三个覆盖遮罩**，不是可直接显示的彩色贴图；使用 `NoColorSpace` 读取遮罩，按 `ground_overlay.ksh` 合成白色覆盖。

```text
L = snowCover
blend = (clamp(L, 0, 1), clamp(L - 1, 0, 1), clamp(L - 2, 0, 1))
layers = texture.rgb × blend
first = layers.b
second = (1 - first) × layers.g
third = (1 - first - second) × layers.r
alpha = first + second + third
```

地表 mesh 的 `renderOrder = -0.55`。原版积雪是地图的 `SetOverlayTexture`／`SetOverlayLerp` 覆盖层，属于 `LAYER_GROUND`（3），低于池塘和熔岩池的 `LAYER_BACKGROUND`（4）、`SetSortOrder(3)`（对应 `-0.5`）。因此层级固定为：地皮混合层 `[-1, -0.6)` < 积雪 `-0.55` < 背景地面实体 `-0.5` < 动态实体。积雪不能盖住池塘、熔岩池等背景贴花；新增地皮层级必须保持在 `-0.6` 以下；使用 Lambert 光照、预乘 alpha、透明双面单 pass，`depthTest = true`、`depthWrite = false`。不要把雪花最前层的材质／顺序设置复制到积雪地表。

纹理按世界坐标重复，周期为 `TILE_SIZE × 8`（当前 96 场景单位），覆盖量只更新 shader 参数与可见性，不修改 `TurfMap` 的实际地皮数据，也不重建整个地表几何。停雪时保留覆盖，融雪到零才隐藏。

## 资源、光照、加载与销毁

- DST 纹理、动画和声音资源从原数据目录镜像到 `public/dst/data`，保留路径和原文件名，运行时使用 `${import.meta.env.BASE_URL}dst/data/`。不要用库存图标、自制图片或屏幕 DOM 雪花代替已有原版资源。
- KTEX 通过共享 `parseKtex` 解码；粒子纹理使用 sRGB、`flipY = false`、线性采样且不生成 mipmap，积雪遮罩使用无颜色空间、重复采样和 mipmap。
- 两种粒子的 `MeshBasicMaterial` 并不绕过游戏共享光照：`DstLocalLighting` 会补丁化它们，随后画面经过季节颜色滤镜。不要另加每种天气独立的光照／滤镜系统。
- `DstLightingRenderer.setPrecipitation()` 已有接口，但当前没有把天气 rate 订阅接入它；不能描述为已自动随降水强度调暗环境。
- 加载已有雨／雪天气时，在纹理就绪后执行 `fastForward()`／`PostInit()` 填充已有粒子；雨的快进不创建历史水花。瞬时粒子本身不入档。
- `dispose()` 需要幂等：释放 rate／cover effect、雨声句柄、纹理、材质、几何、水花 sprite／工厂资源以及雪花覆盖 Group。异步加载结束时先检查已销毁标志，释放刚加载的资源，不重新添加视觉。
- 停止降水与销毁场景是两个生命周期：前者只停止新发射并让已有表现结束，后者明确释放全部资源和订阅。显式游戏关闭使用共享 `DisposeSounds()`；不得在 `pagehide`、`beforeunload` 或 `unload` 注册这些清理。

## 保存、命令及实现边界

`c_save()` 先结算尾帧，再把以下字段写入 `world.systems.weather`：

| 字段 | 保存语义 |
| --- | --- |
| `moisture`、`moisturefloor`、`moistureceil` | 当前湿度及本次上下限 |
| `preciptype` | `none`／`rain`／`snow` |
| `peakprecipitationrate` | 本次峰值强度 |
| `snowlevel` | 0～1 的实际积雪量 |

`rainRate`、`snowRate`、`snowCover` 派生恢复；季节及温度保存在 `world.systems.worldtemperature`，不得只保存冬季的外观。旧天气存档缺少 `snowlevel` 时从零积雪恢复；非法字段在更改状态前校验，失败时保留原状态。详见 [保存系统](dst-save-system.md)。

默认存档当前为冬季中点，季节温度 −25°C，降水类型为雪并带薄积雪。现有调试方式为 `c_give("book_rain")` 后右键阅读：无降水时请求开始，有降水时请求停止；雨雪类型仍取决于温度。成功阅读消耗 1 次耐久（初始 5 次），基础理智代价为 33，并使用现有阅读状态、`book_fx`／`swap_books`、`fx_book_rain` 及 `wickerbottom_rework/book_spells/rain` 音效。

当前没有新增天气控制台命令；天气管理器持有的雨雪 FX 不通过 `c_spawn("rain")`／`c_spawn("snow")` 暴露，也不作为持久实体导出。命令语法、参数和其他支持的 prefab/item ID 保持既有规则。

尚未实现：季节自动推进与季节湿度积累、降水模式、实体雪覆盖、潮湿度／水洼、雷电、月亮冰雹、冬季盛宴雪粒子、雨罩／树下／雨伞／洞穴雨声分支、求雨书的农田加湿及骑乘特效。扩展这些行为时读取对应 Lua，并在所属组件／prefab 内实现，不以应用层特例绕过缺失的组件。

## 代表性验证

现有测试入口：

| 测试 | 负责的验证 |
| --- | --- |
| [weather.test.ts](../packages/animation/tests/weather.test.ts) | 冬季降雪、严格阈值与迟滞、季节／温度订阅释放、积雪／融雪、60 帧与尾帧结算、导出／加载兼容与原子校验 |
| [books.test.ts](../packages/animation/tests/books.test.ts) | 求雨书请求、消耗、降水自然停止及状态恢复 |
| [rain.spec.ts](../packages/ui/tests/rain.spec.ts) | 真实雨丝／水花、三层循环雨声与强度、停止、重新下雨和清理 |
| [snow.spec.ts](../packages/ui/tests/snow.spec.ts) | GPU 雪花与白色积雪遮罩、1～2 倍稳定随机尺寸、两个镜头朝向的下落、概率柔边与中央清晰度、前方透明深度物体不能遮挡雪花、停止和资源释放、实际 `c_save()`／重载 |

涉及状态规则时运行相关领域测试；涉及 shader、声音或排序时运行对应浏览器测试。保持正常流程、重要边界／停止和资源／状态保留的代表性覆盖，不为每个等价参数或镜头方向重复新增测试。

```sh
pnpm --filter @dontstarve-web/animation exec vitest run tests/weather.test.ts tests/books.test.ts tests/worldState.test.ts
pnpm --filter @dontstarve-web/ui exec playwright test tests/rain.spec.ts tests/snow.spec.ts --workers=2
pnpm --filter @dontstarve-web/ui typecheck
pnpm --filter @dontstarve-web/prefab typecheck
pnpm build
```

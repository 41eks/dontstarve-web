# 鼠标悬停动作文字

参考源码目录：`/data/copy/AssetArchive-Dev/data/DST/data/databundles/scripts_unpacked/scripts`。

原 Lua 的分工是 `input.lua` 获取鼠标下的实体，`components/playeractionpicker.lua` 收集并按优先级选择左右键动作，`components/playercontroller.lua` 保存动作，`widgets/hoverer.lua` 从动作的 `GetActionString()` 生成主次提示。动作名称、修饰词和优先级分别来自 `strings.lua`、`languages/chinese_s.po` 和 `actions.lua`。

当前浏览器悬停文字按相同分工处理：

- `packages/stategraphs/src/playeractionpicker.ts` 先使用共享 `PointerRaycaster` 从已登记鼠标实体中命中唯一目标，再把该模型传给动作 provider，只为目标计算左右键动作；实体候选优先于地面点候选，同类候选按源动作优先级降序排列。可见且没有 `NOCLICK` 的已注册实体即使当前动作不可用，仍参与遮挡，避免提示穿过前面的目标。重复的左右键动作会合并。
- 各交互控制器注册接收目标模型的 provider，通过模型索引查询目标适配器，读取目标组件、有效性和装备/选中条件；不创建文字标签、不调用 `show(': …')`，也不在更新循环中执行独立的 Hover raycast。
- `packages/stategraphs/src/actions.ts` 集中保存当前支持动作的源简体中文字符串及优先级。`getActionString()` 根据修饰词或工具的 `spelltype` 选择文字；`BufferedAction.getActionString()` 使用同一函数。
- `packages/ui/src/cursor-label.ts` 统一呈现主次提示。按浏览器界面要求，两条动作均显示源 `controllers.zip` 对应的鼠标图标：左键 `U+E100` 配动作文字，右键 `U+E101` 配 `: 动作文字`。提供目标显示名且没有使用物品的主动作可追加目标名。显式建造/放置提示优先覆盖动作提示；鼠标位于其他 DOM UI 上时隐藏世界提示。
- 指针移动、装备/选中状态变化和目标消失都会重新选择动作；文字和图标按屏幕边界限制位置。控制器注销候选，应用退出时释放共享指针与 Hover UI。

`CursorLabelUi.createLabel()` 为每个建造/放置提示保存独立 key。只有已显示的提示才响应其 `update()`，`hide()` 只在实际移除提示时刷新，避免多个空闲 `BuildCursor` 每帧重复调用同一个动作选择器。全局帧循环仍刷新当前悬停文字；没有鼠标位置或鼠标位于其他 DOM UI 上时，在候选收集与场景命中前返回，符合 Lua 在 HUD 上不查询世界鼠标动作的分支。动作的有效性、排序、遮挡及点击时重新校验保持原有实现。

`PointerRaycaster` 的鼠标命中统一排除隐藏节点、带 `NOCLICK` 的实体及其后代；直接查询子模型时也检查祖先。实体标签优先读取权威 `actionEntity.hasTag()`，没有实体适配器时才使用模型标签。Three.js 默认射线递归不检查 `visible`，`Box3.setFromObject()` 也会包含隐藏子模型，因此这里显式裁剪不可点击子树。虫群的 `rayTestOnBB` 只从可见部分合并包围盒，仍覆盖可见粒子间的空隙；白天消隐后的萤火虫不会挡住后方可交互对象。

普通动画 sprite 在 `SpriteFrameRenderer` 的 mesh 上统一使用 `spriteRaycast.ts`：先通过三角形求交取得 UV 与 `face.materialIndex`，再从对应材质图集保留的 alpha（每像素 1 字节，RGBA 上传 GPU 后释放；无 alpha 的纹理仍读 RGBA）采样，结合材质 `opacity` 和 `alphaTest` 排除不可见像素。采样保留图集裁切 UV、纹理变换／翻转／环绕及最近邻或双线性过滤，alpha 在 worker 解码时一并生成，不执行 GPU 回读。合并帧的不同材质组、镜像部件、换肤及共享动画帧都走同一判断；动画替换几何或材质后自动读取当前资源。透明命中被过滤后，共享拾取器选择后方实际命中的实体；不透明实体即使没有可执行动作仍会遮挡。显式 `SetRayTestOnBB(true)` 的实体保留可见包围盒语义，不应用像素过滤。这里改进的是浏览器 sprite 命中精度，Lua 的原生 `GetEntitiesAtScreenPoint` 内部算法不在脚本源码中。

`actionEntity` 创建和释放时登记／撤销鼠标目标，模型加入或离开场景时同步更新；`NOCLICK` 与 `tickingarea` 标签变更通过原实体通知同步维护集合。可命中实体按模型去重，动作是否可用不影响登记；射线仍检查祖先可见性和隐藏子部件。工具和地面物品的点击使用同一个拾取器，同一 `PointerEvent` 的结果通过弱引用缓存供各处理器复用，下一次事件及逐帧悬停重新查询。仅查询命中模型的 provider 不遍历场景，不调用全量目标 getter；地面点动作保留共享地面射线缓存。

当前接入拾取、采集、容器收获、睡觉、鼠标物品使用、捕虫、锤击、开采、铲子挖掘、铲地、耕坑、播种、扫把换肤、法杖地面动作及唱片插入。候选描述本身不会执行游戏动作。共享拾取覆盖已登记实体，并非 C++ 的完整场景拾取实现。

| 操作 | 源文字 |
| --- | --- |
| `NET` | 捕捉 |
| `HAMMER` | 敲 |
| `MINE` | 开采 |
| `DIG` / `TERRAFORM` | 挖 |
| `TILL` | 耕地 |
| `PLANT` | 栽种 |
| `PICK` | 采集 |
| `CASTSPELL` | 施放法术 |
| `CASTSPELL.RESKIN` | 打扫 |
| `GIVE.PLACE_ITEM` | 放置{item}，唱片为“放置唱片” |

选择优先级和注册生命周期在 `packages/stategraphs/tests/mouse-actions.test.mjs` 验证；实际鼠标输入、左右键文字及图标像素、覆盖、卸装/失效、DOM UI 遮挡及边界布局由 `packages/ui/tests/hoverer.spec.ts` 验证。`cursor-preview.spec.ts` 保留建造预览、原版控制图标和昼夜照明验证。

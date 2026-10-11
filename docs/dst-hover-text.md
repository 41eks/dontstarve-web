# 鼠标悬停动作文字

参考源码目录：`/data/copy/AssetArchive-Dev/data/DST/data/databundles/scripts_unpacked/scripts`。

原 Lua 的分工是 `input.lua` 获取鼠标下的实体，`components/playeractionpicker.lua` 收集并按优先级选择左右键动作，`components/playercontroller.lua` 保存动作，`widgets/hoverer.lua` 从动作的 `GetActionString()` 生成主次提示。动作名称、修饰词和优先级分别来自 `strings.lua`、`languages/chinese_s.po` 和 `actions.lua`。

当前浏览器悬停文字按相同分工处理：

- `packages/stategraphs/src/playeractionpicker.ts` 收集注册的候选描述，使用共享 `PointerRaycaster` 命中一个实体，分别选择左右键动作；实体候选优先于地面点候选，同类候选按源动作优先级降序排列。不可操作的已注册实体仍参与遮挡，避免提示穿过前面的目标。重复的左右键动作会合并。
- 各交互控制器注册动作 ID、模型、有效性和装备/选中条件，不创建文字标签、不调用 `show(': …')`，也不在更新循环中执行独立的 Hover raycast。
- `packages/stategraphs/src/actions.ts` 集中保存当前支持动作的源简体中文字符串及优先级。`getActionString()` 根据修饰词或工具的 `spelltype` 选择文字；`BufferedAction.getActionString()` 使用同一函数。
- `packages/ui/src/cursor-label.ts` 统一呈现主次提示。按浏览器界面要求，两条动作均显示源 `controllers.zip` 对应的鼠标图标：左键 `U+E100` 配动作文字，右键 `U+E101` 配 `: 动作文字`。提供目标显示名且没有使用物品的主动作可追加目标名。显式建造/放置提示优先覆盖动作提示；鼠标位于其他 DOM UI 上时隐藏世界提示。
- 指针移动、装备/选中状态变化和目标消失都会重新选择动作；文字和图标按屏幕边界限制位置。控制器注销候选，应用退出时释放共享指针与 Hover UI。

当前接入捕虫、锤击、开采、铲子挖掘、铲地、耕坑、播种、扫把换肤、荧光花采集、法杖地面动作及唱片插入提示。拾取等其他输入流程继续由现有交互控制器处理；候选描述本身不会执行游戏动作。共享拾取覆盖这些已注册的交互模型，并非 C++ 的完整场景拾取实现。

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

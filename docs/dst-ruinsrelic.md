# 遗迹家具的显示与存档移植

源码根目录：`/data/copy/AssetArchive-Dev/data/DST/data/databundles/scripts_unpacked/scripts`。
复制品定义在 `prefabs/ruinsrelic.lua`；天然遗迹和三种碎石版本定义在 `prefabs/smashables.lua`。
这两组 ID 不互换。另确认了 `ruinsrelic_chair_placer` / `ruinsrelic_table_placer`，它们是建造预览，不作为可保存的世界实体注册。

## 美术与动画

| 款式 | bank / build（两者相同） | Assets 的 ANIM 归档 |
| --- | --- | --- |
| table | `ruins_table` | `anim/ruins_table.zip` |
| chair | `ruins_chair` | `anim/ruins_chair.zip` |
| vase | `ruins_vase` | `anim/ruins_vase.zip` |
| chipbowl | `ruins_chipbowl` | `anim/ruins_chipbowl.zip` |
| bowl | `ruins_bowl` | `anim/ruins_bowl.zip` |
| plate | `ruins_plate` | `anim/ruins_plate.zip` |

`SetBank` 和 `SetBuild` 均使用表中的名称。`ruins_rubble_table/chair/vase` 复用对应完整版本的 bank、build 和归档。
`smashables.lua` 还声明 `Asset("MINIMAP_IMAGE", "relic")`，实例声明 `relic.png`，使用已经镜像的原版公共 minimap 图集。

动画声明逐项对应源码：

- 复制品 fn：`PlayAnimation("idle")`，非循环。没有 prefab OnSave、OnLoad、OnLoadPostPass 或 animover 监听。table/chair 的 onbuilt 回调在源码中为 `hit → PushAnimation("idle", false)`；四种装饰不注册该回调。
- 天然完整版本 fn：先 `PlayAnimation("idle")`；table/chair/vase 的 `MakeRelic` 再 `PushAnimation("idle", false)`，其余三种再次 `PlayAnimation("idle")`。
- 天然碎石版本 fn：先 `PlayAnimation("broken")`；`MakeRubble` 再 `PushAnimation("broken", false)`。仅 table/chair/vase 有碎石 prefab ID。
- 天然版本没有 OnLoad / OnLoadPostPass。`OnPreLoad` 先恢复 `maxhealth`，再比较保存的 `rubble` 与构造值；发生切换时，`MakeRubble` / `MakeRelic` 按上述方式追加 `broken` / `idle`。随后 health 组件 OnLoad 恢复当前生命，不重新推断 rubble。构造时的动画声明按源追加：完整 chair 加载 rubble 状态时声明 `idle → idle → broken`，碎石 vase 加载修复状态时声明 `broken → broken → idle`；读档时美术尚未绘制，这段过渡按驻留规则直接结算到 `broken` / `idle`。
- 源 `OnHit` 为 rubble 时 `repair → PushAnimation("broken", false)`，否则 `hit → PushAnimation("idle", false)`；动画版血量跌破一半时先 `repair` 再 `MakeRubble`；完全修复时先 `hit` 再 `MakeRelic`。这两个文件都没有 animover 删除或动画结束业务回调，所有上述 clip 均为非循环。

动画、字段、tag 由 `RuinsRelicInstance` 同步声明；`ruinsRelicPrefabs` 为 15 个 ID 声明 bank/build、`MakeObstaclePhysics` 半径和 `ruinsrelic_chair` 的两个皮肤，由应用层的 `PrefabEntityManager` 注册并交给其 display 加载。椅子的源 `SetFinalOffset(-1)` 声明为 `sprite.setBehindFoot(true)`，同一脚点上排在其他实体之前。所有姿态和过渡使用 `instancedAnimations: 'all'`，没有改成循环。tile 休眠只释放 visual，唤醒重建并应用当前声明及皮肤，没有新增裁剪或可见性判断。未加载或休眠时的过渡按项目通用驻留规则结算，不保证精确帧进度。

## Tags、组件和持久化

| 来源 | tags / 构造 |
| --- | --- |
| 复制品四种装饰 | `furnituredecor`；inventoryitem、floater、furnituredecor |
| 复制品 chair | `structure`、`limited_chair`、`uncomfortable_chair`；sittable，FinalOffset -1 |
| 复制品 table | 没有 prefab 直接添加的 tag |
| 所有复制品 | inspectable（nameoverride `relic`）、workable（HAMMER，1，savestate=false）、lootdropper、hauntable |
| 所有天然遗迹 | `cavedweller`、`smashable`、`object`、`noauradamage`、`electricdamageimmune`；table/chair 为 `stone`，其他为 `clay` |
| 天然完整 chair 的 MakeRelic | sittable；`structure`、`limited_chair`、`uncomfortable_chair`；FinalOffset -1 |
| 天然 MakeRubble | repairable（stone）；移除 sittable、`structure`、`limited_chair`，源码不移除已经存在的 `uncomfortable_chair` |
| 所有天然遗迹 | combat（KeepTarget=false）、health（初始最大值 90±20，完整 .8 / 碎石 .2）、lootdropper、inspectable、hauntable、roseinspectable；没有 workable |
| 组件添加的相关 tags | inspectable 的 `inspectable`、sittable 的 `cansit`、workable 的 `HAMMER_workable`、repairable 的 `repairable_stone` / `healthrepairable`；hauntable 的临时 `haunted` |

prefab 直接添加的 tags 都由实例持有。constructor-only 的 inspectable/sittable 不执行内部逻辑，因此由 prefab 显式保留其构造 tags；workable / repairable 的能力 tags 由现有组件的 `HasTag` 派生。

天然源码 `OnSave` 写 `rubble = inst.rubble or nil` 和 `maxhealth = health.maxhealth`；health 组件写当前 `health`。项目格式以 `components.ruinsRelic.rubble` 和 `components.health.{current,maximum}` 保存，不另存一份可写 maxhealth。读取先设置 maximum、恢复 rubble，再加载 current；实体 ID、三维位置、旋转保留。没有数据表的早期快照保留相应 prefab 的构造默认值。

复制品没有自己的 OnSave 字段；workable 没有持久工作量。四种装饰的 `inventoryitemmoisture` 可写 `moisture` / `wet`，导入器和反序列化接受，显示存档路径在实例 saveRecord 中保留原载荷；未实现湿度演算。`floater`、`furnituredecor`、`sittable`、`hauntable`、`lootdropper` 没有对应的 OnSave 字段。物品栏中的四种装饰不可堆叠，每个数量占一格，沿用现有库存保存格式。

这些 prefab 都没有 SetStateGraph / SetBrain。新增的 constructor-only 类均在 `packages/componets/src/ruinsrelicSignatures.ts`：`FurnitureDecor(inst)`、`Sittable(inst)`、`Floater(inst)`、`InventoryItemMoisture(inst)`。它们没有方法、任务或事件。复用了已有的 `dragonflySignatures.ts` 中 `Inspectable(inst)` 和 `pandoraschestSignatures.ts` 中 `RoseInspectable(inst)`。现有 Repairable 补充无 workable 时的 health 分支，以保留天然碎石的组件构造和能力 tag，没有伪造 workable。

本次验收范围是构造、显示、驻留、调试命令与存档往返。坐下、家具摆放、漂浮、湿度演算、椅子的世界 shadeling 生成器，以及完整的破坏战利品和建造音效未移植。

## 皮肤

`prefabs/skinprefabs.lua` / `prefabskin.lua` 仅给 `ruinsrelic_chair` 定义 `ruinsrelic_chair_tesla` 和 `ruinsrelic_chair_toilet`。`basic_init_fn` 使用 `SetSkin(build_name, "ruins_chair")`，clear 恢复基础 build。对应 `anim/dynamic/<skin>.zip` 和 `.dyn` 按原字节镜像；通过 sprite 的 skin source 和现有 `reskin_tool` 目标换肤，`skinId` 保存在实例的 sprite json 和导出记录中。天然 chair 及其他 13 个 prefab 没有皮肤支持。

## 导入结果与验收

使用 README 的整簇导入命令重新生成所有 12 份快照及 provenance，并以相同命令 `--check` 核对。最新快照结果如下（每格为源数量 → 导入数量）：

| prefab | Master | Caves |
| --- | --- | --- |
| `ruins_table` | 0 → 0 | 8 → 8 |
| `ruins_chair` | 0 → 0 | 21 → 21 |
| `ruins_vase` | 0 → 0 | 17 → 17 |
| `ruins_chipbowl` | 0 → 0 | 2 → 2 |
| `ruins_bowl` | 0 → 0 | 1 → 1 |
| `ruins_plate` | 0 → 0 | 2 → 2 |
| `ruins_rubble_table` | 0 → 0 | 23 → 23 |
| `ruins_rubble_chair` | 0 → 0 | 45 → 45 |
| `ruins_rubble_vase` | 0 → 0 | 35 → 35 |
| 六种 `ruinsrelic_*`（每种） | 0 → 0 | 0 → 0 |

合并最新 main 后，Master 总数 6,497 → 6,497，Caves 总数 5,392 → 5,546（仅本任务新增 154 个）。任务最初基线的 Caves 为 5,134，期间并行任务已将 258 株 lichen 合入 main。Caves 0000000002 / 0000000003 各新增 159 个，其余四份洞穴快照各新增 154 个；六份地表快照实体数不变。所有快照的其他 prefab 数量变化均为 0。并行任务后续导入的实体另按其所属任务统计。

`packages/animation/tests/ruinsrelic.test.ts` 的三个代表用例覆盖源码动画队列与状态恢复、皮肤休眠重建，以及 c_spawn / c_give → c_save → 反序列化和重载。Playwright 复用 `packages/ui/tests/default-save-load.spec.ts` 的 Master / Caves 默认存档加载用例，没有新增交互浏览器用例。资源完整性、全部 bank/clip 名与原路径字节用 `python3 packages/prefab/scripts/import-ground-items.py --check` 检查。

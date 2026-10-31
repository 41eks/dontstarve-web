# 石笋显示与存档移植

源码根目录为 `/data/copy/AssetArchive-Dev/data/DST/data/databundles/scripts_unpacked/scripts`。本次完整核对了 `prefabs/stalagmite.lua`、`prefabs/stalagmite_tall.lua`，以及 `components/workable.lua`、`lootdropper.lua`、`inspectable.lua`、`hauntable.lua`、`standardcomponents.lua` 的 `MakeHauntableWork` 和 `tuning.lua`。

## Assets、构造动画与恢复

| prefab ID | Assets 的 ANIM | SetBank / SetBuild | fn 的 PlayAnimation | 初始工作量 |
| --- | --- | --- | --- | --- |
| `stalagmite` | `anim/rock_stalagmite.zip` | `rock_stalagmite` / `rock_stalagmite` | `full` | 6 |
| `stalagmite_full` | 同上 | 同上 | `full` | 6 |
| `stalagmite_med` | 同上 | 同上 | `med` | 4 |
| `stalagmite_low` | 同上 | 同上 | `low` | 2 |
| `stalagmite_tall` | `anim/rock_stalagmite_tall.zip` | `rock_stalagmite_tall` / `rock_stalagmite_tall` | `full_1` 或 `full_2` | 6 |
| `stalagmite_tall_full` | 同上 | 同上 | `full_1` 或 `full_2` | 6 |
| `stalagmite_tall_med` | 同上 | 同上 | `med_1` 或 `med_2` | 4 |
| `stalagmite_tall_low` | 同上 | 同上 | `low_1` 或 `low_2` | 2 |

两个文件各只注册表中的四个 prefab；无其他待移植的同文件 prefab。所有动画均为 **非循环** `PlayAnimation`，没有 `PushAnimation`、animover 监听或完成后移除的回调。普通版先播放动画，再随机设置 `SetMultColour(color,color,color,1)`；高型在 master 构造中先随机 `inst.type = "_1" / "_2"`，播放 `anim .. inst.type`，再随机颜色。颜色为 `0.5 + math.random() * 0.5`。

两个 prefab 文件均没有 OnSave、OnPreLoad、OnLoad、OnLoadPostPass，也没有 stategraph 或 brain。`SetPrefabNameOverride("stalagmite" / "stalagmite_tall")` 只归并显示名称，不改实体原始 prefab ID；基础 ID 和 `_full` 共用 fullrock 构造。

从存档恢复时仍完整执行相应构造。普通版恢复其 ID 对应的 `full/med/low`；高型恢复对应阶段并重新随机左右款式。没有额外的读档动画。颜色和 `inst.type` 均不保存，不增加保存这两项的项目字段。

## Tags、组件与字段

- 两个 prefab 文件唯一的直接 `AddTag` 是 `boulder`，使用实例的 `addTag` 添加。
- `inspectable` 构造的 `inspectable` tag 同样保留。已有 `Inspectable(inst)` 只有构造签名，因此由 prefab 显式声明该 tag。
- `workable` 设置 `ACTIONS.MINE`，commonfn 先设置 `ROCKS_MINE = 6`；medrock/lowrock 分别覆盖为 `ROCKS_MINE_MED = 4` / `ROCKS_MINE_LOW = 2`。能力 tag `MINE_workable` 沿用现有组件的派生视图，不复制工作量。
- `lootdropper` 按构造选择原始 `full_rock` / `med_rock` / `low_rock`，或 `stalagmite_tall_*_rock` 表，后续工作量变化不替换该表。
- `MakeHauntableWork` 创建 hauntable，源码中的执行工作部分已注释，配置的 onhaunt 回调返回 false；初始不带临时 `haunted` tag。
- `MakeObstaclePhysics(inst,1)`；小地图分别声明 `stalagmite.png` / `stalagmite_tall.png`。Assets 中对应 `MINIMAP_IMAGE` 分别为 `stalagmite` / `stalagmite_tall`，均已存在于原版公共 `minimap_data2.xml` 图集。

`workable.savestate` 保持默认 false，`workable:OnSave()` 返回空表；其余所用组件没有 OnSave 字段。导入器接受无 data 或空的 `workable`，项目记录使用 `components: {}`，反序列化/catalog 接受全部八个 ID。导出保留原 prefab ID、entity ID、三维脚点和旋转；开采进度不写入存档，读档重置为各 ID 对应的 6/4/2。即使保存前 med 石笋只剩 3 次工作，读档后仍是 med 动画和 4 次工作。

没有新增缺失组件、stategraph 或 brain 的签名类。复用的 constructor-only 依赖仅 `Inspectable(inst)`，位于 `packages/componets/src/dragonflySignatures.ts`。`Workable`、`LootDropper`、`Hauntable` 都复用已有实现。未新增采矿鼠标控制器；普通版源工作回调中依赖工作者 `spooked` 的万圣节分支、未支持的战利品 prefab 不在本次显示/保存移植范围内。

## 皮肤与显示职责

`prefabs/skinprefabs.lua` 没有这八个 ID 的皮肤定义；不添加 skin、皮肤资源或 reskin 目标。

`StalagmiteInstance` 只同步声明标签、组件、逻辑状态、clip 和颜色，不执行资源 IO、await 或创建显示对象。`StalagmiteManager` 共享一个 `SpriteResources`，为两个 bank 声明 archive source；`PrefabDisplay` 在资源路径中调用共享预载/创建入口。`instancedAnimations: 'all'` 合批非循环姿态，`colour: [1,1,1]` 为每个实例启用独立明暗，不修改共享帧数据。

tile 活动只通过 `watchTileActivity` 设置实例状态；休眠释放 visual，身份、组件、declared clip 和颜色继续保留；唤醒重建 visual 时不重跑随机构造。没有新增可见性、距离隐藏或裁剪逻辑。

两份 zip 按原始路径和字节镜像到 `public/dst/data/anim/`，运行 `python3 packages/prefab/scripts/import-rocks.py --check` 检查原始声明、文件字节和全部九个 bank/clip 组合，不用逐 prefab 浏览器渲染验证。

## 默认存档差异与验收

按 README 的整簇命令重新导入全部 12 份快照及 `.import.json`，并运行相同参数的 `--check`。最新快照逐项如下：

| prefab ID | Master 源 → 导入 | Caves 源 → 导入 |
| --- | --- | --- |
| `stalagmite` | 0 → 0 | 187 → 187 |
| `stalagmite_full` | 0 → 0 | 0 → 0 |
| `stalagmite_med` | 0 → 0 | 56 → 56 |
| `stalagmite_low` | 0 → 0 | 21 → 21 |
| `stalagmite_tall` | 0 → 0 | 204 → 204 |
| `stalagmite_tall_full` | 0 → 0 | 5 → 5 |
| `stalagmite_tall_med` | 0 → 0 | 183 → 183 |
| `stalagmite_tall_low` | 0 → 0 | 178 → 178 |

相对合并时的最新 main，Master 总数 6,497 → 6,497；Caves 总数 5,548 → 6,382，新增 834 个。任务初始基线洞穴为 5,546 个，期间并行任务向 main 导入的两个 archive_centipede_husk 不计入本任务新增数量。早期 Caves 0000000002 增加 850 个、0000000003 增加 860 个，后续四份洞穴快照各增加 834 个。六份地表快照均没有目标实体。所有快照中其他实体的数量变化均为 0。

`packages/animation/tests/stalagmite.test.ts` 只有三个代表性用例：普通/高型的源码构造与无 IO 声明；高型休眠后恢复同一 clip、明暗和组件；`c_spawn → c_save` 真实 ZIP 导出后读取独立玩家文件并重新加载，验证 ID、位置、空组件载荷、工作量重置和非循环动画。世界实体没有 inventoryitem，因此 `c_give` 被拒绝。

Playwright 仅复用 `packages/ui/tests/default-save-load.spec.ts` 的 Master / Caves 共用加载用例，使用重新导入的默认存档并检查 gameReady 和 pageerror。测试服务使用任务独立端口，不复用其他 worktree 服务。

# lava_pond 热源实现计划

状态：热源供给端已实现，包含 Heater、原版资源、池面光照、障碍、焦岩布局、命令和保存恢复。实体 Temperature 仍属于下方列出的后续依赖。

## 范围与完成标准

接入熔岩池的原版外观、光照、障碍、周边焦岩、持久化及真实 `heater` 供热接口。`c_spawn("lava_pond")` 可生成，热源查询获得 `500`，移除后不再参与查询；保存读档保留身份、位置和焦岩布局。

本次范围是热源供给端。当前项目只有 `WorldTemperature`，没有实体 `Temperature`，因此这一步完成后角色不会自动升温。实际体温变化必须由后续通用 `temperature` 组件消费热源，不能在熔岩池 prefab 或应用层直接给角色加温。暖石继续保持现有“不实现温度”的范围。

触碰点燃、`propagator` 的火焰传播／伤害、`cooker` 烹饪动作、龙蝇事件及音乐联动暂不纳入此热源任务。它们属于 Lua 的其他分支，后续需在各自组件中接入；不把视觉光照当作供热或伤害。

## 已核对的 Lua 依据

源目录：`/data/copy/AssetArchive-Dev/data/DST/data/databundles/scripts_unpacked/scripts`。

| 来源 | 必须保留的规则 |
| --- | --- |
| `prefabs/lava_pond.lua` | bank/build `lava_tile`，`bubble_lava` 循环，OnGround、BACKGROUND、sort order 3；无原版皮肤 |
| 同一 prefab 的 heater 分支 | `heater.heat = 500`；没有关闭距离衰减，没有设置半径截断，不改写世界／局部环境温度 |
| `components/heater.lua` | 添加／释放 `HASHEATER`；默认 exothermic=true、endothermic=false、ShouldFalloff=true |
| `standardcomponents.lua:MakePondPhysics` | 静态障碍、`blocker`，半径 1.95、高度默认 2；与物品、角色和巨人碰撞 |
| `prefabs/lava_pond.lua:SpawnRocks` | 随机 2～4 块焦岩，7 种外观；保存类型及三维相对 offset，读档复原，不重新随机 |
| 同一文件的焦岩定义 | `lava_pond_rock` 使用 `idle`；`lava_pond_rock2`～`lava_pond_rock7` 使用 `idle2`～`idle7`；随池生成的焦岩不独立持久化 |
| `components/temperature.lua` | 供热消费在实体组件中；候选半径 10，先 GetHeat(observer)，再检查供热属性及距离衰减 |

## 实施顺序

1. **实现通用 Heater。** 在 `packages/componets/src/heater.ts` 保留源职责，提供 `GetHeat(observer)`、供热／制冷属性和距离衰减／半径截断查询。权威可变数据使用私有 signal，外部只能读取；不为固定热源增加计时器或世界温度订阅。释放组件时移除 `HASHEATER`。
2. **导入资源。** 将 `anim/lava_tile.zip`、`anim/scorched_rock.zip` 按原相对路径镜像到 `public/dst/data`。在现有资产导入脚本记录并用 `--check` 验证源字节与路径。运行时统一使用 `${import.meta.env.BASE_URL}dst/data/anim/`。Lua 没有常驻 lava 音效播放，不根据 SoundEmitter 的存在自行补声音。
3. **接入 prefab。** 在 `packages/prefab/src/lava_pond.ts` 管理熔岩池、焦岩和组件生命周期；复用现有动画工厂、局部光照及物理接口。池面贴地绘制，保留源背景顺序；焦岩为独立完整 billboard，以各自脚点参加现有深度排序。不得把焦岩揉成一个与池面共用脚点的可见实体。
4. **建立供热实例。** 池实例挂 `Heater`，配置 heat=500，保留 `lava`、`antlion_sinkhole_blocker`、`birdblocker`、`blocker` 与组件拥有的 `HASHEATER` 标签。暂未实现的 cooker 分支不提供虚假的 COOK 动作。使用现有实体注册路径暴露位置、标签和组件，供以后通用温度组件查询；不新增熔岩池专用的升温控制器。
5. **恢复焦岩布局。** 用共享游戏调度器和私有 `ComponentTimer` 对齐源 0 延迟初始化，位置确定后再创建子焦岩。读档先恢复布局，再执行初始化，避免随机生成后叠加。永久移除取消尚未执行的任务；只替换美术时保留布局与逻辑实例。
6. **接入存档和命令。** 在 `src/prefabDefinitions.ts`、`src/sceneEntities.ts` 及现有存档类型／校验中注册池与独立焦岩。新增 `c_spawn("lava_pond")`、`c_spawn("lava_pond_rock")`、`c_spawn("lava_pond_rock2")`～`c_spawn("lava_pond_rock7")`；它们没有 inventoryitem，不支持 `c_give`。池保存 ID、transform 和 rocks 布局；子焦岩、常量 500、瞬时初始化任务不重复入档。独立生成的焦岩按自己的 prefab ID 保存。
7. **释放和文档。** 显式移除／场景销毁时注销热源，释放碰撞体、局部光照、子焦岩、动画几何及共享工厂；不注册 pagehide 清理。更新 README 的命令语法、例子和支持 ID，补充 prefab 命令静态核对表及温度文档的供给端实现状态。

所有 DST 距离统一经过现有场景比例换算：当前 1 个 DST 单位对应 3 个场景单位。碰撞半径为 5.85，热源消费搜索半径为 30，焦岩 offset 及光照半径也须一致换算；heat=500 保持不变。光照保留源 radius=1.5、falloff=0.66、intensity=0.66、colour=(235,121,12)/255。

## 体温消费的后续依赖

后续要让角色靠近时实际升温，必须先在 `packages/componets` 增加最小源分支的通用 `Temperature`，再注入世界温度、当前位置和附近 heater 实例。不得修改 `WorldTemperature` 的全局数值来模拟局部热源。

干燥观察者的距离系数为 `f = 1 - d² / 100`，其中 d 使用 DST 单位；有效热量 `H = 500 * f`，仅当 H 大于当前体温 T 时将 `H - T` 加到 delta。多个热源的贡献逐项相加；d≥10 时无贡献。最终按 Lua 环境温度、保温和速率限制更新 T，不直接把 T 设为 500。湿润修正、体温上下限、过热伤害、玩家存档和组件释放均须随选定的实际消费分支实现，不能由展示 effect 执行。暖石温度不因此自动接入。

## 代表性验证

- 单测：Heater 的固定输出、默认供热／衰减属性和标签释放；只覆盖本次接口，不提前复制未接入的体温算法测试。
- 单测：正常生成焦岩布局，提前移除取消初始化，读档恢复原布局且不重复生成；保存后校验身份、位置和子实体数量。
- 浏览器：一条完整 `c_spawn → c_save → 重新加载` 流程，抽样默认焦岩和一种编号外观，验证池面循环动画、贴地绘制、焦岩脚点顺序、局部光照、障碍和真实 heater 输出；独立焦岩命令与保存恢复合并在同一流程。
- 资产：用导入脚本 `--check` 做归档字节校验；不对 7 种等价焦岩分别建立浏览器测试。
- 检查主项目／相关包类型检查及 `git diff --check`。验收报告明确这是热源供给端，角色体温联动尚待上述 Temperature 任务。

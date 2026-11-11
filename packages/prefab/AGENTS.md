# Prefab package instructions

适用于 `packages/prefab`：prefab、`PrefabInstance`、manager、prefab 资源导入脚本与 `src/sound.ts`。全仓库分工和通用规则见[根 AGENTS.md](../../AGENTS.md)；显示层与动画层的规则分别见 [display](../display/AGENTS.md)、[animation](../animation/AGENTS.md)。

## 按任务读

本文件只放每次改 prefab 都要守的规则，其余按任务读对应文档，不必全读。

| 任务涉及 | 读 | 其中最常用的规则 |
| --- | --- | --- |
| 查某句 Lua 对应的 TS 写法和示例，或它是否未实现 | [lua-api-map](docs/lua-api-map.md) | 先查表，再看示例；新增写法时更新表 |
| 声明 sprite、动画、外观、皮肤、FX、transform，资源加载，活动区 | [display-declarations](docs/display-declarations.md) | prefab 只声明，不做 IO、不创建 sprite；循环动画走 `instancedAnimations`；循环方式按 Lua |
| 实例、scene、实体事件、鼠标命中、`model.userData` | [instance-ownership](docs/instance-ownership.md) | prefab 和 manager 不持有 `scene`；事件走 `instance`；`userData` 不是数据总线 |
| 物品、地面美术、物品栏图标、皮肤工作流 | [item-art](docs/item-art.md) | 三种美术分别按源解析；有源皮肤才支持 `reskin_tool` |
| 声音、FSB 解码、`src/sound.ts` | [sound](docs/sound.md) | 映射集中在 `src/sound.ts`，不按名称猜音频 |

## Porting tools

- `python3 scripts/dst-lua-inventory.py <prefab_id>...`：列出 Lua 的资源、bank／build、动画、标签（展开 `Make*` 和组件构造函数）、事件、任务、回调和存档字段，并标出 TS 组件是否存在。先用它代替通读 Lua，再只读有分支的部分；大文件用 `--fn` 限定函数。它按行扫描，不能替代对分支的判断。
- `python3 scripts/dst-save-diff.py --expect <prefab_id>...`：重新导入存档后、提交前运行，汇总相对 git 的实体组差异和导入数量；有意外变更时退出码为 1。

## Tags

- When porting a prefab or child/FX entity, keep every tag the Lua source adds (`inst:AddTag(...)`, such as `FX`, `NOCLICK`, `DECOR`), regardless of whether its semantics seem relevant or are consumed yet. Apply them on the entity exactly as in Lua, including non-networked child entities like mist or particles; never drop or substitute a tag because it looks unused. Tags live only on the entity's `PrefabInstance`: write them with `inst.addTag()` / `removeTag()` and read them with `inst.hasTag()`, including tags the component layer derives. An entity that carries tags, child and FX entities included, is created as a `PrefabInstance`; a model has no tag store of its own (no `userData.tags`), and code that only holds a model reads through `prefabInstance(model)?.hasTag()`.

## Components

- 给实体加组件只能用 `addComponent(inst, 'x', X, ...args)`（`src/components.ts`，对应 `inst:AddComponent("x")`），移除只能用 `removeComponent(inst, 'x')`；调用放在 Lua 调用 `AddComponent` 的位置，紧接着按 Lua 配置该组件。不得用 `Object.assign(this.components, {...})`、`this.components.x = ...` 或 `delete inst.components.x` 直接改写 `components`。
- 组件构造函数和 Lua 的 `Component(inst)` 一样以 `inst` 为第一个参数，其余依赖（scheduler、单位换算等）跟在后面；组件通过 `inst` 访问标签、事件和其他组件，不另拼适配对象。泛型组件传实例化表达式（如 `Workable<MyInstance>`）。`x` 必须在实体的 `components` 类型中声明。
- 实体移除时 `addComponent` 已调用组件的 `OnRemoveEntity`（或其拆除方法），组件仍留在 `components` 上；`onRemove` 里不再手动 `dispose()` 这些组件。
- 已有的 `Object.assign`／直接赋值写法不能作为继续使用的依据；改动到这样的文件时一并改成 `addComponent`。

## Prefab callbacks

- Lua prefab 自己定义的特殊回调（如 `OnWork`、`OnFinish`、`OnEat`、`OnAccept`）必须实现在所属 prefab 模块内，与该 prefab 的 `PrefabInstance`／专用实例构造放在同一模块，并按 Lua 注册到真实实例或其组件。回调通过传入的 `inst` 操作所属状态；同一模块内的相关 prefab 可以按源码共享回调。
- Lua prefab 文件里的 `local function` 回调（赋给 `inst.OnSave`／`inst.OnLoad`／`inst.OnEntitySleep` 等字段，或交给 `ListenForEvent`、`DoTaskInTime`／`DoPeriodicTask`、组件的 `SetOnFinished`／`SetOnEquip`／`SetOnWorkCallback` 等），在 TS 中写成 prefab 模块顶层的同名函数，第一个参数是 `inst`，并在对应 `fn`／`master_postinit` 的位置按 Lua 原样注册（如 `inst.OnSave = onsave`、`inst.ListenForEvent('animover', onanimover)`）。不得把它们写成 `PrefabInstance` 子类的方法、类字段箭头函数或构造函数里的闭包；只有 Lua 本身在 `fn` 内写闭包时才写闭包。
- 专用实例子类（或 `XxxInst` 接口）只声明 Lua 挂在 `inst` 上的字段（如 `inst.active`、`inst._light`），以及 Lua 赋给 `inst.X`、供别处以 `inst:X()` 调用的函数字段；这些字段在 `fn` 中赋为模块顶层函数，不在类里实现。
- 变体（金工具、`MakeAxe` 的 `master_postinit` 等）按 Lua 用参数和共享的模块函数组合，不用子类继承表达。
- 示例见 `lantern.ts`（`fuelupdate(inst)`、`turnoff(inst)` 等顶层函数，`LanternInst` 只声明字段）。已有把回调写成类方法的代码不能作为依据；改动这类文件时按本条迁移。
- controller 只做动作请求和真实实例引用的转发，严禁在 controller 中用 `if`／`switch` 或 prefab 分发表实现 prefab 专属业务分支；也不得用 controller 内的闭包、helper 或注入的业务回调隐藏这些分支。已有此类逻辑迁移时必须移回所属 prefab 模块。
- 保持 Lua 的调用关系：共享 `ACTIONS.fn` 调用组件，组件执行通用规则并触发已注册的 prefab 回调。伤害、工作量、进食、消耗等组件规则继续由组件负责；通用动作入口不在各 prefab 重复实现。动作转发细则见 [stategraphs](../stategraphs/AGENTS.md)。

## Prefab porting requirements

- 实体管理：移植 prefab（包括把已有 prefab 迁移过来）时，只能用通用的 `PrefabEntityManager`（`packages/prefab/src/prefabInstance.ts`）管理 `PrefabInstance`。`PrefabEntityManager` 必须是应用层统一创建并持有的全局单例，所有 prefab 共用这一个实例；不得按 prefab、模块或类别分别创建 manager 实例，prefab 模块也不得自行创建 manager。prefab 的实例构造、组件、业务回调和资源声明留在所属 prefab 模块。不新增专用 manager 类，也不通过继承或包装它来添加 prefab 规则；已有的专用 manager 不能作为继续新增的依据。
  - 不得在 `PrefabEntityManager` 中按 `prefabId`／prefab 名称分支，包括 `if`、`switch`、分发表和名单判断。prefab 之间的差异写在 `PrefabEntityDefinition` 的声明或实例、组件上；通用能力不足时，增加对所有 prefab 含义相同的声明字段。
  - 不得把回调写入 `PrefabEntityManager`。Lua 回调（`OnWork`、`OnSave`／`OnLoad`、事件监听等）和 `PrefabEntityDefinition` 中各函数（如 `fn`、`onSpawned`）的实现都放在所属 prefab 模块；manager 只调用 `PrefabEntityDefinition` 声明的函数和实例的 `GetPersistData()`／`SetPersistData()`。
- Expose world prefabs through `c_spawn("prefab_id")` and inventory items through `c_give("item_id", count)`, using actual source IDs. Support both when both forms exist.
- These requirements also apply to artwork/animation-only ports unless the user explicitly narrows the scope.

# Prefab instances and ownership

改动实例、scene、实体事件、鼠标命中或 `model.userData` 时适用。总则见 [prefab](../AGENTS.md)。

- prefab、专用实例、行为回调及 manager 不得持有 `scene`（包括 `private readonly scene: THREE.Scene`、构造参数属性、闭包捕获，以及以 `root`、`world.scene` 等方式保留或访问场景的别名）。应用层注入的场景只在接线时交给 `PrefabDisplay`／`PrefabDisplayGroup` 等 display 层所有者；实体的挂载、显示更新、渲染条目与显示资源释放由 display 层管理。prefab 只声明实例状态、transform、动画、外观和 FX；邻居发现使用注入的逻辑查询或既有实体查询入口，不遍历场景。迁移必须移动实际职责，不能仅改字段名、换成转发回调或增加包装类来隐藏场景引用。
- 实体事件属于逻辑实体：用 `instance.PushEvent()`／`ListenForEvent()`（返回取消函数）／`RemoveEventCallback()` 收发，监听方收到的是 `data`。不在 model 上 `dispatchEvent` 或 `addEventListener` 游戏事件；model 上只保留 three.js 自身的场景树事件（`added`、`removed`、`childadded` 等）。
- 实体根节点由 `PrefabInstance.transform` 创建并持有，display 接收同一个根节点并管理其场景挂载和 visual。逻辑代码通过 `instance.position`／`instance.scale` 读取 transform，通过 `setPosition()`／`setScale()`／`setRotation()` 写入；不得用遍历 `children`、取内层 visual、读取 mesh／材质等方式恢复逻辑状态、选择动画或操作控制器。脚点、sprite 对齐偏移和相机朝向的区别由 display 保持。
- `SpriteResources`／assets／factory 是共享资源所有者，manager 可以持有它们并同步声明 source；实际美术加载、预热和 sprite 创建在 display 的资源路径中执行。prefab／组件／brain／stategraph 不持有加载 Promise，也不在资源完成后回写逻辑状态。实体的卸载不能销毁共享缓存。
- 火焰等通用效果复用已有组件绑定和 FX 显示入口，例如 `BurnableBinding`／`FireFxHost`、`attachFx()`、`followAnimation()`；不为每个 prefab 再写一套火焰创建、挂载、相机跟随、音效和灯光联动 effect。prefab 按 Lua 指定效果及参数，display 绘制，所属组件继续管理业务计时。
- 鼠标命中 model 后，通过 `prefabInstance(model)`／`findActionEntity(model)` 取得逻辑实体；需要显示资源时通过 `prefabDisplay(model)` 取得 display。`reskinTarget` 等操作由实体所有者注册；工具动作（MINE／CHOP／HAMMER／DIG／NET）不注册目标 view，`PlayerController` 直接以命中实体为目标，使用现有实例／display 的目标 view，提交仍委托组件。目标 view 不成为组件、皮肤或生命周期的第二个所有者。
- `model.userData` 不得作为有实例实体的数据总线：不新增 `components`、`animationController`、`display`、`skinIdSignal`、`pickablePlantState`、`removed`、`persists`、目标操作、业务回调等写入或别名。限制同样覆盖 `Object.assign`、属性描述符、嵌套赋值和局部别名修改。没有实例的裸 FX 按 [Tags](../AGENTS.md#tags) 保留 `userData.tags`；材质／几何上的渲染缓存属于渲染内部数据，不能用来保存实体业务状态。
- 迁移要同时检查 prefab、关联组件／行为／子实体、调用方以及公共创建／绑定 helper。先把消费者改为读取实例和组件，再清理不再使用的写入；不通过新 getter、复制信号或转发回调维持旧 `userData` 接口。公共兼容桥尚未迁移时明确其保留范围，不因当前文件没有 `userData` 字符串就宣称生成的 model 已完全清空。测试也通过实例／display 接口断言状态与生命周期。

COOK
FARM

黄金园艺锄 字体

wall sanity debuff

检查packages/prefab里有多少THREE.GROUP -> monolint 

createMemo 惰性

HEALTH重复
packages/prefab/src/fence.ts skinID

hammerTarget 没有用findentity
sound层
atrium地皮有写入深度


prefab_id=	"pandoraschest"

目标：把 $prefab_id 移植为可以从存档加载、显示并重新保存的 prefab，并让导入的存档包含它。

一、先读源码，不要凭名称推断
- 阅读 /data/copy/AssetArchive-Dev/data/DST/data/databundles/scripts_unpacked/scripts 下与 $prefab_id 相关的 Lua：
  定义它的 prefab 文件（同一文件里的相关 prefab 一并确认），以及它用到的 component 和 stategraph。
- 从源码确定以下内容，并在实现说明中逐项列出：
  - Assets 中的 bank/build/anim 归档，以及 AnimState:SetBank / SetBuild；
  - prefab fn 构造时的初始动画，以及 OnLoad / OnLoadPostPass 恢复状态时播放的动画（PlayAnimation / PushAnimation、循环方式、animover 处理）；
  - 全部 AddTag，以及 OnSave/OnLoad 字段；
  - 是否有 skin（没有就不要实现）。

二、Display 层：加载与声明接线
- 资源加载只发生在 display 层，通过 PrefabDisplay 和共享入口
  createSharedArchiveSprite() / preloadSharedArchiveSprite() 或 createSpriteFactory()，
  复用同一 manager 的 ArchiveSpriteAssets / factory，不要逐实体创建缓存。
- 资源镜像到 public/dst/data，保持原始相对路径和文件名。
- tickingarea 只决定资源驻留：asleep 时释放 visual，active 时重建，并恢复已声明的 clip 和外观。
  不要另加可见性或裁剪逻辑。



三、PrefabInstance：读取存档时的动画声明
- 这里的 spawn 流程指从存档读取实体：由存档记录创建 PrefabInstance，执行与 prefab fn 对应的构造，
  再按 OnLoad 恢复保存的字段，最后声明恢复后状态对应的动画。
- prefab 逻辑只修改 PrefabInstance 的 status / sprite (SpriteState)，例如 playOnce / start / pushAnimation，
  不直接创建、挂载或释放 model/sprite，不做任何 IO 或 await。
- 动画按第一步确定的 Lua 顺序声明，不要为了实例化把非循环动画改成循环；非循环动画的完成回调保留源码语义。
- 按 Lua 原样添加全部 tag（实体由 PrefabInstance 持有 tag 时用 instance.addTag）。
- 存档往返：OnSave 写出的字段和读入时一致，src/save 的反序列化和目录（catalog）要接受该实体及其组件字段。

四、缺失依赖：只补构造签名
- 如果 $prefab_id 依赖的 component、stategraph 或 brain 在 packages/prefab、packages/componets、packages/stategraphs、
  packages/brains 中不存在，在所属包里新建对应的类，只补全 constructor 签名（参数与 Lua 中对应的 inst 等一致），
  内部不实现：不写方法逻辑，也不接入调度器或事件。
- 这一条是本任务对 AGENTS.md 中"不得留下未实现依赖"的明确收窄。
- prefab 构造时照常创建这些组件，但不要依赖它们的行为；不要在应用层另写特例来替代。
- 在汇报中列出所有只补了签名的类及其所属文件。

五、地图导入白名单与存档
- 把 $prefab_id 加入 scripts/import-dst-region.py 的白名单，包括它保存的组件字段（如有）。
- 用 README 中记录的导入命令重新生成 public/saves/Cluster_1 的 Master.json / Caves.json 及 .import.json，
  然后运行脚本的 --check 确认结果一致。
- 生成的存档文件汇报差异：
  - 源存档中 $prefab_id 的数量、导入后的数量（两者应一致）；
  - 其他实体数量的变化。

六、调试命令与验收
- 支持 c_spawn("$prefab_id")；如果是世界 prefab，不提供 c_give。
- 执行 c_spawn 后运行 c_save()，导出并重新加载，确认实体的 ID、位置、组件字段和恢复后的动画保留。
- 更新 README 调试命令一节里的 c_spawn 支持 ID 和说明。
- 测试保持代表性，各写一个即可：
  - 从存档记录加载后，声明的动画与 Lua 一致（单元测试）；
  - tile 休眠后重建，恢复声明的 clip（单元测试）；
  - 一个浏览器流程：用 ?saveData= 传入测试内构造、包含 $prefab_id 的存档（packages/ui/tests/inline-save.ts）
    → 渲染 → c_save → 用导出的存档重新加载。不依赖默认存档文件。
# DST Billboard 绘制顺序与墙朝向

开发约束见 [AGENTS.md](../AGENTS.md)。本文记录绘制规则的原因和墙资产的具体帧映射。

雨丝、水花、雪花最前层与积雪地表各自的顺序及材质约束见 [雨雪天气实现约束](dst-weather.md)。雪花使用独立的最终覆盖 Group；地面水花仍按本文的实体脚点规则排序。

## 动画实体的层次

玩家、猪王等动画实体的一帧通常包含多个 DST 元素。每个元素的二维变换烘焙到四边形顶点，所有元素合并为一个 `BufferGeometry`，通过索引与连续材质组保留源层顺序。

一个几何体不一定意味着一次 draw call：Three.js 每个几何体材质组发起一次调用，例如 Wilson 手持物品时可能同时使用角色基础 atlas 与 swap atlas。

蘑菇树直接使用动画包的 `createSharedArchiveSprite()`，prefab 按源 Lua 通过 `playOnce()` / `start()` 选择动作与后续待机。`instancedAnimations: ['idle_loop']` 将待机树交给 `InstancedArchiveSprites`，同外观的树共享合成图集和四边形，在实例属性中独立存储帧 UV、颜色、透明度和变换。受击、倒下、树桩和生长／开花过渡继续按动画帧、build、皮肤和符号配置复用 `FrameGeometryCache` 中的不可变合并几何；返回待机自动重新加入实例批次。燃烧消失的 `chop_burnt` 特效也使用共享入口。每棵树保留模型、随机播放进度、完成回调和交互组件；渲染隐藏的源帧仍用于精确 alpha 拾取和空间边界。单树移除退出批次并释放私有资源，共享帧、合成图集与批次由 `ArchiveSpriteAssets.dispose()` 统一释放。

桦树通过同一 `ArchiveSpriteAssets` 和 `preloadSharedArchiveSprite()` 复用三个大小的动画 bank、树干 build、四种叶色及雪层。`sway1_loop_*`、`sway2_loop_*` 和 `burnt_*` 参与实例化，砍树、生长、落叶、倒下及非循环树桩姿态使用共享的普通帧几何，循环状态恢复时自动回到批次。`ArchiveSprite.setSymbolOverride()` 在预载 build 之间切换／清除 `swap_leaves`，`setColour()` 同步实体私有材质和实例颜色，均保留当前动画进度与完成回调。外观与帧决定合成图集，树的颜色不参与缓存键；同外观 1 棵与 21 棵的浏览器验证均为深度、颜色各一次绘制，跨叶色或图集页会增加批次。积雪按原版 0.015 阈值切换，休眠时清理私有世界监听并通过 `ResidentSprite` 只卸载 visual，保留同一根节点、组件和逻辑树，整个森林销毁时再释放共享资源。调试命令、参数、支持 ID 和树木存档字段不变。

`GrottoPoolManager` 通过通用入口 `createSharedArchiveSprite(assets, definition, options?)` 将池面、雾气、瀑布和月亮玻璃接入同一缓存机制，prefab 不再维护要共享的 clip 清单，运行时切换的动画也自动按帧缓存。每种 clip 及其 `*_mined` 状态分别缓存；池面的 OnGround 旋转、背景顺序、雾气 billboard 和独立实体的随机播放进度仍由原有节点维持。共享几何不合并 draw call，单池移除及其子物件清理不会销毁其他实体借用的帧。

`packages/animation/src/renderOrder.ts` 登记每个动画 sprite 最内层的 `visual` group，`setSpriteEntityRenderOrder()` 将实体顺序写到该 group。每帧按实际脚点的相机空间深度由远到近排序；若改用 sprite 中心或包围盒中心，高个实体会过早或过晚改变遮挡关系。

`SpriteRenderOrderSorter` 每帧先遍历可见实体，把深度和各项排序键写进复用的连续数值数组，再排序数值索引数组，最后把序号写回登记的 `visual`。比较函数只读取数组，不访问实体对象。深度按原有 `0.001` 单位先量化，再写入 `Float32Array`；超出单精度精确整数范围时升级为 `Float64Array`，避免丢失远处实体的深度差。背景层、同深度时脚点 x/z 的稳定顺序、分组的 sortGroup/sortLayer/id 规则均保留；附属部分继承本帧可见主体的原始深度。索引沿用 `Array.sort`，保留分组与非分组实体在同深度混排时的比较行为。缓冲区按需扩容，隐藏、移除与换肤后的 visual 在下一帧重新采集。

源 `LAYER_BACKGROUND` 与几何朝向分别处理。温泉 `hotspring.lua` 只设置背景层和 sort order 2，没有 `SetOrientation(OnGround)`；温泉保留动画默认 billboard，活动时随相机四元数旋转，原始脚点、物理体和存档位置不变。实体排序条目的 `renderLayer` 默认为 0，温泉使用背景层 −1，先按层再按脚点深度排序，顺序仍写入登记的 `visual` group。背景层不会把贴图旋转为地面平面。

## 镜像部件与透明材质

DST 的镜像部件会反转三角形绕序。Three.js 的透明 `DoubleSide` 材质如果分背面与正面两次绘制，索引中保存的源层顺序就会被打散。曾出现的具体症状是猪王镜像左手被躯干遮住而消失。

合并动画 billboard 的透明双面材质设置 `forceSinglePass = true`，让两种朝向在同一 pass 中绘制。

共享 archive 和 factory sprite 的烘焙帧复用 `matrixGate`：换帧更新几何，根节点、visual 与父节点矩阵未变化时跳过子树矩阵计算。`ResidentSprite` / `ResidentSpriteController` 用私有 signal 持有实际 visual，普通 `createEffect` 根据有无 visual 切换渲染矩阵入口。空 visual 的 `updateMatrixWorld()` 使用共享空函数，直接跳过缓存检查、子树更新和空间索引通知；`updateWorldMatrix()` 显式查询仍即时更新，唤醒时使缓存失效。附加动态子节点通过 Three 的 child 事件恢复普通更新，最后一个附加子节点移除后重新跳过；永久移除释放 effect 和矩阵入口。直接移动、旋转、缩放、手动局部矩阵与祖先变换仍使缓存失效，附加动态子节点时使用常规遍历。缓存与空间索引观察共用矩阵入口，更新函数和缓存方法由实体共享，局部变换使用标量快照。`updateSceneMatrices()` 为一次场景遍历划定比较范围，同一父节点的世界矩阵只比较一次；祖先再次进入矩阵更新时先使该结果失效，再更新其子树，范围外的显式查询始终检查当前矩阵。重新挂载切换祖先快照引用，最后一个使用者释放后恢复原矩阵方法；嵌套遍历和异常退出恢复原比较范围。

## 实例化场景

实例化的分层 DST 图像先通过 `packages/animation/src/rgbaSpriteAtlas.ts` 预合成为 RGBA sprite atlas，实例共享纹理和单四边形几何体。直接实例化未合成的重叠部件仍会遇到层顺序问题。

源 build 中的 atlas 尺寸可能大于实际 `.tex`；裁切源图时需按归一化 UV 缩放，合成帧使用实际纹理密度并分页。一个 clip 的所有帧使用同一边界、原点与像素网格；逐帧裁切和取整会改变采样相位及四边形缩放，使静止的树干部件抖动。

如果使用实例化 billboard 森林，单个 draw call 无法把各树实例与动态透明角色逐个交错排序。对应绘制顺序为：

1. Alpha test 深度预渲染：`colorWrite = false`、`depthWrite = true`。
2. 地皮等背景透明层。
3. 森林透明颜色 pass：`depthWrite = false`，在动态角色之前提交。
4. 动态角色按各自脚点的深度排序绘制。

批次父 Group 保持默认 `renderOrder = 0`，颜色 mesh 使用 `renderOrder = -0.4`，排在地皮 mesh（−2～−0.5）之后。Three 先比较 Group 的顺序，再比较 mesh 的顺序；把批次 Group 设为负值会让颜色 pass 早于不写深度的地皮，树便会被地皮覆盖。批次内部实例仍按脚点深度从远到近排列。

`InstancedArchiveSprites` 保留每个实体的世界包围球与视锥测试结果。visual 的世界矩阵或帧边界变化时重算包围球；相机投影、视图矩阵或坐标系变化时重新测试视锥。绘制条目、页成员数组与排序结果跨帧复用，只在脚点排序键或成员变化时重排，脚点可独立于 visual 移动。祖先的场景归属、显隐与光照覆盖每次 pass 按节点采样一次，兼容直接赋值与重新挂载。各槽位通过变换和外观版本跳过未变属性，固定边界的动画换帧只写 UV；增删成员、跨页、隐藏后复用批次时仍核对槽位身份。属性上传合并实际变化的 Float32 区间，并保留 WebGL 尚未消费的更新。

森林颜色 pass 写深度会让共面的 DST 层发生 z-fighting，表现为相机移动时闪烁。此方案用于蘑菇树、月树和桦树的循环动画实例；普通动画实体仍按实体脚点排序。

## 墙的源码与朝向

源 `databundles/scripts_unpacked/scripts/prefabs/walls.lua` 调用 `Transform:SetEightFaced()`，放置时只移动位置，因此墙保持世界旋转 `0`，通过选择不同 art facing 表现朝向。

动画的 `facing` 字节是 `scripts/constants.lua` 中 `FACING_*` 值的位掩码。引擎按 `Transform:GetRotation() + TheCamera:GetHeading()` 匹配；参考 `components/placer.lua` 的“rotate against the camera”和 `prefabs/daywalker.lua` 的 `dir1 + camdir`。墙的旋转为 `0`，所以实际只由相机 heading 决定。

`anim/wall.zip` 的具体映射如下：

| facing 掩码 | 源方向 | build 图片 | `half` 姿态使用的图片 |
| --- | --- | --- | --- |
| `15` | RIGHT / UP / LEFT / DOWN | `wall_segment-10` 到 `wall_segment-16` | 正面 `wall_segment-14` |
| `240` | UPRIGHT / UPLEFT / DOWNRIGHT / DOWNLEFT | `wall_segment-0` 到 `wall_segment-7` | 斜侧面 `wall_segment-4` |
| `255` | 所有方向 | 墙物品的 `idle` | 地面物品姿态，独立于建造后的 `half` |

相机 heading 为 `2n × 45°` 时显示正面，`(2n + 1) × 45°` 时显示斜侧面。新增 facing 时需要从同一动画中选取对应帧，不能混用不同姿态。

## 八向动画实体：栅栏

`prefabs/fence.lua` 同样调用 `Transform:SetEightFaced()`，但与墙不同，它的 `rotation` 不为 `0`：放置器按 `MakePlacer(..., fixedcameraoffset = 0, "eight")` 把旋转设为 `-TheCamera:GetHeading()`（`components/placer.lua`，无 `nearestangle`），所以放置时栅栏总是正对相机。显示 facing 由 `rotation + heading` 决定，`packages/animation/src/facing.ts` 的 `facingFromRotation(rotation, heading)` 按 45° 取扇区。约定如下：旋转 `R` 的 inst 朝向 `(cos R, -sin R)`（Lua 中常见的 `Vector3(cos θ, 0, -sin θ)`），`followcamera.lua` 的右向量为 `(-sin h, cos h)`、屏幕向上为 `(-cos h, -sin h)`，因此 `a = R + h` 时屏幕方向为 `(-sin a, -cos a)`：`a = 0` 面朝相机（DOWN），`a = 90` 为 LEFT，`a = 180` 为 UP，`a = 270` 为 RIGHT，对角依次为 DOWNLEFT（45）、UPLEFT（135）、UPRIGHT（225）、DOWNRIGHT（315）。

`anim/fence.zip` 与 `anim/fence_thin.zip` 的 `idle` / `hit` 为多 facing clip：DOWN=`8`、UP=`2`（数据内已含 `-1` 水平翻转）、左右共用=`5`、两个上斜向共用=`48`、两个下斜向共用=`192`。`ArchiveSprite.setFacing()` 在同名 clip 中选掩码包含该 facing 的一个；若 clip 同时列出某个 facing 与其左右镜像（如 `5`），按右向创作，面向左侧时对 `visual` 水平镜像（`selectsFacing()`）。这一镜像约定来自对引擎行为的推断，原版引擎代码不可见，数据中只有 UP 的 clip 自带翻转矩阵。

`CalcRotationEnum` 的奇偶决定使用哪个 bank：偶数用窄的 `fence_thin`（动画在 `fence_thin.zip`，build 仍为 `fence.zip`），奇数用宽的 `fence`。预览同时持有两个 bank 的 sprite，随相机旋转切换，放置时只保留当前 bank。预览使用 `ArchiveSprite` 的私有材质副本（`options.opacity`）呈现 65% 不透明，放置时 `setOpacity(1)`，不修改资源缓存里共享的材质；实体根节点由 `FencePlacement` 持有，只把 sprite 的 `visual` 绘制组放进去，换肤或换 bank 时替换该组而保留实体身份。

## 静态墙实现

`src/camera.ts` 的 `FollowCameraController.facing` signal 把相机 heading（`packages/animation/src/facing.ts` 的 `facingFromHeading()`）按 45° 分成 8 档，取对应 `FACING_*`（`constants.lua`：RIGHT=0、UP=1、LEFT=2、DOWN=3、UPRIGHT=4、UPLEFT=5、DOWNRIGHT=6、DOWNLEFT=7；墙的 rotation 为 0，故 `a = heading`，偶数档为四个正向，奇数档为四个斜向）的位掩码，该 signal 只在 heading 跨过扇区边界时写入，经 `WorldContext.cameraFacing` 传给 `WallPlacement`，后者用 `watchSignal` 建立私有本地 signal，并在 `createEffect` 中对预览和已建墙调用 `setFacing()`，由动画按 `facing` 掩码匹配 clip；`wall.zip` 与 `wall_dreadstone.zip` 的每个状态只创作了 `15`（四个正向共用）和 `240`（四个斜向共用）两组美术，同组内选哪个方向不改变画面。再调用 `packages/animation/src/wallSprite.ts` 的 `StaticSpriteController.showImage()` 切换图片。

`createStaticSprite()` 每次显示一个 build 图片，`imageIndices` 提前列出所有需要的 facing，不必随相机转动重建 sprite。`wall_dreadstone` 另将 `wall_segment_red` 叠在 `wall_segment_base` 上：通过 `overlay` 传入覆盖符号，其 `imageIndices` 与基础列表按位置配对，让朝向切换后仍保留发光层。


## 地皮与洞穴崖壁 falloff

`falloffdefs.lua` 的普通陆地规则由 `TurfMap.rebuildFalloff()` 生成边面；贴图保持源路径 `levels/tiles/falloff.tex` / `.xml`，源图集有六个方形单元。Lua 最终调用原生 `Map:AddFalloffTexture`，没有提供顶点、高度或随机选图算法。当前视觉尺寸对照 `public/saves/Cluster_1/Snipaste_2026-10-17_20-14-39.png` 校准：一个图集单元覆盖连续两格边界，高度四格；相邻两格共享同一纹理变体和连续 UV，负坐标同样连续，底部从高度比例 0.35 起渐隐至透明。它们是 Web 版视觉校准参数，不声称来自 Lua 的数值。

地皮仍按源地皮层混合，崖壁颜色在地皮之后、积雪与动态角色之前绘制，颜色 pass 均不写深度。`GroundDepthPrepass` 为每个地皮／崖壁颜色 Mesh 添加一个借用同一几何体的 opaque 深度 Mesh：`colorWrite=false`、`depthWrite=true`、alpha-test 0.98，仅实心部分建立遮挡，保留软边缘的颜色混合。深度材质复用地皮 atlas 的 onBeforeCompile 和纹理，不能只用噪声图计算 alpha。地皮重建时两个 pass 同步更换几何体；几何体与纹理由原持有者释放，深度 pass 只释放自己的材质。

一个合并的透明 Mesh 不会自动排序内部崖壁面。`sortGroundFalloffGeometry` 根据 model-view 矩阵对等高边面的中心深度由远到近排序，仅更新索引，不重建顶点、不拆成逐面 Mesh；相机矩阵未变化时复用结果。实心深度与软边排序分别处理，不能用一个固定 renderOrder 替代空间遮挡。代表性浏览器验证会反转整组输入边面并旋转相机，比较实际 WebGL 像素；单位测试覆盖跨负坐标纹理连续性、索引更新与几何体／材质的所有权。

动画循环只循环时间轴，不对 build 的子图编号取模。子图只在 `index <= frame < index + duration` 的范围内有效，空白子图或缺失编号保持不可见；共享 archive sprite 同样跳过已知符号的缺失编号，缺失整个符号仍报告资源错误。桦树 `tree_leaf_green_build` 的 `swap_leaves` 只有 0～16 号子图，`sway1_loop_tall` 中 17～19 号插槽必须隐藏，不能回绕到 0～2 号，否则多画三层树叶并出现切半拼接。洞穴池塘也沿用同一空白插槽规则。调试命令、参数及支持的 prefab/item ID 不变。

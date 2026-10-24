# DST Billboard 绘制顺序与墙朝向

开发约束见 [AGENTS.md](../AGENTS.md)。本文记录绘制规则的原因和墙资产的具体帧映射。

雨丝、水花、雪花最前层与积雪地表各自的顺序及材质约束见 [雨雪天气实现约束](dst-weather.md)。雪花使用独立的最终覆盖 Group；地面水花仍按本文的实体脚点规则排序。

## 动画实体的层次

玩家、猪王等动画实体的一帧通常包含多个 DST 元素。每个元素的二维变换烘焙到四边形顶点，所有元素合并为一个 `BufferGeometry`，通过索引与连续材质组保留源层顺序。

一个几何体不一定意味着一次 draw call：Three.js 每个几何体材质组发起一次调用，例如 Wilson 手持物品时可能同时使用角色基础 atlas 与 swap atlas。

`packages/animation/src/renderOrder.ts` 登记每个动画 sprite 最内层的 `visual` group，`setSpriteEntityRenderOrder()` 将实体顺序写到该 group。每帧按实际脚点的相机空间深度由远到近排序；若改用 sprite 中心或包围盒中心，高个实体会过早或过晚改变遮挡关系。

## 镜像部件与透明材质

DST 的镜像部件会反转三角形绕序。Three.js 的透明 `DoubleSide` 材质如果分背面与正面两次绘制，索引中保存的源层顺序就会被打散。曾出现的具体症状是猪王镜像左手被躯干遮住而消失。

合并动画 billboard 的透明双面材质设置 `forceSinglePass = true`，让两种朝向在同一 pass 中绘制。

## 实例化场景

实例化的分层 DST 图像先通过 `packages/animation/src/rgbaSpriteAtlas.ts` 预合成为 RGBA sprite atlas，实例共享纹理和单四边形几何体。直接实例化未合成的重叠部件仍会遇到层顺序问题。

如果使用实例化 billboard 森林，单个 draw call 无法把各树实例与动态透明角色逐个交错排序。对应绘制顺序为：

1. Alpha test 深度预渲染：`colorWrite = false`、`depthWrite = true`。
2. 森林透明颜色 pass：`depthWrite = false`，在动态角色之前提交。
3. 动态角色按各自脚点的深度排序绘制。

森林颜色 pass 写深度会让共面的 DST 层发生 z-fighting，表现为相机移动时闪烁。此方案适用于实例化森林；当前使用独立动画实体的场景仍按实体脚点排序。

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

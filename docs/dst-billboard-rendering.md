# DST Billboard 绘制顺序与墙朝向

开发约束见 [AGENTS.md](../AGENTS.md)。本文记录绘制规则的原因和墙资产的具体帧映射。

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

## 静态墙实现

`packages/prefab/src/wallPlacement.ts` 的 `isDiagonalHeading()` 判断当前相机朝向，再调用 `packages/animation/src/wallSprite.ts` 的 `StaticSpriteController.showImage()` 切换图片。

`createStaticSprite()` 每次显示一个 build 图片，`imageIndices` 提前列出所有需要的 facing，不必随相机转动重建 sprite。`wall_dreadstone` 另将 `wall_segment_red` 叠在 `wall_segment_base` 上：通过 `overlay` 传入覆盖符号，其 `imageIndices` 与基础列表按位置配对，让朝向切换后仍保留发光层。

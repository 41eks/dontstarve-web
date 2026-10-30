# Animation package instructions

适用于 `packages/animation`：sprite／controller、resident、atlas 合成与合批渲染。

## Shared resources and entity state

- 共享缓存：同一 manager／资源生命周期内的实体，shared archive 路径必须复用同一个 `ArchiveSpriteAssets`；factory 路径必须按实际 animation／build、皮肤及控制器配置复用兼容的 factory。不得逐实体或每次唤醒时创建资源缓存、共享源材质或帧几何缓存；实体独立颜色／透明度所需的私有材质副本由动画实现管理。
- 独立实体状态：各实体独立维护模型位置、播放进度、完成回调和私有外观状态，通过 sprite／控制器接口修改；不得直接修改或释放共享帧的顶点、UV、索引、几何体、源材质或纹理。

## Billboard drawing order and wall facing

- Sort animated billboards as whole entities each frame, far to near by camera-space depth of the actual ground-contact/foot point, never the sprite or bounding-box center.
- Merge each animated frame's parts into one `BufferGeometry`, baking their 2D transforms into vertices and preserving DST layer order through indices and consecutive material groups. Do not restore one mesh per body part or assume a multi-material frame is one draw call.
- Apply entity order to the innermost registered `visual` group; do not rely on `scene.add()` order or globally colliding per-part `renderOrder` values.
- Set `forceSinglePass = true` on transparent `DoubleSide` materials used by merged billboards to preserve layer order for mirrored parts.
- Precompose layered frames for instanced scenery through `packages/animation/src/rgbaSpriteAtlas.ts`; instances must share the resulting texture and single-quad geometry, not unresolved overlapping part geometry.
- 图集合成统一走现有 GPU 合成与 CPU 回退入口；运行中的首次外观准备须按帧预算推进，不得在 prefab 或逐实体绘制中增加同步整段合成。预算需包含帧解析与布局，单次不可拆的上传等操作应单独测量；加载预热和测试 `flush()` 可显式完成全部任务。实现与待优化项见 [GPU atlas composition](../../docs/dst-gpu-atlas-composition.md)。
- 借鉴 Spine 的 sprite 合批时，保留源图层顺序，只合并连续且贴图／混合状态兼容的部件；临时动态缓冲按容量复用，仅提交有效绘制及更新区间，保留尚未消费的更新。不得为缓冲复用改写不可变共享帧，或直接套用 Spine 的颜色空间、预乘 alpha 与深度配置；合成输出必须兼容本项目的 `dstLighting` 和深度预通道。
- 排除离屏合成的绘制统计时，只恢复 calls／triangles／lines／points，不得回退 Three.js 的 `renderer.info.render.frame`；该内部帧编号参与可复用 geometry 的上传判定，回退会使动画后续帧跳过上传。
- For instanced billboard forests, use an alpha-tested, color-disabled depth prepass (`colorWrite = false`, `depthWrite = true`) followed by a transparent color pass (`depthWrite = false`) before dynamic characters. Do not write depth in the forest color pass.
- Walls remain at world rotation `0` and switch eight-faced art using the source facing masks and camera heading. Pair equivalent frames from the same animation across facings.
- List all static sprite facings in `imageIndices` and switch with `showImage()` rather than rebuilding the sprite. Preserve layered wall art through `overlay` with positionally paired `imageIndices`.
- See [rendering rationale, wall masks, and frame examples](../../docs/dst-billboard-rendering.md).

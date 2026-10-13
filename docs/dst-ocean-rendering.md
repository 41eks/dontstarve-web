# 海洋颜色纹理与多阶段渲染

`packages/prefab/src/ocean.ts` 对应 Lua `components/oceancolor.lua`，负责昼夜颜色与纹理混合比例的插值。它通过私有 `watchSignal` 读取世界时钟，在显式释放时解除桥接及其 effect。插值和移动噪声使用每帧实际 `dt`，不写世界时钟。

`packages/prefab/src/oceanRenderPipeline.ts` 负责渲染目标、材质和离屏步骤。对应的 shader 来自 `/data/copy/AssetArchive-Dev/data/DST/data/databundles/shaders.zip`；Lua 参数来自 `tiledefs.lua`、`tilemanager.lua`、`tuning.lua` 和 `gamelogic.lua`。

1. 按地图格子生成近海与默认陆地的主色、白天次色、黄昏次色 RGBA 纹理。保留原始显示空间数值，不在颜色数据上传或模糊时进行 sRGB 解码。
2. 按 `blurh.ksh` / `blurv.ksh` 对三个颜色纹理分别执行 3 轮横向／纵向模糊，步长为 1 个 texel。九点权重为 `0.05, 0.09, 0.12, 0.15, 0.16, 0.15, 0.12, 0.09, 0.05`；总和是原版的 `0.98`，不重新归一化。中间目标为半浮点 RGBA，避免每一轮发生八位整数舍入。
3. 按 `blendoceantexture.ksh` 混合已模糊的白天和黄昏次色纹理，RGB 和 alpha 一起插值。主色纹理单独保留，作为动态噪声的颜色与透明度输入。
4. 按 `ocean_combined.ksh` 在世界坐标下采样颜色纹理，叠加三组移动的绿色通道噪声，并读取与其他世界材质相同的光照贴图。结果以 RGB 乘 `2`、未预乘 alpha 的形式写入屏幕大小的半浮点渲染目标，保留超过 `1` 的编码值。
5. 按 `ocean.ksh` 在屏幕空间读取中间结果，RGB 乘 `0.5` 解码，转换到 Three.js 当前目标所用的色彩空间，并预乘 alpha 合成。海底背景独立使用 `oceancolor.lua` 的 clear colour，不重复应用世界光照。

当前地图只支持 `OCEAN_COASTAL`。颜色纹理采用每格一个 texel，范围对齐实际有符号 tile 网格，包括地图边缘的部分格子；原引擎内部颜色纹理分辨率和生成步骤没有在 Lua 中公开。这是当前地图的分辨率选择，不能据此声称与原引擎逐像素一致。

颜色纹理仅在地图改变时重建和模糊，混合比例变化时更新混合纹理。动态合成每帧执行，以反映噪声、相机和光照变化。屏幕目标随实际渲染目标或 drawing buffer 尺寸变化重建，支持设备像素比例和离屏世界渲染。每次离屏操作恢复原渲染目标、clear colour、clear alpha、scissor 状态和 `autoClear`。

`packages/animation/src/sceneRenderPass.ts` 提供可见场景对象的预渲染／预热登记。`DstLightingRenderer` 在世界光照贴图更新后、世界绘制前执行这些步骤，并在预热阶段准备离屏 shader 与纹理。海洋实例显式释放时取消登记并释放所有自身资源；共享的噪声纹理与光照贴图仍由原所有者管理。中间渲染目标不进入存档，读档后由保存的地图与世界阶段重新建立。

浏览器测试覆盖原版模糊的数值衰减、岸线 RGBA 过渡、昼夜纹理混合、光照和编码／解码、设备像素比例、目标尺寸变化、渲染状态恢复与资源所有权。原有海面、岸线、积雪及保存重载测试继续覆盖完整场景。

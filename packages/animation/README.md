# @dontstarve-web/animation

## DST 动画实体

`@dontstarve-web/animation/archiveSprite` 提供 `ArchiveSpriteAssets` 和
`createArchiveSprite(assets, definition, options?)`，负责并行加载 animation/build/皮肤资源、
选择 bank 和动画、解析符号覆盖、创建模型和内部 visual Group，以及逐帧绘制。
调用方传入资源定义；该模块不依赖 prefab 目录、物品 ID 或库存事件。

```ts
import { ArchiveSpriteAssets, createArchiveSprite } from '@dontstarve-web/animation/archiveSprite';

const assets = new ArchiveSpriteAssets();
const sprite = await createArchiveSprite(assets, {
  animationArchive: 'torch.zip', buildArchives: ['swap_torch.zip'],
  bank: 'torch', animation: 'idle', loop: false,
}, { name: 'Torch' });
scene.add(sprite.model);
sprite.update(dt);
sprite.setPaused(true);
sprite.dispose(); // 释放实体几何；共享材质和纹理由 assets 持有
assets.dispose(); // 所有使用此缓存的实体移除后释放共享资源
```

`definition.symbolOverrides` 指定源符号对应的 build archive 和替换符号；
`options.skinArchive` 指定皮肤 build，缺少的符号回退到基础 build。
`options.scale` 默认为 `0.02`，Y 轴翻转用于 DST 的二维坐标。
`new ArchiveSpriteAssets(materialNamePrefix?, assetBaseUrl?)` 可注入动画根路径；省略时为
`${import.meta.env.BASE_URL}dst/data/anim`，同一个资源所有者的所有实体共用此路径和缓存。
每帧部件合并为一个几何体，保留源图层顺序和连续材质组；内部 visual 已注册到
实体绘制排序系统。`setAnimation(name)` 切换同一 bank 的动画，`setPaused(boolean)`
控制更新，具体掉落和库存行为由 prefab 层监听事件后调用。

## 通用共享帧入口

prefab 可直接使用 `createSharedArchiveSprite(assets, definition, options?)`，参数与返回的控制器沿用
`createArchiveSprite()`。所有动画在首次显示某帧时缓存几何，后续 `start()` / `playOnce()` 切换的 clip 也自动共享，
无需在 prefab 里列出普通、开采后或其他状态的动画清单。

```ts
import { ArchiveSpriteAssets, createSharedArchiveSprite } from '@dontstarve-web/animation/archiveSprite';

// 每个 manager 只创建一个资源所有者，所有实例共用；不要在逐实体构造中重新创建。
const assets = new ArchiveSpriteAssets();
const sprite = await createSharedArchiveSprite(assets, {
  animationArchive: 'moonglasspool_tile.zip',
  buildArchives: ['moonglasspool_tile.zip'],
  bank: 'moonglasspool_tile', animation: 'idle', loop: true,
}, { name: 'grotto_pool_big' });
sprite.update(dt);
sprite.dispose(); // 只释放本实例的资源
assets.dispose(); // manager 的所有实例移除后，统一释放缓存几何、材质和纹理
```

缓存按实际 clip、帧、build、皮肤、符号覆盖和隐藏配置区分；模型位置、播放进度、完成回调和私有颜色／透明度仍独立。
共享的是不可变几何，调用方不要直接修改其顶点、UV、索引或释放它。`grotto_pool` 已使用此入口；
仅需部分动画共享时，仍可用 `createArchiveSprite()` 的 `sharedAnimations: ['idle']`。

## prefab 的动画切换

动画包统一提供共享帧和通用播放接口；动作对应哪个源 clip、结束后播放什么，由 prefab 按 Lua 选择。
例如蘑菇树直接使用 `createSharedArchiveSprite()` 返回的控制器：

```ts
sprite.setFrame(Math.floor(Math.random() * sprite.frameCount));
sprite.playOnce('chop', () => sprite.start('idle_loop'));
sprite.playOnce('fall', () => sprite.start('idle_stump'));
sprite.playOnce('change', () => sprite.start('idle_loop'));
```

待机、受击、倒下、树桩及生长／开花的帧几何自动共享，各实体保留独立模型节点、播放进度、完成回调和材质颜色。
换帧命中缓存时不再逐实体解析部件、重写顶点或上传几何；普通共享帧仍按实体脚点排序与绘制。
砍伐次数、掉落、生长阶段、计时和保存仍由 prefab 与组件负责。

底层 `createArchiveSprite()` 的 `options.sharedAnimations` 支持 clip 列表或 `'all'`；默认保留独立几何。

## 场景动画实例化

`createSharedArchiveSprite()` 可额外传入 `instancedAnimations: ['idle_loop']`。指定的循环 clip
由同一个 `ArchiveSpriteAssets` 按外观合批为 `InstancedMesh`；其他 clip（以及 `playOnce()`）继续显示普通共享帧，
返回指定循环时自动重新入批。蓝／红／月亮蘑菇树已启用此选项；随机起始帧、颜色、透明度和实体位置保持独立。

`instancedAnimations: 'all'` 同时实例化非循环动画，保持 `playOnce()` 的完成回调和末帧停留语义。
蓝蘑菇使用此模式绘制 `blue`、`inground`、`picked` 及张开／缩回动画；所有植株复用 manager
持有的 `ArchiveSpriteAssets`，每株独立切换动画。`preloadSharedArchiveSprite()` 提供同样的共享与实例化路径，
预载一次后同步创建各植株，保留原有植物组件、交互和存档生命周期。

`RockManager` 同样使用 `instancedAnimations: 'all'`：`full/med/low`、落石的 `idle/idle_raised`
按 Lua 保持非循环播放，开采切换姿态后重新选择对应共享图集批次。动画与 build 分离的落石及其
`swap_boulder2..8` 符号覆盖也按外观合批，实体明暗和拾取代理保持独立。
月岩壳破碎后通过 `spriteErosion.ts` 的 `setSpriteErosion()` 写入独立的实例侵蚀量，
深度与颜色 pass 使用同一侵蚀属性；完成移除仍由游戏时间调度器执行，不依赖绘制帧。

源 atlas 中分散的部件经 `rgbaSpriteAtlas.ts` 按动画变换及层顺序预合成完整帧。图集使用源纹理密度、
按设备上限分页（每页不超过 4096），同一 clip 共用固定边界和像素网格，避免逐帧裁切取整导致抖动。
每个可见图集页绘制一次深度预处理和一次透明颜色 pass；颜色 pass 排在地皮之后、动态角色之前且不写深度。
实例也继承实体祖先上的 `lightOverride`，按实例属性交给既有共享 lightmap 着色；萤火虫的
`swarm_loop` 使用此路径保留夜间自亮，开始和结束动画仍使用普通共享帧。
嵌套在逻辑实体下的 sprite 可通过 `options.foot` 指定实际脚点节点，排序与抛出时视觉高度分开。
实例按完整帧的世界包围球做视锥裁剪；离屏实体继续推进动画并保留共享资源，但不参与本帧的实例排序和上传。

场景需通过 `renderSceneWithPasses(renderer, scene, camera)` 绘制；启动预热使用
`await prewarmScenePasses(renderer, scene, camera, signal)`，两者导出自 `@dontstarve-web/animation/sceneRenderPass`。
单实体保留渲染隐藏的源帧用于精确 alpha 拾取和空间边界，`sprite.dispose()` 释放实体并退出批次，
所有实体移除后由 `assets.dispose()` 统一释放合成图集、批次和共享源资源。

## DST 图片 XML 索引

`images/` 下的 XML 文件原样提取自：

```text
public/dst/data/databundles/images.zip
```

文件保留了压缩包内 `images/` 目录的相对路径。例如：

```text
images.zip!images/inventoryimages3.xml
    -> packages/animation/images/inventoryimages3.xml
```

这些文件是 DST 图片图集的纯文本索引，记录对应 `.tex` 纹理文件以及各图片元素的名称和 UV 坐标。将它们保留在包内是为了能够直接使用编辑器或 `rg` 搜索图片名称；运行时使用的原始资源仍位于 `public/dst/data`。

更新 `images.zip` 后，使用以下命令重新同步全部 XML 索引：

```sh
unzip -oq public/dst/data/databundles/images.zip 'images/*.xml' -d packages/animation
```

例如搜索物品图片所在的索引：

```sh
rg 'spear_rose' packages/animation/images
```

## UI 共享图集图片

`@dontstarve-web/animation/atlasImage` 用 KV 缓存小图在共享图片上的
`imageUrl`、`x`、`y`、`width`、`height`、`atlasWidth` 和 `atlasHeight`。
每张源纹理只转成一个 PNG Blob URL，格子使用 CSS 背景裁切，按小图比例缩放；
不为每个格子裁切像素或创建 canvas。

```ts
import { loadImageAtlas } from '@dontstarve-web/animation/imageAtlas';
import { registerImageAtlases, createAtlasImage, getAtlasImage } from '@dontstarve-web/animation/atlasImage';

// 初始化时批量注册；加载函数在第一次查询时才执行，也可以直接传已加载的 ImageAtlas。
const archive = `${import.meta.env.BASE_URL}dst/data/databundles/images.zip`;
registerImageAtlases(Object.fromEntries([
  'images/crafting_menu.xml', 'images/hud.xml', 'images/inventoryimages.xml',
].map((path) => [path, () => loadImageAtlas(archive, path)])));

const image = createAtlasImage('slot-background', 'images/crafting_menu.xml', 'pinslot_bg.tex');
container.append(image); // 返回独立的 span，各个实例共享同一张背景图片。
await image.ready;
const region = await getAtlasImage('images/crafting_menu.xml', 'pinslot_bg');
```

为返回的元素设置宽高，内部 CSS 会居中并保持小图比例。`ready` 等待共享图片解码完成；
失败时拒绝 Promise，同时设置 `data-error` 并触发 `error` 事件。图集加载失败后下次查询会重试。
注册按图集路径去重，同名小图通过图集路径区分。页面内显式结束游戏时可调用 `disposeAtlasImages()`
释放 Blob URL 和注册表；下一次初始化重新注册。`pagehide` 不执行该清理。

UI 的批量注册入口是 `packages/ui/src/image-atlases.ts`；资源包路径只在此处配置，
制作、HUD、物品栏和接收动画的调用方不再传入 `archiveUrl`。

## DST 制作配方

### 来源

配方来自 DST 的 `scripts.zip` 数据包，压缩包及内部文件路径为：

```text
/data/copy/AssetArchive-Dev/data/Don't Starve Together/data/databundles/scripts.zip
└── scripts/recipes.lua
```

当前使用的是 AssetArchive 解包后的同一文件：

```text
/data/copy/AssetArchive-Dev/data/Don't Starve Together/data/databundles/scripts_unpacked/scripts/recipes.lua
```

该文件原样复制到 `packages/animation/scripts/recipes.lua`，再由
`packages/animation/scripts/extract-recipes.mjs` 转换为 `packages/animation/recipes.json`：

```text
scripts.zip!scripts/recipes.lua
    -> packages/animation/scripts/recipes.lua
    -> packages/animation/recipes.json
```

### JSON 生成规则

`recipes.json` 是便于前端直接读取的结构化版本，包含 `recipes` 和
`deconstructionRecipes` 两组数据。Lua 中的常量、函数引用等不能安全转换为普通
JSON 值的表达式会保留为 `{ "lua": "原表达式" }`，循环生成的配方则会展开成最终条目。

同步 `scripts/recipes.lua` 后可重新生成并检查 JSON：

```sh
pnpm --filter @dontstarve-web/animation recipes:generate
pnpm --filter @dontstarve-web/animation recipes:check
```

其他 workspace 包也可以通过导出路径读取：

```ts
import recipeData from '@dontstarve-web/animation/recipes.json';
```

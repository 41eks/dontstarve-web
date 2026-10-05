# @dontstarve-web/animation

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
注册按图集路径去重，同名小图通过图集路径区分。游戏关闭时调用 `disposeAtlasImages()`
释放 Blob URL 和注册表；下一次初始化重新注册。

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

# @three-roaming/wilson

## DST 图片 XML 索引

`images/` 下的 XML 文件原样提取自：

```text
public/dst/data/databundles/images.zip
```

文件保留了压缩包内 `images/` 目录的相对路径。例如：

```text
images.zip!images/inventoryimages3.xml
    -> packages/wilson/images/inventoryimages3.xml
```

这些文件是 DST 图片图集的纯文本索引，记录对应 `.tex` 纹理文件以及各图片元素的名称和 UV 坐标。将它们保留在包内是为了能够直接使用编辑器或 `rg` 搜索图片名称；运行时使用的原始资源仍位于 `public/dst/data`。

更新 `images.zip` 后，使用以下命令重新同步全部 XML 索引：

```sh
unzip -oq public/dst/data/databundles/images.zip 'images/*.xml' -d packages/wilson
```

例如搜索物品图片所在的索引：

```sh
rg 'spear_rose' packages/wilson/images
```

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

该文件原样复制到 `packages/wilson/scripts/recipes.lua`，再由
`packages/wilson/scripts/extract-recipes.mjs` 转换为 `packages/wilson/recipes.json`：

```text
scripts.zip!scripts/recipes.lua
    -> packages/wilson/scripts/recipes.lua
    -> packages/wilson/recipes.json
```

### JSON 生成规则

`recipes.json` 是便于前端直接读取的结构化版本，包含 `recipes` 和
`deconstructionRecipes` 两组数据。Lua 中的常量、函数引用等不能安全转换为普通
JSON 值的表达式会保留为 `{ "lua": "原表达式" }`，循环生成的配方则会展开成最终条目。

同步 `scripts/recipes.lua` 后可重新生成并检查 JSON：

```sh
pnpm --filter @three-roaming/wilson recipes:generate
pnpm --filter @three-roaming/wilson recipes:check
```

其他 workspace 包也可以通过导出路径读取：

```ts
import recipeData from '@three-roaming/wilson/recipes.json';
```

# @three-roaming/prefab

DST 场景预制体。该包基于 `@three-roaming/animation` 组合具体资源，当前提供：

- `createWilsonPlayer` / `createWilsonPlayerPrefab`
- `createPigKing`
- `createMoonTreeForest`

调用方负责传入 `${import.meta.env.BASE_URL}dst/data/anim` 形式的动画资源根路径；
Pig King 的地板纹理 URL 也由调用方传入。这样 prefab 包不依赖应用的 Vite base 配置。

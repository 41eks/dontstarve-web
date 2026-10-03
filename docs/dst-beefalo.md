# Beefalo

在游戏控制台输入 `c_spawn('beefalo')`，会在玩家附近的空地生成一只成年野生皮弗娄牛。可重复生成，每只牛拥有独立行为、动画和物理碰撞体，共享原始贴图。

实现位于 `packages/prefab/src/beefalo.ts`，依据 DST 的 `prefabs/beefalo.lua`、`brains/beefalobrain.lua`、`stategraphs/SGBeefalo.lua` 和 `components/periodicspawner.lua`：

- 随机游荡和停步，使用 `walk_pre`、`walk_loop`、`walk_pst`；寻路避开建筑，物理碰撞防止穿过角色。
- 空闲时吃草、抖毛或播放嚎叫动作。野生牛初始饥饿值为零，吃草使用 `graze2_pre/loop/pst`。
- 玩家进入 4 个 DST 单位内时停步注视，超过 6 个单位才恢复游荡。
- 夜间播放入睡和睡眠动画，天亮播放起身动画。
- 每 40–60 秒尝试在身后生成粪肥，遵守最小间距 8、半径 20 内最多 2 个的源脚本规则。粪肥使用已有地面动画，可以拾取和保存。

距离与行走速度按 `TILE_SIZE / 4` 转换为场景单位。牛保持源动画原点为脚点；六向画面根据运动方向和相机方向选择，改变朝向不会重播动画。所有部件合并为一份帧几何，透明双面材质使用 `forceSinglePass`，与玩家和建筑按脚点深度统一排序。

资源按源目录原样保存于 `public/dst/data/anim/`：`beefalo_basic.zip`、`beefalo_actions.zip`、`beefalo_actions_domestic.zip`、`beefalo_build.zip`。前三份提供动画，最后一份提供 `beefalo_build` 和两个贴图图集。动画支持集中在 `packages/animation/src/beefaloSprite.ts`，组合这些资源包、切换六方向动画，并隐藏源脚本中的 `HEAT` 层。

`c_save()` 保存牛的 ID、位置、游荡中心、朝向和粪肥剩余计时。加载时重新创建碰撞体和动画，依据当前昼夜恢复行为。本次仅实现被动基础行为，尚未接入音效、战斗、发情、喂养、驯化或骑乘。

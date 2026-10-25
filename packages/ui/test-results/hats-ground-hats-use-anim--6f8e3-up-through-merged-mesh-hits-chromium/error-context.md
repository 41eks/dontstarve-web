# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: hats.spec.ts >> ground hats use anim geometry, preserve feet and pick up through merged mesh hits
- Location: tests/hats.spec.ts:58:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 2
+ Received  + 1

@@ -16,11 +16,10 @@
    "iconPickedUp": true,
    "iconPrefab": "beeswax",
    "isAnimatedMesh": true,
    "pickedUp": Array [
      "strawhat",
-     "torch",
      "beeswax",
    ],
    "rejectedPickupCount": 1,
    "restoredFoot": Array [
      3,
@@ -32,7 +31,7 @@
      -6,
      0,
      0,
    ],
    "torchIsMesh": true,
-   "torchPickedUp": true,
+   "torchPickedUp": false,
  }
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - main:
    - region "制作菜单":
      - generic [aria-hidden]:
        - button
        - heading [level=1]: 工具
        - button
      - navigation [aria-hidden]:
        - button
        - button [pressed]
        - button
        - button
        - button
        - button
        - button
        - button
        - button
        - button
        - button
        - button
        - button
        - button
        - button
        - button
        - button
        - button
        - button
        - button
        - button
        - button
      - generic [aria-hidden]:
        - listbox:
          - generic:
            - generic:
              - option [selected]
              - option
              - option
              - option
              - option
              - option
              - option
            - generic:
              - option
              - option
              - option
              - option
              - option
              - option
              - option
            - generic:
              - option
              - option
              - option
              - option
              - option
              - option
              - option
            - generic:
              - option
              - option
              - option
              - option
              - option
              - option
              - option
            - generic:
              - option
              - option
              - option
              - option
              - option
              - option
              - option
            - generic:
              - option
              - option
              - option
              - option
              - option
              - option
              - option
            - generic:
              - option
              - option
              - option
              - option
              - option
              - option
              - option
            - generic:
              - option
              - option
              - option
              - option
              - option
              - option
              - option
        - generic:
          - button [disabled]
          - scrollbar
          - button
      - article [aria-hidden]:
        - generic:
          - generic:
            - heading [level=2]: 斧头
          - paragraph: 砍倒树木！
        - generic:
          - button
          - button
          - strong: 默认
        - generic:
          - generic: 17/1
          - generic: 0/1
        - button [disabled]: 建造
      - complementary "快捷制作" [ref=e2]:
        - button "展开制作菜单" [ref=e3] [cursor=pointer]
        - generic "配方页码" [ref=e4]:
          - button "上一页" [ref=e5] [cursor=pointer]
          - generic [ref=e6]: "1"
          - button "下一页" [ref=e7] [cursor=pointer]
        - generic [ref=e8]:
          - text: Transmute Log Transmute Twigs Transmute Flint Transmute Rocks Transmute Bluegem Transmute Redgem Transmute Purplegem Transmute Orangegem Transmute Yellowgem Transmute Greengem
          - generic [ref=e9]:
            - button "斧头" [ref=e10] [cursor=pointer]
            - button "鹤嘴锄" [ref=e11] [cursor=pointer]
            - button "铲子" [ref=e12] [cursor=pointer]
            - button "锤子" [ref=e13] [cursor=pointer]
            - button "园艺锄" [ref=e14] [cursor=pointer]
            - button "干草叉" [ref=e15] [cursor=pointer]
            - button "黄金斧头" [ref=e16] [cursor=pointer]
            - button "黄金鹤嘴锄" [ref=e17] [cursor=pointer]
            - button "黄金铲子" [ref=e18] [cursor=pointer]
            - button "黄金园艺锄" [ref=e19] [cursor=pointer]
          - text: 薇洛的打火机 火炬 营火 便携营火 火坑 低微咩咩雕像 吸热营火 吸热火坑 南瓜灯 矿工帽 科学机器 炼金引擎 智囊团 钓具容器 制图桌 灵子分解器 暗影操控器 陶轮 土地夯实器 锯马 绳子 Walter Rope 木板 Woodie Boards 石砖 莎草纸 电子元件 活木头 时间碎片 蜡纸 电气化电路 警钟 可靠的弹弓 薇诺娜的投石机 薇诺娜的投石机 强抢袋 长矛 战斗长矛 奔雷矛 回旋镖 格挡电路 草甲 木甲 荆棘外壳 鳞甲 暗夜甲 大理石甲 硬木帽 橄榄球头盔 战斗头盔 针线包 可靠的胶布 聪明的伪装 松树先锋队帽子 充气背心 气球帽 背包 种子袋 猪皮包 保鲜背包 不老表 第二次机会表 治疗黏团 豆增压电路 扑腾绷带 治疗药膏 黏糊糊的药膏 避火膏 蜂蜜药膏 犁地草膏 阿比盖尔之花 警钟 俗气鹅像 俗气海狸像 俗气鹿像 树精守卫雕像 魔术师高礼帽 魔术师箱子 暗影秘典 灵子分解器 盛宴树盆 陶轮 土地夯实器 羽毛笔 清洁扫把 木牌 指路木牌 小木牌 蕨类盆栽 多肉盆栽 砖砌烤炉 冬季盛宴餐桌 盛宴树盆 疯狂科学家实验室 火鸡神龛 座狼神龛 猪神龛 胡萝卜鼠神龛 皮弗娄牛神龛 浣猫神龛 捆绑包装 礼物包装 背包 猪皮包 保鲜背包 厨师袋 种子袋 糖果袋 战斗号子罐 灵魂罐 砖砌烤炉 再消化电路 薇洛的打火机 便携烹饪锅 便携研磨器 便携香料站 厨师袋 烹饪指南 烹饪锅 晾肉架 耕地机 园艺锄 黄金园艺锄 烧灼园艺锄 空浇水壶 空鸟嘴壶 便便桶 催长剂起子 树果酱 肥料包 钓具容器 淡水钓竿 海钓竿 木球浮漂 硬物浮漂 黑羽浮漂 红羽浮漂 蔚蓝羽浮漂 黄羽浮漂 鹅羽浮漂 智囊团 草筏套装 船套装 海带补丁 船补丁 桨 浮木桨 充气背心 锚套装 方向舵套装 皮弗娄牛铃 舔盐块 美味舔盐块 刷子 鞍角 鞍具 战争鞍具 战斗鞍具 闪亮鞍具 皮弗娄牛美妆台 营火 便携营火 火坑 低微咩咩雕像 龙鳞火炉 暖石 热能电路 犬牙背心 雨衣 透气背心 吸热营火 吸热火坑 暖石 制冷电路 寒冰护符 旋转的风扇 花伞 雨伞 羽毛扇 避火膏 花伞 雨伞 传送伞 雨衣 气球帽 草帽 养蜂帽 高礼帽 魔术师高礼帽 矿工帽
  - region "生存状态":
    - generic:
      - img "世界第 1 日，白天" [ref=e20]
      - generic "当前季节：冬":
        - strong: 冬
    - generic:
      - generic "饱食度 105":
        - status: "105"
      - generic "精神值 35":
        - status: "35"
      - generic "生命值 150":
        - status: "150"
    - generic "温度 45 度":
      - status: 45°
  - region "物品栏" [ref=e22]:
    - group "背包" [ref=e23]:
      - generic [ref=e24]:
        - button "物品栏 1" [ref=e25] [cursor=pointer]
        - button "物品栏 2" [ref=e26] [cursor=pointer]
        - button "物品栏 3" [ref=e27] [cursor=pointer]
        - button "物品栏 4" [ref=e28] [cursor=pointer]
        - button "物品栏 5" [ref=e29] [cursor=pointer]
      - generic [ref=e30]:
        - button "物品栏 6" [ref=e31] [cursor=pointer]
        - button "物品栏 7" [ref=e32] [cursor=pointer]
        - button "物品栏 8" [ref=e33] [cursor=pointer]
        - button "物品栏 9" [ref=e34] [cursor=pointer]
        - button "物品栏 10" [ref=e35] [cursor=pointer]
      - generic [ref=e36]:
        - button "物品栏 11" [ref=e37] [cursor=pointer]
        - button "物品栏 12" [ref=e38] [cursor=pointer]
        - button "物品栏 13" [ref=e39] [cursor=pointer]
        - button "物品栏 14" [ref=e40] [cursor=pointer]
        - button "物品栏 15" [ref=e41] [cursor=pointer]
    - group "装备" [ref=e42]:
      - button "手部装备" [ref=e43] [cursor=pointer]
      - button "身体装备" [ref=e44] [cursor=pointer]
      - button "头部装备" [ref=e45] [cursor=pointer]
    - button "查看角色" [ref=e46] [cursor=pointer]
  - region "地图控制" [ref=e47]:
    - button "打开地图" [ref=e48] [cursor=pointer]
    - generic [ref=e49]:
      - button "向左旋转视角" [ref=e50] [cursor=pointer]
      - button "暂停游戏" [ref=e51] [cursor=pointer]
      - button "向右旋转视角" [ref=e52] [cursor=pointer]
```

# Test source

```ts
  1  | import { fileURLToPath } from 'node:url';
  2  | import { expect, test } from '@playwright/test';
  3  | 
  4  | const moduleUrl = (path: string) => `/@fs${fileURLToPath(new URL(path, import.meta.url))}`;
  5  | const modules = {
  6  |   hats: moduleUrl('../../prefab/src/hats.ts'),
  7  |   player: moduleUrl('../../prefab/src/player.ts'),
  8  |   inventory: moduleUrl('../../../src/inventory.ts'),
  9  |   ui: moduleUrl('../src/index.ts'),
  10 |   atlas: moduleUrl('../../animation/src/imageAtlas.ts'),
  11 |   preview: moduleUrl('./hat-preview.ts'),
  12 | };
  13 | 
  14 | test('all hats have inventory icons; craft respects single hats and nonconsumed tools', async ({ page }) => {
  15 |   test.setTimeout(120_000);
  16 |   await page.goto('/tests/fixture.html');
  17 |   const result = await page.evaluate(async (modules) => {
  18 |     const { HAT_IDS, HAT_DEFINITIONS, HAT_ITEM_SPECS, HAT_RECIPES } = await import(modules.hats);
  19 |     const { createInventoryStore } = await import(modules.inventory);
  20 |     const { inventorySlotAddress, equipmentSlotAddress, INVENTORY_RECIPES } = await import(modules.ui);
  21 |     const { loadImageAtlas } = await import(modules.atlas);
  22 |     const missingIcons: string[] = [];
  23 |     for (const id of HAT_IDS) {
  24 |       const { icon, atlas } = HAT_ITEM_SPECS[id];
  25 |       const sprite = (await loadImageAtlas('/dst/data/databundles/images.zip', atlas)).require(icon);
  26 |       if (!sprite.pixels.some((v: number, index: number) => index % 4 === 3 && v > 0)) missingIcons.push(id);
  27 |     }
  28 |     const store = createInventoryStore([{ slot_index: 0, id: 'cutgrass', num: 24 }]);
  29 |     const crafted = [store.craft(INVENTORY_RECIPES.strawhat), store.craft(INVENTORY_RECIPES.strawhat)];
  30 |     const hatStacks = store.exportState().slots.flatMap(({ item }: { item: { itemId: string; count: number } | null }) =>
  31 |       item?.itemId === 'strawhat' ? [item.count] : []);
  32 |     const equipped = store.applySlotChanges([{ slot: inventorySlotAddress(1), itemId: 'strawhat', delta: -1 },
  33 |       { slot: equipmentSlotAddress('head'), itemId: 'strawhat', delta: 1 }]);
  34 |     const unequipped = store.applySlotChanges([{ slot: equipmentSlotAddress('head'), itemId: 'strawhat', delta: -1 },
  35 |       { slot: inventorySlotAddress(2), itemId: 'strawhat', delta: 1 }]);
  36 |     const woodie = createInventoryStore([
  37 |       { slot_index: 0, id: 'log', num: 6 }, { slot_index: 1, id: 'pinecone', num: 1 },
  38 |     ]);
  39 |     const noTool = woodie.craft(HAT_RECIPES.woodcarvedhat);
  40 |     woodie.add('lucy', 1);
  41 |     const withTool = woodie.craft(HAT_RECIPES.woodcarvedhat);
  42 |     return {
  43 |       hatCount: HAT_IDS.length, sourceRecipes: Object.keys(HAT_RECIPES).length,
  44 |       missingIcons, crafted, hatStacks, equipped, unequipped, noTool, withTool,
  45 |       toolCount: woodie.materialSummary().lucy,
  46 |       balloonCraftable: Boolean(INVENTORY_RECIPES.balloonhat),
  47 |       droppedHatHasRecipe: Boolean(HAT_RECIPES.walrushat),
  48 |       mirrorPaths: Object.values(HAT_DEFINITIONS).every((hat: any) => hat.archive.startsWith('hat_')),
  49 |     };
  50 |   }, modules);
  51 |   expect(result).toEqual({
  52 |     hatCount: 82, sourceRecipes: 51, missingIcons: [], crafted: [true, true], hatStacks: [1, 1],
  53 |     equipped: true, unequipped: true, noTool: false, withTool: true, toolCount: 1,
  54 |     balloonCraftable: false, droppedHatHasRecipe: false, mirrorPaths: true,
  55 |   });
  56 | });
  57 | 
  58 | test('ground hats use anim geometry, preserve feet and pick up through merged mesh hits', async ({ page }) => {
  59 |   test.setTimeout(120_000);
  60 |   await page.goto('/tests/fixture.html');
  61 |   const result = await page.evaluate(async (url) => {
  62 |     const { checkGroundHats } = await import(url);
  63 |     return checkGroundHats();
  64 |   }, moduleUrl('./ground-hat-fixture.ts'));
> 65 |   expect(result).toEqual({
     |                  ^ Error: expect(received).toEqual(expected) // deep equality
  66 |     failedDrop: false, rollbackCount: 0, foot: [0, 0, 0], isAnimatedMesh: true,
  67 |     pickedUp: ['strawhat', 'torch', 'beeswax'], rejectedPickupCount: 1, afterPickupCount: 0,
  68 |     failures: [], restoredFoot: [3, 0.25, 4], torchIsMesh: true, torchFoot: [-6, 0, 0], torchPickedUp: true,
  69 |     iconPrefab: 'beeswax', iconIsSprite: true, iconFoot: [6, 0, 0], iconPickedUp: true,
  70 |   });
  71 | });
  72 | 
```
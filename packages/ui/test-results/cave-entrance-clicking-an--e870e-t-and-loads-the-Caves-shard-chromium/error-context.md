# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: cave-entrance.spec.ts >> clicking an open cave entrance walks up to it and loads the Caves shard
- Location: tests/cave-entrance.spec.ts:61:1

# Error details

```
TimeoutError: page.waitForURL: Timeout 15000ms exceeded.
=========================== logs ===========================
waiting for navigation until "load"
============================================================
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [aria-hidden]:
    - generic: 进入
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
        - generic: 0/1
        - generic: 0/1
      - button [disabled]: 建造
    - complementary "快捷制作" [ref=e3]:
      - button "展开制作菜单" [ref=e4] [cursor=pointer]
      - generic "配方页码" [ref=e5]:
        - button "上一页" [ref=e6] [cursor=pointer]
        - generic [ref=e7]: "1"
        - button "下一页" [ref=e8] [cursor=pointer]
      - generic [ref=e9]:
        - text: Transmute Log Transmute Twigs Transmute Flint Transmute Rocks Transmute Bluegem Transmute Redgem Transmute Purplegem Transmute Orangegem Transmute Yellowgem Transmute Greengem
        - generic [ref=e10]:
          - button "斧头" [ref=e11] [cursor=pointer]
          - button "鹤嘴锄" [ref=e12] [cursor=pointer]
          - button "铲子" [ref=e13] [cursor=pointer]
          - button "锤子" [ref=e14] [cursor=pointer]
          - button "园艺锄" [ref=e15] [cursor=pointer]
          - button "干草叉" [ref=e16] [cursor=pointer]
          - button "黄金斧头" [ref=e17] [cursor=pointer]
          - button "黄金鹤嘴锄" [ref=e18] [cursor=pointer]
          - button "黄金铲子" [ref=e19] [cursor=pointer]
          - button "黄金园艺锄" [ref=e20] [cursor=pointer]
        - text: 薇洛的打火机 火炬 营火 便携营火 火坑 低微咩咩雕像 吸热营火 吸热火坑 南瓜灯 矿工帽 科学机器 炼金引擎 智囊团 钓具容器 制图桌 灵子分解器 暗影操控器 陶轮 土地夯实器 锯马 绳子 Walter Rope 木板 Woodie Boards 石砖 莎草纸 电子元件 活木头 时间碎片 蜡纸 电气化电路 警钟 可靠的弹弓 薇诺娜的投石机 薇诺娜的投石机 强抢袋 长矛 战斗长矛 奔雷矛 回旋镖 格挡电路 草甲 木甲 荆棘外壳 鳞甲 暗夜甲 大理石甲 硬木帽 橄榄球头盔 战斗头盔 针线包 可靠的胶布 聪明的伪装 松树先锋队帽子 充气背心 气球帽 背包 种子袋 猪皮包 保鲜背包 不老表 第二次机会表 治疗黏团 豆增压电路 扑腾绷带 治疗药膏 黏糊糊的药膏 避火膏 蜂蜜药膏 犁地草膏 阿比盖尔之花 警钟 俗气鹅像 俗气海狸像 俗气鹿像 树精守卫雕像 魔术师高礼帽 魔术师箱子 暗影秘典 灵子分解器 盛宴树盆 陶轮 土地夯实器 羽毛笔 清洁扫把 木牌 指路木牌 小木牌 蕨类盆栽 多肉盆栽 砖砌烤炉 冬季盛宴餐桌 盛宴树盆 疯狂科学家实验室 火鸡神龛 座狼神龛 猪神龛 胡萝卜鼠神龛 皮弗娄牛神龛 浣猫神龛 捆绑包装 礼物包装 背包 猪皮包 保鲜背包 厨师袋 种子袋 糖果袋 战斗号子罐 灵魂罐 砖砌烤炉 再消化电路 薇洛的打火机 便携烹饪锅 便携研磨器 便携香料站 厨师袋 烹饪指南 烹饪锅 晾肉架 耕地机 园艺锄 黄金园艺锄 烧灼园艺锄 空浇水壶 空鸟嘴壶 便便桶 催长剂起子 树果酱 肥料包 钓具容器 淡水钓竿 海钓竿 木球浮漂 硬物浮漂 黑羽浮漂 红羽浮漂 蔚蓝羽浮漂 黄羽浮漂 鹅羽浮漂 智囊团 草筏套装 船套装 海带补丁 船补丁 桨 浮木桨 充气背心 锚套装 方向舵套装 皮弗娄牛铃 舔盐块 美味舔盐块 刷子 鞍角 鞍具 战争鞍具 战斗鞍具 闪亮鞍具 皮弗娄牛美妆台 营火 便携营火 火坑 低微咩咩雕像 龙鳞火炉 暖石 热能电路 犬牙背心 雨衣 透气背心 吸热营火 吸热火坑 暖石 制冷电路 寒冰护符 旋转的风扇 花伞 雨伞 羽毛扇 避火膏 花伞 雨伞 传送伞 雨衣 气球帽 草帽 养蜂帽 高礼帽 魔术师高礼帽 矿工帽
  - region "生存状态":
    - generic:
      - img "世界第 1 日，白天" [ref=e21]
      - generic "当前季节：冬":
        - strong: 冬
    - generic:
      - generic "饱食度 150":
        - status: "150"
      - generic "精神值 200":
        - status: "200"
      - generic "生命值 150":
        - status: "150"
    - generic "温度 45 度":
      - status: 45°
  - region "物品栏" [ref=e23]:
    - group "背包" [ref=e24]:
      - generic [ref=e25]:
        - button "物品栏 1" [ref=e26] [cursor=pointer]
        - button "物品栏 2" [ref=e27] [cursor=pointer]
        - button "物品栏 3" [ref=e28] [cursor=pointer]
        - button "物品栏 4" [ref=e29] [cursor=pointer]
        - button "物品栏 5" [ref=e30] [cursor=pointer]
      - generic [ref=e31]:
        - button "物品栏 6" [ref=e32] [cursor=pointer]
        - button "物品栏 7" [ref=e33] [cursor=pointer]
        - button "物品栏 8" [ref=e34] [cursor=pointer]
        - button "物品栏 9" [ref=e35] [cursor=pointer]
        - button "物品栏 10" [ref=e36] [cursor=pointer]
      - generic [ref=e37]:
        - button "物品栏 11" [ref=e38] [cursor=pointer]
        - button "物品栏 12" [ref=e39] [cursor=pointer]
        - button "物品栏 13" [ref=e40] [cursor=pointer]
        - button "物品栏 14" [ref=e41] [cursor=pointer]
        - button "物品栏 15" [ref=e42] [cursor=pointer]
    - group "装备" [ref=e43]:
      - button "手部装备" [ref=e44] [cursor=pointer]
      - button "身体装备" [ref=e45] [cursor=pointer]
      - button "头部装备" [ref=e46] [cursor=pointer]
    - button "查看角色" [ref=e47] [cursor=pointer]
  - region "地图控制" [ref=e48]:
    - button "打开地图" [ref=e49] [cursor=pointer]
    - generic [ref=e50]:
      - button "向左旋转视角" [ref=e51] [cursor=pointer]
      - button "暂停游戏" [ref=e52] [cursor=pointer]
      - button "向右旋转视角" [ref=e53] [cursor=pointer]
  - status "帧率": FPS 8
```

# Test source

```ts
  1  | import { fileURLToPath } from 'node:url';
  2  | import { expect, test } from '@playwright/test';
  3  | 
  4  | const urls = Object.fromEntries(['main', 'universal', 'camera'].map(name =>
  5  |   [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));
  6  | 
  7  | /** Load the cluster's shard with a single entrance 9 units from the player. */
  8  | async function openGame(page: import('@playwright/test').Page, prefab: 'cave_entrance' | 'cave_entrance_open' | 'cave_exit') {
  9  |   const shard = prefab === 'cave_exit' ? 'Caves' : 'Master';
  10 |   const errors: string[] = [];
  11 |   page.on('pageerror', error => errors.push(error.message));
  12 |   page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  13 |   await page.route(`**/saves/Cluster_1/${shard}.json`, async route => {
  14 |     const response = await route.fetch(), save = await response.json();
  15 |     const [x, y, z] = save.players.local.transform.position;
  16 |     delete save.world.entities.cave_entrance; delete save.world.entities.cave_entrance_open; delete save.world.entities.cave_exit;
  17 |     save.world.entities[prefab] = [{ id: 'entrance', transform: { position: [x, y, z - 9], rotationY: 0 }, components: {} }];
  18 |     for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
  19 |     save.players.local.inventory.bufferedBuilds = [];
  20 |     await route.fulfill({ response, json: save });
  21 |   });
  22 |   await page.goto(`/tests/dst-lighting.html?save=Cluster_1/${shard}.json`);
  23 |   await page.evaluate(async urls => {
  24 |     await import(urls.main);
  25 |     const { scene, renderer } = await import(urls.universal), { camera } = await import(urls.camera);
  26 |     (window as any).caveGame = { scene, renderer, camera };
  27 |   }, urls);
  28 |   await expect(page.locator('canvas[data-game-canvas]')).toHaveAttribute('data-loaded', 'true');
  29 |   return errors;
  30 | }
  31 | 
  32 | /** Screen position of the entrance's ground point, raised by `height` for upright art. */
  33 | const entrancePoint = (page: import('@playwright/test').Page, height: number) => page.evaluate(height => {
  34 |   const { scene, renderer, camera } = (window as any).caveGame;
  35 |   const entrance = scene.children.find((model: any) => model.userData.instance?.entityId === 'entrance');
  36 |   const ndc = entrance.position.clone().setY(height).project(camera), rect = renderer.domElement.getBoundingClientRect();
  37 |   return { x: rect.left + (ndc.x + 1) * rect.width / 2, y: rect.top + (1 - ndc.y) * rect.height / 2 };
  38 | }, height);
  39 | 
  40 | test('right-clicking a closed cave entrance with a pickaxe walks up to it and mines it open', async ({ page }) => {
  41 |   test.setTimeout(90_000);
  42 |   const errors = await openGame(page, 'cave_entrance');
  43 |   await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(
  44 |     new CustomEvent('game:debug-command', { detail: { command: 'c_give("pickaxe")' } })));
  45 |   const bar = page.locator('dst-inventory-bar'), hand = bar.locator('.inventory-bar__equipment .inventory-slot').first();
  46 |   await bar.locator('.inventory-bar__items [data-item-id="pickaxe"]').dragTo(hand);
  47 |   await expect(hand).toHaveAttribute('data-item-id', 'pickaxe');
  48 |   const workLeft = () => page.evaluate(() => (window as any).caveGame.scene.children
  49 |     .find((model: any) => model.userData.instance?.entityId === 'entrance')?.userData.components.workable?.GetWorkLeft() ?? 0);
  50 |   for (let hit = 0; hit < 6; hit++) {
  51 |     const point = await entrancePoint(page, 3);
  52 |     await page.mouse.click(point.x, point.y, { button: 'right' });
  53 |     await expect.poll(workLeft, { timeout: 10_000 }).toBe(5 - hit);
  54 |     if (hit < 5) await page.waitForTimeout(1500);
  55 |   }
  56 |   await expect.poll(() => page.evaluate(() => (window as any).caveGame.scene.children
  57 |     .some((model: any) => model.userData.instance?.prefab === 'cave_entrance_open'))).toBe(true);
  58 |   expect(errors).toEqual([]);
  59 | });
  60 | 
  61 | test('clicking an open cave entrance walks up to it and loads the Caves shard', async ({ page }) => {
  62 |   test.setTimeout(90_000);
  63 |   const errors = await openGame(page, 'cave_entrance_open');
  64 |   const point = await entrancePoint(page, 0);
  65 |   await page.mouse.click(point.x, point.y);
> 66 |   await page.waitForURL(/save=Cluster_1%2FCaves\.json|save=Cluster_1\/Caves\.json/, { timeout: 15_000 });
     |              ^ TimeoutError: page.waitForURL: Timeout 15000ms exceeded.
  67 |   expect(errors).toEqual([]);
  68 | });
  69 | 
  70 | test('clicking a cave exit walks up to it and loads the Master shard', async ({ page }) => {
  71 |   test.setTimeout(90_000);
  72 |   const errors = await openGame(page, 'cave_exit');
  73 |   const point = await entrancePoint(page, 0);
  74 |   await page.mouse.click(point.x, point.y);
  75 |   await page.waitForURL(/save=Cluster_1%2FMaster\.json|save=Cluster_1\/Master\.json/, { timeout: 15_000 });
  76 |   expect(errors).toEqual([]);
  77 | });
  78 | 
```
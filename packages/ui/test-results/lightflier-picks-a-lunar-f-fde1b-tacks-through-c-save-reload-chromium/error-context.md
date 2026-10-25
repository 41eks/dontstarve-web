# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: lightflier.spec.ts >> picks a lunar flower, nets its insect, and preserves spawned insects and captured stacks through c_save/reload
- Location: tests/lightflier.spec.ts:8:1

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('dst-inventory-bar').locator('.inventory-bar__items [data-item-id="lightflier"]')
Expected: 1
Received: 0
Timeout:  15000ms

Call log:
  - Expect "toHaveCount" locator('dst-inventory-bar').locator('.inventory-bar__items [data-item-id="lightflier"]') with timeout 15000ms
  - waiting for locator('dst-inventory-bar').locator('.inventory-bar__items [data-item-id="lightflier"]')
    31 × locator resolved to 0 elements
       - unexpected value "0"

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [aria-hidden]:
    - generic: ": 灵魂跳跃"
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
      - img "世界第 11 日，黄昏" [ref=e21]
      - generic "当前季节：冬":
        - strong: 冬
    - generic:
      - generic "饱食度 150":
        - status: "150"
      - generic "精神值 165":
        - status: "165"
      - generic "生命值 150":
        - status: "150"
    - generic "温度 45 度":
      - status: 45°
  - region "物品栏" [ref=e23]:
    - group "背包" [ref=e24]:
      - generic [ref=e25]:
        - button "物品栏 1" [ref=e26] [cursor=pointer]
        - button "排箫，数量 1，耐久 90%" [ref=e27] [cursor=pointer]:
          - generic [aria-hidden]: 90%
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
      - button "捕虫网，数量 1，耐久 100%" [ref=e44] [cursor=pointer]:
        - generic [aria-hidden]: 100%
      - button "身体装备" [ref=e45] [cursor=pointer]
      - button "头部装备" [ref=e46] [cursor=pointer]
    - button "查看角色" [ref=e47] [cursor=pointer]
  - region "地图控制" [ref=e48]:
    - button "打开地图" [ref=e49] [cursor=pointer]
    - generic [ref=e50]:
      - button "向左旋转视角" [ref=e51] [cursor=pointer]
      - button "暂停游戏" [ref=e52] [cursor=pointer]
      - button "向右旋转视角" [ref=e53] [cursor=pointer]
  - status "帧率": FPS 13
```

# Test source

```ts
  1  | import { readSaveDownload } from './save-download';
  2  | import { fileURLToPath } from 'node:url';
  3  | import { expect, test } from '@playwright/test';
  4  | 
  5  | const urls = Object.fromEntries(['main', 'universal', 'camera', 'view'].map(name =>
  6  |   [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));
  7  | 
  8  | test('picks a lunar flower, nets its insect, and preserves spawned insects and captured stacks through c_save/reload', async ({ page }) => {
  9  |   test.setTimeout(90_000);
  10 |   const errors: string[] = [];
  11 |   page.on('pageerror', error => errors.push(error.message));
  12 |   page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  13 |   await page.route('**/saves/initial-world.json', async route => {
  14 |     const response = await route.fetch(), save = await response.json();
  15 |     save.world.entities = { lightflier_flower: [{ id: 'lunar-flower', transform: { position: [0, 0, -3], rotationY: 0 },
  16 |       components: { lightflierFlower: { variant: 'single', lightState: 'CHARGED', childspawner: { childreninside: 1, childrenoutside: [] } } } }] };
  17 |     save.players.local.transform.position = [0, 0, 0];
  18 |     for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
  19 |     save.players.local.inventory.bufferedBuilds = [];
  20 |     await route.fulfill({ response, json: save });
  21 |   });
  22 |   const prepare = () => page.evaluate(async urls => {
  23 |     await import(urls.main);
  24 |     const { scene, renderer } = await import(urls.universal), { camera } = await import(urls.camera);
  25 |     const { view } = await import(urls.view);
  26 |     (window as any).lightFlierGame = { scene, renderer, camera, view };
  27 |   }, urls);
  28 |   const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
  29 |     new CustomEvent('game:debug-command', { detail: { command } })), command);
  30 |   const saveGame = async () => {
  31 |     const download = page.waitForEvent('download'); await submit('c_save()');
  32 |     return JSON.parse(await readSaveDownload((await (await download).path())!, 'Master'));
  33 |   };
  34 |   const point = (prefab: string) => page.evaluate(prefab => {
  35 |     const { scene, renderer, camera, view } = (window as any).lightFlierGame;
  36 |     const model = scene.children.find((m: any) => m.userData.instance?.prefab === prefab || m.userData.itemId === prefab);
  37 |     if (!model) return null;
  38 |     let mesh: any; model.traverse((m: any) => { if (!mesh && m.isMesh && m.geometry.getAttribute('position')?.count) mesh = m; });
  39 |     if (!mesh) return null;
  40 |     mesh.updateWorldMatrix(true, false); mesh.geometry.computeBoundingBox();
  41 |     const bounds = mesh.geometry.boundingBox, rect = renderer.domElement.getBoundingClientRect();
  42 |     // The lightflier's wings leave transparent space at the frame centre. Sample
  43 |     // the visible input shape rather than treating the atlas rectangle as opaque.
  44 |     for (const y of [.5, .4, .6, .3, .7, .2, .8]) for (const x of [.5, .4, .6, .3, .7, .2, .8]) {
  45 |       const p = bounds.min.clone().lerp(bounds.max, .5); p.x = bounds.min.x + (bounds.max.x - bounds.min.x) * x;
  46 |       p.y = bounds.min.y + (bounds.max.y - bounds.min.y) * y; mesh.localToWorld(p); p.project(camera);
  47 |       const point = { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
  48 |       const actions = view.mouseActions.getMouseActions(new PointerEvent('pointermove', { clientX: point.x, clientY: point.y }));
  49 |       if (actions.left?.target?.prefab === prefab && ['PICK', 'NET'].includes(actions.left.action)) return point;
  50 |     }
  51 |     return null;
  52 |   }, prefab);
  53 |   await page.goto('/tests/dst-lighting.html?save=initial-world.json'); await prepare();
  54 |   await expect(page.locator('canvas[data-game-canvas]')).toHaveAttribute('data-loaded', 'true');
  55 |   await expect.poll(() => page.evaluate(() => !(window as any).lightFlierGame.view.player.userData.animationController.stategraph.hasStateTag('busy')), { timeout: 15000 }).toBe(true);
  56 |   await submit('c_give("bugnet")'); await submit('c_give("panflute")');
  57 |   const bar = page.locator('dst-inventory-bar'), hand = bar.locator('.inventory-bar__equipment .inventory-slot').first();
  58 |   await bar.locator('.inventory-bar__items [data-item-id="bugnet"]').click(); await hand.click(); await expect(hand).toHaveAttribute('data-item-id', 'bugnet');
  59 |   await expect.poll(() => page.evaluate(() => !(window as any).lightFlierGame.view.player.userData.animationController.stategraph.hasStateTag('busy')), { timeout: 15000 }).toBe(true);
  60 |   const flower = await point('lightflier_flower'); expect(flower).not.toBeNull(); await page.mouse.click(flower!.x, flower!.y);
  61 |   await expect.poll(() => page.evaluate(() => (window as any).lightFlierGame.scene.children.filter((m: any) => m.userData.itemId === 'lightflier').length), { timeout: 15000 }).toBe(1);
  62 |   await expect.poll(() => page.evaluate(() => !(window as any).lightFlierGame.view.player.userData.animationController.stategraph.hasStateTag('busy'))).toBe(true);
  63 |   await bar.locator('.inventory-bar__items [data-item-id="panflute"]').click({ button: 'right' });
  64 |   await expect.poll(() => page.evaluate(() => (window as any).lightFlierGame.scene.children.find((m: any) => m.userData.itemId === 'lightflier')?.userData.lightflier.components.sleeper.IsAsleep()), { timeout: 10000 }).toBe(true);
  65 |   await expect.poll(() => page.evaluate(() => !(window as any).lightFlierGame.view.player.userData.animationController.stategraph.hasStateTag('busy')), { timeout: 15000 }).toBe(true);
  66 |   const bug = await point('lightflier'); expect(bug).not.toBeNull(); await page.mouse.click(bug!.x, bug!.y);
> 67 |   await expect(bar.locator('.inventory-bar__items [data-item-id="lightflier"]')).toHaveCount(1, { timeout: 15000 });
     |                                                                                  ^ Error: expect(locator).toHaveCount(expected) failed
  68 |   await submit('c_give("lightflier", 2)'); await submit('c_spawn("lightflier")'); await submit('c_spawn("lightflier_flower")');
  69 |   await expect.poll(() => page.evaluate(() => (window as any).lightFlierGame.scene.children.filter((m: any) => m.userData.instance?.prefab === 'lightflier_flower').length)).toBe(2);
  70 |   const saved = await saveGame();
  71 |   const stack = Object.values(saved.players.local.inventory.containers).flatMap((c: any) => c.slots).find((s: any) => s.item.itemId === 'lightflier') as any;
  72 |   expect(stack.item.count).toBe(3); expect(stack.item.lightflier.health).toBe(25);
  73 |   expect(saved.world.entities.lightflier_flower).toHaveLength(2);
  74 |   const groundBug = saved.world.entities.ground_item.filter((r: any) => r.components.stack.itemId === 'lightflier');
  75 |   expect(groundBug).toHaveLength(1); expect(groundBug[0].components.stack.lightflier.health).toBe(25);
  76 |   await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved })); await page.reload(); await prepare();
  77 |   await expect(page.locator('canvas[data-game-canvas]')).toHaveAttribute('data-loaded', 'true');
  78 |   const restored = await saveGame();
  79 |   const loadedStack = Object.values(restored.players.local.inventory.containers).flatMap((c: any) => c.slots).find((s: any) => s.item.itemId === 'lightflier') as any;
  80 |   expect(loadedStack.item.entityId).toBe(stack.item.entityId); expect(loadedStack.item.count).toBe(3);
  81 |   expect(loadedStack.item.lightflier.knownHome).toEqual(stack.item.lightflier.knownHome);
  82 |   const restoredBug = restored.world.entities.ground_item.find((r: any) => r.id === groundBug[0].id);
  83 |   expect(restoredBug.components.stack.itemId).toBe('lightflier');
  84 |   expect(restoredBug.components.stack.lightflier.health).toBe(groundBug[0].components.stack.lightflier.health);
  85 |   expect(restored.world.entities.lightflier_flower.map((r: any) => [r.id, r.transform.position])).toEqual(saved.world.entities.lightflier_flower.map((r: any) => [r.id, r.transform.position]));
  86 |   expect(errors).toEqual([]);
  87 | });
  88 | 
```
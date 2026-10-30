# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: axe-chop.spec.ts >> chops a moon tree, reloads its stump, and digs it with a shovel, preserving loot and removal through saves
- Location: tests/axe-chop.spec.ts:8:1

# Error details

```
Error: Timeout 5000ms exceeded while waiting on the predicate
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
      - img "世界第 12 日，白天" [ref=e21]
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
      - button "斧头，数量 1，耐久 84%" [ref=e44] [cursor=pointer]:
        - generic [aria-hidden]: 84%
      - button "身体装备" [ref=e45] [cursor=pointer]
      - button "头部装备" [ref=e46] [cursor=pointer]
    - button "查看角色" [ref=e47] [cursor=pointer]
  - region "地图控制" [ref=e48]:
    - button "打开地图" [ref=e49] [cursor=pointer]
    - generic [ref=e50]:
      - button "向左旋转视角" [ref=e51] [cursor=pointer]
      - button "暂停游戏" [ref=e52] [cursor=pointer]
      - button "向右旋转视角" [ref=e53] [cursor=pointer]
  - status
```

# Test source

```ts
  1   | import { readSaveDownload } from './save-download';
  2   | import { fileURLToPath } from 'node:url';
  3   | import { expect, test } from '@playwright/test';
  4   | 
  5   | const urls = Object.fromEntries(['main', 'universal', 'camera', 'player'].map(name =>
  6   |   [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));
  7   | 
  8   | test('chops a moon tree, reloads its stump, and digs it with a shovel, preserving loot and removal through saves', async ({ page }) => {
  9   |   test.setTimeout(180_000);
  10  |   const errors: string[] = [];
  11  |   page.on('pageerror', error => errors.push(error.message));
  12  |   page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  13  |   await page.route('**/saves/initial-world.json', async route => {
  14  |     const response = await route.fetch(), save = await response.json();
  15  |     save.world.entities = { moon_tree: [{ id: 'chop_tree', transform: { position: [0, 0, -6], rotationY: 0 }, components: {} }] };
  16  |     save.players.local.transform.position = [0, 0, 0];
  17  |     for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
  18  |     save.players.local.inventory.bufferedBuilds = [];
  19  |     await route.fulfill({ response, json: save });
  20  |   });
  21  |   const prepare = () => page.evaluate(async urls => {
  22  |     const main = await import(urls.main), { scene, renderer } = await import(urls.universal);
  23  |     const { camera } = await import(urls.camera);
  24  |     const { player } = await import(urls.player);
  25  |     (window as any).chopGame = { main, scene, renderer, camera, player };
  26  |   }, urls);
  27  |   const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
  28  |     new CustomEvent('game:debug-command', { detail: { command } })), command);
  29  |   const saveGame = async () => {
  30  |     const download = page.waitForEvent('download'); await submit('c_save()');
  31  |     return JSON.parse(await readSaveDownload((await (await download).path())!, 'Master'));
  32  |   };
  33  |   const treeAnimation = () => page.evaluate(() => {
  34  |     const tree = (window as any).chopGame.scene.children.find((model: any) => (window as any).__prefabInstance(model)?.prefab === 'moon_tree');
  35  |     return (window as any).__prefabInstance(tree)?.sprite.currentAnimation ?? null;
  36  |   });
  37  |   const clickTree = async () => {
  38  |     const point = await page.evaluate(async () => {
  39  |       const { scene, camera, renderer } = (window as any).chopGame;
  40  |       const tree = scene.children.find((model: any) => (window as any).__prefabInstance(model)?.prefab === 'moon_tree');
  41  |       let mesh: any; tree.traverse((object: any) => { if (!mesh && object.isMesh && object.geometry.index) mesh = object; });
  42  |       mesh.updateWorldMatrix(true, false);
  43  |       const { Raycaster, Vector2, Vector3 } = await import('/node_modules/.vite/deps/three.js');
  44  |       const positions = mesh.geometry.getAttribute('position'), bounds = renderer.domElement.getBoundingClientRect();
  45  |       const raycaster = new Raycaster(), pointer = new Vector2();
  46  |       const point = new Vector3(), origin = new Vector3(), across = new Vector3(), down = new Vector3();
  47  |       // Sample opaque art through the actual sprite raycast, including the shorter stump pose.
  48  |       const count = Number.isFinite(mesh.geometry.drawRange.count) ? mesh.geometry.drawRange.count : mesh.geometry.index.count;
  49  |       for (let quad = count / 6 - 1; quad >= 0; quad--) {
  50  |         origin.fromBufferAttribute(positions, quad * 4);
  51  |         across.fromBufferAttribute(positions, quad * 4 + 1).sub(origin);
  52  |         down.fromBufferAttribute(positions, quad * 4 + 3).sub(origin);
  53  |         for (const v of [.3, .5, .7]) for (const u of [.5, .3, .7]) {
  54  |           point.copy(origin).addScaledVector(across, u).addScaledVector(down, v);
  55  |           mesh.localToWorld(point); point.project(camera);
  56  |           if (Math.abs(point.x) >= .95 || Math.abs(point.y) >= .9) continue;
  57  |           pointer.set(point.x, point.y); raycaster.setFromCamera(pointer, camera);
  58  |           if (!raycaster.intersectObject(mesh).length) continue;
  59  |           return { x: bounds.left + (point.x + 1) * bounds.width / 2, y: bounds.top + (1 - point.y) * bounds.height / 2 };
  60  |         }
  61  |       }
  62  |       throw new Error('No opaque tree pixel is visible');
  63  |     });
  64  |     await page.mouse.click(point.x, point.y, { button: 'right' });
  65  |   };
  66  | 
  67  |   await page.goto('/tests/dst-lighting.html?save=initial-world.json'); await prepare();
  68  |   await submit('c_give("axe")');
  69  |   const bar = page.locator('dst-inventory-bar');
  70  |   const hand = bar.locator('.inventory-bar__equipment .inventory-slot').first();
  71  |   await bar.locator('.inventory-bar__items [data-item-id="axe"]').dragTo(hand);
  72  |   await expect(hand).toHaveAttribute('data-item-id', 'axe');
  73  |   await expect.poll(treeAnimation).toBe('sway1_loop_tall');
  74  | 
  75  |   // The player walks to the tree; the first strike wears the axe but leaves the tree standing.
  76  |   const uses = async () => (await saveGame()).players.local.inventory.containers['player:equipment'].slots[0].item.remainingUses ?? 100;
  77  |   await clickTree();
  78  |   await expect.poll(uses, { timeout: 20_000 }).toBeLessThan(100);
  79  |   expect((await saveGame()).world.entities.moon_tree[0].components).toMatchObject({ moonTree: { size: 'tall' }, growable: { stage: 3 } });
  80  | 
  81  |   // Sixteen strikes in total; keep clicking while the tree stands.
  82  |   for (let attempt = 0; attempt < 40 && !(await treeAnimation())?.match(/^(fall|stump)/); attempt++) {
  83  |     await clickTree(); await page.waitForTimeout(700);
  84  |   }
  85  |   await expect.poll(treeAnimation, { timeout: 20_000 }).toBe('stump_tall');
  86  |   const felled = await saveGame();
  87  |   expect(felled.world.entities.moon_tree[0].components).toMatchObject({ moonTree: { stump: true, size: 'tall' }, growable: { stage: 3 } });
  88  |   const decay = felled.world.entities.moon_tree[0].components.moonTreeTimer.timers.decay;
  89  |   expect(decay.timeleft).toBeGreaterThan(0);
> 90  |   await expect.poll(async () => (await saveGame()).world.entities.ground_item?.length ?? 0).toBeGreaterThanOrEqual(6);
      |                                                                                             ^ Error: Timeout 5000ms exceeded while waiting on the predicate
  91  |   const loot = (await saveGame()).world.entities.ground_item.map((record: any) => record.components.stack.itemId);
  92  |   expect(loot.filter((itemId: string) => itemId === 'log')).toHaveLength(4);
  93  |   expect(loot.filter((itemId: string) => itemId === 'moon_tree_blossom')).toHaveLength(2);
  94  | 
  95  |   await page.route('**/saves/initial-world.json', route => route.fulfill({ json: felled }));
  96  |   await page.reload(); await prepare();
  97  |   await expect.poll(treeAnimation).toBe('stump_tall');
  98  |   const reloaded = (await saveGame()).world.entities.moon_tree[0];
  99  |   expect(reloaded.components).toMatchObject({ moonTree: { stump: true, size: 'tall' }, growable: { stage: 3 } });
  100 |   expect(reloaded.components.moonTreeTimer.timers.decay.initial_time).toBe(decay.initial_time);
  101 |   expect(reloaded.components.moonTreeTimer.timers.decay.timeleft).toBeLessThanOrEqual(decay.timeleft);
  102 | 
  103 |   await hand.dragTo(bar.locator('.inventory-bar__items .inventory-slot[data-item-id=""]').first());
  104 |   await submit('c_give("shovel")');
  105 |   await bar.locator('.inventory-bar__items [data-item-id="shovel"]').dragTo(hand);
  106 |   await expect(hand).toHaveAttribute('data-item-id', 'shovel');
  107 |   await clickTree();
  108 |   await expect.poll(treeAnimation, { timeout: 20_000 }).toBeNull();
  109 |   await expect.poll(async () => ((await saveGame()).world.entities.ground_item ?? [])
  110 |     .filter((record: any) => record.components.stack.itemId === 'log')
  111 |     .reduce((total: number, record: any) => total + record.components.stack.count, 0)).toBe(6);
  112 |   const dug = await saveGame();
  113 |   expect(dug.world.entities.moon_tree ?? []).toEqual([]);
  114 |   const savedShovel = dug.players.local.inventory.containers['player:equipment'].slots[0].item;
  115 |   expect(savedShovel).toMatchObject({ itemId: 'shovel', remainingUses: 24 });
  116 |   await page.route('**/saves/initial-world.json', route => route.fulfill({ json: dug }));
  117 |   await page.reload(); await prepare();
  118 |   await expect.poll(treeAnimation).toBeNull();
  119 |   const restored = await saveGame();
  120 |   expect(restored.world.entities.moon_tree ?? []).toEqual([]);
  121 |   expect(restored.players.local.inventory.containers['player:equipment'].slots[0].item).toEqual(savedShovel);
  122 |   expect(restored.world.entities.ground_item.filter((record: any) => record.components.stack.itemId === 'log'))
  123 |     .toEqual(dug.world.entities.ground_item.filter((record: any) => record.components.stack.itemId === 'log'));
  124 |   expect(errors).toEqual([]);
  125 | });
  126 | 
```
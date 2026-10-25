# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: heatrock.spec.ts >> spawns and gives neutral thermal stones, reskins and transfers one, then saves and reloads their identities and fuel
- Location: tests/heatrock.spec.ts:8:1

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('dst-inventory-bar').locator('.inventory-bar__items').locator('[data-item-id="heatrock"]')
Expected: 2
Received: 0
Timeout:  5000ms

Call log:
  - Expect "toHaveCount" locator('dst-inventory-bar').locator('.inventory-bar__items').locator('[data-item-id="heatrock"]') with timeout 5000ms
  - waiting for locator('dst-inventory-bar').locator('.inventory-bar__items').locator('[data-item-id="heatrock"]')
    11 × locator resolved to 0 elements
       - unexpected value "0"

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - region "背包" [ref=e3]:
    - group "背包物品" [ref=e4]:
      - button "噩梦燃料，数量 14" [ref=e5] [cursor=pointer]:
        - generic [aria-hidden]: "14"
      - button "黄金铲子，数量 1，耐久 68%" [ref=e6] [cursor=pointer]:
        - generic [aria-hidden]: 68%
      - button "魔光护符，数量 1" [ref=e7] [cursor=pointer]
      - button "木甲，数量 1" [ref=e8] [cursor=pointer]
      - button "紫晶提灯，数量 1，耐久 53%" [ref=e9] [cursor=pointer]:
        - generic [aria-hidden]: 53%
      - button "腐烂物，数量 2" [ref=e10] [cursor=pointer]:
        - generic [aria-hidden]: "2"
      - button "浮木桨，数量 1" [ref=e11] [cursor=pointer]
      - button "采下的草，数量 9" [ref=e12] [cursor=pointer]:
        - generic [aria-hidden]: "9"
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
        - generic: 1/1
      - button [disabled]: 建造
    - complementary "快捷制作" [ref=e13]:
      - button "展开制作菜单" [ref=e14] [cursor=pointer]
      - generic "配方页码" [ref=e15]:
        - button "上一页" [ref=e16] [cursor=pointer]
        - generic [ref=e17]: "1"
        - button "下一页" [ref=e18] [cursor=pointer]
      - generic [ref=e19]:
        - text: Transmute Log Transmute Twigs Transmute Flint Transmute Rocks Transmute Bluegem Transmute Redgem Transmute Purplegem Transmute Orangegem Transmute Yellowgem Transmute Greengem
        - generic [ref=e20]:
          - button "斧头" [ref=e21] [cursor=pointer]
          - button "鹤嘴锄" [ref=e22] [cursor=pointer]
          - button "铲子" [ref=e23] [cursor=pointer]
          - button "锤子" [ref=e24] [cursor=pointer]
          - button "园艺锄" [ref=e25] [cursor=pointer]
          - button "干草叉" [ref=e26] [cursor=pointer]
          - button "黄金斧头" [ref=e27] [cursor=pointer]
          - button "黄金鹤嘴锄" [ref=e28] [cursor=pointer]
          - button "黄金铲子" [ref=e29] [cursor=pointer]
          - button "黄金园艺锄" [ref=e30] [cursor=pointer]
        - text: 薇洛的打火机 火炬 营火 便携营火 火坑 低微咩咩雕像 吸热营火 吸热火坑 南瓜灯 矿工帽 科学机器 炼金引擎 智囊团 钓具容器 制图桌 灵子分解器 暗影操控器 陶轮 土地夯实器 锯马 绳子 Walter Rope 木板 Woodie Boards 石砖 莎草纸 电子元件 活木头 时间碎片 蜡纸 电气化电路 警钟 可靠的弹弓 薇诺娜的投石机 薇诺娜的投石机 强抢袋 长矛 战斗长矛 奔雷矛 回旋镖 格挡电路 草甲 木甲 荆棘外壳 鳞甲 暗夜甲 大理石甲 硬木帽 橄榄球头盔 战斗头盔 针线包 可靠的胶布 聪明的伪装 松树先锋队帽子 充气背心 气球帽 背包 种子袋 猪皮包 保鲜背包 不老表 第二次机会表 治疗黏团 豆增压电路 扑腾绷带 治疗药膏 黏糊糊的药膏 避火膏 蜂蜜药膏 犁地草膏 阿比盖尔之花 警钟 俗气鹅像 俗气海狸像 俗气鹿像 树精守卫雕像 魔术师高礼帽 魔术师箱子 暗影秘典 灵子分解器 盛宴树盆 陶轮 土地夯实器 羽毛笔 清洁扫把 木牌 指路木牌 小木牌 蕨类盆栽 多肉盆栽 砖砌烤炉 冬季盛宴餐桌 盛宴树盆 疯狂科学家实验室 火鸡神龛 座狼神龛 猪神龛 胡萝卜鼠神龛 皮弗娄牛神龛 浣猫神龛 捆绑包装 礼物包装 背包 猪皮包 保鲜背包 厨师袋 种子袋 糖果袋 战斗号子罐 灵魂罐 砖砌烤炉 再消化电路 薇洛的打火机 便携烹饪锅 便携研磨器 便携香料站 厨师袋 烹饪指南 烹饪锅 晾肉架 耕地机 园艺锄 黄金园艺锄 烧灼园艺锄 空浇水壶 空鸟嘴壶 便便桶 催长剂起子 树果酱 肥料包 钓具容器 淡水钓竿 海钓竿 木球浮漂 硬物浮漂 黑羽浮漂 红羽浮漂 蔚蓝羽浮漂 黄羽浮漂 鹅羽浮漂 智囊团 草筏套装 船套装 海带补丁 船补丁 桨 浮木桨 充气背心 锚套装 方向舵套装 皮弗娄牛铃 舔盐块 美味舔盐块 刷子 鞍角 鞍具 战争鞍具 战斗鞍具 闪亮鞍具 皮弗娄牛美妆台 营火 便携营火 火坑 低微咩咩雕像 龙鳞火炉 暖石 热能电路 犬牙背心 雨衣 透气背心 吸热营火 吸热火坑 暖石 制冷电路 寒冰护符 旋转的风扇 花伞 雨伞 羽毛扇 避火膏 花伞 雨伞 传送伞 雨衣 气球帽 草帽 养蜂帽 高礼帽 魔术师高礼帽 矿工帽
  - region "生存状态":
    - generic:
      - img "世界第 1 日，白天" [ref=e31]
      - generic "当前季节：冬":
        - strong: 冬
    - generic:
      - generic "饱食度 150":
        - status: "150"
      - generic "精神值 199":
        - status: "199"
      - generic "生命值 150":
        - status: "150"
    - generic "温度 45 度":
      - status: 45°
  - region "物品栏" [ref=e33]:
    - group "背包" [ref=e34]:
      - generic [ref=e35]:
        - button "排箫，数量 1，耐久 100%，潮湿" [ref=e36] [cursor=pointer]:
          - generic [aria-hidden]: 100%
        - button "穿刺玻璃刀，数量 1，潮湿" [ref=e37] [cursor=pointer]
        - button "灵魂罐，数量 1" [ref=e38] [cursor=pointer]
        - button "木头，数量 14，潮湿" [ref=e39] [cursor=pointer]:
          - generic [aria-hidden]: "14"
        - button "尖角绝望石头盔，数量 1" [ref=e40] [cursor=pointer]
      - generic [ref=e41]:
        - button "灵魂，数量 15" [ref=e42] [cursor=pointer]:
          - generic [aria-hidden]: "15"
        - button "小肉，数量 8，新鲜度 90%，潮湿" [ref=e43] [cursor=pointer]:
          - generic [aria-hidden]: "8"
        - button "猛兽眼球伞，数量 1" [ref=e44] [cursor=pointer]
        - button "爆米花，数量 1，新鲜度 67%，潮湿" [ref=e45] [cursor=pointer]
        - button "石头，数量 3，潮湿" [ref=e46] [cursor=pointer]:
          - generic [aria-hidden]: "3"
      - generic [ref=e47]:
        - button "噩梦燃料，数量 10" [ref=e48] [cursor=pointer]:
          - generic [aria-hidden]: "10"
        - button "燧石，数量 1，潮湿" [ref=e49] [cursor=pointer]
        - button "扭曲唤星者魔杖，数量 1，耐久 45%，潮湿" [ref=e50] [cursor=pointer]:
          - generic [aria-hidden]: 45%
        - button "肉，数量 17，新鲜度 86%，潮湿" [ref=e51] [cursor=pointer]:
          - generic [aria-hidden]: "17"
        - button "懒人魔杖，数量 1，潮湿" [ref=e52] [cursor=pointer]
    - group "装备" [ref=e53]:
      - button "手部装备" [ref=e54] [cursor=pointer]
      - button "浣猫旅行包，数量 1，潮湿" [ref=e55] [cursor=pointer]
      - button "眼面具，数量 1" [ref=e56] [cursor=pointer]
    - button "查看角色" [ref=e57] [cursor=pointer]
  - region "地图控制" [ref=e58]:
    - button "打开地图" [ref=e59] [cursor=pointer]
    - generic [ref=e60]:
      - button "向左旋转视角" [ref=e61] [cursor=pointer]
      - button "暂停游戏" [ref=e62] [cursor=pointer]
      - button "向右旋转视角" [ref=e63] [cursor=pointer]
  - status "帧率": FPS 7
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
  8   | test('spawns and gives neutral thermal stones, reskins and transfers one, then saves and reloads their identities and fuel', async ({ page }) => {
  9   |   test.setTimeout(150_000);
  10  |   const errors: string[] = [];
  11  |   page.on('pageerror', error => errors.push(error.message));
  12  |   page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  13  |   await page.route('**/saves/initial-world.json', async route => {
  14  |     const response = await route.fetch(), save = await response.json();
  15  |     save.world.entities = {}; save.world.elapsedSeconds = 0;
  16  |     save.players.local.transform.position = [0, 0, 0];
  17  |     for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
  18  |     save.players.local.inventory.bufferedBuilds = [];
  19  |     await route.fulfill({ response, json: save });
  20  |   });
  21  |   const prepare = () => page.evaluate(async urls => {
  22  |     const main = await import(urls.main), { scene, renderer } = await import(urls.universal);
  23  |     const { camera } = await import(urls.camera), { player, playerBody } = await import(urls.player);
  24  |     (window as any).heatRockGame = { main, scene, renderer, camera, player, playerBody };
  25  |   }, urls);
  26  |   const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
  27  |     new CustomEvent('game:debug-command', { detail: { command } })), command);
  28  |   const saveGame = async () => {
  29  |     const download = page.waitForEvent('download'); await submit('c_save()');
  30  |     return JSON.parse(await readSaveDownload((await (await download).path())!));
  31  |   };
  32  |   const ground = () => page.evaluate(() => (window as any).heatRockGame.scene.children
  33  |     .filter((model: any) => model.userData.itemId === 'heatrock').map((model: any) => ({
  34  |       id: model.userData.instance?.entityId, skin: model.userData.instance?.skinId,
  35  |       vertices: model.children[0].children[0].geometry.drawRange.count,
  36  |       materials: model.children[0].children[0].material.map((material: any) => material.name),
  37  |     })));
  38  |   const clickStone = async (id: string, button: 'left' | 'right') => {
  39  |     await expect.poll(() => page.evaluate(() => !(window as any).heatRockGame.player.userData.stategraph.hasStateTag('busy')),
  40  |       { timeout: 20_000 }).toBe(true);
  41  |     const point = await page.evaluate(async ({ id, pointerUrl }) => {
  42  |       const { scene, camera, renderer } = (window as any).heatRockGame;
  43  |       const model = scene.children.find((model: any) => model.userData.instance?.entityId === id), mesh = model.children[0].children[0];
  44  |       const { PointerRaycaster } = await import(pointerUrl);
  45  |       const pointer = new PointerRaycaster({ scene, camera, renderer });
  46  |       const rect = renderer.domElement.getBoundingClientRect();
  47  |       // Animation buffers can include unused vertices, and a frame's centre can be transparent.
  48  |       const box = mesh.geometry.boundingBox;
  49  |       try {
  50  |         for (const y of [.5, .3, .7, .1, .9]) for (const x of [.5, .3, .7, .1, .9]) {
  51  |           const sample = model.position.clone().set(box.min.x + (box.max.x - box.min.x) * x,
  52  |             box.min.y + (box.max.y - box.min.y) * y, box.min.z);
  53  |           mesh.localToWorld(sample).project(camera);
  54  |           const point = { x: rect.left + (sample.x + 1) * rect.width / 2, y: rect.top + (1 - sample.y) * rect.height / 2 };
  55  |           pointer.trackPointer({ clientX: point.x, clientY: point.y } as PointerEvent);
  56  |           let picked = pointer.pickMouseTarget()?.object;
  57  |           while (picked && picked !== model) picked = picked.parent;
  58  |           if (picked === model) return point;
  59  |         }
  60  |         throw new Error('No opaque thermal stone pixel to click');
  61  |       } finally { pointer.dispose(); }
  62  |     }, { id, pointerUrl: `/@fs${fileURLToPath(new URL('../../stategraphs/src/pointerRaycaster.ts', import.meta.url))}` });
  63  |     await page.mouse.click(point.x, point.y, { button });
  64  |   };
  65  |   const slots = (save: any) => Object.values(save.players.local.inventory.containers).flatMap((container: any) => container.slots) as any[];
  66  |   const stones = (save: any) => slots(save).filter(slot => slot.item.itemId === 'heatrock').map(slot => slot.item);
  67  |   const expectStoneState = (actual: any, expected: any, elapsed: number) => {
  68  |     const { temperature: actualTemperature, ...actualState } = actual;
  69  |     const { temperature: expectedTemperature, ...expectedState } = expected;
  70  |     expect(actualState).toEqual(expectedState);
  71  |     // These neutral stones keep exchanging heat while the browser performs input and save/load.
  72  |     // Their source rate is at most 1 degree/game second; discrete item state must remain exact.
  73  |     expect(Math.abs(actualTemperature.current - expectedTemperature.current)).toBeLessThanOrEqual(elapsed + 1e-6);
  74  |   };
  75  |   const expectInventoryStones = (actual: any, expected: any) => {
  76  |     expect(stones(actual)).toHaveLength(stones(expected).length);
  77  |     stones(actual).forEach((stone: any, index: number) => expectStoneState(stone, stones(expected)[index],
  78  |       actual.world.elapsedSeconds - expected.world.elapsedSeconds));
  79  |   };
  80  | 
  81  |   await page.goto('/tests/dst-lighting.html'); await prepare();
  82  |   await submit('c_give("heatrock", 2); c_give("reskin_tool"); c_spawn("heatrock")');
  83  |   const bar = page.locator('dst-inventory-bar'), bag = bar.locator('.inventory-bar__items');
> 84  |   await expect(bag.locator('[data-item-id="heatrock"]')).toHaveCount(2);
      |                                                          ^ Error: expect(locator).toHaveCount(expected) failed
  85  |   await expect(bag.locator('[data-item-id="heatrock"]').first().locator('.inventory-slot__icon')).toHaveAttribute('data-element', 'heat_rock3.tex');
  86  |   await expect.poll(async () => (await ground()).length).toBe(1);
  87  |   const spawned = (await ground())[0];
  88  |   expect(spawned.vertices).toBeGreaterThan(0); expect(spawned.materials).toContain('ground:heat_rock');
  89  |   await page.evaluate(id => {
  90  |     const game = (window as any).heatRockGame;
  91  |     game.scene.children.find((model: any) => model.userData.instance?.entityId === id).userData.components.fueled.remaining = 75;
  92  |     game.playerBody.position.set(-3, game.playerBody.shapes[0].radius, 3); game.player.position.set(-3, 0, 3);
  93  |   }, spawned.id);
  94  |   await bag.locator('[data-item-id="reskin_tool"]').dragTo(bar.locator('[data-slot-key="hand"]'));
  95  |   await clickStone(spawned.id, 'right');
  96  |   await expect.poll(async () => (await ground())[0]?.skin, { timeout: 20_000 }).toBe('heatrock_fantasy');
  97  |   expect((await ground())[0].materials).toContain('ground:heatrock_fantasy');
  98  |   const groundSave = await saveGame();
  99  |   const savedStone = groundSave.world.entities.ground_item.find((record: any) => record.id === spawned.id);
  100 |   expect(savedStone.components.stack).toMatchObject({ itemId: 'heatrock', count: 1, skinId: 'heatrock_fantasy', remainingFuel: 75 });
  101 |   expect(stones(groundSave)).toHaveLength(2);
  102 | 
  103 |   await clickStone(spawned.id, 'left');
  104 |   const skinned = bag.locator('[data-item-id="heatrock"][data-skin-id="heatrock_fantasy"]');
  105 |   await expect(skinned).toBeVisible();
  106 |   await expect(skinned.locator('.inventory-slot__icon')).toHaveAttribute('data-element', 'heatrock_fantasy3.tex');
  107 |   await page.keyboard.down('Shift'); await skinned.click({ button: 'right' }); await page.keyboard.up('Shift');
  108 |   await expect.poll(async () => (await ground()).some(stone => stone.id === spawned.id && stone.skin === 'heatrock_fantasy')).toBe(true);
  109 |   const dropped = await saveGame();
  110 |   expectStoneState(dropped.world.entities.ground_item.find((record: any) => record.id === spawned.id).components.stack,
  111 |     savedStone.components.stack, dropped.world.elapsedSeconds - groundSave.world.elapsedSeconds);
  112 |   await page.route('**/saves/initial-world.json', route => route.fulfill({ json: dropped }));
  113 |   await page.reload(); await prepare();
  114 |   await expect.poll(async () => (await ground())[0]?.skin).toBe('heatrock_fantasy');
  115 |   const restored = await saveGame();
  116 |   expect(restored.world.entities.ground_item).toHaveLength(dropped.world.entities.ground_item.length);
  117 |   restored.world.entities.ground_item.forEach((record: any, index: number) => {
  118 |     const expected = dropped.world.entities.ground_item[index];
  119 |     expect({ ...record, components: undefined }).toEqual({ ...expected, components: undefined });
  120 |     expect({ ...record.components, stack: undefined }).toEqual({ ...expected.components, stack: undefined });
  121 |     expectStoneState(record.components.stack, expected.components.stack,
  122 |       restored.world.elapsedSeconds - dropped.world.elapsedSeconds);
  123 |   });
  124 |   expectInventoryStones(restored, dropped);
  125 |   await clickStone(spawned.id, 'left'); await expect(skinned).toBeVisible();
  126 |   const taken = await saveGame();
  127 |   expectStoneState(stones(taken).find(item => item.entityId === spawned.id), { entityId: spawned.id, ...savedStone.components.stack },
  128 |     taken.world.elapsedSeconds - groundSave.world.elapsedSeconds);
  129 |   expect(taken.world.entities.ground_item ?? []).toEqual([]);
  130 |   await page.route('**/saves/initial-world.json', route => route.fulfill({ json: taken }));
  131 |   await page.reload(); await prepare();
  132 |   expectInventoryStones(await saveGame(), taken);
  133 |   await expect(skinned.locator('.inventory-slot__icon')).toHaveAttribute('data-element', 'heatrock_fantasy3.tex');
  134 |   expect(errors).toEqual([]);
  135 | });
  136 | 
```
# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: moonbase.spec.ts >> repairs moonbase with a cursor moonrock, inserts and retrieves a skinned staff, and saves the new material prefab
- Location: tests/moonbase.spec.ts:8:1

# Error details

```
Test timeout of 150000ms exceeded.
```

```
Error: locator.click: Test timeout of 150000ms exceeded.
Call log:
  - waiting for locator('dst-inventory-bar .inventory-bar__items').locator('[data-item-id="moonrocknugget"]')

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
      - generic "精神值 186":
        - status: "186"
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
        - button "小肉，数量 8，新鲜度 85%，潮湿" [ref=e43] [cursor=pointer]:
          - generic [aria-hidden]: "8"
        - button "猛兽眼球伞，数量 1" [ref=e44] [cursor=pointer]
        - button "爆米花，数量 1，新鲜度 65%，潮湿" [ref=e45] [cursor=pointer]
        - button "石头，数量 3，潮湿" [ref=e46] [cursor=pointer]:
          - generic [aria-hidden]: "3"
      - generic [ref=e47]:
        - button "噩梦燃料，数量 10" [ref=e48] [cursor=pointer]:
          - generic [aria-hidden]: "10"
        - button "燧石，数量 1，潮湿" [ref=e49] [cursor=pointer]
        - button "扭曲唤星者魔杖，数量 1，耐久 45%，潮湿" [ref=e50] [cursor=pointer]:
          - generic [aria-hidden]: 45%
        - button "肉，数量 17，新鲜度 80%，潮湿" [ref=e51] [cursor=pointer]:
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
  8   | test('repairs moonbase with a cursor moonrock, inserts and retrieves a skinned staff, and saves the new material prefab', async ({ page }) => {
  9   |   test.setTimeout(150_000);
  10  |   const errors: string[] = [];
  11  |   page.on('pageerror', error => errors.push(error.message));
  12  |   page.on('console', message => {
  13  |     if (message.type() === 'error' || (message.type() === 'warning' && /Unable to (prepare|play)/.test(message.text()))) errors.push(message.text());
  14  |   });
  15  |   await page.addInitScript(() => {
  16  |     (window as any).moonbaseAudio = [];
  17  |     const original = AudioContext.prototype.createBufferSource;
  18  |     AudioContext.prototype.createBufferSource = function () {
  19  |       const source = original.call(this), start = source.start.bind(source);
  20  |       source.start = (...args: Parameters<typeof start>) => {
  21  |         if (source.buffer) (window as any).moonbaseAudio.push({ duration: source.buffer.duration, loop: source.loop });
  22  |         start(...args);
  23  |       };
  24  |       return source;
  25  |     };
  26  |   });
  27  |   await page.route('**/saves/initial-world.json', async route => {
  28  |     const response = await route.fetch(), save = await response.json();
  29  |     save.world.entities = {}; save.world.elapsedSeconds = 0; save.players.local.transform.position = [0, 0, 0];
  30  |     for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
  31  |     save.players.local.inventory.containers['player:inventory'].slots = [{ slotKey: '0', item: {
  32  |       entityId: 'moonbase_browser_staff', itemId: 'yellowstaff', count: 1, skinId: 'starstaff_crystal', remainingUses: 7,
  33  |     } }];
  34  |     save.players.local.inventory.bufferedBuilds = [];
  35  |     await route.fulfill({ response, json: save });
  36  |   });
  37  |   const prepare = () => page.evaluate(async urls => {
  38  |     const main = await import(urls.main), { scene, renderer } = await import(urls.universal);
  39  |     const { camera } = await import(urls.camera), { player } = await import(urls.player);
  40  |     (window as any).moonbaseGame = { main, scene, renderer, camera, player };
  41  |   }, urls);
  42  |   const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
  43  |     new CustomEvent('game:debug-command', { detail: { command } })), command);
  44  |   const state = () => page.evaluate(() => {
  45  |     const model = (window as any).moonbaseGame.scene.children.find((model: any) => model.name === 'MoonBase');
  46  |     if (!model) return null;
  47  |     return { workleft: model.userData.components.workable.GetWorkLeft(),
  48  |       held: model.userData.moonbase.staff.peek()?.snapshot(), animation: model.userData.animationController.currentAnimation };
  49  |   });
  50  |   const saveGame = async () => {
  51  |     const download = page.waitForEvent('download'); await submit('c_save()');
  52  |     return JSON.parse(await readSaveDownload((await (await download).path())!));
  53  |   };
  54  |   const clickMoonbase = async (button: 'left' | 'right' = 'left') => {
  55  |     const point = await page.evaluate(() => {
  56  |       const { scene, camera, renderer } = (window as any).moonbaseGame;
  57  |       const model = scene.children.find((model: any) => model.name === 'MoonBase'), mesh = model.children[0].children[0];
  58  |       mesh.geometry.computeBoundingBox();
  59  |       const center = mesh.geometry.boundingBox.getCenter(model.position.clone());
  60  |       mesh.localToWorld(center).project(camera);
  61  |       const rect = renderer.domElement.getBoundingClientRect();
  62  |       return { x: rect.left + (center.x + 1) * rect.width / 2, y: rect.top + (1 - center.y) * rect.height / 2 };
  63  |     });
  64  |     await page.mouse.click(point.x, point.y, { button });
  65  |   };
  66  |   const samples = () => page.evaluate(() => ((window as any).moonbaseAudio as { duration: number; loop: boolean }[]).filter(sample => !sample.loop));
  67  |   const clearSamples = () => page.evaluate(() => { (window as any).moonbaseAudio.length = 0; });
  68  |   const bar = page.locator('dst-inventory-bar .inventory-bar__items');
  69  | 
  70  |   await page.goto('/tests/dst-lighting.html'); await prepare();
  71  |   await submit('c_spawn("moonbase")');
  72  |   await expect.poll(state).toMatchObject({ workleft: 4, animation: 'med' });
  73  |   await submit('c_give("moonrocknugget", 2)');
> 74  |   await bar.locator('[data-item-id="moonrocknugget"]').click();
      |                                                        ^ Error: locator.click: Test timeout of 150000ms exceeded.
  75  |   await clearSamples();
  76  |   await clickMoonbase('right'); // The action walks to range before the long repair action.
  77  |   await expect.poll(async () => (await state())?.workleft, { timeout: 30_000 }).toBe(6);
  78  |   const repairSamples = await samples();
  79  |   expect(repairSamples).toHaveLength(3);
  80  |   expect(repairSamples[0].duration).toBeCloseTo(34346 / 44100, 5);
  81  |   expect(repairSamples[2].duration).toBeCloseTo(19081 / 44100, 5);
  82  |   await expect.poll(async () => (await state())?.animation).toBe('full');
  83  | 
  84  |   await bar.locator('[data-item-id="yellowstaff"]').click();
  85  |   await clearSamples(); await clickMoonbase();
  86  |   await expect.poll(async () => (await state())?.held).toMatchObject({ entityId: 'moonbase_browser_staff', skinId: 'starstaff_crystal', remainingUses: 7 });
  87  |   expect(await samples()).toHaveLength(2);
  88  |   const saved = await saveGame(), moonbase = saved.world.entities.moonbase[0];
  89  |   expect(moonbase.components.workable).toEqual({ maxwork: 6, workleft: 6 });
  90  |   expect(JSON.stringify(saved.players.local.inventory)).not.toContain('yellowstaff');
  91  |   await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  92  |   await page.reload(); await prepare();
  93  |   await expect.poll(async () => (await state())?.held).toEqual(moonbase.components.moonbase.staff);
  94  |   expect((await saveGame()).world.entities.moonbase[0]).toEqual(moonbase);
  95  | 
  96  |   await clearSamples(); await clickMoonbase();
  97  |   await expect.poll(async () => (await state())?.held).toBeUndefined();
  98  |   expect(await samples()).toHaveLength(2);
  99  |   await expect(bar.locator('[data-item-id="yellowstaff"]')).toHaveAttribute('data-skin-id', 'starstaff_crystal');
  100 |   await submit('c_spawn("moonrocknugget")');
  101 |   await expect.poll(() => page.evaluate(() => (window as any).moonbaseGame.scene.children
  102 |     .some((model: any) => model.userData.itemId === 'moonrocknugget'))).toBe(true);
  103 |   const taken = await saveGame();
  104 |   expect(taken.world.entities.moonbase[0].components.moonbase).toBeUndefined();
  105 |   const slots = Object.values(taken.players.local.inventory.containers).flatMap((container: any) => container.slots) as any[];
  106 |   expect(slots.find(slot => slot.item.itemId === 'yellowstaff').item).toEqual(moonbase.components.moonbase.staff);
  107 |   expect(slots.find(slot => slot.item.itemId === 'moonrocknugget').item.count).toBe(1);
  108 |   const groundRock = taken.world.entities.ground_item.find((entity: any) => entity.components.stack.itemId === 'moonrocknugget');
  109 |   expect(groundRock.components.stack.count).toBe(1);
  110 |   await page.route('**/saves/initial-world.json', route => route.fulfill({ json: taken }));
  111 |   await page.reload(); await prepare();
  112 |   const final = await saveGame();
  113 |   expect(final.world.entities.ground_item).toEqual(taken.world.entities.ground_item);
  114 |   expect(final.players.local.inventory).toEqual(taken.players.local.inventory);
  115 |   expect(errors).toEqual([]);
  116 | });
  117 | 
  118 | test('shows native charge layers, resumes after a downloaded save, and returns the transformed moonstaff', async ({ page }) => {
  119 |   test.setTimeout(180_000);
  120 |   const errors: string[] = [];
  121 |   page.on('pageerror', error => errors.push(error.message));
  122 |   page.on('console', message => {
  123 |     if (message.type() === 'error' || (message.type() === 'warning' && /Unable to (prepare|play)/.test(message.text()))) errors.push(message.text());
  124 |   });
  125 |   await page.addInitScript(() => {
  126 |     const sounds: { duration: number; channels: number; loop: boolean; stopped: boolean }[] = [];
  127 |     (window as any).chargeAudio = sounds;
  128 |     const original = AudioContext.prototype.createBufferSource;
  129 |     AudioContext.prototype.createBufferSource = function () {
  130 |       const source = original.call(this), start = source.start.bind(source), stop = source.stop.bind(source);
  131 |       let sound: typeof sounds[number] | undefined;
  132 |       source.start = (...args: Parameters<typeof start>) => {
  133 |         if (source.buffer) {
  134 |           sound = { duration: source.buffer.duration, channels: source.buffer.numberOfChannels, loop: source.loop, stopped: false };
  135 |           sounds.push(sound);
  136 |         }
  137 |         start(...args);
  138 |       };
  139 |       source.stop = (...args: Parameters<typeof stop>) => { if (sound) sound.stopped = true; stop(...args); };
  140 |       return source;
  141 |     };
  142 |   });
  143 |   await page.route('**/saves/initial-world.json', async route => {
  144 |     const response = await route.fetch(), save = await response.json();
  145 |     save.world.elapsedSeconds = 10 * 480 + 420; // Day 11, beginning of the full-moon night.
  146 |     save.world.entities = { moonbase: [{ id: 'browser_charge_base', transform: { position: [0, 0, -10], rotationY: 0 },
  147 |       components: { building: { state: 'idle' }, workable: { workleft: 6, maxwork: 6 }, moonbase: {
  148 |         staff: { entityId: 'browser_charge_yellow', itemId: 'yellowstaff', count: 1, skinId: 'starstaff_crystal', remainingUses: 7 },
  149 |       } } }] };
  150 |     save.players.local.transform.position = [0, 0, 0];
  151 |     for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
  152 |     save.players.local.inventory.bufferedBuilds = [];
  153 |     await route.fulfill({ response, json: save });
  154 |   });
  155 |   const prepare = () => page.evaluate(async urls => {
  156 |     await import(urls.main);
  157 |     const { scene, renderer } = await import(urls.universal), { camera } = await import(urls.camera);
  158 |     (window as any).chargeGame = { scene, renderer, camera };
  159 |   }, urls);
  160 |   const current = () => page.evaluate(() => {
  161 |     const { scene } = (window as any).chargeGame, model = scene.children.find((model: any) => model.name === 'MoonBase');
  162 |     const state = model.userData.moonbase;
  163 |     const order = (name: string) => scene.children.find((model: any) => model.name === name)?.children[0].renderOrder;
  164 |     return { phase: state.charge.peek(), staff: state.staff.peek()?.snapshot(),
  165 |       orders: [order('positronbeam_back'), model.children[0].renderOrder, order('positronbeam_front'), order('positronpulse')],
  166 |       cold: scene.children.some((model: any) => model.name === 'staffcoldlightfx'),
  167 |       intense: model.userData.actionEntity.hasTag('intense') };
  168 |   });
  169 |   const audio = () => page.evaluate(() => (window as any).chargeAudio as {
  170 |     duration: number; channels: number; loop: boolean; stopped: boolean;
  171 |   }[]);
  172 |   const saveGame = async () => {
  173 |     const download = page.waitForEvent('download');
  174 |     await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(
```
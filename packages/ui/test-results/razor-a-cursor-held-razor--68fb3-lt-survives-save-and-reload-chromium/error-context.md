# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: razor.spec.ts >> a cursor-held razor refuses an awake beefalo, shaves a sleeping one, and the result survives save and reload
- Location: tests/razor.spec.ts:8:1

# Error details

```
Error: expect(received).not.toBeNull()

Received: null

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
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
  8   | test('a cursor-held razor refuses an awake beefalo, shaves a sleeping one, and the result survives save and reload', async ({ page }) => {
  9   |   test.setTimeout(180_000);
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
  24  |     (window as any).razorGame = { main, scene, renderer, camera, player, playerBody };
  25  |   }, urls);
  26  |   const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
  27  |     new CustomEvent('game:debug-command', { detail: { command } })), command);
  28  |   const saveGame = async () => {
  29  |     const download = page.waitForEvent('download'); await submit('c_save()');
  30  |     return JSON.parse(await readSaveDownload((await (await download).path())!));
  31  |   };
  32  |   const beefalo = () => page.evaluate(() => {
  33  |     const model = (window as any).razorGame.scene.children.find((model: any) => model.userData.instance?.prefab === 'beefalo');
  34  |     if (!model) return null;
  35  |     const { beard, sleeper } = model.userData.components, inst = model.userData.actionEntity;
  36  |     return { id: model.userData.instance?.entityId, state: model.userData.beefaloState, bits: beard.bits.peek(), growth: beard.daysgrowth.peek(),
  37  |       asleep: sleeper.IsAsleep(), bearded: inst.hasTag('bearded'), hairy: inst.hasTag('has_beard') };
  38  |   });
  39  |   const wool = () => page.evaluate(() => (window as any).razorGame.scene.children
  40  |     .filter((model: any) => model.userData.itemId === 'beefalowool').length);
  41  |   const clickBeefalo = async () => {
  42  |     const point = await page.evaluate(() => {
  43  |       const { scene, camera, renderer } = (window as any).razorGame;
  44  |       const model = scene.children.find((model: any) => model.userData.instance?.prefab === 'beefalo'), mesh = model.children[0].children[0];
  45  |       mesh.geometry.computeBoundingBox();
  46  |       const center = mesh.geometry.boundingBox.getCenter(model.position.clone()); mesh.localToWorld(center).project(camera);
  47  |       const rect = renderer.domElement.getBoundingClientRect();
  48  |       return { x: rect.left + (center.x + 1) * rect.width / 2, y: rect.top + (1 - center.y) * rect.height / 2 };
  49  |     });
  50  |     await page.mouse.click(point.x, point.y);
  51  |   };
  52  |   const slots = (save: any) => Object.entries(save.players.local.inventory.containers).flatMap(([id, container]: [string, any]) =>
  53  |     container.slots.map((slot: any) => ({ container: id, ...slot })));
  54  |   const cursor = page.locator('.slot-drag-preview[data-cursor="true"]');
  55  | 
  56  |   await page.goto('/tests/dst-lighting.html'); await prepare();
  57  |   await submit('c_give("razor"); c_spawn("razor"); c_spawn("beefalo")');
> 58  |   await expect.poll(beefalo).not.toBeNull();
      |                                  ^ Error: expect(received).not.toBeNull()
  59  |   // The ground razor is built from razor.zip/swap_razor, not from its inventory icon.
  60  |   await expect.poll(() => page.evaluate(() => (window as any).razorGame.scene.children
  61  |     .filter((model: any) => model.userData.itemId === 'razor')
  62  |     .map((model: any) => model.children[0].children[0].geometry.drawRange.count > 0))).toEqual([true]);
  63  |   // Wandering is not under test here; stop its brain while testing the player's tool input.
  64  |   await page.evaluate(() => {
  65  |     const { scene, player, playerBody } = (window as any).razorGame;
  66  |     const model = scene.children.find((model: any) => model.userData.instance?.prefab === 'beefalo');
  67  |     model.userData.beefaloController.brain.Stop();
  68  |     playerBody.position.set(model.position.x - 6, playerBody.shapes[0].radius, model.position.z + 6);
  69  |     player.position.set(model.position.x - 6, 0, model.position.z + 6);
  70  |   });
  71  |   // reskin_tool cycles the ground razor through its three source skins, keeping its identity.
  72  |   const groundRazor = () => page.evaluate(() => (window as any).razorGame.scene.children
  73  |     .filter((model: any) => model.userData.itemId === 'razor')
  74  |     .map((model: any) => ({ id: model.userData.instance?.entityId, skin: model.userData.instance?.skinId })));
  75  |   const spawnedRazor = (await groundRazor())[0];
  76  |   await submit('c_give("reskin_tool")');
  77  |   const bar = page.locator('dst-inventory-bar');
  78  |   await bar.locator('.inventory-bar__items [data-item-id="reskin_tool"]').dragTo(bar.locator('[data-slot-key="hand"]'));
  79  |   await page.evaluate(id => {
  80  |     const { scene, camera, renderer, player, playerBody } = (window as any).razorGame;
  81  |     const model = scene.children.find((model: any) => model.userData.instance?.entityId === id);
  82  |     playerBody.position.set(model.position.x + 3, playerBody.shapes[0].radius, model.position.z + 3);
  83  |     player.position.set(model.position.x + 3, 0, model.position.z + 3);
  84  |     (window as any).razorPoint = () => {
  85  |       const mesh = model.children[0].children[0]; mesh.geometry.computeBoundingBox();
  86  |       const center = mesh.geometry.boundingBox.getCenter(model.position.clone()); mesh.localToWorld(center).project(camera);
  87  |       const rect = renderer.domElement.getBoundingClientRect();
  88  |       return { x: rect.left + (center.x + 1) * rect.width / 2, y: rect.top + (1 - center.y) * rect.height / 2 };
  89  |     };
  90  |   }, spawnedRazor.id);
  91  |   const razorPoint = await page.evaluate(() => (window as any).razorPoint());
  92  |   await page.mouse.click(razorPoint.x, razorPoint.y, { button: 'right' });
  93  |   await expect.poll(async () => (await groundRazor())[0]?.skin, { timeout: 20_000 }).toBe('razor_barber');
  94  |   expect((await groundRazor())[0].id).toBe(spawnedRazor.id);
  95  | 
  96  |   const razor = page.locator('dst-inventory-bar .inventory-bar__items [data-item-id="razor"]');
  97  |   await expect(razor.locator('.inventory-slot__icon[data-loaded="true"]')).toBeVisible();
  98  |   await razor.click();
  99  |   await expect(cursor).toHaveAttribute('data-item-id', 'razor');
  100 | 
  101 |   // Awake: the shave state reports AWAKEBEEFALO, the beard and the cursor are untouched.
  102 |   expect((await beefalo())!.asleep).toBe(false);
  103 |   await clickBeefalo();
  104 |   await page.waitForTimeout(4000);
  105 |   expect(await beefalo()).toMatchObject({ bits: 3, asleep: false });
  106 |   expect(await wool()).toBe(0);
  107 |   await expect(cursor).toHaveAttribute('data-item-id', 'razor');
  108 | 
  109 |   // Night: the sleeper puts it to sleep by itself, and the same click shaves it, drops three wool and
  110 |   // keeps it sleeping in the shaved build. DST nights start at 420 s of the 480 s day.
  111 |   const day = await saveGame();
  112 |   expect(day.world.entities.beefalo[0].components.beefalo.knownlocations).toEqual({ locations: [] });
  113 |   expect(day.world.entities.ground_item.filter((entry: any) => entry.components.stack.itemId === 'razor')).toHaveLength(1);
  114 |   day.world.elapsedSeconds = 425;
  115 |   await page.route('**/saves/initial-world.json', route => route.fulfill({ json: day }));
  116 |   await page.reload(); await prepare();
  117 |   await expect(cursor).toHaveAttribute('data-item-id', 'razor');
  118 |   await expect.poll(async () => (await beefalo())?.state, { timeout: 20_000 }).toBe('sleeping');
  119 |   expect(await beefalo()).toMatchObject({ bits: 3, asleep: true });
  120 |   await page.evaluate(() => {
  121 |     const { scene, player, playerBody } = (window as any).razorGame;
  122 |     const model = scene.children.find((model: any) => model.userData.instance?.prefab === 'beefalo');
  123 |     playerBody.position.set(model.position.x - 6, playerBody.shapes[0].radius, model.position.z + 6);
  124 |     player.position.set(model.position.x - 6, 0, model.position.z + 6);
  125 |   });
  126 |   await clickBeefalo();
  127 |   await expect.poll(wool, { timeout: 30_000 }).toBe(3);
  128 |   const shaved = (await beefalo())!;
  129 |   expect(shaved).toMatchObject({ bits: 0, growth: 0, asleep: true });
  130 |   expect(shaved).toMatchObject({ bearded: true, hairy: false });
  131 |   await expect(cursor).toHaveAttribute('data-item-id', 'razor');
  132 | 
  133 |   const saved = await saveGame();
  134 |   const record = saved.world.entities.beefalo.find((entry: any) => entry.id === shaved.id);
  135 |   expect(record.components.beefalo.beard).toEqual({ growth: 0, growthaccumulator: 0, bits: 0 });
  136 |   expect(saved.world.entities.ground_item.filter((entry: any) => entry.components.stack.itemId === 'beefalowool')).toHaveLength(3);
  137 |   expect(slots(saved).filter(slot => slot.item.itemId === 'razor' && slot.container === 'player:cursor')).toHaveLength(1);
  138 | 
  139 |   saved.world.elapsedSeconds = 425;
  140 |   await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  141 |   await page.reload(); await prepare();
  142 |   await expect.poll(beefalo).toMatchObject({ id: shaved.id, bits: 0 });
  143 |   expect(await beefalo()).toMatchObject({ bearded: true, hairy: false });
  144 |   const restored = await saveGame();
  145 |   expect(restored.world.entities.beefalo.find((entry: any) => entry.id === shaved.id).components.beefalo.beard)
  146 |     .toEqual(record.components.beefalo.beard);
  147 |   expect(slots(restored).filter(slot => slot.item.itemId === 'razor' && slot.container === 'player:cursor')).toHaveLength(1);
  148 |   expect(errors).toEqual([]);
  149 | });
  150 | 
```
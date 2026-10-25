# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: monkeytail.spec.ts >> picks monkeytail, plants a cursor-held root and fertilizes it through real input, then reloads the save
- Location: tests/monkeytail.spec.ts:6:1

# Error details

```
Error: expect(received).toBeGreaterThanOrEqual(expected)

Matcher error: received value must be a number or bigint

Received has value: undefined
```

# Page snapshot

```yaml
- generic [ref=e1]:
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
      - generic "精神值 165":
        - status: "165"
      - generic "生命值 150":
        - status: "150"
    - generic "温度 45 度":
      - status: 45°
  - region "物品栏" [ref=e23]:
    - group "背包" [ref=e24]:
      - generic [ref=e25]:
        - button "猴尾草，数量 1" [ref=e26] [cursor=pointer]
        - button "物品栏 2" [ref=e27] [cursor=pointer]
        - button "采下的芦苇，数量 1" [ref=e28] [cursor=pointer]
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
  - status
  - status "帧率": FPS 9
```

# Test source

```ts
  1  | import { hoverSprite } from './sprite-input';
  2  | import { readSaveDownload } from './save-download';
  3  | import { fileURLToPath } from 'node:url';
  4  | import { expect, test } from '@playwright/test';
  5  | 
  6  | test('picks monkeytail, plants a cursor-held root and fertilizes it through real input, then reloads the save', async ({ page }) => {
  7  |   test.setTimeout(150_000);
  8  |   const errors: string[] = [];
  9  |   page.on('pageerror', error => errors.push(error.message));
  10 |   await page.route('**/saves/initial-world.json', async route => {
  11 |     const response = await route.fetch(), save = await response.json();
  12 |     save.world.entities = {}; save.world.elapsedSeconds = 0;
  13 |     save.players.local.transform.position = [0, 0, 0];
  14 |     for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
  15 |     save.players.local.inventory.bufferedBuilds = [];
  16 |     await route.fulfill({ response, json: save });
  17 |   });
  18 |   const urls = Object.fromEntries(['main', 'universal', 'view', 'building', 'player'].map(name =>
  19 |     [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));
  20 |   urls.physics = `/@fs${fileURLToPath(new URL('../../../src/physics.ts', import.meta.url))}`;
  21 |   const prepare = () => page.evaluate(async urls => {
  22 |     const { worldState } = await import(urls.physics); worldState.season.set({ season: 'winter', progress: .5 });
  23 |     const { inventory, gameReady } = await import(urls.main); await gameReady;
  24 |     const { scene } = await import(urls.universal), { view } = await import(urls.view);
  25 |     const { turfMap } = await import(urls.building), { player, playerBody } = await import(urls.player);
  26 |     // Both target tiles are valid soil, independently of the generator's initial terrain.
  27 |     turfMap.setTile(0, 0, 4);
  28 |     playerBody.position.set(0, playerBody.shapes[0].radius, 0); playerBody.velocity.set(0, 0, 0); player.position.set(0, 0, 0);
  29 |     (window as any).monkeytailGame = { inventory, scene, view, player, playerBody };
  30 |   }, urls);
  31 |   const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
  32 |     new CustomEvent('game:debug-command', { detail: { command } })), command);
  33 |   const screenPoint = (planted: boolean) => page.evaluate(async ({ planted, moduleUrl }) => {
  34 |     const { scene, view } = (window as any).monkeytailGame;
  35 |     const model = scene.children.find((model: any) => model.userData.instance?.prefab === 'monkeytail'
  36 |       && !!model.userData.components.pickable.exportState().transplanted === planted);
  37 |     if (!model) throw new Error('No monkeytail target');
  38 |     scene.updateMatrixWorld(true);
  39 |     const { spriteScreenPoint } = await import(moduleUrl);
  40 |     return spriteScreenPoint(model, view.camera, view.renderer);
  41 |   }, { planted, moduleUrl: `/@fs${fileURLToPath(new URL('./sprite-screen-point.ts', import.meta.url))}` });
  42 |   const hover = (target: Parameters<typeof screenPoint>[0], button: 'left' | 'right', action: string) =>
  43 |     hoverSprite(page, () => screenPoint(target), 'monkeytailGame', button, action);
  44 |   const count = (id: string) => page.evaluate(id => (window as any).monkeytailGame.inventory.count(id), id);
  45 |   const bar = page.locator('dst-inventory-bar .inventory-bar__items');
  46 | 
  47 |   await page.goto('/tests/dst-lighting.html?save=initial-world.json'); await prepare();
  48 |   await submit('c_spawn("monkeytail");c_give("dug_monkeytail",2);c_give("poop",2)');
  49 |   await expect(bar.locator('[data-item-id="dug_monkeytail"] .inventory-slot__icon[data-loaded="true"]')).toBeVisible();
  50 |   await expect.poll(() => page.evaluate(() => (window as any).monkeytailGame.scene.children.filter((model: any) => model.userData.instance?.prefab === 'monkeytail').length)).toBe(1);
  51 |   const wild = await hover(false, 'left', 'PICK');
  52 |   await page.mouse.click(wild.x, wild.y);
  53 |   await expect.poll(() => count('cutreeds')).toBe(1);
  54 | 
  55 |   await bar.locator('[data-item-id="dug_monkeytail"]').click();
  56 |   const plantingPoint = await page.evaluate(() => {
  57 |     const { player, view } = (window as any).monkeytailGame;
  58 |     const point = player.position.clone().set(6, 0, 6).project(view.camera), rect = view.renderer.domElement.getBoundingClientRect();
  59 |     return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
  60 |   });
  61 |   await page.mouse.move(plantingPoint.x, plantingPoint.y);
  62 |   await expect.poll(() => page.evaluate(() => (window as any).monkeytailGame.view.mouseActions.getMouseActions().right?.action)).toBe('DEPLOY');
  63 |   await page.mouse.click(plantingPoint.x, plantingPoint.y, { button: 'right' });
  64 |   await expect.poll(() => page.evaluate(() => (window as any).monkeytailGame.scene.children.filter((model: any) => model.userData.instance?.prefab === 'monkeytail').length)).toBe(2);
  65 |   await expect.poll(() => count('dug_monkeytail')).toBe(1);
  66 |   const root = await page.evaluate(() => {
  67 |     const model = (window as any).monkeytailGame.scene.children.find((model: any) => model.userData.components?.pickable?.exportState().transplanted);
  68 |     return { id: model.userData.instance?.entityId, position: model.position.toArray(), state: model.userData.components.pickable.exportState() };
  69 |   });
  70 |   expect(root.state).toMatchObject({ picked: true, transplanted: true, cyclesLeft: 0 });
  71 |   // Put the remaining root back, then hold manure on the cursor.
  72 |   await bar.locator('.inventory-slot[data-item-id=""]').first().click();
  73 |   await bar.locator('[data-item-id="poop"]').click();
  74 |   const dead = await hover(true, 'left', 'FERTILIZE');
  75 |   await page.mouse.click(dead.x, dead.y);
  76 |   await expect.poll(() => count('poop')).toBe(1);
  77 |   await expect.poll(() => page.evaluate(id => {
  78 |     const model = (window as any).monkeytailGame.scene.children.find((model: any) => model.userData.instance?.entityId === id);
  79 |     return model.userData.components.pickable.state.timer.peek().status;
  80 |   }, root.id)).toBe('stopped'); // Initial world is winter: fertilizer cannot bypass the winter pause.
  81 | 
  82 |   const download = page.waitForEvent('download'); await submit('c_save()');
  83 |   const saved = JSON.parse(await readSaveDownload((await (await download).path())!, 'Master'));
  84 |   const plant = saved.world.entities.monkeytail.find((record: any) => record.id === root.id);
  85 |   expect(plant.transform.position).toEqual(root.position);
  86 |   expect(plant.components.pickable).toMatchObject({ picked: true, transplanted: true, paused: true });
> 87 |   expect(plant.components.pickable.cyclesLeft).toBeGreaterThanOrEqual(5);
     |                                                ^ Error: expect(received).toBeGreaterThanOrEqual(expected)
  88 |   await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  89 |   await page.reload(); await prepare();
  90 |   await expect.poll(() => page.evaluate(id => {
  91 |     const model = (window as any).monkeytailGame.scene.children.find((model: any) => model.userData.instance?.entityId === id);
  92 |     return model?.userData.components.pickable.exportState();
  93 |   }, root.id)).toEqual(plant.components.pickable);
  94 |   await expect.poll(() => count('dug_monkeytail')).toBe(1);
  95 |   expect(errors).toEqual([]);
  96 | });
  97 | 
```
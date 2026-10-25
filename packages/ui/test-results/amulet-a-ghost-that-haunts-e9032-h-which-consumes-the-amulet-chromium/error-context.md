# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: amulet.spec.ts >> a ghost that haunts a red amulet rises from it in amulet_rebirth, which consumes the amulet
- Location: tests/amulet.spec.ts:7:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "HAUNT"
Received: undefined

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
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
      - generic "饱食度 100":
        - status: "100"
      - generic "精神值 100":
        - status: "100"
      - generic "生命值 50":
        - status: "50"
    - generic "温度 45 度":
      - status: 45°
  - region "地图控制" [ref=e23]:
    - button "打开地图" [ref=e24] [cursor=pointer]
    - generic [ref=e25]:
      - button "向左旋转视角" [ref=e26] [cursor=pointer]
      - button "暂停游戏" [ref=e27] [cursor=pointer]
      - button "向右旋转视角" [ref=e28] [cursor=pointer]
  - status "帧率": FPS 7
```

# Test source

```ts
  1  | import { readSaveDownload } from './save-download';
  2  | import { fileURLToPath } from 'node:url';
  3  | import { expect, test } from '@playwright/test';
  4  | 
  5  | const urlOf = (path: string) => `/@fs${fileURLToPath(new URL(`../../../${path}`, import.meta.url))}`;
  6  | 
  7  | test('a ghost that haunts a red amulet rises from it in amulet_rebirth, which consumes the amulet', async ({ page }) => {
  8  |   test.setTimeout(150_000);
  9  |   const errors: string[] = [];
  10 |   page.on('pageerror', error => errors.push(error.message));
  11 |   page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  12 |   await page.route('**/saves/initial-world.json', async route => {
  13 |     const response = await route.fetch(), save = await response.json();
  14 |     save.world.entities = {}; save.world.elapsedSeconds = 0;
  15 |     save.players.local.transform.position = [0, 0, 0];
  16 |     for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
  17 |     save.players.local.inventory.bufferedBuilds = [];
  18 |     await route.fulfill({ response, json: save });
  19 |   });
  20 |   const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
  21 |     new CustomEvent('game:debug-command', { detail: { command } })), command);
  22 |   const saveGame = async () => {
  23 |     const download = page.waitForEvent('download'); await submit('c_save()');
  24 |     return JSON.parse(await readSaveDownload((await (await download).path())!));
  25 |   };
  26 |   const amulet = () => page.evaluate(() => {
  27 |     const model = (window as any).amuletGame.scene.children.find((model: any) => model.userData.itemId === 'amulet');
  28 |     return model ? { resurrector: model.userData.actionEntity?.hasTag('resurrector'), hauntable: !!model.userData.components?.hauntable,
  29 |       haunted: model.userData.actionEntity?.hasTag('haunted') } : null;
  30 |   });
  31 |   const player = () => page.evaluate(() => {
  32 |     const { player, stats, main } = (window as any).amuletGame, controller = player.userData.animationController;
  33 |     return { ghost: controller.isGhost, state: controller.stategraph.stateName, ghostMode: stats.playerGhostMode.peek(),
  34 |       invincible: stats.playerStats.health.invincible, penalty: stats.playerStats.health.penalty,
  35 |       body: main.inventory.GetEquippedItem('body')?.prefab ?? null, amulets: main.inventory.count('amulet'),
  36 |       tags: player.userData.instance.listTags() };
  37 |   });
  38 | 
  39 |   await page.goto('/tests/dst-lighting.html');
  40 |   await page.evaluate(async urls => {
  41 |     const main = await import(urls.main), { scene } = await import(urls.universal);
  42 |     const { player } = await import(urls.player), stats = await import(urls.playerStats);
  43 |     (window as any).amuletGame = { main, scene, player, stats };
  44 |   }, { main: urlOf('src/main.ts'), universal: urlOf('src/universal.ts'), player: urlOf('src/player.ts'), playerStats: urlOf('src/playerStats.ts') });
  45 |   await page.evaluate(() => (window as any).amuletGame.stats.playerStats.health.set(0));
  46 |   await expect.poll(async () => (await player()).ghost, { timeout: 30_000 }).toBe(true);
  47 |   await expect.poll(async () => (await player()).state, { timeout: 15_000 }).toBe('idle');
  48 | 
  49 |   await expect(page.locator('dst-inventory-bar')).toHaveCSS('display', 'none');
  50 |   await submit('c_spawn("amulet")');
  51 |   await expect.poll(amulet).toMatchObject({ hauntable: true, resurrector: true });
  52 | 
  53 |   // Move the amulet off the ghost, then a real left click on it: HAUNT for a ghost.
  54 |   await page.waitForTimeout(1000);
  55 |   await page.evaluate(() => {
  56 |     const model = (window as any).amuletGame.scene.children.find((model: any) => model.userData.itemId === 'amulet');
  57 |     model.userData.pickupTarget.entity.transform.position.x = 6; model.position.x = 6;
  58 |   });
  59 |   await page.waitForTimeout(500);
  60 |   const click = await page.evaluate(async url => {
  61 |     const { view } = await import(url), { scene } = (window as any).amuletGame;
  62 |     const model = scene.children.find((model: any) => model.userData.itemId === 'amulet');
  63 |     const at = model.position.clone(); at.y = .15;
  64 |     const ndc = at.project(view.camera), rect = view.renderer.domElement.getBoundingClientRect();
  65 |     return { x: rect.left + (ndc.x + 1) / 2 * rect.width, y: rect.top + (1 - ndc.y) / 2 * rect.height };
  66 |   }, urlOf('src/view.ts'));
  67 |   await page.mouse.move(click.x, click.y);
> 68 |   await expect.poll(() => page.evaluate(async url => (await import(url)).view.mouseActions.getMouseActions().left?.action, urlOf('src/view.ts'))).toBe('HAUNT');
     |                                                                                                                                                   ^ Error: expect(received).toBe(expected) // Object.is equality
  69 |   await page.mouse.click(click.x, click.y);
  70 |   await expect.poll(async () => (await player()).state).toBe('haunt_pre');
  71 |   await expect.poll(async () => (await player()).state, { timeout: 20_000 }).toBe('amulet_rebirth');
  72 |   // The amulet was worn for the state, then consumed; the player is alive, invincible and without a portal penalty.
  73 |   expect(await player()).toMatchObject({ ghost: false, ghostMode: false, invincible: true, penalty: 0, body: null, amulets: 0 });
  74 |   expect(await amulet()).toBeNull();
  75 |   await expect.poll(async () => (await player()).state, { timeout: 20_000 }).toBe('idle');
  76 |   expect(await player()).toMatchObject({ ghost: false, invincible: false, body: null, amulets: 0 });
  77 |   expect((await player()).tags).not.toContain('playerghost');
  78 |   await expect(page.locator('dst-inventory-bar')).not.toHaveCSS('display', 'none');
  79 | 
  80 |   const saved = await saveGame();
  81 |   expect(saved.players.local.ghost).toBeFalsy();
  82 |   expect(JSON.stringify(saved)).not.toContain('"itemId":"amulet"');
  83 |   expect(errors).toEqual([]);
  84 | });
  85 | 
```
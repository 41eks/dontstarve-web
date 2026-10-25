# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: nightsword-sanity.spec.ts >> equipping a nightsword updates the sanity HUD, persists through reload and stops draining when dragged out
- Location: tests/nightsword-sanity.spec.ts:8:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "nightsword"
Received: "goldenpickaxe"
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
      - generic "精神值 99":
        - status: "99"
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
      - button "暗夜剑，数量 1，耐久 100%" [ref=e44] [cursor=pointer]:
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
  - status
  - status "帧率": FPS 7
```

# Test source

```ts
  1  | import { readSaveDownload } from './save-download';
  2  | import { fileURLToPath } from 'node:url';
  3  | import { expect, test } from '@playwright/test';
  4  | 
  5  | const modules = Object.fromEntries(['main', 'playerStats'].map(name =>
  6  |   [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));
  7  | 
  8  | test('equipping a nightsword updates the sanity HUD, persists through reload and stops draining when dragged out', async ({ page }) => {
  9  |   test.setTimeout(150_000);
  10 |   const errors: string[] = [];
  11 |   page.on('pageerror', error => errors.push(error.message));
  12 |   page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  13 |   const prepare = () => page.evaluate(async paths => {
  14 |     const main = await import(paths.main), { playerStats } = await import(paths.playerStats);
  15 |     (window as any).nightswordGame = { main, playerStats };
  16 |   }, modules);
  17 |   await page.goto('/tests/dst-lighting.html'); await prepare();
  18 |   await page.evaluate(() => {
  19 |     const { main, playerStats } = (window as any).nightswordGame;
  20 |     main.inventory.applySlotChanges(main.inventory.exportState().slots.filter((slot: any) => slot.item)
  21 |       .map((slot: any) => ({ slot: slot.address, ...slot.item, delta: -slot.item.count })));
  22 |     playerStats.sanity.set(100);
  23 |     document.querySelector('dst-debug-console')!.dispatchEvent(new CustomEvent('game:debug-command', {
  24 |       detail: { command: 'c_give("nightsword")' },
  25 |     }));
  26 |   });
  27 |   const bar = page.locator('dst-inventory-bar'), hand = bar.locator('[data-slot-key="hand"]');
  28 |   const items = bar.locator('.inventory-bar__items');
  29 |   await items.locator('[data-item-id="nightsword"]').dragTo(hand);
  30 |   await expect(hand).toHaveAttribute('data-item-id', 'nightsword');
  31 |   const meter = page.locator('dst-status-hud .survival-meter--sanity output');
  32 |   await expect.poll(async () => Number(await meter.textContent()), { timeout: 15_000 }).toBeLessThan(100);
  33 | 
  34 |   const download = page.waitForEvent('download');
  35 |   await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(
  36 |     new CustomEvent('game:debug-command', { detail: { command: 'c_save()' } })));
  37 |   const saved = JSON.parse(await readSaveDownload((await (await download).path())!));
  38 |   expect(saved.players.local.inventory.containers['player:equipment'].slots.find((slot: any) => slot.slotKey === 'hand')
> 39 |     .item.itemId).toBe('nightsword');
     |                   ^ Error: expect(received).toBe(expected) // Object.is equality
  40 |   await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  41 |   await page.reload(); await prepare();
  42 |   await expect(hand).toHaveAttribute('data-item-id', 'nightsword');
  43 |   await expect.poll(() => page.evaluate(() => (window as any).nightswordGame.playerStats.sanity.peek()))
  44 |     .toBeLessThan(saved.players.local.stats.sanity);
  45 |   await hand.dragTo(items.locator('[data-item-id=""]').first());
  46 |   await expect(hand).toHaveAttribute('data-item-id', '');
  47 |   const unequipped = await page.evaluate(() => (window as any).nightswordGame.playerStats.sanity.peek());
  48 |   // Observe active gameplay frames after the actual inventory drag finished.
  49 |   await page.evaluate(() => new Promise<void>(resolve => {
  50 |     let frames = 0;
  51 |     const advance = () => { if (++frames === 30) resolve(); else requestAnimationFrame(advance); };
  52 |     requestAnimationFrame(advance);
  53 |   }));
  54 |   expect(await page.evaluate(() => (window as any).nightswordGame.playerStats.sanity.peek())).toBe(unequipped);
  55 |   await expect(meter).toHaveText(String(Math.round(unequipped)));
  56 |   expect(errors).toEqual([]);
  57 | });
  58 | 
```
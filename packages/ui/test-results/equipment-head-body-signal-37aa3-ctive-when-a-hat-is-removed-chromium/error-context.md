# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: equipment.spec.ts >> head/body signals restore equipped art and keep the backpack active when a hat is removed
- Location: tests/equipment.spec.ts:8:1

# Error details

```
TypeError: Cannot read properties of undefined (reading 'item')
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - region "背包" [ref=e3]:
    - group "背包物品" [ref=e4]:
      - button "背包 1" [ref=e5] [cursor=pointer]
      - button "背包 2" [ref=e6] [cursor=pointer]
      - button "背包 3" [ref=e7] [cursor=pointer]
      - button "背包 4" [ref=e8] [cursor=pointer]
      - button "背包 5" [ref=e9] [cursor=pointer]
      - button "背包 6" [ref=e10] [cursor=pointer]
      - button "背包 7" [ref=e11] [cursor=pointer]
      - button "背包 8" [ref=e12] [cursor=pointer]
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
        - button "物品栏 1" [ref=e36] [cursor=pointer]
        - button "物品栏 2" [ref=e37] [cursor=pointer]
        - button "物品栏 3" [ref=e38] [cursor=pointer]
        - button "物品栏 4" [ref=e39] [cursor=pointer]
        - button "物品栏 5" [ref=e40] [cursor=pointer]
      - generic [ref=e41]:
        - button "物品栏 6" [ref=e42] [cursor=pointer]
        - button "物品栏 7" [ref=e43] [cursor=pointer]
        - button "物品栏 8" [ref=e44] [cursor=pointer]
        - button "物品栏 9" [ref=e45] [cursor=pointer]
        - button "物品栏 10" [ref=e46] [cursor=pointer]
      - generic [ref=e47]:
        - button "物品栏 11" [ref=e48] [cursor=pointer]
        - button "物品栏 12" [ref=e49] [cursor=pointer]
        - button "物品栏 13" [ref=e50] [cursor=pointer]
        - button "物品栏 14" [ref=e51] [cursor=pointer]
        - button "物品栏 15" [ref=e52] [cursor=pointer]
    - group "装备" [ref=e53]:
      - button "手部装备" [ref=e54] [cursor=pointer]
      - button "背包，数量 1" [ref=e55] [cursor=pointer]
      - button "草帽，数量 1" [ref=e56] [cursor=pointer]
    - button "查看角色" [ref=e57] [cursor=pointer]
  - region "地图控制" [ref=e58]:
    - button "打开地图" [ref=e59] [cursor=pointer]
    - generic [ref=e60]:
      - button "向左旋转视角" [ref=e61] [cursor=pointer]
      - button "暂停游戏" [ref=e62] [cursor=pointer]
      - button "向右旋转视角" [ref=e63] [cursor=pointer]
  - status
  - status "帧率": FPS 2
```

# Test source

```ts
  1  | import { readSaveDownload } from './save-download';
  2  | import { fileURLToPath } from 'node:url';
  3  | import { expect, test } from '@playwright/test';
  4  | 
  5  | const modules = Object.fromEntries(['main', 'player'].map(name =>
  6  |   [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));
  7  | 
  8  | test('head/body signals restore equipped art and keep the backpack active when a hat is removed', async ({ page }) => {
  9  |   test.setTimeout(150_000);
  10 |   const errors: string[] = [];
  11 |   page.on('pageerror', error => errors.push(error.message));
  12 |   page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  13 |   const prepare = () => page.evaluate(async paths => {
  14 |     const main = await import(paths.main), { player } = await import(paths.player);
  15 |     (window as any).equipmentGame = { main, player };
  16 |   }, modules);
  17 |   await page.goto('/tests/dst-lighting.html');
  18 |   await prepare();
  19 |   await page.evaluate(() => {
  20 |     const { main } = (window as any).equipmentGame;
  21 |     main.inventory.applySlotChanges(main.inventory.exportState().slots.filter((slot: any) => slot.item)
  22 |       .map((slot: any) => ({ slot: slot.address, ...slot.item, delta: -slot.item.count })));
  23 |     for (const command of ['c_give("strawhat")', 'c_give("backpack")']) {
  24 |       document.querySelector('dst-debug-console')!.dispatchEvent(new CustomEvent('game:debug-command', { detail: { command } }));
  25 |     }
  26 |   });
  27 |   const bar = page.locator('dst-inventory-bar');
  28 |   const head = bar.locator('[data-slot-key="head"]'), body = bar.locator('[data-slot-key="body"]');
  29 |   const items = bar.locator('.inventory-bar__items');
  30 |   await items.locator('[data-item-id="strawhat"]').dragTo(head);
  31 |   await items.locator('[data-item-id="backpack"]').dragTo(body);
  32 |   const hatArt = () => page.evaluate(() => {
  33 |     const mesh = (window as any).equipmentGame.player.getObjectByProperty('isMesh', true);
  34 |     return mesh.geometry.groups.some((group: any) => mesh.material[group.materialIndex]?.name.startsWith('hat:'));
  35 |   });
  36 |   await expect.poll(hatArt).toBe(true);
  37 |   await expect(page.locator('dst-backpack-panel .inventory-slot')).toHaveCount(8);
  38 | 
  39 |   const download = page.waitForEvent('download');
  40 |   await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(
  41 |     new CustomEvent('game:debug-command', { detail: { command: 'c_save()' } })));
  42 |   const save = JSON.parse(await readSaveDownload((await (await download).path())!));
  43 |   const savedEquipment = save.players.local.inventory.containers['player:equipment'].slots;
> 44 |   expect(savedEquipment.find((slot: any) => slot.slotKey === 'head').item.itemId).toBe('strawhat');
     |                                                                     ^ TypeError: Cannot read properties of undefined (reading 'item')
  45 |   expect(savedEquipment.find((slot: any) => slot.slotKey === 'body').item.itemId).toBe('backpack');
  46 |   await page.route('**/saves/initial-world.json', route => route.fulfill({ json: save }));
  47 |   await page.reload(); await prepare();
  48 |   await expect(head).toHaveAttribute('data-item-id', 'strawhat');
  49 |   await expect(body).toHaveAttribute('data-item-id', 'backpack');
  50 |   await expect.poll(hatArt).toBe(true);
  51 |   await expect(page.locator('dst-backpack-panel .chest-panel')).toBeVisible();
  52 |   await head.dragTo(items.locator('[data-item-id=""]').first());
  53 |   await expect(head).toHaveAttribute('data-item-id', '');
  54 |   await expect.poll(hatArt).toBe(false);
  55 |   await expect(page.locator('dst-backpack-panel .chest-panel')).toBeVisible();
  56 |   expect(await page.evaluate(() => {
  57 |     const { main } = (window as any).equipmentGame;
  58 |     return { head: main.headEquipment.peek(), body: main.bodyEquipment.peek()?.itemId,
  59 |       hat: main.inventory.materialSummary().strawhat };
  60 |   })).toEqual({ head: null, body: 'backpack', hat: 1 });
  61 |   expect(errors).toEqual([]);
  62 | });
  63 | 
```
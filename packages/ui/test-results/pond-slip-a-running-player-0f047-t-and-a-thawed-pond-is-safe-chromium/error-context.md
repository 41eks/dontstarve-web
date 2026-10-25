# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: pond-slip.spec.ts >> a running player slips on a frozen pond, slides along the heading, falls on held input and a thawed pond is safe
- Location: tests/pond-slip.spec.ts:8:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

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
  1  | import { fileURLToPath } from 'node:url';
  2  | import { readFile } from 'node:fs/promises';
  3  | import { expect, test } from '@playwright/test';
  4  | 
  5  | const urls = Object.fromEntries(['main', 'universal', 'camera', 'player', 'scene'].map(name =>
  6  |   [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));
  7  | 
  8  | test('a running player slips on a frozen pond, slides along the heading, falls on held input and a thawed pond is safe', async ({ page }) => {
  9  |   test.setTimeout(150_000);
  10 |   const errors: string[] = [];
  11 |   page.on('pageerror', error => errors.push(error.message));
  12 |   page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  13 |   await page.route('**/saves/initial-world.json', async route => {
  14 |     const response = await route.fetch(), save = await response.json();
  15 |     save.world.entities = {}; save.world.elapsedSeconds = 420;
  16 |     save.world.systems.weather = { ...save.world.systems.weather, snowlevel: .5, preciptype: 'none', moisture: 0 };
  17 |     save.players.local.transform.position = [0, 0, 0];
  18 |     for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
  19 |     save.players.local.inventory.bufferedBuilds = [];
  20 |     await route.fulfill({ response, json: save });
  21 |   });
  22 |   await page.goto('/tests/dst-lighting.html');
  23 |   await page.evaluate(async urls => {
  24 |     await import(urls.main);
  25 |     const { scene } = await import(urls.universal), { player, playerBody } = await import(urls.player), { camera } = await import(urls.camera);
  26 |     (window as any).slipGame = { scene, player, playerBody, camera };
  27 |   }, urls);
  28 |   const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
  29 |     new CustomEvent('game:debug-command', { detail: { command } })), command);
  30 |   const state = () => page.evaluate(() => {
  31 |     const { scene, player, playerBody } = (window as any).slipGame;
  32 |     const pond = scene.children.find((model: any) => model.userData.instance?.prefab === 'pond');
  33 |     return { sg: player.userData.stategraph.stateName as string, x: player.position.x as number, z: player.position.z as number,
  34 |       speed: Math.hypot(playerBody.velocity.x, playerBody.velocity.z) as number,
  35 |       frozen: pond?.userData.frozen as boolean | undefined, slippery: pond?.userData.actionEntity?.hasTag('slipperyfeettarget') as boolean | undefined };
  36 |   });
  37 |   const movePlayer = (x: number, z: number) => page.evaluate(({ x, z }) => {
  38 |     const { player, playerBody } = (window as any).slipGame;
  39 |     playerBody.position.set(x, playerBody.shapes[0].radius, z); playerBody.velocity.set(0, 0, 0); player.position.set(x, 0, z);
  40 |   }, { x, z });
  41 | 
  42 |   await submit('c_spawn("pond")');
> 43 |   await expect.poll(async () => (await state()).frozen).toBe(true);
     |                                                         ^ Error: expect(received).toBe(expected) // Object.is equality
  44 |   expect((await state()).slippery).toBe(true);
  45 |   // KeyD walks along the camera's right vector: start on the far side of the pond so the path crosses its centre.
  46 |   const right = await page.evaluate(() => {
  47 |     const { camera } = (window as any).slipGame, forward = camera.getWorldDirection(camera.position.clone());
  48 |     forward.y = 0; forward.normalize();
  49 |     return [-forward.z, forward.x];
  50 |   });
  51 |   await movePlayer(-right[0] * 9, -right[1] * 9);
  52 |   await page.keyboard.down('KeyD');
  53 |   const seen = new Set<string>();
  54 |   await expect.poll(async () => { const s = await state(); seen.add(s.sg); return s.sg; }, { timeout: 30_000, intervals: [50] }).toBe('slip');
  55 |   await page.keyboard.up('KeyD');
  56 |   const sliding = await state();
  57 |   expect(sliding.speed).toBeGreaterThan(0);
  58 |   // Releasing the key does not stop the slide: the state keeps the motor along the old heading.
  59 |   await page.waitForTimeout(300);
  60 |   const later = await state();
  61 |   expect(Math.hypot(later.x - sliding.x, later.z - sliding.z)).toBeGreaterThan(.05);
  62 |   await expect.poll(async () => (await state()).sg, { timeout: 15_000 }).not.toMatch(/^slip/);
  63 |   expect(seen.has('slip')).toBe(true);
  64 |   await expect.poll(async () => (await state()).speed).toBeLessThan(.01);
  65 |   expect(errors).toEqual([]);
  66 | });
  67 | 
```
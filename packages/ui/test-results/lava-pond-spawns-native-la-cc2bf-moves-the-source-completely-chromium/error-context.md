# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: lava-pond.spec.ts >> spawns native lava and independent scorched rocks, restores their layout and heat source, and removes the source completely
- Location: tests/lava-pond.spec.ts:9:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
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
  - status "帧率": FPS 8
```

# Test source

```ts
  1   | import { readSaveDownload } from './save-download';
  2   | import { fileURLToPath } from 'node:url';
  3   | import { expect, test } from '@playwright/test';
  4   | 
  5   | const urls = Object.fromEntries(['main', 'universal', 'camera', 'player', 'scene'].map(name =>
  6   |   [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));
  7   | const queryUrl = `/@fs${fileURLToPath(new URL('../../prefab/src/actionEntity.ts', import.meta.url))}`;
  8   | 
  9   | test('spawns native lava and independent scorched rocks, restores their layout and heat source, and removes the source completely', async ({ page }) => {
  10  |   test.setTimeout(150_000);
  11  |   const errors: string[] = [];
  12  |   page.on('pageerror', error => errors.push(error.message));
  13  |   page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  14  |   await page.route('**/saves/initial-world.json', async route => {
  15  |     const response = await route.fetch(), save = await response.json();
  16  |     save.world.entities = {}; save.world.elapsedSeconds = 420;
  17  |     save.players.local.transform.position = [0, 0, 0];
  18  |     for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
  19  |     save.players.local.inventory.bufferedBuilds = [];
  20  |     await route.fulfill({ response, json: save });
  21  |   });
  22  |   const prepare = () => page.evaluate(async ({ urls, queryUrl }) => {
  23  |     await import(urls.main);
  24  |     const { scene, renderer, dstLighting } = await import(urls.universal), { camera, followCamera } = await import(urls.camera);
  25  |     const { player, playerBody } = await import(urls.player), { world } = await import(urls.scene);
  26  |     const { FindEntities } = await import(queryUrl);
  27  |     (window as any).lavaGame = { scene, renderer, dstLighting, camera, followCamera, player, playerBody, world, FindEntities };
  28  |   }, { urls, queryUrl });
  29  |   const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
  30  |     new CustomEvent('game:debug-command', { detail: { command } })), command);
  31  |   const saveGame = async () => {
  32  |     const download = page.waitForEvent('download'); await submit('c_save()');
  33  |     return JSON.parse(await readSaveDownload((await (await download).path())!));
  34  |   };
  35  |   const movePlayer = (x: number, z: number) => page.evaluate(({ x, z }) => {
  36  |     const { player, playerBody } = (window as any).lavaGame;
  37  |     playerBody.position.set(x, playerBody.shapes[0].radius, z); playerBody.velocity.set(0, 0, 0); player.position.set(x, 0, z);
  38  |   }, { x, z });
  39  |   const state = () => page.evaluate(() => {
  40  |     const { scene, camera, dstLighting, world, FindEntities } = (window as any).lavaGame;
  41  |     const model = scene.children.find((model: any) => model.userData.instance?.prefab === 'lava_pond');
  42  |     if (!model) return null;
  43  |     // A display root holds the drawn sprite (art group, then mesh) beside the child rocks.
  44  |     const controller = model.userData.lavaPond, drawn = model.children[0], mesh = drawn.children[0].children[0];
  45  |     const childRocks = controller.children.map((rock: any) => ({
  46  |       prefab: rock.userData.instance?.prefab, foot: rock.getWorldPosition(model.position.clone()).toArray(),
  47  |       order: rock.children[0].children[0].renderOrder,
  48  |       cameraDepth: rock.getWorldPosition(model.position.clone()).applyMatrix4(camera.matrixWorldInverse).z,
  49  |       vertices: rock.children[0].children[0].children[0].geometry.drawRange.count,
  50  |       build: rock.children[0].userData.animationController.build.name,
  51  |     }));
  52  |     const heaters = FindEntities(model.position, 30, ['HASHEATER'], ['INLIMBO']);
  53  |     const withoutPool = dstLighting.sampleLightLevel(model.position, model);
  54  |     return { id: model.userData.instance?.entityId, position: model.position.toArray(), clip: model.userData.animationController.currentAnimation,
  55  |       vertices: mesh.geometry.drawRange.count, frameVersion: mesh.geometry.getAttribute('uv').version, build: drawn.userData.animationController.build.name,
  56  |       flat: drawn.children[0].rotation.x, poolOrder: mesh.renderOrder, childRocks,
  57  |       heat: heaters.find((inst: any) => inst.model === model)?.components.heater?.GetHeat(),
  58  |       bodyRegistered: world.bodies.includes(model.userData.instance.physicsBody),
  59  |       light: dstLighting.sampleLightLevel(model.position), withoutPool };
  60  |   });
  61  | 
  62  |   await page.goto('/tests/dst-lighting.html'); await prepare();
  63  |   await submit('c_spawn("lava_pond")');
  64  |   await expect.poll(async () => (await state())?.childRocks.length).toBeGreaterThanOrEqual(2);
  65  |   await movePlayer(16, -10); await submit('c_spawn("lava_pond_rock")');
  66  |   await movePlayer(22, -10); await submit('c_spawn("lava_pond_rock6")');
  67  |   await expect.poll(() => page.evaluate(() => (window as any).lavaGame.scene.children
  68  |     .filter((model: any) => model.userData.instance?.prefab?.startsWith('lava_pond_rock')).length)).toBe(2);
  69  |   await movePlayer(18, 18);
  70  |   const initial = (await state())!;
  71  |   expect(initial.clip).toBe('bubble_lava'); expect(initial.vertices).toBeGreaterThan(0);
  72  |   expect(initial.build).toBe('lava_tile'); expect(initial.flat).toBeCloseTo(-Math.PI / 2);
> 73  |   expect(initial.poolOrder).toBeLessThan(0); expect(initial.bodyRegistered).toBe(true); expect(initial.heat).toBe(500);
      |                                                                             ^ Error: expect(received).toBe(expected) // Object.is equality
  74  |   expect(initial.light).toBeGreaterThan(initial.withoutPool);
  75  |   await expect.poll(async () => (await state())?.frameVersion).toBeGreaterThan(initial.frameVersion);
  76  |   const sorted = (await state())!.childRocks.sort((a: any, b: any) => a.cameraDepth - b.cameraDepth);
  77  |   expect(sorted.every((rock: any) => rock.vertices > 0 && rock.build === 'scorched_rock')).toBe(true);
  78  |   for (let i = 1; i < sorted.length; i++) expect(sorted[i].order).toBeGreaterThan(sorted[i - 1].order);
  79  |   // Focus the visual review on the pool after checking the normal player camera's sorting.
  80  |   await page.evaluate(() => {
  81  |     const { scene, followCamera } = (window as any).lavaGame;
  82  |     followCamera.setTarget(scene.children.find((model: any) => model.userData.instance?.prefab === 'lava_pond')); followCamera.snap();
  83  |   });
  84  |   await page.screenshot({ path: '/tmp/lava-pond.png' });
  85  |   await page.evaluate(() => { const { followCamera, player } = (window as any).lavaGame; followCamera.setTarget(player); followCamera.snap(); });
  86  | 
  87  |   const saved = await saveGame();
  88  |   expect(saved.world.entities.lava_pond).toHaveLength(1);
  89  |   const savedPool = saved.world.entities.lava_pond[0];
  90  |   expect(savedPool.id).toBe(initial.id); expect(savedPool.transform.position).toEqual(initial.position);
  91  |   expect(savedPool.components.lavaPond.rocks).toHaveLength(initial.childRocks.length);
  92  |   expect(Object.keys(savedPool.components)).toEqual(['lavaPond']);
  93  |   const baseRock = saved.world.entities.lava_pond_rock[0], numberedRock = saved.world.entities.lava_pond_rock6[0];
  94  |   expect(baseRock.transform.position).toEqual([16, 0, -10]); expect(numberedRock.transform.position).toEqual([22, 0, -10]);
  95  |   await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  96  |   await page.reload(); await prepare();
  97  |   await expect.poll(async () => (await state())?.childRocks.length).toBe(initial.childRocks.length);
  98  |   const restored = await state();
  99  |   expect(restored!.id).toBe(initial.id); expect(restored!.heat).toBe(500);
  100 |   expect(restored!.childRocks.map((rock: any) => [rock.prefab, rock.foot])).toEqual(initial.childRocks.map(rock => [rock.prefab, rock.foot]));
  101 |   const reSaved = await saveGame();
  102 |   expect(reSaved.world.entities.lava_pond).toEqual(saved.world.entities.lava_pond);
  103 |   expect(reSaved.world.entities.lava_pond_rock).toEqual([baseRock]);
  104 |   expect(reSaved.world.entities.lava_pond_rock6).toEqual([numberedRock]);
  105 | 
  106 |   expect(await page.evaluate(() => {
  107 |     const { scene, world, FindEntities, dstLighting } = (window as any).lavaGame;
  108 |     const model = scene.children.find((model: any) => model.userData.instance?.prefab === 'lava_pond');
  109 |     const body = model.userData.instance.physicsBody, position = model.position.clone();
  110 |     const blocked = world.bodies.includes(body);
  111 |     model.userData.remove();
  112 |     return { blocked, heaters: FindEntities(position, 30, ['HASHEATER']).length,
  113 |       body: world.bodies.includes(body), children: model.userData.lavaPond.children.length,
  114 |       localLight: dstLighting.sampleLightLevel(position) };
  115 |   })).toMatchObject({ blocked: true, heaters: 0, body: false, children: 0 });
  116 |   const removed = await saveGame();
  117 |   expect(removed.world.entities.lava_pond).toEqual([]);
  118 |   expect(removed.world.entities.lava_pond_rock).toEqual([baseRock]);
  119 |   expect(removed.world.entities.lava_pond_rock6).toEqual([numberedRock]);
  120 |   expect(errors).toEqual([]);
  121 | });
  122 | 
```
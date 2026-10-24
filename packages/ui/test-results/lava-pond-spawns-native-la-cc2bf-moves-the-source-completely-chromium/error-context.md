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
      - generic "精神值 200":
        - status: "200"
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
  - status "帧率": FPS 7
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
  41  |     const model = scene.children.find((model: any) => model.userData.prefab === 'lava_pond');
  42  |     if (!model) return null;
  43  |     const controller = model.userData.lavaPond, mesh = model.children[0].children[0];
  44  |     const childRocks = controller.children.map((rock: any) => ({
  45  |       prefab: rock.userData.prefab, foot: rock.getWorldPosition(model.position.clone()).toArray(),
  46  |       order: rock.children[0].renderOrder,
  47  |       cameraDepth: rock.getWorldPosition(model.position.clone()).applyMatrix4(camera.matrixWorldInverse).z,
  48  |       vertices: rock.children[0].children[0].geometry.drawRange.count,
  49  |       build: rock.userData.animationController.build.name,
  50  |     }));
  51  |     const heaters = FindEntities(scene, model.position, 30, ['HASHEATER'], ['INLIMBO']);
  52  |     const withoutPool = dstLighting.sampleLightLevel(model.position, model);
  53  |     return { id: model.userData.entityId, position: model.position.toArray(), clip: model.userData.animationController.currentAnimation,
  54  |       vertices: mesh.geometry.drawRange.count, frameVersion: mesh.geometry.getAttribute('uv').version, build: model.userData.animationController.build.name,
  55  |       flat: model.children[0].rotation.x, poolOrder: mesh.renderOrder, childRocks,
  56  |       heat: heaters.find((inst: any) => inst.model === model)?.components.heater?.GetHeat(),
  57  |       bodyRegistered: world.bodies.includes(controller.body),
  58  |       light: dstLighting.sampleLightLevel(model.position), withoutPool };
  59  |   });
  60  | 
  61  |   await page.goto('/tests/dst-lighting.html'); await prepare();
  62  |   await submit('c_spawn("lava_pond")');
  63  |   await expect.poll(async () => (await state())?.childRocks.length).toBeGreaterThanOrEqual(2);
  64  |   await movePlayer(16, -10); await submit('c_spawn("lava_pond_rock")');
  65  |   await movePlayer(22, -10); await submit('c_spawn("lava_pond_rock6")');
  66  |   await expect.poll(() => page.evaluate(() => (window as any).lavaGame.scene.children
  67  |     .filter((model: any) => model.userData.prefab?.startsWith('lava_pond_rock')).length)).toBe(2);
  68  |   await movePlayer(18, 18);
  69  |   const initial = (await state())!;
  70  |   expect(initial.clip).toBe('bubble_lava'); expect(initial.vertices).toBeGreaterThan(0);
  71  |   expect(initial.build).toBe('lava_tile'); expect(initial.flat).toBeCloseTo(-Math.PI / 2);
> 72  |   expect(initial.poolOrder).toBeLessThan(0); expect(initial.bodyRegistered).toBe(true); expect(initial.heat).toBe(500);
      |                                                                             ^ Error: expect(received).toBe(expected) // Object.is equality
  73  |   expect(initial.light).toBeGreaterThan(initial.withoutPool);
  74  |   await expect.poll(async () => (await state())?.frameVersion).toBeGreaterThan(initial.frameVersion);
  75  |   const sorted = (await state())!.childRocks.sort((a: any, b: any) => a.cameraDepth - b.cameraDepth);
  76  |   expect(sorted.every((rock: any) => rock.vertices > 0 && rock.build === 'scorched_rock')).toBe(true);
  77  |   for (let i = 1; i < sorted.length; i++) expect(sorted[i].order).toBeGreaterThan(sorted[i - 1].order);
  78  |   // Focus the visual review on the pool after checking the normal player camera's sorting.
  79  |   await page.evaluate(() => {
  80  |     const { scene, followCamera } = (window as any).lavaGame;
  81  |     followCamera.setTarget(scene.children.find((model: any) => model.userData.prefab === 'lava_pond')); followCamera.snap();
  82  |   });
  83  |   await page.screenshot({ path: '/tmp/lava-pond.png' });
  84  |   await page.evaluate(() => { const { followCamera, player } = (window as any).lavaGame; followCamera.setTarget(player); followCamera.snap(); });
  85  | 
  86  |   const saved = await saveGame();
  87  |   expect(saved.world.entities.lava_pond).toHaveLength(1);
  88  |   const savedPool = saved.world.entities.lava_pond[0];
  89  |   expect(savedPool.id).toBe(initial.id); expect(savedPool.transform.position).toEqual(initial.position);
  90  |   expect(savedPool.components.lavaPond.rocks).toHaveLength(initial.childRocks.length);
  91  |   expect(Object.keys(savedPool.components)).toEqual(['lavaPond']);
  92  |   const baseRock = saved.world.entities.lava_pond_rock[0], numberedRock = saved.world.entities.lava_pond_rock6[0];
  93  |   expect(baseRock.transform.position).toEqual([16, 0, -10]); expect(numberedRock.transform.position).toEqual([22, 0, -10]);
  94  |   await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  95  |   await page.reload(); await prepare();
  96  |   await expect.poll(async () => (await state())?.childRocks.length).toBe(initial.childRocks.length);
  97  |   const restored = await state();
  98  |   expect(restored!.id).toBe(initial.id); expect(restored!.heat).toBe(500);
  99  |   expect(restored!.childRocks.map((rock: any) => [rock.prefab, rock.foot])).toEqual(initial.childRocks.map(rock => [rock.prefab, rock.foot]));
  100 |   const reSaved = await saveGame();
  101 |   expect(reSaved.world.entities.lava_pond).toEqual(saved.world.entities.lava_pond);
  102 |   expect(reSaved.world.entities.lava_pond_rock).toEqual([baseRock]);
  103 |   expect(reSaved.world.entities.lava_pond_rock6).toEqual([numberedRock]);
  104 | 
  105 |   expect(await page.evaluate(() => {
  106 |     const { scene, world, FindEntities, dstLighting } = (window as any).lavaGame;
  107 |     const model = scene.children.find((model: any) => model.userData.prefab === 'lava_pond');
  108 |     const body = model.userData.physicsBody, position = model.position.clone();
  109 |     model.userData.remove();
  110 |     return { heaters: FindEntities(scene, position, 30, ['HASHEATER']).length,
  111 |       body: world.bodies.includes(body), children: model.userData.lavaPond.children.length,
  112 |       localLight: dstLighting.sampleLightLevel(position) };
  113 |   })).toMatchObject({ heaters: 0, body: false, children: 0 });
  114 |   const removed = await saveGame();
  115 |   expect(removed.world.entities.lava_pond).toEqual([]);
  116 |   expect(removed.world.entities.lava_pond_rock).toEqual([baseRock]);
  117 |   expect(removed.world.entities.lava_pond_rock6).toEqual([numberedRock]);
  118 |   expect(errors).toEqual([]);
  119 | });
  120 | 
```
# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: cave-terrain.spec.ts >> loads whitelisted cave entities, stops keyboard movement at the void and reloads an exported cave
- Location: tests/cave-terrain.spec.ts:9:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 4
+ Received  + 4

  Array [
-   "dst_04E26ADB66396E8D_pighead_index_000001",
-   "dst_04E26ADB66396E8D_archive_moon_statue_id_110743",
-   "dst_04E26ADB66396E8D_rock1_index_000001",
-   "dst_04E26ADB66396E8D_cavein_boulder_id_104106",
+   undefined,
+   undefined,
+   undefined,
+   undefined,
  ]
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
      - button "黄金鹤嘴锄，数量 1，耐久 95%" [ref=e44] [cursor=pointer]:
        - generic [aria-hidden]: 95%
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
  3   | import { readFile } from 'node:fs/promises';
  4   | import { expect, test } from '@playwright/test';
  5   | 
  6   | const urls = Object.fromEntries(['main', 'universal', 'camera', 'player', 'scene', 'building'].map(name =>
  7   |   [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));
  8   | 
  9   | test('loads whitelisted cave entities, stops keyboard movement at the void and reloads an exported cave', async ({ page }) => {
  10  |   test.setTimeout(150_000);
  11  |   const errors: string[] = [];
  12  |   const imported = JSON.parse(await readFile(new URL('../../../public/saves/Cluster_1/Caves.json', import.meta.url), 'utf8'));
  13  |   page.on('pageerror', error => errors.push(error.message));
  14  |   const prepare = () => page.evaluate(async urls => {
  15  |     await import(urls.main);
  16  |     const modules = Object.fromEntries(await Promise.all(Object.entries(urls).filter(([name]) => name !== 'main')
  17  |       .map(async ([name, url]) => [name, await import(url)])));
  18  |     (window as any).caveGame = modules;
  19  |   }, urls);
  20  |   await page.goto('/tests/dst-lighting.html?save=Cluster_1/Caves.json');
  21  |   await prepare();
  22  |   await expect(page.locator('canvas[data-game-canvas]')).toHaveAttribute('data-loaded', 'true');
  23  |   // Sample buildings, archive props and instanced rocks (including split animation/build archives).
  24  |   const samples = ['pighead', 'archive_moon_statue', 'rock1', 'cavein_boulder'].map(prefab => imported.world.entities[prefab][0]);
  25  |   const rendered = await page.evaluate(samples => {
  26  |     const { universal: { scene } } = (window as any).caveGame;
  27  |     return samples.map((record: any) => {
  28  |       const model = scene.children.find((child: any) => child.userData.instance?.entityId === record.id);
  29  |       let vertices = 0;
  30  |       model?.traverse((child: any) => { vertices += child.geometry?.getAttribute('position')?.count ?? 0; });
  31  |       return { id: model?.userData.instance?.entityId, vertices };
  32  |     });
  33  |   }, samples);
> 34  |   expect(rendered.map(record => record.id)).toEqual(samples.map(record => record.id));
      |                                             ^ Error: expect(received).toEqual(expected) // deep equality
  35  |   expect(rendered.every(record => record.vertices > 0)).toBe(true);
  36  |   await page.evaluate(heads => {
  37  |     const { camera: { followCamera }, player: { player, playerBody } } = (window as any).caveGame;
  38  |     const cx = heads.reduce((sum: number, record: any) => sum + record.transform.position[0], 0) / heads.length;
  39  |     const cz = heads.reduce((sum: number, record: any) => sum + record.transform.position[2], 0) / heads.length;
  40  |     player.position.set(cx + 18, 0, cz + 18);
  41  |     playerBody.position.set(player.position.x, playerBody.shapes[0].radius, player.position.z);
  42  |     playerBody.velocity.setZero();
  43  |     followCamera.snap();
  44  |   }, imported.world.entities.pighead.slice(-4));
  45  |   await page.screenshot({ path: '/tmp/dst-cave-pighead-alignment.png' });
  46  |   const boundary = await page.evaluate(() => {
  47  |     const { building: { turfMap, ground }, universal: { scene }, camera: { followCamera }, player: { player, playerBody } } = (window as any).caveGame;
  48  |     // Set a cardinal camera so W is an actual negative-X movement request.
  49  |     followCamera.setHeadingTarget(0);
  50  |     const cell = turfMap.exportTiles().find((tile: any) => tile.tileId === 14 && turfMap.isVoidAtCell(tile.col - 1, tile.row));
  51  |     const edge = cell.col * 12, radius = playerBody.shapes[0].radius;
  52  |     player.position.set(edge + radius + .2, 0, (cell.row + .5) * 12);
  53  |     playerBody.position.set(player.position.x, radius, player.position.z);
  54  |     playerBody.velocity.setZero();
  55  |     followCamera.snap();
  56  |     return { edge, start: player.position.x, groundVisible: ground.material.visible, background: scene.background.getHex() };
  57  |   });
  58  |   expect(boundary.groundVisible).toBe(false);
  59  |   expect(boundary.background).toBe(0);
  60  |   // falloffdefs.lua: land cells hang a cliff on every side bordering void, whatever the camera heading.
  61  |   const falloff = await page.evaluate(() => {
  62  |     const { universal: { scene } } = (window as any).caveGame;
  63  |     const mesh = scene.getObjectByName('TurfFalloff');
  64  |     return { vertices: mesh.geometry.getAttribute('position').count, visible: mesh.visible };
  65  |   });
  66  |   expect(falloff.vertices).toBeGreaterThan(0);
  67  |   expect(falloff.visible).toBe(true);
  68  |   await page.keyboard.down('KeyW');
  69  |   await page.waitForTimeout(500);
  70  |   await page.keyboard.up('KeyW');
  71  |   const position = await page.evaluate(() => {
  72  |     const { player: { player }, building: { turfMap } } = (window as any).caveGame;
  73  |     return { x: player.position.x, passable: turfMap.isPassableAtPoint(player.position) };
  74  |   });
  75  |   expect(position.passable).toBe(true);
  76  |   expect(position.x).toBeGreaterThan(boundary.edge);
  77  |   expect(position.x).toBeLessThanOrEqual(boundary.start + .01);
  78  |   await page.keyboard.press('KeyM');
  79  |   await expect(page.locator('dst-minimap .minimap__viewport')).toBeVisible();
  80  |   await expect(page.locator('dst-minimap canvas')).toHaveCount(0);
  81  |   // Check actual decoded terrain images, not only the visibility of their container.
  82  |   await expect.poll(() => page.locator('dst-minimap').evaluate(async (map: any) => {
  83  |     const { sampleDomTerrain } = await import('./minimap-dom-samples.ts');
  84  |     const [centre] = sampleDomTerrain(map, [{ x: map.view.centerX, z: map.view.centerZ }]);
  85  |     return { ready: (await map.inspect()).ready, painted: centre[3] > 0 };
  86  |   }), { timeout: 60_000 }).toEqual({ ready: true, painted: true });
  87  |   await page.locator('dst-minimap').evaluate((map: any) => map.setView({ zoom: 1 }));
  88  |   const image = page.locator('dst-minimap .minimap__ground');
  89  |   await expect(image).toHaveCount(1);
  90  |   expect(await image.evaluate((image: HTMLImageElement) => image.naturalWidth * image.naturalHeight * 4)).toBeLessThanOrEqual(256 * 1024 * 1024);
  91  |   await page.keyboard.press('KeyM');
  92  |   const staticIds = ['cavein_boulder', 'rock_moon', 'rock_moon_shell', 'moonrockseed'];
  93  |   for (const prefab of staticIds) {
  94  |     await page.evaluate(prefab => document.querySelector('dst-debug-console')!.dispatchEvent(new CustomEvent('game:debug-command', {
  95  |       detail: { command: `c_spawn("${prefab}")` },
  96  |     })), prefab);
  97  |     await expect.poll(() => page.evaluate(prefab => {
  98  |       const { universal: { scene } } = (window as any).caveGame;
  99  |       return scene.children.filter((child: any) => child.userData.instance?.prefab === prefab).length;
  100 |     }, prefab)).toBe((imported.world.entities[prefab]?.length ?? 0) + 1);
  101 |   }
  102 |   const download = page.waitForEvent('download');
  103 |   await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(new CustomEvent('game:debug-command', {
  104 |     detail: { command: 'c_save()' },
  105 |   })));
  106 |   const saved = JSON.parse(await readSaveDownload((await (await download).path())!));
  107 |   expect(saved.world.prefab).toBe('cave');
  108 |   expect(saved.world.map.defaultTileId).toBe(1);
  109 |   expect(saved.world.map.tiles).toHaveLength(imported.world.map.tiles.length);
  110 |   for (const prefab of ['pighead', 'archive_moon_statue', 'rock1']) {
  111 |     expect(saved.world.entities[prefab]).toEqual(imported.world.entities[prefab]);
  112 |   }
  113 |   expect(saved.world.entities.cavein_boulder.slice(0, imported.world.entities.cavein_boulder.length)).toEqual(imported.world.entities.cavein_boulder);
  114 |   for (const prefab of staticIds) expect(saved.world.entities[prefab]).toHaveLength((imported.world.entities[prefab]?.length ?? 0) + 1);
  115 |   await page.route('**/saves/Cluster_1/Caves.json', route => route.fulfill({ json: saved }));
  116 |   await page.reload();
  117 |   await prepare();
  118 |   await expect(page.locator('canvas[data-game-canvas]')).toHaveAttribute('data-loaded', 'true');
  119 |   const restored = await page.evaluate(() => {
  120 |     const { building: { turfMap, ground }, player: { player } } = (window as any).caveGame;
  121 |     return { tiles: turfMap.exportTiles(), position: player.position.toArray(), groundVisible: ground.material.visible };
  122 |   });
  123 |   expect(restored.tiles).toEqual(saved.world.map.tiles);
  124 |   expect(restored.position[0]).toBeCloseTo(saved.players.local.transform.position[0], 3);
  125 |   expect(restored.position[2]).toBeCloseTo(saved.players.local.transform.position[2], 3);
  126 |   expect(restored.groundVisible).toBe(false);
  127 |   const secondDownload = page.waitForEvent('download');
  128 |   await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(new CustomEvent('game:debug-command', {
  129 |     detail: { command: 'c_save()' },
  130 |   })));
  131 |   const reexported = JSON.parse(await readSaveDownload((await (await secondDownload).path())!));
  132 |   for (const prefab of ['pighead', 'archive_moon_statue', 'rock1', ...staticIds]) {
  133 |     expect(reexported.world.entities[prefab]).toEqual(saved.world.entities[prefab]);
  134 |   }
```
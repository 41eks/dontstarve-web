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

Expected: undefined
Received: []
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
        - button "香蕉奶昔，数量 8" [ref=e26] [cursor=pointer]:
          - generic [aria-hidden]: "8"
        - button "骨头头盔，数量 1" [ref=e27] [cursor=pointer]
        - button "物品栏 3" [ref=e28] [cursor=pointer]
        - button "物品栏 4" [ref=e29] [cursor=pointer]
        - button "物品栏 5" [ref=e30] [cursor=pointer]
      - generic [ref=e31]:
        - button "空瓶子，数量 1" [ref=e32] [cursor=pointer]
        - button "物品栏 7" [ref=e33] [cursor=pointer]
        - button "泰拉棱镜，数量 1" [ref=e34] [cursor=pointer]
        - button "梦魇护符，数量 1" [ref=e35] [cursor=pointer]
        - button "泰拉棱镜，数量 1" [ref=e36] [cursor=pointer]
      - generic [ref=e37]:
        - button "火魔杖，数量 1，耐久 95%" [ref=e38] [cursor=pointer]:
          - generic [aria-hidden]: 95%
        - button "铥矿皇冠，数量 1" [ref=e39] [cursor=pointer]
        - button "噩梦燃料，数量 22" [ref=e40] [cursor=pointer]:
          - generic [aria-hidden]: "22"
        - button "物品栏 14" [ref=e41] [cursor=pointer]
        - button "物品栏 15" [ref=e42] [cursor=pointer]
    - group "装备" [ref=e43]:
      - button "扭曲唤星者魔杖，数量 1，耐久 30%" [ref=e44] [cursor=pointer]:
        - generic [aria-hidden]: 30%
      - button "身体装备" [ref=e45] [cursor=pointer]
      - button "铥矿皇冠，数量 1" [ref=e46] [cursor=pointer]
    - button "查看角色" [ref=e47] [cursor=pointer]
  - region "地图控制" [ref=e48]:
    - button "打开地图" [ref=e49] [cursor=pointer]
    - generic [ref=e50]:
      - button "向左旋转视角" [ref=e51] [cursor=pointer]
      - button "暂停游戏" [ref=e52] [cursor=pointer]
      - button "向右旋转视角" [ref=e53] [cursor=pointer]
  - status
```

# Test source

```ts
  8   | 
  9   | test('loads whitelisted cave entities, stops keyboard movement at the void and reloads an exported cave', async ({ page }) => {
  10  |   test.setTimeout(150_000);
  11  |   const errors: string[] = [];
  12  |   const imported = JSON.parse(await readFile(new URL('../../../public/saves/Cluster_1/Caves.json', import.meta.url), 'utf8'));
  13  |   const sessionPlayer = JSON.parse(await readFile(new URL(`../../../public/saves/Cluster_1/${imported.session.playerFile}`, import.meta.url), 'utf8')).player;
  14  |   page.on('pageerror', error => errors.push(error.message));
  15  |   const prepare = () => page.evaluate(async urls => {
  16  |     await import(urls.main);
  17  |     const modules = Object.fromEntries(await Promise.all(Object.entries(urls).filter(([name]) => name !== 'main')
  18  |       .map(async ([name, url]) => [name, await import(url)])));
  19  |     (window as any).caveGame = modules;
  20  |   }, urls);
  21  |   await page.goto('/tests/dst-lighting.html');
  22  |   await prepare();
  23  |   await expect(page.locator('canvas[data-game-canvas]')).toHaveAttribute('data-loaded', 'true');
  24  |   expect(await page.evaluate(() => {
  25  |     const { player, playerInstance } = (window as any).caveGame.player;
  26  |     return (window as any).__prefabInstance(player) === playerInstance && !Object.hasOwn(player.userData, 'instance');
  27  |   })).toBe(true);
  28  |   const initialPosition = await page.evaluate(() => (window as any).caveGame.player.player.position.toArray());
  29  |   expect(initialPosition[0]).toBeCloseTo(sessionPlayer.transform.position[0], 3);
  30  |   expect(initialPosition[2]).toBeCloseTo(sessionPlayer.transform.position[2], 3);
  31  |   expect(Math.hypot(initialPosition[0] - imported.world.entities.atrium_gate[0].transform.position[0],
  32  |     initialPosition[2] - imported.world.entities.atrium_gate[0].transform.position[2])).toBeLessThan(20);
  33  |   await page.evaluate(heads => {
  34  |     const { camera: { followCamera }, player: { player, playerBody } } = (window as any).caveGame;
  35  |     const cx = heads.reduce((sum: number, record: any) => sum + record.transform.position[0], 0) / heads.length;
  36  |     const cz = heads.reduce((sum: number, record: any) => sum + record.transform.position[2], 0) / heads.length;
  37  |     player.position.set(cx + 18, 0, cz + 18);
  38  |     playerBody.position.set(player.position.x, playerBody.shapes[0].radius, player.position.z);
  39  |     playerBody.velocity.setZero();
  40  |     followCamera.snap();
  41  |   }, imported.world.entities.pighead.slice(-4));
  42  |   await page.screenshot({ path: '/tmp/dst-cave-pighead-alignment.png' });
  43  |   const boundary = await page.evaluate(() => {
  44  |     const { building: { turfMap, ground }, universal: { scene }, camera: { followCamera }, player: { player, playerBody } } = (window as any).caveGame;
  45  |     // Set a cardinal camera so W is an actual negative-X movement request.
  46  |     followCamera.setHeadingTarget(0);
  47  |     const cell = turfMap.exportTiles().find((tile: any) => tile.tileId === 14 && turfMap.isVoidAtCell(tile.col - 1, tile.row));
  48  |     const edge = cell.col * 12, radius = playerBody.shapes[0].radius;
  49  |     player.position.set(edge + radius + .2, 0, (cell.row + .5) * 12);
  50  |     playerBody.position.set(player.position.x, radius, player.position.z);
  51  |     playerBody.velocity.setZero();
  52  |     followCamera.snap();
  53  |     return { edge, start: player.position.x, groundVisible: ground.material.visible, background: scene.background.getHex() };
  54  |   });
  55  |   expect(boundary.groundVisible).toBe(false);
  56  |   expect(boundary.background).toBe(0);
  57  |   // falloffdefs.lua: land cells hang a cliff on every side bordering void, whatever the camera heading.
  58  |   const falloff = await page.evaluate(() => {
  59  |     const { universal: { scene } } = (window as any).caveGame;
  60  |     const mesh = scene.getObjectByName('TurfFalloff');
  61  |     return { vertices: mesh.geometry.getAttribute('position').count, visible: mesh.visible };
  62  |   });
  63  |   expect(falloff.vertices).toBeGreaterThan(0);
  64  |   expect(falloff.visible).toBe(true);
  65  |   await page.keyboard.down('KeyW');
  66  |   await page.waitForTimeout(500);
  67  |   await page.keyboard.up('KeyW');
  68  |   const position = await page.evaluate(() => {
  69  |     const { player: { player }, building: { turfMap } } = (window as any).caveGame;
  70  |     return { x: player.position.x, passable: turfMap.isPassableAtPoint(player.position) };
  71  |   });
  72  |   expect(position.passable).toBe(true);
  73  |   expect(position.x).toBeGreaterThan(boundary.edge);
  74  |   expect(position.x).toBeLessThanOrEqual(boundary.start + .01);
  75  |   await page.keyboard.press('KeyM');
  76  |   await expect(page.locator('dst-minimap .minimap__viewport')).toBeVisible();
  77  |   await expect(page.locator('dst-minimap canvas')).toHaveCount(0);
  78  |   // Check actual decoded terrain images, not only the visibility of their container.
  79  |   await expect.poll(() => page.locator('dst-minimap').evaluate(async (map: any) => {
  80  |     const { sampleDomTerrain } = await import('./minimap-dom-samples.ts');
  81  |     const [centre] = sampleDomTerrain(map, [{ x: map.view.centerX, z: map.view.centerZ }]);
  82  |     return { ready: (await map.inspect()).ready, painted: centre[3] > 0 };
  83  |   }), { timeout: 60_000 }).toEqual({ ready: true, painted: true });
  84  |   await page.locator('dst-minimap').evaluate((map: any) => map.setView({ zoom: 1 }));
  85  |   const image = page.locator('dst-minimap .minimap__ground');
  86  |   await expect(image).toHaveCount(1);
  87  |   expect(await image.evaluate((image: HTMLImageElement) => image.naturalWidth * image.naturalHeight * 4)).toBeLessThanOrEqual(256 * 1024 * 1024);
  88  |   await page.keyboard.press('KeyM');
  89  |   const staticIds = ['cavein_boulder', 'rock_moon', 'rock_moon_shell', 'moonrockseed'];
  90  |   for (const prefab of staticIds) {
  91  |     await page.evaluate(prefab => document.querySelector('dst-debug-console')!.dispatchEvent(new CustomEvent('game:debug-command', {
  92  |       detail: { command: `c_spawn("${prefab}")` },
  93  |     })), prefab);
  94  |     await expect.poll(() => page.evaluate(prefab => {
  95  |       const { universal: { scene } } = (window as any).caveGame;
  96  |       return scene.children.filter((child: any) => (window as any).__prefabInstance(child)?.prefab === prefab).length;
  97  |     }, prefab)).toBeGreaterThan(0);
  98  |   }
  99  |   const download = page.waitForEvent('download');
  100 |   await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(new CustomEvent('game:debug-command', {
  101 |     detail: { command: 'c_save()' },
  102 |   })));
  103 |   const saved = JSON.parse(await readSaveDownload((await (await download).path())!));
  104 |   expect(saved.world.prefab).toBe('cave');
  105 |   expect(saved.world.map.defaultTileId).toBe(1);
  106 |   expect(saved.world.map.tiles).toHaveLength(imported.world.map.tiles.length);
  107 |   for (const prefab of ['pighead', 'archive_moon_statue', 'rock1']) {
> 108 |     expect(saved.world.entities[prefab]).toEqual(imported.world.entities[prefab]);
      |                                          ^ Error: expect(received).toEqual(expected) // deep equality
  109 |   }
  110 |   expect(saved.world.entities.cavein_boulder.slice(0, imported.world.entities.cavein_boulder.length)).toEqual(imported.world.entities.cavein_boulder);
  111 |   for (const prefab of staticIds) expect(saved.world.entities[prefab]).toHaveLength((imported.world.entities[prefab]?.length ?? 0) + 1);
  112 |   await page.route('**/saves/Cluster_1/Caves.json', route => route.fulfill({ json: saved }));
  113 |   await page.reload();
  114 |   await prepare();
  115 |   await expect(page.locator('canvas[data-game-canvas]')).toHaveAttribute('data-loaded', 'true');
  116 |   const restored = await page.evaluate(() => {
  117 |     const { building: { turfMap, ground }, player: { player } } = (window as any).caveGame;
  118 |     return { tiles: turfMap.exportTiles(), position: player.position.toArray(), groundVisible: ground.material.visible };
  119 |   });
  120 |   expect(restored.tiles).toEqual(saved.world.map.tiles);
  121 |   expect(restored.position[0]).toBeCloseTo(saved.players.local.transform.position[0], 3);
  122 |   expect(restored.position[2]).toBeCloseTo(saved.players.local.transform.position[2], 3);
  123 |   expect(restored.groundVisible).toBe(false);
  124 |   const secondDownload = page.waitForEvent('download');
  125 |   await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(new CustomEvent('game:debug-command', {
  126 |     detail: { command: 'c_save()' },
  127 |   })));
  128 |   const reexported = JSON.parse(await readSaveDownload((await (await secondDownload).path())!));
  129 |   for (const prefab of ['pighead', 'archive_moon_statue', 'rock1', ...staticIds]) {
  130 |     expect(reexported.world.entities[prefab]).toEqual(saved.world.entities[prefab]);
  131 |   }
  132 |   expect(errors).toEqual([]);
  133 | });
  134 | 
```
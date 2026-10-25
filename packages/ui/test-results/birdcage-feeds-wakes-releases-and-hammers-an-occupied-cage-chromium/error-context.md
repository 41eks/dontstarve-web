# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: birdcage.spec.ts >> feeds, wakes, releases and hammers an occupied cage
- Location: tests/birdcage.spec.ts:159:1

# Error details

```
Test timeout of 180000ms exceeded.
```

```
Error: locator.click: Test timeout of 180000ms exceeded.
Call log:
  - waiting for locator('dst-inventory-bar .inventory-bar__items [data-item-id="canary"]')

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
      - generic "精神值 183":
        - status: "183"
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
        - button "小肉，数量 9，新鲜度 84%，潮湿" [ref=e43] [cursor=pointer]:
          - generic [aria-hidden]: "9"
        - button "猛兽眼球伞，数量 1" [ref=e44] [cursor=pointer]
        - button "爆米花，数量 1，新鲜度 64%，潮湿" [ref=e45] [cursor=pointer]
        - button "石头，数量 3，潮湿" [ref=e46] [cursor=pointer]:
          - generic [aria-hidden]: "3"
      - generic [ref=e47]:
        - button "噩梦燃料，数量 10" [ref=e48] [cursor=pointer]:
          - generic [aria-hidden]: "10"
        - button "燧石，数量 1，潮湿" [ref=e49] [cursor=pointer]
        - button "扭曲唤星者魔杖，数量 1，耐久 45%，潮湿" [ref=e50] [cursor=pointer]:
          - generic [aria-hidden]: 45%
        - button "肉，数量 17，新鲜度 79%，潮湿" [ref=e51] [cursor=pointer]:
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
  71  |   const errors: string[] = [];
  72  |   const { prepare, submit, saveGame, cage, clickCage, slot, approach, start } = await harness(page, errors);
  73  |   await start();
  74  |   await submit('c_spawn("birdcage")');
  75  |   await expect.poll(cage).toMatchObject({ state: '_empty', status: 'GENERIC', animation: 'idle_empty', bird: null, tags: [] });
  76  |   await submit('c_give("canary")');
  77  |   await approach();
  78  | 
  79  |   // The held canary is imprisoned: the same inst leaves the cursor and the cage turns on its trader.
  80  |   await slot('canary').click();
  81  |   await clickCage();
  82  |   await expect.poll(cage).toMatchObject({ state: '_bird', status: 'OCCUPIED', bird: 'canary', tags: ['occupied', 'trader'] });
  83  |   await expect(slot('canary')).toHaveCount(0);
  84  |   await expect.poll(async () => (await cage())!.animation).toBe('idle_bird');
  85  | 
  86  |   // Sweeping the cage with the reskin tool swaps the skin build and keeps the canary override.
  87  |   await submit('c_give("reskin_tool")');
  88  |   const sweeper = await page.evaluate(async inventoryUrl => {
  89  |     const { equipmentSlotAddress, inventorySlotAddress } = await import(inventoryUrl);
  90  |     const game = (window as any).cageGame, store = game.main.inventory, hand = equipmentSlotAddress('hand');
  91  |     const source = store.exportState().slots.find((entry: any) => entry.address.containerId === 'player:inventory' && entry.item?.itemId === 'reskin_tool');
  92  |     if (!source || !store.applySlotChanges([
  93  |       { slot: inventorySlotAddress(Number(source.address.slotKey)), itemId: 'reskin_tool', skinId: source.item.skinId, delta: -1 },
  94  |       { slot: hand, itemId: 'reskin_tool', skinId: source.item.skinId, delta: 1 },
  95  |     ])) throw new Error('Unable to equip sweeper');
  96  |     await game.player.userData.animationController.setCarryItem('reskin_tool', source.item.skinId);
  97  |     return true;
  98  |   }, `/@fs${fileURLToPath(new URL('../../inventory/src/index.ts', import.meta.url))}`);
  99  |   expect(sweeper).toBe(true);
  100 |   const plainAtlases = await page.evaluate(() => (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage').children[0].children[0].material.length);
  101 |   const point = await page.evaluate(() => {
  102 |     const { scene, camera, renderer } = (window as any).cageGame;
  103 |     const model = scene.children.find((child: any) => child.name === 'Birdcage');
  104 |     const mesh = model.children[0].children[0];
  105 |     mesh.geometry.computeBoundingBox();
  106 |     const centre = mesh.geometry.boundingBox.getCenter(model.position.clone()).applyMatrix4(mesh.matrixWorld).project(camera);
  107 |     const rect = renderer.domElement.getBoundingClientRect();
  108 |     return { x: rect.left + (centre.x + 1) * rect.width / 2, y: rect.top + (1 - centre.y) * rect.height / 2 };
  109 |   });
  110 |   await page.mouse.click(point.x, point.y, { button: 'right' });
  111 |   await expect.poll(() => page.evaluate(() => (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage').userData.instance?.skinId)).toBe('birdcage_adventure');
  112 |   await expect.poll(() => page.evaluate(() => (window as any).cageGame.player.userData.animationController.isReskinning)).toBe(false);
  113 |   expect(await cage()).toMatchObject({ state: '_bird', bird: 'canary', animation: 'idle_bird' });
  114 |   expect(await page.evaluate(() => (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage').children[0].children[0].material.length))
  115 |     .toBeGreaterThanOrEqual(plainAtlases);
  116 | 
  117 |   const saved = await saveGame();
  118 |   const record = saved.world.entities.birdcage[0].components.birdcage;
  119 |   expect(saved.world.entities.birdcage[0].components.building.skinId).toBe('birdcage_adventure');
  120 |   expect(record).toMatchObject({ cageState: '_bird', birdType: 'canary', occupant: { itemId: 'canary', count: 1 } });
  121 |   expect(record.occupant.freshnessPercent).toBeGreaterThan(.99);
  122 |   expect(JSON.stringify(saved.players.local.inventory)).not.toContain('canary');
  123 | 
  124 |   // A skinned cage keeps drawing its canary from the override build.
  125 |   saved.world.entities.birdcage[0].components.building.skinId = 'birdcage_circus';
  126 |   await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  127 |   await page.reload(); await prepare();
  128 |   await expect.poll(cage).toMatchObject({ state: '_bird', bird: 'canary', animation: 'idle_bird' });
  129 |   expect(await page.evaluate(() => {
  130 |     const model = (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage');
  131 |     return { skin: model.userData.instance?.skinId, atlases: model.children[0].children[0].material.length };
  132 |   })).toMatchObject({ skin: 'birdcage_circus', atlases: expect.any(Number) });
  133 |   expect((await saveGame()).world.entities.birdcage[0].components.birdcage.occupant.entityId).toBe(record.occupant.entityId);
  134 | 
  135 |   // Starvation: the bird's perishable ends, the cage shows the death state and shelves the meat.
  136 |   await page.evaluate(() => {
  137 |     const model = (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage');
  138 |     model.userData.actionEntity.components.birdcage.getBird().components.perishable.SetPercent(.0001);
  139 |   });
  140 |   await expect.poll(cage, { timeout: 60_000 }).toMatchObject({ state: '_death', status: 'DEAD', bird: null, shelf: 'smallmeat', tags: ['takeshelfitem'] });
  141 |   const dead = await saveGame();
  142 |   expect(dead.world.entities.birdcage[0].components.birdcage).toMatchObject({ cageState: '_death', birdType: 'canary', item: { itemId: 'smallmeat' } });
  143 | 
  144 |   // Rot: the shelved meat spoils into the skeleton state.
  145 |   await page.evaluate(() => {
  146 |     const model = (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage');
  147 |     model.userData.actionEntity.components.birdcage.item.components.perishable.SetPercent(.0001);
  148 |   });
  149 |   await expect.poll(cage, { timeout: 60_000 }).toMatchObject({ state: '_skeleton', status: 'SKELETON', shelf: 'spoiled_food', tags: ['takeshelfitem'] });
  150 |   expect((await saveGame()).world.entities.birdcage[0].components.birdcage).toMatchObject({ cageState: '_skeleton', item: { itemId: 'spoiled_food' } });
  151 | 
  152 |   // TAKEITEM mucks the cage out and re-enables the occupiable.
  153 |   await clickCage();
  154 |   await expect.poll(cage).toMatchObject({ state: '_empty', status: 'GENERIC', shelf: null, tags: [] });
  155 |   await expect(slot('spoiled_food')).toHaveCount(1);
  156 |   expect(errors).toEqual([]);
  157 | });
  158 | 
  159 | test('feeds, wakes, releases and hammers an occupied cage', async ({ page }) => {
  160 |   test.setTimeout(180_000);
  161 |   const errors: string[] = [];
  162 |   const { submit, saveGame, cage, clickCage, slot, approach, start } = await harness(page, errors);
  163 |   const bird = () => page.evaluate(() => (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage')
  164 |     .userData.actionEntity.components.birdcage);
  165 |   await start();
  166 |   await submit('c_spawn("birdcage")');
  167 |   await expect.poll(cage).toMatchObject({ state: '_empty' });
  168 |   await submit('c_give("canary")');
  169 |   await submit('c_give("smallmeat")');
  170 |   await approach();
> 171 |   await slot('canary').click();
      |                        ^ Error: locator.click: Test timeout of 180000ms exceeded.
  172 |   await clickCage();
  173 |   await expect.poll(cage).toMatchObject({ state: '_bird', bird: 'canary' });
  174 | 
  175 |   // Meat is accepted: after the peck clips the bird is full again and an egg drops beside the cage.
  176 |   await page.evaluate(async () => {
  177 |     const cageComponent = (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage')
  178 |       .userData.actionEntity.components.birdcage;
  179 |     cageComponent.getBird().components.perishable.SetPercent(.4);
  180 |   });
  181 |   await expect.poll(cage).toMatchObject({ status: 'HUNGRY' });
  182 |   await slot('smallmeat').click();
  183 |   await clickCage();
  184 |   await expect.poll(async () => (await cage())!.status, { timeout: 30_000 }).toBe('OCCUPIED');
  185 |   await expect.poll(async () => JSON.stringify((await saveGame()).world.entities.ground_item ?? [])).toContain('bird_egg');
  186 |   await expect(slot('smallmeat')).toHaveCount(0);
  187 | 
  188 |   // A sleeping cage refuses gifts; waking returns to the idle loop.
  189 |   await page.evaluate(async () => {
  190 |     const cageComponent = (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage')
  191 |       .userData.actionEntity.components.birdcage;
  192 |     cageComponent.sleeper.GoToSleep();
  193 |   });
  194 |   await expect.poll(cage).toMatchObject({ status: 'SLEEPING', animation: 'sleep_loop' });
  195 |   expect((await page.evaluate(async () => {
  196 |     const cageComponent = (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage')
  197 |       .userData.actionEntity.components.birdcage;
  198 |     return cageComponent.trader.AbleToAccept({ prefab: 'smallmeat', hasTag: () => false });
  199 |   }))).toEqual({ ok: false, reason: 'SLEEPING' });
  200 |   await page.evaluate(() => (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage')
  201 |     .userData.actionEntity.components.birdcage.sleeper.WakeUp());
  202 |   await expect.poll(cage).toMatchObject({ animation: 'idle_bird' });
  203 | 
  204 |   // HARVEST (FREE) returns the same inst, with its hunger, to the inventory.
  205 |   await page.evaluate(() => (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage')
  206 |     .userData.actionEntity.components.birdcage.getBird().components.perishable.SetPercent(.7));
  207 |   const before = (await saveGame()).world.entities.birdcage[0].components.birdcage.occupant;
  208 |   await clickCage();
  209 |   await expect.poll(cage).toMatchObject({ state: '_empty', bird: null });
  210 |   await expect(slot('canary')).toHaveCount(1);
  211 |   const freed = JSON.stringify((await saveGame()).players.local.inventory);
  212 |   expect(freed).toContain(before.entityId);
  213 |   expect(freed).toMatch(/"freshnessPercent":0\.[67]/);
  214 | 
  215 |   // Hammering an occupied cage drops the bird itself along with the recipe loot.
  216 |   await slot('canary').click();
  217 |   await clickCage();
  218 |   await expect.poll(cage).toMatchObject({ state: '_bird' });
  219 |   await page.evaluate(() => {
  220 |     const model = (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage');
  221 |     const workable = model.userData.actionEntity.components.workable;
  222 |     for (let hit = 0; hit < 4; hit++) workable.WorkedBy({}, 1);
  223 |   });
  224 |   await expect.poll(cage).toBeNull();
  225 |   await expect.poll(async () => JSON.stringify((await saveGame()).world.entities.ground_item ?? []), { timeout: 15_000 }).toContain('"itemId":"canary"');
  226 |   expect(errors).toEqual([]);
  227 | });
  228 | 
  229 | test('c_give and c_spawn carry birds and eggs through c_save: carried birds starve, grounded ones do not', async ({ page }) => {
  230 |   test.setTimeout(120_000);
  231 |   const errors: string[] = [];
  232 |   const { submit, saveGame, prepare, start } = await harness(page, errors);
  233 |   await start();
  234 |   await submit('c_give("crow")');
  235 |   await submit('c_give("robin_winter")');
  236 |   await submit('c_give("bird_egg")');
  237 |   await submit('c_spawn("canary")');
  238 |   await submit('c_spawn("rottenegg")');
  239 |   const inventoryItems = (save: any) => JSON.stringify(save.players.local.inventory);
  240 |   await expect.poll(async () => inventoryItems(await saveGame())).toMatch(/robin_winter/);
  241 |   await expect.poll(async () => JSON.stringify((await saveGame()).world.entities.ground_item ?? [])).toMatch(/canary[\s\S]*rottenegg|rottenegg[\s\S]*canary/);
  242 |   const first = await saveGame();
  243 |   expect(inventoryItems(first)).toMatch(/"itemId":"crow"/);
  244 |   expect(inventoryItems(first)).toMatch(/"itemId":"bird_egg"/);
  245 |   const ground = JSON.stringify(first.world.entities.ground_item);
  246 |   expect(ground).toContain('"itemId":"canary"');
  247 |   expect(ground).toContain('"itemId":"rottenegg"');
  248 | 
  249 |   // A carried bird loses freshness; the one standing on the ground keeps it.
  250 |   await page.waitForTimeout(3_000);
  251 |   const later = await saveGame();
  252 |   const freshness = (save: any, id: string) => {
  253 |     const hit = (JSON.stringify(save).match(new RegExp(`"itemId":"${id}"[^}]*?"freshnessPercent":([0-9.e-]+)`)) ?? [])[1];
  254 |     return hit === undefined ? undefined : Number(hit);
  255 |   };
  256 |   expect(freshness(later, 'crow')).toBeLessThan(1);
  257 |   expect(freshness(later, 'canary')).toBe(1);
  258 | 
  259 |   await page.route('**/saves/initial-world.json', route => route.fulfill({ json: later }));
  260 |   await page.reload(); await prepare();
  261 |   const reloaded = await saveGame();
  262 |   // Time passes between the save and the reload, so the carried bird can only have starved a little more.
  263 |   expect(freshness(reloaded, 'crow')).toBeLessThanOrEqual(freshness(later, 'crow')!);
  264 |   expect(freshness(reloaded, 'crow')).toBeGreaterThan(freshness(later, 'crow')! - .02);
  265 |   expect(freshness(reloaded, 'canary')).toBe(1);
  266 |   expect(JSON.stringify(reloaded.world.entities.ground_item)).toContain('"itemId":"canary"');
  267 |   expect(errors).toEqual([]);
  268 | });
  269 | 
```
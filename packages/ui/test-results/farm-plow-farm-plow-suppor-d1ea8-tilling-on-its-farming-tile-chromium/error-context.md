# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: farm-plow.spec.ts >> farm plow supports seed planting and ordinary/golden hoe tilling on its farming tile
- Location: tests/farm-plow.spec.ts:7:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 109.6875
Received: 150
```

# Page snapshot

```yaml
- generic [ref=f1e1]:
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
    - complementary "快捷制作" [ref=f1e3]:
      - button "展开制作菜单" [ref=f1e4] [cursor=pointer]
      - generic "配方页码" [ref=f1e5]:
        - button "上一页" [ref=f1e6] [cursor=pointer]
        - generic [ref=f1e7]: "1"
        - button "下一页" [ref=f1e8] [cursor=pointer]
      - generic [ref=f1e9]:
        - text: Transmute Log Transmute Twigs Transmute Flint Transmute Rocks Transmute Bluegem Transmute Redgem Transmute Purplegem Transmute Orangegem Transmute Yellowgem Transmute Greengem
        - generic [ref=f1e10]:
          - button "斧头" [ref=f1e11] [cursor=pointer]
          - button "鹤嘴锄" [ref=f1e12] [cursor=pointer]
          - button "铲子" [ref=f1e13] [cursor=pointer]
          - button "锤子" [ref=f1e14] [cursor=pointer]
          - button "园艺锄" [ref=f1e15] [cursor=pointer]
          - button "干草叉" [ref=f1e16] [cursor=pointer]
          - button "黄金斧头" [ref=f1e17] [cursor=pointer]
          - button "黄金鹤嘴锄" [ref=f1e18] [cursor=pointer]
          - button "黄金铲子" [ref=f1e19] [cursor=pointer]
          - button "黄金园艺锄" [ref=f1e20] [cursor=pointer]
        - text: 薇洛的打火机 火炬 营火 便携营火 火坑 低微咩咩雕像 吸热营火 吸热火坑 南瓜灯 矿工帽 科学机器 炼金引擎 智囊团 钓具容器 制图桌 灵子分解器 暗影操控器 陶轮 土地夯实器 锯马 绳子 Walter Rope 木板 Woodie Boards 石砖 莎草纸 电子元件 活木头 时间碎片 蜡纸 电气化电路 警钟 可靠的弹弓 薇诺娜的投石机 薇诺娜的投石机 强抢袋 长矛 战斗长矛 奔雷矛 回旋镖 格挡电路 草甲 木甲 荆棘外壳 鳞甲 暗夜甲 大理石甲 硬木帽 橄榄球头盔 战斗头盔 针线包 可靠的胶布 聪明的伪装 松树先锋队帽子 充气背心 气球帽 背包 种子袋 猪皮包 保鲜背包 不老表 第二次机会表 治疗黏团 豆增压电路 扑腾绷带 治疗药膏 黏糊糊的药膏 避火膏 蜂蜜药膏 犁地草膏 阿比盖尔之花 警钟 俗气鹅像 俗气海狸像 俗气鹿像 树精守卫雕像 魔术师高礼帽 魔术师箱子 暗影秘典 灵子分解器 盛宴树盆 陶轮 土地夯实器 羽毛笔 清洁扫把 木牌 指路木牌 小木牌 蕨类盆栽 多肉盆栽 砖砌烤炉 冬季盛宴餐桌 盛宴树盆 疯狂科学家实验室 火鸡神龛 座狼神龛 猪神龛 胡萝卜鼠神龛 皮弗娄牛神龛 浣猫神龛 捆绑包装 礼物包装 背包 猪皮包 保鲜背包 厨师袋 种子袋 糖果袋 战斗号子罐 灵魂罐 砖砌烤炉 再消化电路 薇洛的打火机 便携烹饪锅 便携研磨器 便携香料站 厨师袋 烹饪指南 烹饪锅 晾肉架 耕地机 园艺锄 黄金园艺锄 烧灼园艺锄 空浇水壶 空鸟嘴壶 便便桶 催长剂起子 树果酱 肥料包 钓具容器 淡水钓竿 海钓竿 木球浮漂 硬物浮漂 黑羽浮漂 红羽浮漂 蔚蓝羽浮漂 黄羽浮漂 鹅羽浮漂 智囊团 草筏套装 船套装 海带补丁 船补丁 桨 浮木桨 充气背心 锚套装 方向舵套装 皮弗娄牛铃 舔盐块 美味舔盐块 刷子 鞍角 鞍具 战争鞍具 战斗鞍具 闪亮鞍具 皮弗娄牛美妆台 营火 便携营火 火坑 低微咩咩雕像 龙鳞火炉 暖石 热能电路 犬牙背心 雨衣 透气背心 吸热营火 吸热火坑 暖石 制冷电路 寒冰护符 旋转的风扇 花伞 雨伞 羽毛扇 避火膏 花伞 雨伞 传送伞 雨衣 气球帽 草帽 养蜂帽 高礼帽 魔术师高礼帽 矿工帽
  - region "生存状态":
    - generic:
      - img "世界第 11 日，夜晚" [ref=f1e21]
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
  - region "物品栏" [ref=f1e23]:
    - group "背包" [ref=f1e24]:
      - generic [ref=f1e25]:
        - button "耕地机，数量 1，耐久 75%" [ref=f1e26] [cursor=pointer]:
          - generic [aria-hidden]: 75%
        - button "种子，数量 1" [ref=f1e27] [cursor=pointer]
        - button "物品栏 3" [ref=f1e28] [cursor=pointer]
        - button "物品栏 4" [ref=f1e29] [cursor=pointer]
        - button "物品栏 5" [ref=f1e30] [cursor=pointer]
      - generic [ref=f1e31]:
        - button "物品栏 6" [ref=f1e32] [cursor=pointer]
        - button "物品栏 7" [ref=f1e33] [cursor=pointer]
        - button "物品栏 8" [ref=f1e34] [cursor=pointer]
        - button "物品栏 9" [ref=f1e35] [cursor=pointer]
        - button "物品栏 10" [ref=f1e36] [cursor=pointer]
      - generic [ref=f1e37]:
        - button "物品栏 11" [ref=f1e38] [cursor=pointer]
        - button "物品栏 12" [ref=f1e39] [cursor=pointer]
        - button "物品栏 13" [ref=f1e40] [cursor=pointer]
        - button "清洁扫把，数量 1" [ref=f1e41] [cursor=pointer]
        - button "物品栏 15" [ref=f1e42] [cursor=pointer]
    - group "装备" [ref=f1e43]:
      - button "手部装备" [ref=f1e44] [cursor=pointer]
      - button "身体装备" [ref=f1e45] [cursor=pointer]
      - button "终极棱镜，数量 1" [ref=f1e46] [cursor=pointer]
    - button "查看角色" [ref=f1e47] [cursor=pointer]
  - region "地图控制" [ref=f1e48]:
    - button "打开地图" [ref=f1e49] [cursor=pointer]
    - generic [ref=f1e50]:
      - button "向左旋转视角" [ref=f1e51] [cursor=pointer]
      - button "暂停游戏" [ref=f1e52] [cursor=pointer]
      - button "向右旋转视角" [ref=f1e53] [cursor=pointer]
  - status
  - status "帧率": FPS 7
```

# Test source

```ts
  78  |   const drillingSave = JSON.parse(await readSaveDownload((await (await duringDownload).path())!, 'Master'));
  79  |   expect(drillingSave.world.entities.farm_plow[0].components.farmPlow).toMatchObject({ phase: 'drill_loop', deployItem: { ...originalItem, remainingUses: 3 } });
  80  |   expect(drillingSave.world.entities.farm_plow[0].components.farmPlow.remainingSeconds).toBeLessThan(15);
  81  |   await page.route('**/saves/initial-world.json', (route) => route.fulfill({ json: drillingSave }));
  82  |   await page.reload(); await prepare();
  83  |   expect(await page.evaluate(() => (window as any).farmGame.main.inventory.count('farm_plow_item'))).toBe(0);
  84  | 
  85  |   await expect.poll(() => page.evaluate(() => {
  86  |     const { turfMap, center } = (window as any).farmGame; return turfMap.getTileAtWorld(center);
  87  |   }), { timeout: 25_000 }).toBe(47);
  88  |   await expect.poll(() => page.evaluate(() => (window as any).farmGame.scene.children
  89  |     .some((model: any) => model.name === 'GroundItem:farm_plow_item')), { timeout: 10_000 }).toBe(true);
  90  |   await expect.poll(() => page.evaluate(() => (window as any).farmGame.scene.children
  91  |     .some((model: any) => model.userData.instance?.prefab === 'farm_plow'))).toBe(false);
  92  |   await page.screenshot({ path: '/tmp/dontstarve-farm-plow-finished.png' });
  93  |   // Sample an alpha-hit point through the real sprite raycaster, including instanced input proxies.
  94  |   const spritePoint = async (prefab: string, name?: string) => page.evaluate(async ({ prefab, name, pointerPath }) => {
  95  |     const { scene, view, player } = (window as any).farmGame;
  96  |     const model = scene.children.filter((model: any) => name ? model.name === name : model.userData.instance?.prefab === prefab
  97  |       && model.userData.animationController.currentAnimation === 'till_idle')
  98  |       .sort((a: any, b: any) => a.position.distanceToSquared(player.position) - b.position.distanceToSquared(player.position))[0];
  99  |     if (!model) throw new Error(`No clickable ${prefab}`);
  100 |     const mesh = model.getObjectsByProperty('isMesh', true).find((object: any) => object.geometry?.drawRange.count > 0);
  101 |     if (!mesh) throw new Error(`No drawn mesh for ${prefab}`);
  102 |     mesh.updateWorldMatrix(true, false);
  103 |     const positions = mesh.geometry.getAttribute('position'), bounds = view.renderer.domElement.getBoundingClientRect();
  104 |     const point = model.position.clone();
  105 |     let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  106 |     for (let i = 0; i < mesh.geometry.drawRange.count / 6 * 4; i++) {
  107 |       point.fromBufferAttribute(positions, i); mesh.localToWorld(point).project(view.camera);
  108 |       minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
  109 |       minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
  110 |     }
  111 |     const { PointerRaycaster } = await import(pointerPath), pointer = new PointerRaycaster(view);
  112 |     try {
  113 |       for (const fy of [.5, .35, .65, .2, .8, .1, .9]) for (const fx of [.5, .35, .65, .2, .8, .1, .9]) {
  114 |         const x = bounds.left + (minX + (maxX - minX) * fx + 1) * bounds.width / 2;
  115 |         const y = bounds.top + (1 - minY - (maxY - minY) * fy) * bounds.height / 2;
  116 |         pointer.trackPointer({ clientX: x, clientY: y });
  117 |         if (pointer.raycastPointer([model])) return { x, y, id: model.userData.instance?.entityId, position: model.position.toArray() };
  118 |       }
  119 |       throw new Error(`No alpha-hit point for ${prefab}`);
  120 |     } finally { pointer.dispose(); }
  121 |   }, { prefab, name, pointerPath: url('../../stategraphs/src/pointerRaycaster.ts') });
  122 |   const pickupPoint = await spritePoint('farm_plow_item', 'GroundItem:farm_plow_item');
  123 |   expect(pickupPoint.id).toBe(originalItem.entityId);
  124 |   await page.mouse.click(pickupPoint.x, pickupPoint.y);
  125 |   await expect(item).toHaveCount(1);
  126 |   expect(await page.evaluate(() => (window as any).farmGame.main.inventory.exportState().slots
  127 |     .find((slot: any) => slot.item?.itemId === 'farm_plow_item').item)).toEqual({ ...originalItem, remainingUses: 3 });
  128 |   const afterDownload = page.waitForEvent('download');
  129 |   await submit('c_save()');
  130 |   const finishedSave = JSON.parse(await readSaveDownload((await (await afterDownload).path())!, 'Master'));
  131 |   expect(finishedSave.world.entities.farm_plow).toEqual([]);
  132 |   expect(finishedSave.world.entities.farm_soil_debris.length).toBeGreaterThan(0);
  133 |   expect(finishedSave.world.map.tiles.some((tile: any) => tile.tileId === 47)).toBe(true);
  134 |   await page.evaluate(() => {
  135 |     const { inventory } = (window as any).farmGame.main;
  136 |     inventory.applySlotChanges(inventory.exportState().slots.filter((slot: any) => slot.item?.itemId === 'seeds')
  137 |       .map((slot: any) => ({ slot: slot.address, itemId: 'seeds', delta: -slot.item.count })));
  138 |   });
  139 |   await submit('c_give("seeds", 3)');
  140 |   const seeds = page.locator('dst-inventory-bar .inventory-bar__items [data-item-id="seeds"]');
  141 |   await expect(seeds).toHaveCount(1);
  142 |   await expect(seeds.locator('.inventory-slot__icon[data-loaded="true"]')).toBeVisible();
  143 |   await seeds.click({ button: 'right' });
  144 |   await expect.poll(() => page.evaluate(() => (window as any).farmGame.main.inventory.exportState().slots
  145 |     .find((slot: any) => slot.item?.itemId === 'seeds')?.item.count)).toBe(2);
  146 |   await expect.poll(() => page.evaluate(() => (window as any).farmGame.player.userData.animationController.stategraph.stateName)).toBe('idle');
  147 |   await seeds.click({ button: 'right', modifiers: ['Shift'] });
  148 |   await expect.poll(() => page.evaluate(() => (window as any).farmGame.scene.children
  149 |     .some((model: any) => model.name === 'GroundItem:seeds'))).toBe(true);
  150 |   const seedPoint = await spritePoint('seeds', 'GroundItem:seeds');
  151 |   await page.mouse.click(seedPoint.x, seedPoint.y);
  152 |   await expect.poll(() => page.evaluate(() => (window as any).farmGame.main.inventory.exportState().slots
  153 |     .find((slot: any) => slot.item?.itemId === 'seeds')?.item.count)).toBe(2);
  154 |   const hole = await spritePoint('farm_soil');
  155 |   await seeds.click();
  156 |   const cursorSeed = page.locator('.slot-drag-preview[data-selection="true"][data-item-id="seeds"]');
  157 |   await expect(cursorSeed.locator('.slot-drag-preview__icon[data-loaded="true"]')).toBeVisible();
  158 |   await expect(cursorSeed.locator('.slot-drag-preview__count')).toHaveText('2');
  159 |   await page.mouse.move(hole.x, hole.y);
  160 |   await expect.poll(() => cursorSeed.evaluate((element) => parseFloat((element as HTMLElement).style.left))).toBeCloseTo(hole.x, 2);
  161 |   // Selection claims the click before transfer pickup; cancel without spending.
  162 |   await page.keyboard.press('Escape');
  163 |   await expect(cursorSeed).toHaveCount(0);
  164 |   await seeds.click();
  165 |   await page.mouse.click(hole.x, hole.y);
  166 |   await expect.poll(() => page.evaluate(() => (window as any).farmGame.scene.children
  167 |     .filter((model: any) => model.userData.instance?.prefab === 'farm_plant_randomseed').length), { timeout: 15_000 }).toBe(1);
  168 |   await expect.poll(() => page.evaluate(() => (window as any).farmGame.scene.children
  169 |     .find((model: any) => model.userData.instance?.prefab === 'farm_plant_randomseed')?.userData.animationController.currentAnimation)).toBe('sow_idle');
  170 |   await expect(cursorSeed.locator('.slot-drag-preview__count')).toHaveText('');
  171 |   const plantedDownload = page.waitForEvent('download');
  172 |   await submit('c_save()');
  173 |   const plantedSave = JSON.parse(await readSaveDownload((await (await plantedDownload).path())!, 'Master'));
  174 |   expect(plantedSave.world.entities.farm_soil.some((record: any) => record.id === hole.id)).toBe(false);
  175 |   expect(plantedSave.world.entities.farm_plant_randomseed[0].transform.position).toEqual(hole.position);
  176 |   expect(plantedSave.players.local.inventory.containers['player:inventory'].slots
  177 |     .find((slot: any) => slot.item?.itemId === 'seeds').item.count).toBe(1);
> 178 |   expect(plantedSave.players.local.stats.hunger).toBe(109.6875);
      |                                                  ^ Error: expect(received).toBe(expected) // Object.is equality
  179 |   await page.evaluate(async ({ paths, save }) => {
  180 |     const { deserializeSave } = await import(paths.deserialize);
  181 |     const { SAVE_CATALOG } = await import(paths.catalog);
  182 |     deserializeSave(JSON.stringify(save), SAVE_CATALOG);
  183 |   }, { paths: { deserialize: url('../../../src/save/deserialize.ts'), catalog: url('../../../src/save/catalog.ts') }, save: plantedSave });
  184 |   await page.screenshot({ path: '/tmp/dontstarve-seeds-planted.png' });
  185 |   // Use the same plowed tile for both tool forms; preserve the planted seed.
  186 |   await submit('c_give("farm_hoe")');
  187 |   const bar = page.locator('dst-inventory-bar');
  188 |   const hand = bar.locator('.inventory-bar__equipment .inventory-slot').first();
  189 |   const unequipHand = async () => {
  190 |     if (await hand.getAttribute('data-item-id')) {
  191 |       await hand.dragTo(bar.locator('.inventory-bar__items .inventory-slot[data-item-id=""]').first());
  192 |       await expect(hand).toHaveAttribute('data-item-id', '');
  193 |     }
  194 |   };
  195 |   await unequipHand();
  196 |   await bar.locator('.inventory-bar__items [data-item-id="farm_hoe"]').dragTo(hand);
  197 |   await expect(hand).toHaveAttribute('data-item-id', 'farm_hoe');
  198 |   await expect.poll(() => page.evaluate(() => (window as any).farmGame.player.getObjectByProperty('isMesh', true).material
  199 |     .some((material: any) => material.name === 'ground:quagmire_hoe'))).toBe(true);
  200 |   const tillPoint = await page.evaluate(() => {
  201 |     const { scene, view, player, center } = (window as any).farmGame;
  202 |     const blocked = scene.children.filter((model: any) => ['farm_soil_debris', 'farm_plant_randomseed'].includes(model.userData.instance?.prefab));
  203 |     let point: any;
  204 |     for (let dx = -5; dx <= 5 && !point; dx += 1) for (let dz = -5; dz <= 5 && !point; dz += 1) {
  205 |       const candidate = player.position.clone().set(center.x + dx, 0, center.z + dz);
  206 |       if (blocked.every((model: any) => model.position.distanceToSquared(candidate) >= 3.75 ** 2)) point = candidate;
  207 |     }
  208 |     if (!point) throw new Error('No clear till point on completed farm tile');
  209 |     const ndc = point.clone().project(view.camera), bounds = view.renderer.domElement.getBoundingClientRect();
  210 |     return { x: bounds.left + (ndc.x + 1) * bounds.width / 2, y: bounds.top + (1 - ndc.y) * bounds.height / 2,
  211 |       position: point.toArray() };
  212 |   });
  213 |   await page.mouse.click(tillPoint.x, tillPoint.y, { button: 'right' });
  214 |   await expect.poll(() => page.evaluate((position) => (window as any).farmGame.scene.children
  215 |     .some((model: any) => model.userData.instance?.prefab === 'farm_soil'
  216 |       && model.position.distanceToSquared((window as any).farmGame.player.position.clone().fromArray(position)) < 0.001), tillPoint.position),
  217 |   { timeout: 15_000 }).toBe(true);
  218 |   await expect.poll(() => page.evaluate(() => (window as any).farmGame.player.userData.animationController.isTilling)).toBe(false);
  219 |   await submit('c_give("golden_farm_hoe")');
  220 |   await unequipHand();
  221 |   await bar.locator('.inventory-bar__items [data-item-id="golden_farm_hoe"]').dragTo(hand);
  222 |   await expect(hand).toHaveAttribute('data-item-id', 'golden_farm_hoe');
  223 |   await expect.poll(() => page.evaluate(() => (window as any).farmGame.player.getObjectByProperty('isMesh', true).material
  224 |     .some((material: any) => material.name === 'ground:swap_goldenhoe'))).toBe(true);
  225 |   const retill = await page.evaluate((position) => {
  226 |     const { scene, view, player } = (window as any).farmGame;
  227 |     const point = player.position.clone().fromArray(position);
  228 |     const previous = scene.children.find((model: any) => model.userData.instance?.prefab === 'farm_soil' && model.position.distanceToSquared(point) < 0.001);
  229 |     const ndc = point.project(view.camera), bounds = view.renderer.domElement.getBoundingClientRect();
  230 |     return { x: bounds.left + (ndc.x + 1) * bounds.width / 2, y: bounds.top + (1 - ndc.y) * bounds.height / 2,
  231 |       oldId: previous.userData.instance?.entityId };
  232 |   }, tillPoint.position);
  233 |   await page.mouse.click(retill.x, retill.y, { button: 'right' });
  234 |   await expect.poll(() => page.evaluate((oldId) => (window as any).farmGame.scene.children
  235 |     .some((model: any) => model.userData.instance?.entityId === oldId), retill.oldId)).toBe(false);
  236 |   await expect.poll(() => page.evaluate(() => (window as any).farmGame.player.userData.animationController.isTilling)).toBe(false);
  237 |   // Ground reskin -> pickup -> equipment must preserve the golden tool's skin.
  238 |   const beforeCancel = await page.evaluate((position) => {
  239 |     const { scene, player } = (window as any).farmGame;
  240 |     return scene.children.find((model: any) => model.userData.instance?.prefab === 'farm_soil'
  241 |       && model.position.distanceToSquared(player.position.clone().fromArray(position)) < 0.001).userData.instance?.entityId;
  242 |   }, tillPoint.position);
  243 |   await page.mouse.click(retill.x, retill.y, { button: 'right' });
  244 |   await expect.poll(() => page.evaluate(() => (window as any).farmGame.player.userData.animationController.isTilling)).toBe(true);
  245 |   await page.keyboard.press('Escape');
  246 |   await page.waitForTimeout(1000);
  247 |   expect(await page.evaluate((id) => (window as any).farmGame.scene.children
  248 |     .some((model: any) => model.userData.instance?.entityId === id), beforeCancel)).toBe(true);
  249 |   await hand.click({ button: 'right', modifiers: ['Shift'] });
  250 |   await expect.poll(() => page.evaluate(() => (window as any).farmGame.scene.children
  251 |     .some((model: any) => model.name === 'GroundItem:golden_farm_hoe'))).toBe(true);
  252 |   await bar.locator('.inventory-bar__items [data-item-id="reskin_tool"]').first().dragTo(hand);
  253 |   await expect.poll(() => page.evaluate(() => (window as any).farmGame.player.getObjectByProperty('isMesh', true).material
  254 |     .some((material: any) => material.name === 'ground:swap_reskin_tool'))).toBe(true);
  255 |   const goldPoint = await spritePoint('golden_farm_hoe', 'GroundItem:golden_farm_hoe');
  256 |   await page.mouse.click(goldPoint.x, goldPoint.y, { button: 'right' });
  257 |   await expect.poll(() => page.evaluate(() => (window as any).farmGame.scene.children
  258 |     .find((model: any) => model.name === 'GroundItem:golden_farm_hoe')?.userData.instance?.skinId)).toBe('golden_farmhoe_garden');
  259 |   const skinnedPoint = await spritePoint('golden_farm_hoe', 'GroundItem:golden_farm_hoe');
  260 |   await page.mouse.click(skinnedPoint.x, skinnedPoint.y);
  261 |   await unequipHand();
  262 |   await bar.locator('.inventory-bar__items [data-item-id="golden_farm_hoe"]').dragTo(hand);
  263 |   await expect(hand).toHaveAttribute('data-item-id', 'golden_farm_hoe');
  264 |   await submit('c_spawn("farm_hoe")');
  265 |   await submit('c_spawn("golden_farm_hoe")');
  266 |   await expect.poll(() => page.evaluate(() => (window as any).farmGame.scene.children
  267 |     .filter((model: any) => ['GroundItem:farm_hoe', 'GroundItem:golden_farm_hoe'].includes(model.name)).length)).toBe(2);
  268 |   const hoeDownload = page.waitForEvent('download');
  269 |   await submit('c_save()');
  270 |   const hoeSave = JSON.parse(await readSaveDownload((await (await hoeDownload).path())!, 'Master'));
  271 |   expect(hoeSave.world.entities.farm_plant_randomseed).toEqual(plantedSave.world.entities.farm_plant_randomseed);
  272 |   expect(hoeSave.players.local.inventory.containers['player:equipment'].slots
  273 |     .find((slot: any) => slot.slotKey === 'hand').item.skinId).toBe('golden_farmhoe_garden');
  274 |   expect(hoeSave.world.entities.farm_soil.some((record: any) => record.components.farmSoil.broken === false
  275 |     && record.transform.position.every((value: number, index: number) => Math.abs(value - tillPoint.position[index]) < 0.001))).toBe(true);
  276 |   await page.screenshot({ path: '/tmp/dontstarve-farm-hoe-tilled.png' });
  277 |   const groundTools = hoeSave.world.entities.ground_item.filter((record: any) => ['farm_hoe', 'golden_farm_hoe'].includes(record.components.stack.itemId));
  278 |   expect(groundTools).toHaveLength(2);
```
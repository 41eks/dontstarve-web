# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ui.spec.ts >> uses the mirrored DST data path for every image
- Location: tests/ui.spec.ts:260:1

# Error details

```
Error: expect(received).toMatch(expected)

Expected pattern: /^\/dst\/data\/ui\//
Received string:  "/tests/dst/data/ui/crafting/filter/filter_button_inactive.tex.png"
```

# Page snapshot

```yaml
- generic [active]:
  - main:
    - region "制作菜单":
      - text: ◆
      - complementary "快捷制作" [ref=e1]:
        - button "展开制作菜单" [ref=e2] [cursor=pointer]
        - generic "配方页码" [ref=e3]:
          - button "上一页" [ref=e4] [cursor=pointer]
          - generic [ref=e5]: "1"
          - button "下一页" [ref=e6] [cursor=pointer]
        - generic [ref=e7]:
          - text: Transmute Log Transmute Twigs Transmute Flint Transmute Rocks Transmute Bluegem Transmute Redgem Transmute Purplegem Transmute Orangegem Transmute Yellowgem Transmute Greengem
          - generic [ref=e8]:
            - button "斧头" [ref=e9] [cursor=pointer]
            - button "鹤嘴锄" [ref=e10] [cursor=pointer]
            - button "铲子" [ref=e11] [cursor=pointer]
            - button "锤子" [ref=e12] [cursor=pointer]
            - button "园艺锄" [ref=e13] [cursor=pointer]
            - button "干草叉" [ref=e14] [cursor=pointer]
            - button "黄金斧头" [ref=e15] [cursor=pointer]
            - button "黄金鹤嘴锄" [ref=e16] [cursor=pointer]
            - button "黄金铲子" [ref=e17] [cursor=pointer]
            - button "黄金园艺锄" [ref=e18] [cursor=pointer]
          - text: 薇洛的打火机 火炬 营火 便携营火 火坑 低微咩咩雕像 吸热营火 吸热火坑 南瓜灯 矿工帽 科学机器 炼金引擎 智囊团 钓具容器 制图桌 灵子分解器 暗影操控器 陶轮 土地夯实器 锯马 绳子 Walter Rope 木板 Woodie Boards 石砖 莎草纸 电子元件 活木头 时间碎片 蜡纸 电气化电路 警钟 可靠的弹弓 薇诺娜的投石机 薇诺娜的投石机 强抢袋 长矛 战斗长矛 奔雷矛 回旋镖 格挡电路 草甲 木甲 荆棘外壳 鳞甲 暗夜甲 大理石甲 硬木帽 橄榄球头盔 战斗头盔 针线包 可靠的胶布 聪明的伪装 松树先锋队帽子 充气背心 气球帽 背包 种子袋 猪皮包 保鲜背包 不老表 第二次机会表 治疗黏团 豆增压电路 扑腾绷带 治疗药膏 黏糊糊的药膏 避火膏 蜂蜜药膏 犁地草膏 阿比盖尔之花 警钟 俗气鹅像 俗气海狸像 俗气鹿像 树精守卫雕像 魔术师高礼帽 魔术师箱子 暗影秘典 灵子分解器 盛宴树盆 陶轮 土地夯实器 羽毛笔 清洁扫把 木牌 指路木牌 小木牌 蕨类盆栽 多肉盆栽 砖砌烤炉 冬季盛宴餐桌 盛宴树盆 疯狂科学家实验室 火鸡神龛 座狼神龛 猪神龛 胡萝卜鼠神龛 皮弗娄牛神龛 浣猫神龛 捆绑包装 礼物包装 背包 猪皮包 保鲜背包 厨师袋 种子袋 糖果袋 战斗号子罐 灵魂罐 砖砌烤炉 再消化电路 薇洛的打火机 便携烹饪锅 便携研磨器 便携香料站 厨师袋 烹饪指南 烹饪锅 晾肉架 耕地机 园艺锄 黄金园艺锄 烧灼园艺锄 空浇水壶 空鸟嘴壶 便便桶 催长剂起子 树果酱 肥料包 钓具容器 淡水钓竿 海钓竿 木球浮漂 硬物浮漂 黑羽浮漂 红羽浮漂 蔚蓝羽浮漂 黄羽浮漂 鹅羽浮漂 智囊团 草筏套装 船套装 海带补丁 船补丁 桨 浮木桨 充气背心 锚套装 方向舵套装 皮弗娄牛铃 舔盐块 美味舔盐块 刷子 鞍角 鞍具 战争鞍具 战斗鞍具 闪亮鞍具 皮弗娄牛美妆台 营火 便携营火 火坑 低微咩咩雕像 龙鳞火炉 暖石 热能电路 犬牙背心 雨衣 透气背心 吸热营火 吸热火坑 暖石 制冷电路 寒冰护符 旋转的风扇 花伞 雨伞 羽毛扇 避火膏 花伞 雨伞 传送伞 雨衣 气球帽 草帽 养蜂帽 高礼帽 魔术师高礼帽 矿工帽
  - region "生存状态":
    - generic:
      - generic "世界第 32 日":
        - generic [aria-hidden]:
          - generic:
            - generic: 世界
            - strong: 32日
      - generic "当前季节：冬":
        - strong: 冬
    - generic:
      - generic "饱食度 105":
        - status: "105"
      - generic "精神值 35":
        - status: "35"
      - generic "生命值 150":
        - status: "150"
    - generic "温度 45 度":
      - status: 45°
  - region "物品栏" [ref=e19]:
    - group "背包" [ref=e21]:
      - generic [ref=e22]:
        - button "物品栏 1" [ref=e23] [cursor=pointer]
        - button "物品栏 2" [ref=e24] [cursor=pointer]
        - button "物品栏 3" [ref=e25] [cursor=pointer]
        - button "物品栏 4" [ref=e26] [cursor=pointer]
        - button "物品栏 5" [ref=e27] [cursor=pointer]
      - generic [ref=e28]:
        - button "物品栏 6" [ref=e29] [cursor=pointer]
        - button "物品栏 7" [ref=e30] [cursor=pointer]
        - button "物品栏 8" [ref=e31] [cursor=pointer]
        - button "物品栏 9" [ref=e32] [cursor=pointer]
        - button "物品栏 10" [ref=e33] [cursor=pointer]
      - generic [ref=e34]:
        - button "物品栏 11" [ref=e35] [cursor=pointer]
        - button "物品栏 12" [ref=e36] [cursor=pointer]
        - button "物品栏 13" [ref=e37] [cursor=pointer]
        - button "物品栏 14" [ref=e38] [cursor=pointer]
        - button "物品栏 15" [ref=e39] [cursor=pointer]
    - group "装备" [ref=e40]:
      - button "手部装备" [ref=e41] [cursor=pointer]
      - button "身体装备" [ref=e42] [cursor=pointer]
      - button "头部装备" [ref=e43] [cursor=pointer]
    - button "查看角色" [ref=e44] [cursor=pointer]
  - region "地图控制" [ref=e45]:
    - button "打开地图" [ref=e46] [cursor=pointer]
    - generic [ref=e47]:
      - button "向左旋转视角" [ref=e48] [cursor=pointer]
      - button "暂停游戏" [ref=e49] [cursor=pointer]
      - button "向右旋转视角" [ref=e50] [cursor=pointer]
```

# Test source

```ts
  168 |   const missingProducts = [...new Set(Object.values(INVENTORY_RECIPES)
  169 |     .map(({ productId }) => productId))]
  170 |     .filter((productId) => !INVENTORY_PRODUCT_SPECS[productId]);
  171 | 
  172 |   expect(missingProducts).toEqual([]);
  173 |   expect(INVENTORY_PRODUCT_SPECS.rope).toEqual({
  174 |     name: '绳子',
  175 |     icon: 'rope.tex',
  176 |   });
  177 | });
  178 | 
  179 | async function openFixture(page: Page): Promise<void> {
  180 |   await page.goto(fixtureUrl);
  181 |   await expect(page.locator('dst-crafting-ui')).toHaveCount(1);
  182 |   await expect(page.locator('dst-debug-console')).toHaveCount(1);
  183 |   await expect(page.locator('dst-chest-panel')).toHaveCount(1);
  184 |   await expect(page.locator('dst-status-hud')).toHaveCount(1);
  185 |   await expect(page.locator('dst-inventory-bar')).toHaveCount(1);
  186 |   await expect(page.locator('dst-map-controls')).toHaveCount(1);
  187 | }
  188 | 
  189 | test('registers all elements with open, styled shadow roots', async ({ page }) => {
  190 |   await openFixture(page);
  191 | 
  192 |   const components = await page.evaluate(() =>
  193 |     ['dst-chest-panel', 'dst-crafting-ui', 'dst-debug-console', 'dst-status-hud', 'dst-inventory-bar', 'dst-map-controls'].map((tagName) => {
  194 |       const element = document.querySelector(tagName);
  195 |       return {
  196 |         tagName,
  197 |         isRegistered: Boolean(customElements.get(tagName)),
  198 |         hasOpenShadowRoot: Boolean(element?.shadowRoot),
  199 |         hasStyle: Boolean(element?.shadowRoot?.querySelector('style')),
  200 |       };
  201 |     }),
  202 |   );
  203 | 
  204 |   expect(components).toEqual([
  205 |     { tagName: 'dst-chest-panel', isRegistered: true, hasOpenShadowRoot: true, hasStyle: true },
  206 |     { tagName: 'dst-crafting-ui', isRegistered: true, hasOpenShadowRoot: true, hasStyle: true },
  207 |     { tagName: 'dst-debug-console', isRegistered: true, hasOpenShadowRoot: true, hasStyle: true },
  208 |     { tagName: 'dst-status-hud', isRegistered: true, hasOpenShadowRoot: true, hasStyle: true },
  209 |     { tagName: 'dst-inventory-bar', isRegistered: true, hasOpenShadowRoot: true, hasStyle: true },
  210 |     { tagName: 'dst-map-controls', isRegistered: true, hasOpenShadowRoot: true, hasStyle: true },
  211 |   ]);
  212 | 
  213 |   await page.addStyleTag({ content: '.survival-hud { display: none !important; }' });
  214 |   await expect(page.locator('dst-status-hud').locator('.survival-hud')).toHaveCSS('display', 'block');
  215 | 
  216 |   const clockRim = page.locator('dst-status-hud .world-clock__rim');
  217 |   await expect(clockRim).toHaveAttribute('data-atlas', 'images/hud.xml');
  218 |   await expect(clockRim).toHaveAttribute('data-element', 'clock_rim.tex');
  219 |   await expect(clockRim).toHaveAttribute('data-loaded', 'true');
  220 |   await expect(clockRim).toHaveAttribute('data-width', '216');
  221 |   await expect(clockRim).toHaveAttribute('data-height', '216');
  222 | });
  223 | 
  224 | test('opens the debug console with backquote and emits entered commands', async ({ page }) => {
  225 |   await openFixture(page);
  226 | 
  227 |   const debugConsole = page.locator('dst-debug-console');
  228 |   const panel = debugConsole.locator('.debug-console');
  229 |   const input = debugConsole.locator('.debug-console__input');
  230 |   const background = debugConsole.locator('.debug-console__background');
  231 |   await expect(panel).toBeHidden();
  232 |   await expect(background).toHaveAttribute('data-atlas', 'images/textboxes.xml');
  233 |   await expect(background).toHaveAttribute('data-element', 'textbox_long.tex');
  234 |   await expect(background).toHaveAttribute('data-loaded', 'true');
  235 | 
  236 |   await page.evaluate(() => {
  237 |     window.addEventListener('game:debug-command', (event) => {
  238 |       (window as typeof window & { debugCommand?: unknown }).debugCommand =
  239 |         (event as CustomEvent).detail;
  240 |     });
  241 |   });
  242 |   await page.keyboard.press('Backquote');
  243 |   await expect(panel).toBeVisible();
  244 |   await expect(input).toBeFocused();
  245 |   await input.fill('c_give("meatballs", 3)');
  246 |   await input.press('Enter');
  247 | 
  248 |   await expect(panel).toBeHidden();
  249 |   await expect.poll(() => page.evaluate(() =>
  250 |     (window as typeof window & { debugCommand?: unknown }).debugCommand,
  251 |   )).toEqual({ command: 'c_give("meatballs", 3)' });
  252 | 
  253 |   await page.keyboard.press('Backquote');
  254 |   await input.press('ArrowUp');
  255 |   await expect(input).toHaveValue('c_give("meatballs", 3)');
  256 |   await input.press('Escape');
  257 |   await expect(panel).toBeHidden();
  258 | });
  259 | 
  260 | test('uses the mirrored DST data path for every image', async ({ page }) => {
  261 |   await openFixture(page);
  262 | 
  263 |   const imageUrls = await page.locator('dst-crafting-ui img, dst-status-hud img, dst-inventory-bar img, dst-map-controls img')
  264 |     .evaluateAll((images) => images.map((image) => (image as HTMLImageElement).src));
  265 | 
  266 |   expect(imageUrls.length).toBeGreaterThan(10);
  267 |   for (const imageUrl of imageUrls) {
> 268 |     expect(new URL(imageUrl).pathname).toMatch(/^\/dst\/data\/ui\//);
      |                                        ^ Error: expect(received).toMatch(expected)
  269 |   }
  270 | 
  271 |   for (const imageUrl of new Set(imageUrls)) {
  272 |     const response = await page.request.get(imageUrl);
  273 |     expect(response.status(), imageUrl).toBe(200);
  274 |   }
  275 | 
  276 |   const atlasPaths = await page.locator('dst-crafting-ui [data-atlas]')
  277 |     .evaluateAll((images) => images.map((image) => (image as HTMLElement).dataset.atlas));
  278 |   expect(atlasPaths.length).toBeGreaterThan(0);
  279 |   expect(atlasPaths.every((path) => path?.startsWith('images/'))).toBe(true);
  280 | });
  281 | 
  282 | test('renders the inventory and equipment slots and emits selection events', async ({ page }) => {
  283 |   await openFixture(page);
  284 | 
  285 |   const inventoryBar = page.locator('dst-inventory-bar');
  286 |   await expect(inventoryBar.locator('.inventory-bar__items .inventory-slot')).toHaveCount(15);
  287 |   await expect(inventoryBar.locator('.inventory-bar__equipment .inventory-slot')).toHaveCount(3);
  288 | 
  289 |   await page.evaluate(() => {
  290 |     const bar = document.querySelector('dst-inventory-bar') as HTMLElement & {
  291 |       setSlot(ref: unknown, item: unknown): void;
  292 |     };
  293 |     bar.setSlot({ containerId: 'player:inventory', slotKey: '0' }, {
  294 |       id: 'axe',
  295 |       skinId: 'axe_feathered',
  296 |       name: '猎人斧',
  297 |       count: 1,
  298 |       maxStack: 1,
  299 |       icon: 'axe_feathered.tex',
  300 |       atlas: 'images/inventoryimages.xml',
  301 |     });
  302 |   });
  303 |   const skinnedSlot = inventoryBar.locator('.inventory-bar__items .inventory-slot').first();
  304 |   await expect(skinnedSlot).toHaveAttribute('data-item-id', 'axe');
  305 |   await expect(skinnedSlot).toHaveAttribute('data-skin-id', 'axe_feathered');
  306 |   await expect(skinnedSlot).toHaveAttribute('aria-label', '猎人斧，数量 1');
  307 |   await expect(skinnedSlot.locator('.inventory-slot__icon')).toHaveAttribute('data-element', 'axe_feathered.tex');
  308 |   await expect(skinnedSlot.locator('.inventory-slot__icon')).toHaveAttribute('data-loaded', 'true');
  309 | 
  310 |   await page.evaluate(() => {
  311 |     const eventLog: Array<{ type: string; detail: unknown }> = [];
  312 |     window.addEventListener('game:slot-select', (event) => {
  313 |       eventLog.push({ type: event.type, detail: (event as CustomEvent).detail });
  314 |     });
  315 |     window.addEventListener('game:self-inspect', (event) => {
  316 |       eventLog.push({ type: event.type, detail: null });
  317 |     });
  318 |     (window as typeof window & { inventoryEventLog: typeof eventLog }).inventoryEventLog = eventLog;
  319 |   });
  320 | 
  321 |   await inventoryBar.locator('.inventory-bar__items .inventory-slot').nth(4).click();
  322 |   await inventoryBar.locator('.inventory-bar__equipment .inventory-slot').nth(1).click();
  323 |   await inventoryBar.locator('.inventory-bar__inspect').click();
  324 | 
  325 |   await expect.poll(() => page.evaluate(() =>
  326 |     (window as typeof window & { inventoryEventLog: unknown[] }).inventoryEventLog,
  327 |   )).toEqual([
  328 |     {
  329 |       type: 'game:slot-select',
  330 |       detail: { slot: { containerId: 'player:inventory', slotKey: '4' } },
  331 |     },
  332 |     {
  333 |       type: 'game:slot-select',
  334 |       detail: { slot: { containerId: 'player:equipment', slotKey: 'body' } },
  335 |     },
  336 |     { type: 'game:self-inspect', detail: null },
  337 |   ]);
  338 | });
  339 | 
  340 | test('uses one dedicated chest panel with compact slots matching the backpack size without a close button', async ({ page }) => {
  341 |   await openFixture(page);
  342 | 
  343 |   await page.evaluate(() => {
  344 |     const chest = document.querySelector('dst-chest-panel') as HTMLElement & {
  345 |       open(options: { containerId: string; slotCount: number; title: string }): void;
  346 |       setAnchor(clientX: number, clientY: number): void;
  347 |     };
  348 |     chest.open({
  349 |       containerId: 'world:treasurechest:0',
  350 |       slotCount: 9,
  351 |       title: '箱子',
  352 |     });
  353 |     chest.setAnchor(420, 360);
  354 |   });
  355 | 
  356 |   const chest = page.locator('dst-chest-panel');
  357 |   await expect(chest).toHaveCount(1);
  358 |   await expect(chest.locator('.chest-panel')).toBeVisible();
  359 |   await expect(chest.locator('.inventory-slot')).toHaveCount(9);
  360 |   await expect(chest.locator('.inventory-slot').first()).toBeVisible();
  361 |   await expect(chest.locator('.chest-panel__close')).toHaveCount(0);
  362 | 
  363 |   const backpackSlotBox = await page.locator(
  364 |     'dst-inventory-bar .inventory-bar__items .inventory-slot',
  365 |   ).first().boundingBox();
  366 |   const chestSlotBox = await chest.locator('.inventory-slot').first().boundingBox();
  367 |   expect(backpackSlotBox).not.toBeNull();
  368 |   expect(chestSlotBox).not.toBeNull();
```
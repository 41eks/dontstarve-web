# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ui.spec.ts >> updates individual inventory signals and emits an atomic transfer request
- Location: tests/ui.spec.ts:456:1

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('.slot-drag-preview').locator('img.slot-drag-preview__icon')
Expected: 1
Received: 0
Timeout:  5000ms

Call log:
  - Expect "toHaveCount" locator('.slot-drag-preview').locator('img.slot-drag-preview__icon') with timeout 5000ms
  - waiting for locator('.slot-drag-preview').locator('img.slot-drag-preview__icon')
    14 × locator resolved to 0 elements
       - unexpected value "0"

```

# Page snapshot

```yaml
- generic:
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
        - button "草，数量 3" [ref=e23] [cursor=pointer]:
          - generic [aria-hidden]: "3"
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
  - generic [aria-hidden]:
    - generic: "3"
```

# Test source

```ts
  397 |     return element.getContext('2d')!.getImageData(0, 0, element.width, element.height)
  398 |       .data.some((value, index) => index % 4 === 3 && value > 0);
  399 |   })).toBe(true);
  400 |   await panel.screenshot({ path: testInfo.outputPath('chest-panel.png') });
  401 |   const closing = await page.evaluate(() => {
  402 |     const element = document.querySelector('dst-chest-panel') as HTMLElement & { close(): void; isClosing: boolean };
  403 |     let closedContainer: string | undefined;
  404 |     element.addEventListener('game:chest-close', (event) => closedContainer = (event as CustomEvent).detail.containerId);
  405 |     element.close();
  406 |     const panel = element.shadowRoot!.querySelector<HTMLElement>('.chest-panel')!;
  407 |     const canvas = panel.querySelector<HTMLCanvasElement>('.chest-panel__background')!;
  408 |     return { animation: canvas.dataset.animation, visible: !panel.hidden, isClosing: element.isClosing, closedContainer };
  409 |   });
  410 |   expect(closing).toEqual({ animation: 'close', visible: true, isClosing: true, closedContainer: 'world:treasurechest:animated' });
  411 |   await expect(panel).toBeHidden();
  412 | });
  413 | 
  414 | test('emits an inventory slot context-menu event and suppresses the native menu', async ({ page }) => {
  415 |   await openFixture(page);
  416 | 
  417 |   await page.evaluate(() => {
  418 |     const inventoryBar = document.querySelector('dst-inventory-bar') as HTMLElement & {
  419 |       setSlot(ref: unknown, item: unknown): void;
  420 |     };
  421 |     inventoryBar.setSlot({ containerId: 'player:inventory', slotKey: '0' }, {
  422 |       id: 'meatballs',
  423 |       name: '肉丸',
  424 |       count: 1,
  425 |       maxStack: 40,
  426 |       icon: 'meatballs.tex',
  427 |     });
  428 |     window.addEventListener('game:slot-context-menu', (event) => {
  429 |       (window as typeof window & { slotContextMenu?: unknown }).slotContextMenu = {
  430 |         detail: (event as CustomEvent).detail,
  431 |       };
  432 |     });
  433 |     window.addEventListener('contextmenu', (event) => {
  434 |       (window as typeof window & { nativeContextMenuPrevented?: boolean })
  435 |         .nativeContextMenuPrevented = event.defaultPrevented;
  436 |     });
  437 |   });
  438 | 
  439 |   await page.locator('dst-inventory-bar .inventory-bar__items .inventory-slot').first().click({
  440 |     button: 'right',
  441 |   });
  442 | 
  443 |   await expect.poll(() => page.evaluate(() =>
  444 |     (window as typeof window & { slotContextMenu?: unknown }).slotContextMenu,
  445 |   )).toEqual({
  446 |     detail: {
  447 |       slot: { containerId: 'player:inventory', slotKey: '0' },
  448 |       shiftKey: false,
  449 |     },
  450 |   });
  451 |   await expect.poll(() => page.evaluate(() =>
  452 |     (window as typeof window & { nativeContextMenuPrevented?: boolean }).nativeContextMenuPrevented,
  453 |   )).toBe(true);
  454 | });
  455 | 
  456 | test('updates individual inventory signals and emits an atomic transfer request', async ({ page }) => {
  457 |   await openFixture(page);
  458 | 
  459 |   await page.evaluate(() => {
  460 |     const inventoryBar = document.querySelector('dst-inventory-bar') as HTMLElement & {
  461 |       setSlot(ref: unknown, item: unknown): void;
  462 |     };
  463 |     inventoryBar.setSlot({ containerId: 'player:inventory', slotKey: '0' }, {
  464 |       id: 'cutgrass',
  465 |       name: '草',
  466 |       count: 3,
  467 |       maxStack: 40,
  468 |       icon: 'cutgrass.tex',
  469 |     });
  470 | 
  471 |     const eventLog: Array<{ type: string; detail: unknown }> = [];
  472 |     window.addEventListener('game:slot-transfer-request', (event) => {
  473 |       eventLog.push({ type: event.type, detail: (event as CustomEvent).detail });
  474 |     });
  475 |     (window as typeof window & { inventoryDragEventLog: typeof eventLog }).inventoryDragEventLog = eventLog;
  476 |   });
  477 | 
  478 |   const slots = page.locator('dst-inventory-bar .inventory-bar__items .inventory-slot');
  479 |   await expect(slots.nth(0).locator('.inventory-slot__count')).toHaveText('3');
  480 |   await expect(slots.nth(0)).toHaveAttribute('data-item-id', 'cutgrass');
  481 |   await expect(slots.nth(0).locator('.inventory-slot__icon')).toHaveAttribute('data-loaded', 'true');
  482 | 
  483 |   const sourceIconBox = await slots.nth(0).locator('.inventory-slot__icon').boundingBox();
  484 |   const sourceBox = await slots.nth(0).boundingBox();
  485 |   const targetBox = await slots.nth(2).boundingBox();
  486 |   expect(sourceBox).not.toBeNull();
  487 |   expect(targetBox).not.toBeNull();
  488 |   await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  489 |   await page.mouse.down();
  490 |   await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, {
  491 |     steps: 4,
  492 |   });
  493 |   const dragPreview = page.locator('.slot-drag-preview');
  494 |   await expect(dragPreview).toBeVisible();
  495 |   await expect(dragPreview).toHaveAttribute('data-item-id', 'cutgrass');
  496 |   await expect(dragPreview.locator('.slot-drag-preview__icon')).toHaveCount(1);
> 497 |   await expect(dragPreview.locator('img.slot-drag-preview__icon')).toHaveCount(1);
      |                                                                    ^ Error: expect(locator).toHaveCount(expected) failed
  498 |   const previewBox = await dragPreview.boundingBox();
  499 |   expect(previewBox).not.toBeNull();
  500 |   expect(sourceIconBox).not.toBeNull();
  501 |   expect(previewBox!.width).toBeCloseTo(sourceIconBox!.width, 1);
  502 |   expect(previewBox!.height).toBeCloseTo(sourceIconBox!.height, 1);
  503 |   expect(Math.abs(
  504 |     previewBox!.x + previewBox!.width / 2 - (targetBox!.x + targetBox!.width / 2),
  505 |   )).toBeLessThan(2);
  506 |   expect(Math.abs(
  507 |     previewBox!.y + previewBox!.height / 2 - (targetBox!.y + targetBox!.height / 2),
  508 |   )).toBeLessThan(2);
  509 |   await page.mouse.up();
  510 |   await expect(dragPreview).toHaveCount(0);
  511 | 
  512 |   await expect.poll(() => page.evaluate(() =>
  513 |     (window as typeof window & { inventoryDragEventLog: unknown[] }).inventoryDragEventLog,
  514 |   )).toEqual([
  515 |     {
  516 |       type: 'game:slot-transfer-request',
  517 |       detail: {
  518 |         operationId: 1,
  519 |         from: { containerId: 'player:inventory', slotKey: '0' },
  520 |         to: { containerId: 'player:inventory', slotKey: '2' },
  521 |         itemId: 'cutgrass',
  522 |         amount: 3,
  523 |       },
  524 |     },
  525 |   ]);
  526 | });
  527 | 
  528 | test('picks up a backpack item on click and transfers it into storage on the next click', async ({ page }) => {
  529 |   await openFixture(page);
  530 | 
  531 |   await page.evaluate(() => {
  532 |     const inventoryBar = document.querySelector('dst-inventory-bar') as HTMLElement & {
  533 |       setSlot(ref: unknown, item: unknown): void;
  534 |     };
  535 |     inventoryBar.setSlot({ containerId: 'player:inventory', slotKey: '0' }, {
  536 |       id: 'cutgrass',
  537 |       name: '草',
  538 |       count: 3,
  539 |       maxStack: 40,
  540 |       icon: 'cutgrass.tex',
  541 |     });
  542 |     const storagePanel = document.querySelector('dst-chest-panel') as HTMLElement & {
  543 |       open(options: { containerId: string; slotCount: number; title: string }): void;
  544 |       setAnchor(clientX: number, clientY: number): void;
  545 |     };
  546 |     storagePanel.open({
  547 |       containerId: 'world:treasurechest:0',
  548 |       slotCount: 9,
  549 |       title: '箱子',
  550 |     });
  551 |     storagePanel.setAnchor(420, 360);
  552 |     window.addEventListener('game:slot-transfer-request', (event) => {
  553 |       (window as typeof window & { clickTransfer?: unknown }).clickTransfer =
  554 |         (event as CustomEvent).detail;
  555 |     });
  556 |   });
  557 | 
  558 |   const slots = page.locator('dst-inventory-bar .inventory-bar__items .inventory-slot');
  559 |   await expect(slots.nth(0).locator('.inventory-slot__icon')).toHaveAttribute('data-loaded', 'true');
  560 |   await slots.nth(0).click();
  561 | 
  562 |   const preview = page.locator('.slot-drag-preview');
  563 |   await expect(preview).toBeVisible();
  564 |   await expect(preview).toHaveAttribute('data-item-id', 'cutgrass');
  565 |   await expect(slots.nth(0)).toHaveClass(/is-dragging/);
  566 | 
  567 |   const storageSlots = page.locator('dst-chest-panel .inventory-slot');
  568 |   const targetBox = await storageSlots.nth(2).boundingBox();
  569 |   expect(targetBox).not.toBeNull();
  570 |   await page.mouse.move(
  571 |     targetBox!.x + targetBox!.width / 2,
  572 |     targetBox!.y + targetBox!.height / 2,
  573 |   );
  574 |   await expect(storageSlots.nth(2)).toHaveClass(/is-drop-target/);
  575 |   await storageSlots.nth(2).click();
  576 | 
  577 |   await expect(preview).toHaveCount(0);
  578 |   await expect.poll(() => page.evaluate(() =>
  579 |     (window as typeof window & { clickTransfer?: unknown }).clickTransfer,
  580 |   )).toEqual({
  581 |     operationId: 1,
  582 |     from: { containerId: 'player:inventory', slotKey: '0' },
  583 |     to: { containerId: 'world:treasurechest:0', slotKey: '2' },
  584 |     itemId: 'cutgrass',
  585 |     amount: 3,
  586 |   });
  587 | });
  588 | 
  589 | test('lets a listener claim the slot click so a placeable stack is not picked up', async ({ page }) => {
  590 |   await openFixture(page);
  591 | 
  592 |   await page.evaluate(() => {
  593 |     const inventoryBar = document.querySelector('dst-inventory-bar') as HTMLElement & {
  594 |       setSlot(ref: unknown, item: unknown): void;
  595 |     };
  596 |     inventoryBar.setSlot({ containerId: 'player:inventory', slotKey: '0' }, {
  597 |       id: 'wall_wood_item',
```
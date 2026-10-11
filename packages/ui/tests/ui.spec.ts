import { expect, test, type Page } from '@playwright/test';
import { categories, type Recipe } from '../src/categories';
import { INVENTORY_PRODUCT_SPECS, INVENTORY_RECIPES } from '../src/categories/shared';
import { createSlotContainer } from '../src/slot/slot-container';
import type { DstChestPanelElement } from '../src/chest-panel';

const fixtureUrl = '/tests/fixture.html';
const renderedCraftingCategories = categories.filter(({ id }) => id !== 'none');
const renderedRecipeCount = renderedCraftingCategories.reduce((count, category) => count + category.recipes.length, 0);
const renderedQuickItemCount = renderedCraftingCategories.reduce((count, category) => count + Math.min(10, category.recipes.length), 0);

for (const storage of [
  { prefab: 'dragonflychest', slotCount: 12, columns: 3, panelArchive: 'ui_chester_shadow_3x4.zip', singleItems: false },
]) {
  test(`renders ${storage.prefab} with its original panel, capacity and inventory-sized slots`, async ({ page }) => {
    await openFixture(page);
    await page.evaluate((storage) => {
      const panel = document.querySelector('dst-chest-panel') as DstChestPanelElement;
      panel.open({ ...storage, containerId: `world:${storage.prefab}:test`, title: storage.prefab });
      panel.setAnchor(700, 650);
      if (storage.singleItems && !panel.slotContainer!.slots.every((slot) => slot.maxStack() === 1)) {
        throw new Error('Light slots must accept one item');
      }
    }, storage);
    const panel = page.locator('dst-chest-panel');
    const background = panel.locator('.chest-panel__background');
    await expect(background).toHaveAttribute('data-archive', new RegExp(`${storage.panelArchive}$`));
    await expect(background).toHaveAttribute('data-loaded', 'true');
    const slots = panel.locator('.inventory-slot');
    await expect(slots).toHaveCount(storage.slotCount);
    await expect(slots.first()).toBeVisible();
    const first = (await slots.first().boundingBox())!;
    const nextRow = (await slots.nth(storage.columns).boundingBox())!;
    const inventory = (await page.locator('dst-inventory-bar .inventory-slot').first().boundingBox())!;
    expect(first.width).toBeCloseTo(inventory.width, 1);
    expect(first.height).toBeCloseTo(inventory.height, 1);
    expect(nextRow.x).toBeCloseTo(first.x, 1);
    expect(nextRow.y).toBeGreaterThan(first.y);
  });
}

test('shows four prepared food slots to the right and transfers one item from a stack', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(() => {
    const panel = document.querySelector('dst-cook-pot-panel') as HTMLElement & {
      open(options: { containerId: string; slotCount: number; title: string }): void;
      setAnchor(x: number, y: number): void;
      slotContainer: { slots: { constructor: { name: string }; maxStack(): number }[] };
    };
    panel.open({ containerId: 'world:cookpot:pot', slotCount: 4, title: '烹饪锅' });
    panel.setAnchor(420, 360);
    if (!panel.slotContainer.slots.every((slot) => slot.constructor.name === 'PreparedFoodSlot' && slot.maxStack() === 1)) {
      throw new Error('Expected dedicated PreparedFoodSlot instances');
    }
    const bar = document.querySelector('dst-inventory-bar') as HTMLElement & {
      setSlot(address: unknown, item: unknown): void;
    };
    bar.setSlot({ containerId: 'player:inventory', slotKey: '0' }, {
      id: 'berries', name: '浆果', count: 3, maxStack: 40, icon: 'berries.tex',
    });
    (window as typeof window & { potTransfers: unknown[] }).potTransfers = [];
    window.addEventListener('game:slot-transfer-request', (event) => {
      (window as typeof window & { potTransfers: unknown[] }).potTransfers.push((event as CustomEvent).detail);
    });
  });
  const panel = page.locator('dst-cook-pot-panel .cook-pot-panel');
  const background = panel.locator('.chest-panel__background');
  await expect(background).toHaveAttribute('data-archive', /\/dst\/data\/anim\/ui_cookpot_1x4.zip$/);
  await expect(background).toHaveAttribute('data-loaded', 'true');
  await expect(background).toHaveAttribute('data-animation', 'open');
  await expect(background).toHaveAttribute('data-playing', 'false');
  const slots = panel.locator('.inventory-slot');
  await expect(slots).toHaveCount(4);
  await expect(slots.nth(0)).toHaveAttribute('data-background-asset', 'preparedfood_slot.tex');
  await expect(slots.nth(0).locator('.inventory-slot__background')).toHaveAttribute('data-loaded', 'true');
  const boxes = await Promise.all([0, 1, 2, 3].map((index) => slots.nth(index).boundingBox()));
  const inventoryBox = (await page.locator('dst-inventory-bar .inventory-slot').first().boundingBox())!;
  for (let i = 0; i < boxes.length; i++) {
    expect(boxes[i]!.width).toBeCloseTo(inventoryBox.width, 1);
    expect(boxes[i]!.height).toBeCloseTo(inventoryBox.height, 1);
    expect(boxes[i]!.x).toBeGreaterThan(420);
    expect(boxes[i]!.x).toBeCloseTo(boxes[0]!.x, 1);
    if (i > 0) expect(boxes[i]!.y).toBeGreaterThan(boxes[i - 1]!.y);
  }
  await page.locator('dst-inventory-bar .inventory-bar__items .inventory-slot').nth(0).dragTo(slots.nth(0));
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { potTransfers: unknown[] }).potTransfers,
  )).toEqual([{
    operationId: 1,
    from: { containerId: 'player:inventory', slotKey: '0' },
    to: { containerId: 'world:cookpot:pot', slotKey: '0' }, itemId: 'berries', amount: 1,
  }]);
});

test('creates addressable slot containers with per-slot acceptance rules', () => {
  const container = createSlotContainer({
    id: 'player:equipment',
    kind: 'equipment',
    slotKeys: ['hand', 'body'],
    accepts: (slotKey, item) => item.equippable === slotKey,
  });
  const torch = {
    id: 'torch',
    name: '火炬',
    count: 1,
    maxStack: 1,
    icon: 'torch.tex',
    equippable: 'hand',
  };

  expect(container.getSlot('hand').address).toEqual({
    containerId: 'player:equipment',
    slotKey: 'hand',
  });
  expect(container.getSlot('hand').accepts(torch)).toBe(true);
  expect(container.getSlot('body').accepts(torch)).toBe(false);
});

test('generates an inventory product spec for every recipe product', () => {
  const missingProducts = [...new Set(Object.values(INVENTORY_RECIPES)
    .map(({ productId }) => productId))]
    .filter((productId) => !INVENTORY_PRODUCT_SPECS[productId]);

  expect(missingProducts).toEqual([]);
  expect(INVENTORY_PRODUCT_SPECS.rope).toEqual({
    name: '绳子',
    icon: 'rope.tex',
  });
});

async function openFixture(page: Page): Promise<void> {
  await page.goto(fixtureUrl);
  await expect(page.locator('dst-crafting-ui')).toHaveCount(1);
  await expect(page.locator('dst-debug-console')).toHaveCount(1);
  await expect(page.locator('dst-chest-panel')).toHaveCount(1);
  await expect(page.locator('dst-status-hud')).toHaveCount(1);
  await expect(page.locator('dst-inventory-bar')).toHaveCount(1);
  await expect(page.locator('dst-map-controls')).toHaveCount(1);
}

test('opens the debug console with backquote and emits entered commands', async ({ page }) => {
  await openFixture(page);

  const debugConsole = page.locator('dst-debug-console');
  const panel = debugConsole.locator('.debug-console');
  const input = debugConsole.locator('.debug-console__input');
  const background = debugConsole.locator('.debug-console__background');
  await expect(panel).toBeHidden();
  await expect(background).toHaveAttribute('data-atlas', 'images/textboxes.xml');
  await expect(background).toHaveAttribute('data-element', 'textbox_long.tex');
  await expect(background).toHaveAttribute('data-loaded', 'true');

  await page.evaluate(() => {
    window.addEventListener('game:debug-command', (event) => {
      (window as typeof window & { debugCommand?: unknown }).debugCommand =
        (event as CustomEvent).detail;
    });
  });
  await page.keyboard.press('Backquote');
  await expect(panel).toBeVisible();
  await expect(input).toBeFocused();
  await input.fill('c_give("meatballs", 3)');
  await input.press('Enter');

  await expect(panel).toBeHidden();
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { debugCommand?: unknown }).debugCommand,
  )).toEqual({ command: 'c_give("meatballs", 3)' });

  await page.keyboard.press('Backquote');
  await input.press('ArrowUp');
  await expect(input).toHaveValue('c_give("meatballs", 3)');
  await input.press('Escape');
  await expect(panel).toBeHidden();
});

test('renders the inventory and equipment slots and emits selection events', async ({ page }) => {
  await openFixture(page);

  const inventoryBar = page.locator('dst-inventory-bar');
  await expect(inventoryBar.locator('.inventory-bar__items .inventory-slot')).toHaveCount(15);
  await expect(inventoryBar.locator('.inventory-bar__equipment .inventory-slot')).toHaveCount(3);

  await page.evaluate(() => {
    const bar = document.querySelector('dst-inventory-bar') as HTMLElement & {
      setSlot(ref: unknown, item: unknown): void;
    };
    bar.setSlot({ containerId: 'player:inventory', slotKey: '0' }, {
      id: 'axe',
      skinId: 'axe_feathered',
      name: '猎人斧',
      count: 1,
      maxStack: 1,
      icon: 'axe_feathered.tex',
      atlas: 'images/inventoryimages.xml',
    });
  });
  const skinnedSlot = inventoryBar.locator('.inventory-bar__items .inventory-slot').first();
  await expect(skinnedSlot).toHaveAttribute('data-item-id', 'axe');
  await expect(skinnedSlot).toHaveAttribute('data-skin-id', 'axe_feathered');
  await expect(skinnedSlot).toHaveAttribute('aria-label', '猎人斧，数量 1');
  await expect(skinnedSlot.locator('.inventory-slot__icon')).toHaveAttribute('data-element', 'axe_feathered.tex');
  await expect(skinnedSlot.locator('.inventory-slot__icon')).toHaveAttribute('data-loaded', 'true');

  await page.evaluate(() => {
    const eventLog: Array<{ type: string; detail: unknown }> = [];
    window.addEventListener('game:slot-select', (event) => {
      eventLog.push({ type: event.type, detail: (event as CustomEvent).detail });
    });
    window.addEventListener('game:self-inspect', (event) => {
      eventLog.push({ type: event.type, detail: null });
    });
    (window as typeof window & { inventoryEventLog: typeof eventLog }).inventoryEventLog = eventLog;
  });

  await inventoryBar.locator('.inventory-bar__items .inventory-slot').nth(4).click();
  await inventoryBar.locator('.inventory-bar__equipment .inventory-slot').nth(1).click();
  await inventoryBar.locator('.inventory-bar__inspect').click();

  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { inventoryEventLog: unknown[] }).inventoryEventLog,
  )).toEqual([
    {
      type: 'game:slot-select',
      detail: { slot: { containerId: 'player:inventory', slotKey: '4' } },
    },
    {
      type: 'game:slot-select',
      detail: { slot: { containerId: 'player:equipment', slotKey: 'body' } },
    },
    { type: 'game:self-inspect', detail: null },
  ]);
});

test('routes right-click input through slot signals and preserves the bubbling context-menu event', async ({ page }) => {
  await openFixture(page);

  await page.evaluate(() => {
    const inventoryBar = document.querySelector('dst-inventory-bar') as HTMLElement & {
      setSlot(ref: unknown, item: unknown): void;
      contextMenu: { subscribe(listener: (request: unknown) => void): () => void };
    };
    inventoryBar.setSlot({ containerId: 'player:inventory', slotKey: '0' }, {
      entityId: 'food-entity',
      id: 'meatballs',
      name: '肉丸',
      count: 1,
      maxStack: 40,
      icon: 'meatballs.tex',
    });
    inventoryBar.contextMenu.subscribe(request => {
      (window as typeof window & { slotContextRequest?: unknown }).slotContextRequest = request;
    });
    window.addEventListener('game:slot-context-menu', (event) => {
      (window as typeof window & { slotContextMenu?: unknown }).slotContextMenu = {
        detail: (event as CustomEvent).detail,
      };
    });
    window.addEventListener('contextmenu', (event) => {
      (window as typeof window & { nativeContextMenuPrevented?: boolean })
        .nativeContextMenuPrevented = event.defaultPrevented;
    });
  });

  await page.locator('dst-inventory-bar .inventory-bar__items .inventory-slot').first().click({
    button: 'right',
  });

  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { slotContextMenu?: unknown }).slotContextMenu,
  )).toEqual({
    detail: {
      slot: { containerId: 'player:inventory', slotKey: '0' },
      shiftKey: false,
    },
  });
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { nativeContextMenuPrevented?: boolean }).nativeContextMenuPrevented,
  )).toBe(true);
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { slotContextRequest?: unknown }).slotContextRequest,
  )).toMatchObject({ action: 'use', item: { entityId: 'food-entity', id: 'meatballs' } });

  await page.locator('dst-inventory-bar .inventory-bar__items .inventory-slot').first().click({
    button: 'right', modifiers: ['Shift'],
  });
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { slotContextRequest?: unknown }).slotContextRequest,
  )).toMatchObject({ action: 'drop', shiftKey: true });
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { slotContextMenu?: unknown }).slotContextMenu,
  )).toMatchObject({ detail: { shiftKey: true } });
});

test('updates individual inventory signals and emits an atomic transfer request', async ({ page }) => {
  await openFixture(page);

  await page.evaluate(() => {
    const inventoryBar = document.querySelector('dst-inventory-bar') as HTMLElement & {
      setSlot(ref: unknown, item: unknown): void;
    };
    inventoryBar.setSlot({ containerId: 'player:inventory', slotKey: '0' }, {
      id: 'cutgrass',
      name: '草',
      count: 3,
      maxStack: 40,
      icon: 'cutgrass.tex',
    });

    const eventLog: Array<{ type: string; detail: unknown }> = [];
    window.addEventListener('game:slot-transfer-request', (event) => {
      eventLog.push({ type: event.type, detail: (event as CustomEvent).detail });
    });
    (window as typeof window & { inventoryDragEventLog: typeof eventLog }).inventoryDragEventLog = eventLog;
  });

  const slots = page.locator('dst-inventory-bar .inventory-bar__items .inventory-slot');
  await expect(slots.nth(0).locator('.inventory-slot__count')).toHaveText('3');
  await expect(slots.nth(0)).toHaveAttribute('data-item-id', 'cutgrass');
  await expect(slots.nth(0).locator('.inventory-slot__icon')).toHaveAttribute('data-loaded', 'true');

  const sourceIconBox = await slots.nth(0).locator('.inventory-slot__icon').boundingBox();
  const sourceBox = await slots.nth(0).boundingBox();
  const targetBox = await slots.nth(2).boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, {
    steps: 4,
  });
  const dragPreview = page.locator('.slot-drag-preview');
  await expect(dragPreview).toBeVisible();
  await expect(dragPreview).toHaveAttribute('data-item-id', 'cutgrass');
  await expect(dragPreview.locator('.slot-drag-preview__icon')).toHaveCount(1);
  await expect(dragPreview.locator('.slot-drag-preview__icon')).toHaveAttribute('data-loaded', 'true');
  const previewBox = await dragPreview.boundingBox();
  expect(previewBox).not.toBeNull();
  expect(sourceIconBox).not.toBeNull();
  expect(previewBox!.width).toBeCloseTo(sourceIconBox!.width, 1);
  expect(previewBox!.height).toBeCloseTo(sourceIconBox!.height, 1);
  expect(Math.abs(
    previewBox!.x + previewBox!.width / 2 - (targetBox!.x + targetBox!.width / 2),
  )).toBeLessThan(2);
  expect(Math.abs(
    previewBox!.y + previewBox!.height / 2 - (targetBox!.y + targetBox!.height / 2),
  )).toBeLessThan(2);
  await page.mouse.up();
  await expect(dragPreview).toHaveCount(0);

  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { inventoryDragEventLog: unknown[] }).inventoryDragEventLog,
  )).toEqual([
    {
      type: 'game:slot-transfer-request',
      detail: {
        operationId: 1,
        from: { containerId: 'player:inventory', slotKey: '0' },
        to: { containerId: 'player:inventory', slotKey: '2' },
        itemId: 'cutgrass',
        amount: 3,
      },
    },
  ]);
});

test('lets a listener claim the slot click so a placeable stack is not picked up', async ({ page }) => {
  await openFixture(page);

  await page.evaluate(() => {
    const inventoryBar = document.querySelector('dst-inventory-bar') as HTMLElement & {
      setSlot(ref: unknown, item: unknown): void;
    };
    inventoryBar.setSlot({ containerId: 'player:inventory', slotKey: '0' }, {
      id: 'wall_wood_item',
      name: '木墙',
      count: 6,
      maxStack: 99,
      icon: 'wall_wood_item.tex',
    });
    const events: string[] = [];
    window.addEventListener('game:slot-select', (event) => {
      events.push((event as CustomEvent).detail.slot.slotKey);
      // A placeable item claims the click so placement can start instead of a transfer.
      event.preventDefault();
    }, true);
    (window as typeof window & { claimedSelect: string[] }).claimedSelect = events;
  });

  const slots = page.locator('dst-inventory-bar .inventory-bar__items .inventory-slot');
  await expect(slots.nth(0).locator('.inventory-slot__icon')).toHaveAttribute('data-loaded', 'true');
  await slots.nth(0).click();

  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { claimedSelect?: unknown }).claimedSelect,
  )).toEqual(['0']);
  await expect(page.locator('.slot-drag-preview')).toHaveCount(0);
  await expect(slots.nth(0)).not.toHaveClass(/is-dragging/);
});

test('updates the crafting selection and collapsed state', async ({ page }) => {
  await openFixture(page);

  const crafting = page.locator('dst-crafting-ui');
  const panel = crafting.locator('.craft-panel');
  const recipes = crafting.locator('.craft-recipe-category:not([hidden]) .craft-recipe');

  await expect(panel).toHaveClass(/is-collapsed/);
  await crafting.locator('.craft-quick-toggle').click();
  await expect(panel).not.toHaveClass(/is-collapsed/);

  await expect(crafting.locator('.craft-category')).toHaveCount(categories.length);
  await expect(recipes).toHaveCount(56);
  await expect(recipes.first()).toHaveAttribute('aria-selected', 'true');
  await expect(crafting.locator('.craft-detail h2')).toHaveText('斧头');
  const background = recipes.first().locator('.craft-recipe-bg');
  const frame = recipes.first().locator('.craft-recipe-frame');
  const lock = recipes.first().locator('.craft-lock');
  await expect(background).toHaveAttribute('data-atlas', 'images/crafting_menu.xml');
  await expect(background).toHaveAttribute('data-element', 'slot_bg.tex');
  await expect(frame).toHaveAttribute('data-element', 'slot_frame.tex');
  await expect(lock).toHaveAttribute('data-element', 'slot_fg_lock.tex');
  await expect(background).toHaveAttribute('data-loaded', 'true');
  await expect(frame).toHaveAttribute('data-loaded', 'true');
  await expect(lock).toHaveAttribute('data-loaded', 'true');
  await expect(background).toHaveAttribute('data-width', '128');
  await expect(background).toHaveAttribute('data-height', '128');
  await expect(recipes.first().locator('.craft-recipe-asset')).toHaveAttribute('data-element', 'axe.tex');
  await expect(recipes.first().locator('.craft-recipe-asset')).toHaveAttribute('data-loaded', 'true');
  await expect(crafting.locator('.craft-selected-icon .craft-recipe-asset')).toHaveAttribute('data-element', 'axe.tex');
  await expect(crafting.locator('.craft-preview strong')).toHaveText('默认');
  await expect(crafting.locator('.craft-arrow-left')).toHaveAttribute('aria-label', '上一个皮肤');
  await expect(crafting.locator('.craft-arrow-right')).toHaveAttribute('aria-label', '下一个皮肤');
  await expect(crafting.locator('.craft-arrow-right')).toBeEnabled();
  await crafting.locator('.craft-arrow-right').click();
  await expect(crafting.locator('.craft-selected-icon .craft-recipe-asset')).toHaveAttribute(
    'data-element',
    'axe_feathered.tex',
  );
  await expect(crafting.locator('.craft-selected-icon .craft-recipe-asset')).toHaveAttribute('data-loaded', 'true');
  await expect(crafting.locator('.craft-preview strong')).toHaveText('猎人斧');
  await expect(crafting.locator('.craft-material-asset')).toHaveCount(2);
  await expect(crafting.locator('.craft-material-asset').nth(0)).toHaveAttribute(
    'data-atlas',
    'images/inventoryimages.xml',
  );
  await expect(crafting.locator('.craft-material-asset').nth(0)).toHaveAttribute('data-element', 'twigs.tex');
  await expect(crafting.locator('.craft-material-asset').nth(1)).toHaveAttribute('data-element', 'flint.tex');
  await expect(crafting.locator('.craft-material-asset[data-loaded="true"]')).toHaveCount(2);
  await expect(crafting.locator('.craft-material-count')).toHaveText(['17/1', '0/1']);

  const fireCategory = crafting.locator('.craft-category[aria-label="光源"]');
  await fireCategory.click();
  await expect(fireCategory).toHaveAttribute('aria-pressed', 'true');
  await expect(crafting.locator('.craft-header h1')).toHaveText('光源');
  await expect(recipes).toHaveCount(23);
  const torchRecipe = recipes.filter({ has: page.locator('[data-element="torch.tex"]') });
  await torchRecipe.click();
  await expect(crafting.locator('.craft-detail h2')).toHaveText('火炬');
  await expect(recipes.locator('[data-element="torch.tex"]')).toHaveAttribute('data-loaded', 'true');
  await expect(crafting.locator('.craft-material-asset').nth(0)).toHaveAttribute('data-element', 'cutgrass.tex');
  await expect(crafting.locator('.craft-material-asset').nth(1)).toHaveAttribute('data-element', 'twigs.tex');
  await expect(crafting.locator('.craft-material-asset[data-loaded="true"]')).toHaveCount(2);
  await expect(crafting.locator('img[src*="crafting/item/"]')).toHaveCount(0);
  await expect(crafting.locator('.craft-material-count')).toHaveText(['3/2', '17/2']);
  await expect(crafting.locator('.craft-build')).toBeEnabled();
  await expect(torchRecipe.locator('.craft-lock')).toHaveCount(0);
  await crafting.locator('.craft-arrow-right').click();
  await expect(crafting.locator('.craft-selected-icon .craft-recipe-asset')).toHaveAttribute(
    'data-element',
    'torch_barber.tex',
  );
  await expect(crafting.locator('.craft-preview strong')).toHaveText('油脂火炬');

  await page.evaluate(() => {
    const stateChanges: Array<{ crafting: boolean; recipeId: string; at: number }> = [];
    (window as typeof window & { craftingStateChanges?: unknown }).craftingStateChanges = stateChanges;
    window.addEventListener('game:crafting-state-change', (event) => {
      stateChanges.push({
        ...(event as CustomEvent<{ crafting: boolean; recipeId: string }>).detail,
        at: performance.now(),
      });
    });
    window.addEventListener('game:craft-request', (event) => {
      (window as typeof window & { craftRequest?: unknown; craftRequestAt?: number }).craftRequest =
        (event as CustomEvent).detail;
      (window as typeof window & { craftRequestAt?: number }).craftRequestAt = performance.now();
    });
  });
  await crafting.locator('.craft-build').click();
  await expect(crafting.locator('.craft-build')).toBeDisabled();
  await expect(crafting.locator('.craft-build')).toHaveText('制作中…');
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { craftingStateChanges?: unknown }).craftingStateChanges,
  )).toEqual([{
    crafting: true,
    recipeId: 'torch',
    skinId: 'torch_barber',
    at: expect.any(Number),
  }]);
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { craftRequest?: unknown }).craftRequest,
  )).toEqual({ recipeId: 'torch', skinId: 'torch_barber' });
  const craftTiming = await page.evaluate(() => {
    const target = window as typeof window & {
      craftRequestAt?: number;
      craftingStateChanges?: Array<{ crafting: boolean; recipeId: string; at: number }>;
    };
    return {
      elapsed: target.craftRequestAt! - target.craftingStateChanges![0].at,
      states: target.craftingStateChanges!.map(({ crafting, recipeId }) => ({ crafting, recipeId })),
    };
  });
  expect(craftTiming.elapsed).toBeGreaterThanOrEqual(900);
  expect(craftTiming.states).toEqual([
    { crafting: true, recipeId: 'torch' },
    { crafting: false, recipeId: 'torch' },
  ]);
  await expect(crafting.locator('.craft-build')).toBeEnabled();

  await page.evaluate(() => {
    const element = document.querySelector('dst-crafting-ui') as HTMLElement & {
      setMaterialSummary(summary: Readonly<Record<string, number>>): void;
    };
    element.setMaterialSummary({ cutgrass: 1, twigs: 15, torch: 1 });
  });
  await expect(crafting.locator('.craft-header h1')).toHaveText('光源');
  await expect(crafting.locator('.craft-detail h2')).toHaveText('火炬');
  await expect(crafting.locator('.craft-material-count')).toHaveText(['1/2', '15/2']);
  await expect(crafting.locator('.craft-build')).toBeDisabled();

  const scienceCategory = crafting.locator('.craft-category[aria-label="科学"]');
  await scienceCategory.click();
  await expect(scienceCategory).toHaveAttribute('aria-pressed', 'true');
  await expect(crafting.locator('.craft-header h1')).toHaveText('科学');
  await expect(recipes).toHaveCount(22);
  await expect(recipes.first()).toHaveAttribute('aria-selected', 'true');
  await expect(crafting.locator('.craft-detail h2')).toHaveText('科学机器');
  await expect(crafting.locator('.craft-material')).toHaveCount(3);
  await expect(crafting.locator('.craft-build')).toBeDisabled();

  await page.evaluate(() => {
    const element = document.querySelector('dst-crafting-ui') as HTMLElement & {
      setBufferedRecipes(recipeIds: Iterable<string>): void;
    };
    element.setBufferedRecipes(['researchlab']);
  });
  const bufferedResearchLab = recipes.filter({ has: page.locator('[data-element="researchlab.tex"]') });
  await expect(bufferedResearchLab.locator('.craft-recipe-bg')).toHaveAttribute(
    'data-element',
    'slot_bg_buffered.tex',
  );
  await expect(bufferedResearchLab.locator('.craft-lock')).toHaveCount(0);
  await expect(crafting.locator('.craft-build')).toBeEnabled();
  await expect(crafting.locator('.craft-build')).toHaveText('放置');

  await crafting.locator('.craft-view-toggle').click();
  await expect(panel).toHaveClass(/is-collapsed/);
  await expect(crafting.locator('.craft-quick-toggle')).toHaveAttribute('aria-expanded', 'false');

  await crafting.locator('.craft-quick-toggle').click();
  await expect(panel).not.toHaveClass(/is-collapsed/);
  await expect(crafting.locator('.craft-quick-toggle')).toHaveAttribute('aria-expanded', 'true');
});

test('keeps every category mounted and switches groups without recreating buttons or effects', async ({ page }) => {
  await openFixture(page);
  const crafting = page.locator('dst-crafting-ui');
  await crafting.locator('.craft-quick-toggle').click();
  const recipeGroups = crafting.locator('.craft-recipe-category');
  const quickGroups = crafting.locator('.craft-quick-category');
  await expect(recipeGroups).toHaveCount(renderedCraftingCategories.length);
  await expect(quickGroups).toHaveCount(renderedCraftingCategories.length);
  await expect(crafting.locator('.craft-recipe')).toHaveCount(renderedRecipeCount);
  await expect(crafting.locator('.craft-quick-item')).toHaveCount(renderedQuickItemCount);
  await expect.poll(() => crafting.locator('.craft-recipe-category [data-atlas]:not([data-loaded="true"]):not([data-error])').count(), { timeout: 20_000 }).toBe(0);

  const initial = await page.evaluate(() => {
    const element = document.querySelector('dst-crafting-ui') as HTMLElement & { recipeButtonEffects: Array<() => void> };
    const root = element.shadowRoot!;
    const nodes = [...root.querySelectorAll('.craft-recipe, .craft-recipe [data-atlas], .craft-quick-item, .craft-quick-item [data-atlas]')];
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(root.querySelector('.craft-recipes')!, { childList: true, subtree: true });
    observer.observe(root.querySelector('.craft-quick-items')!, { childList: true, subtree: true });
    (window as typeof window & { categorySnapshot: unknown }).categorySnapshot = {
      nodes, effects: [...element.recipeButtonEffects], mutations, observer,
    };
    return { effects: element.recipeButtonEffects.length };
  });
  expect(initial.effects).toBe(renderedRecipeCount * 2);

  for (const name of ['光源', '科学', '全部', '工具', '光源']) {
    await crafting.locator(`.craft-category[aria-label="${name}"]`).click();
    await expect(crafting.locator('.craft-header h1')).toHaveText(name);
    await expect(crafting.locator('.craft-recipe-category:not([hidden])')).toHaveCount(name === '全部' ? renderedCraftingCategories.length : 1);
    await expect(crafting.locator('.craft-quick-category:not([hidden])')).toHaveCount(1);
    await expect(crafting.locator('.craft-category[aria-pressed="true"]')).toHaveAttribute('aria-label', name);
    if (name === '全部') {
      await expect(crafting.locator('.craft-recipe-category:not([hidden]) .craft-recipe')).toHaveCount(renderedRecipeCount);
      const fireIndex = renderedCraftingCategories.findIndex(({ id }) => id === 'fire');
      await recipeGroups.nth(fireIndex).locator('.craft-recipe').first().click();
      await expect(crafting.locator('.craft-detail h2')).toHaveText(renderedCraftingCategories[fireIndex].recipes[0].name);
      await crafting.locator('.craft-quick-category:not([hidden]) .craft-quick-item').nth(5).click();
      await expect(crafting.locator('.craft-detail h2')).toHaveText(renderedCraftingCategories[0].recipes[5].name);
      await expect(crafting.locator('.craft-recipe[aria-selected="true"]')).toHaveCount(1);
    }
    const retained = await page.evaluate(() => {
      const element = document.querySelector('dst-crafting-ui') as HTMLElement & { recipeButtonEffects: Array<() => void> };
      const snapshot = (window as typeof window & { categorySnapshot: {
        nodes: Element[]; effects: Array<() => void>; mutations: MutationRecord[]; observer: MutationObserver;
      } }).categorySnapshot;
      snapshot.mutations.push(...snapshot.observer.takeRecords());
      return {
        nodes: snapshot.nodes.every((node) => node.isConnected),
        effects: snapshot.effects.length === element.recipeButtonEffects.length
          && snapshot.effects.every((effect, index) => effect === element.recipeButtonEffects[index]),
        mutations: snapshot.mutations.length,
      };
    });
    expect(retained).toEqual({ nodes: true, effects: true, mutations: 0 });
  }

  // Seven recipe slots remain on each row with gaps after adding the group wrappers.
  const recipes = crafting.locator('.craft-recipe-category:not([hidden]) .craft-recipe');
  const first = (await recipes.nth(0).boundingBox())!;
  const second = (await recipes.nth(1).boundingBox())!;
  const seventh = (await recipes.nth(6).boundingBox())!;
  const eighth = (await recipes.nth(7).boundingBox())!;
  expect(second.x).toBeGreaterThan(first.x + first.width);
  expect(seventh.y).toBeCloseTo(first.y, 1);
  expect(eighth.x).toBeCloseTo(first.x, 1);
  expect(eighth.y).toBeGreaterThan(first.y + first.height);

  await crafting.locator('.craft-category[aria-label="工具"]').click();
  await page.evaluate(async () => {
    const element = document.querySelector('dst-crafting-ui') as HTMLElement & {
      setMaterialSummary(summary: Readonly<Record<string, number>>): void;
      setBufferedRecipes(ids: Iterable<string>): void;
    };
    element.setMaterialSummary({ cutgrass: 0, twigs: 0 });
    await Promise.resolve();
    element.setBufferedRecipes(['torch']);
    await Promise.resolve();
  });
  await crafting.locator('.craft-category[aria-label="光源"]').click();
  const torch = recipes.filter({ has: page.locator('[data-element="torch.tex"]') });
  await torch.click();
  await expect(torch.locator('.craft-lock')).toHaveCount(0);
  await expect(torch.locator('.craft-recipe-bg')).toHaveAttribute('data-element', 'slot_bg_buffered.tex');
  await expect(crafting.locator('.craft-build')).toBeEnabled();
  await expect(crafting.locator('.craft-build')).toHaveText('放置');
  await expect(crafting.locator('.craft-material-count')).toHaveText(['0/2', '0/2']);
});

test('renders retained offscreen recipe rows when scrolled and changes only two selection attributes', async ({ page }) => {
  await openFixture(page);
  const crafting = page.locator('dst-crafting-ui');
  await crafting.locator('.craft-quick-toggle').click();
  await crafting.locator('.craft-category[aria-label="全部"]').click();
  const allRecipes = categories.find(({ id }) => id === 'none')!.recipes;
  const group = crafting.locator('.craft-recipes');
  await expect(group.locator('.craft-recipe-row')).toHaveCount(renderedCraftingCategories.reduce((count, { recipes }) => count + Math.ceil(recipes.length / 7), 0));
  await expect(group.locator('.craft-recipe-row').last()).toHaveCSS('content-visibility', 'auto');
  await crafting.locator('.craft-recipes').evaluate((grid) => { grid.scrollTop = grid.scrollHeight; });
  const lastButton = group.locator('.craft-recipe').last();
  await expect(lastButton).toBeInViewport();
  const changedAttributes = await crafting.evaluate(async (element) => {
    const group = element.shadowRoot!.querySelector('.craft-recipes')!;
    const observer = new MutationObserver(() => {});
    observer.observe(group, { attributes: true, subtree: true, attributeFilter: ['aria-selected'] });
    const buttons = group.querySelectorAll<HTMLButtonElement>('.craft-recipe');
    buttons[buttons.length - 1].click();
    const records = observer.takeRecords();
    observer.disconnect();
    await Promise.resolve();
    return records.length;
  });
  expect(changedAttributes).toBe(2);
  await expect(lastButton).toHaveAttribute('aria-selected', 'true');
  await expect(crafting.locator('.craft-detail h2')).toHaveText(allRecipes.at(-1)!.name);
  await expect(group.locator('.craft-recipe[aria-selected="true"]')).toHaveCount(1);

  await page.setViewportSize({ width: 640, height: 640 });
  await crafting.locator('.craft-recipes').evaluate((grid) => { grid.scrollTop = 0; });
  const recipes = group.locator('.craft-recipe');
  const first = (await recipes.nth(0).boundingBox())!;
  const seventh = (await recipes.nth(6).boundingBox())!;
  const eighth = (await recipes.nth(7).boundingBox())!;
  expect(seventh.y).toBeCloseTo(first.y, 1);
  expect(eighth.x).toBeCloseTo(first.x, 1);
  expect(eighth.y).toBeGreaterThan(first.y + first.height);
});

test('emits composed map, pause, and camera events', async ({ page }) => {
  await openFixture(page);

  await page.evaluate(() => {
    const eventLog: Array<{ type: string; detail: unknown }> = [];
    for (const type of ['game:map-toggle', 'game:pause-toggle', 'game:camera-turn']) {
      window.addEventListener(type, (event) => {
        eventLog.push({ type, detail: (event as CustomEvent).detail });
      });
    }
    (window as typeof window & { eventLog: typeof eventLog }).eventLog = eventLog;
  });

  const controls = page.locator('dst-map-controls');
  await controls.locator('.map-controls__map').click();
  await controls.locator('.map-controls__pause').click();
  await controls.locator('.map-controls__turn--left').click();
  await controls.locator('.map-controls__turn--right').click();

  await expect(controls.locator('.map-controls__map')).toHaveAttribute('aria-pressed', 'true');
  await expect(controls.locator('.map-controls__pause')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { eventLog: unknown[] }).eventLog,
  )).toEqual([
    { type: 'game:map-toggle', detail: { isOpen: true } },
    { type: 'game:pause-toggle', detail: { isPaused: true } },
    { type: 'game:camera-turn', detail: { direction: 'left' } },
    { type: 'game:camera-turn', detail: { direction: 'right' } },
  ]);
});

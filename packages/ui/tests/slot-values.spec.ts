import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { DstInventoryBarElement } from '../src/inventory-bar';

test('subscribes to individual slot indicators, draws native meters and releases bindings on disconnect', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/fixture.html');
  await page.evaluate(() => {
    const bar = document.querySelector('dst-inventory-bar') as DstInventoryBarElement;
    bar.setSlot({ containerId: 'player:inventory', slotKey: '0' }, {
      entityId: 'berries:first', id: 'berries', name: '浆果', icon: 'berries.tex', count: 3, maxStack: 40,
      freshnessPercent: .75, wet: true,
    });
  });
  const slot = page.locator('dst-inventory-bar .inventory-bar__items .inventory-slot').first();
  const freshness = slot.locator('.inventory-slot__freshness');
  const wetness = slot.locator('.inventory-slot__wetness');
  await expect(slot.locator('.inventory-slot__count')).toHaveText('3');
  await expect(freshness).toHaveAttribute('data-archive', /\/anim\/spoiled_meter\.zip$/);
  await expect(freshness).toHaveAttribute('data-loaded', 'true');
  await expect(freshness).toHaveAttribute('data-percent', '0.25');
  await expect(freshness).toHaveAttribute('data-playing', 'false');
  await expect(wetness).toHaveAttribute('data-archive', /\/anim\/wet_meter\.zip$/);
  await expect(wetness).toHaveAttribute('data-loaded', 'true');
  await expect(wetness).toHaveAttribute('data-playing', 'false');
  await expect(wetness).toBeVisible();
  await expect(slot).toHaveAttribute('aria-label', '浆果，数量 3，新鲜度 75%，潮湿');

  await page.evaluate(() => {
    const bar = document.querySelector('dst-inventory-bar') as DstInventoryBarElement;
    const button = bar.shadowRoot!.querySelector('.inventory-slot')!;
    const nodes = ['.inventory-slot__percent', '.inventory-slot__freshness', '.inventory-slot__wetness'];
    const observed = { mutations: [] as string[], icon: button.querySelector('.inventory-slot__icon') };
    for (const selector of nodes) new MutationObserver(records => {
      if (records.length) observed.mutations.push(selector);
    }).observe(button.querySelector(selector)!, { attributes: true, childList: true, subtree: true });
    (window as any).slotValueFixture = { bar, button, observed };
    const address = { containerId: 'player:inventory', slotKey: '0' };
    bar.setSlot(address, { ...bar.getSlot(address)!, count: 2 });
  });
  await expect(slot.locator('.inventory-slot__count')).toHaveText('2');
  expect(await page.evaluate(() => (window as any).slotValueFixture.observed.mutations)).toEqual([]);
  expect(await page.evaluate(() => {
    const { button, observed } = (window as any).slotValueFixture;
    return button.querySelector('.inventory-slot__icon') === observed.icon;
  })).toBe(true);

  await page.evaluate(() => {
    const { bar } = (window as any).slotValueFixture;
    bar.setSlot({ containerId: 'player:inventory', slotKey: '0' }, {
      entityId: 'torch:next', id: 'torch', name: '火把', icon: 'torch.tex', count: 1, maxStack: 1, durabilityPercent: .5,
    });
  });
  await expect(freshness).toBeHidden();
  await expect(wetness).toBeHidden();
  await expect(slot.locator('.inventory-slot__percent')).toHaveText('50%');
  await page.evaluate(() => {
    const { bar, observed, button } = (window as any).slotValueFixture;
    observed.countMutations = 0;
    new MutationObserver(records => { observed.countMutations += records.length; })
      .observe(button.querySelector('.inventory-slot__count'), { childList: true, subtree: true });
    const address = { containerId: 'player:inventory', slotKey: '0' };
    bar.setSlot(address, { ...bar.getSlot(address), durabilityPercent: .005 });
  });
  await expect(slot.locator('.inventory-slot__percent')).toHaveText('1%');
  expect(await page.evaluate(() => (window as any).slotValueFixture.observed.countMutations)).toBe(0);

  await page.evaluate(() => {
    const { bar } = (window as any).slotValueFixture;
    bar.remove();
    bar.setSlot({ containerId: 'player:inventory', slotKey: '0' }, {
      id: 'berries', name: '浆果', icon: 'berries.tex', count: 4, maxStack: 40, freshnessPercent: 0, wet: true,
    });
  });
  expect(await page.evaluate(() => {
    const { button } = (window as any).slotValueFixture;
    return { count: button.querySelector('.inventory-slot__count').textContent,
      percent: button.querySelector('.inventory-slot__percent').textContent,
      wetHidden: button.querySelector('.inventory-slot__wetness').hidden };
  })).toEqual({ count: '', percent: '1%', wetHidden: true });
  await page.evaluate(() => document.body.append((window as any).slotValueFixture.bar));
  await expect(slot.locator('.inventory-slot__count')).toHaveText('4');
  await expect(freshness).toHaveAttribute('data-percent', '0.99');
  await expect(slot.locator('.inventory-slot__percent')).toHaveText('');
  await expect(wetness).toBeVisible();
  expect(errors).toEqual([]);
});


test('renders inventory-owned signals without replacing the UI item and unbinds replaced entities', async ({ page }) => {
  await page.goto('/tests/fixture.html');
  await page.evaluate(async url => {
    const { InventoryStore, InventorySlot, inventorySlotAddress } = await import(url);
    const address = inventorySlotAddress(0);
    const store = new InventoryStore([{ address, slot: new InventorySlot() }], {
      berries: { name: '浆果', icon: 'berries.tex', maxStack: 40 },
      // A fueled prefab adds fueled and InitializeFuelLevel in its configuration.
      torch: { name: '火把', icon: 'torch.tex', maxStack: 1, maxFuel: 75,
        configureEntity: (entity: any) => { if (!entity.components.fueled) entity.AddFueled().InitializeFuelLevel(75); } },
    });
    store.add('berries', 3);
    const entity = store.getEntity(address);
    entity.setFreshnessPercent(.75); entity.setWet(true);
    const bar = document.querySelector('dst-inventory-bar');
    const show = () => {
      const current = store.getEntity(address);
      const snapshot = current.snapshot();
      bar.setSlot(address, { id: snapshot.itemId, entityId: current.id, count: snapshot.count,
        ...store.getStackSpec(snapshot), signals: store.getItemSignals(address) });
    };
    show();
    // Deliberately no store.subscribe -> setSlot bridge: component signals must suffice.
    const slot = bar.containers[0].getSlot('0');
    (window as any).inventoryValueFixture = { store, entity, bar, slot, item: slot.item.peek(), show, address };
  }, `/@fs${fileURLToPath(new URL('../../inventory/src/index.ts', import.meta.url))}`);
  const button = page.locator('dst-inventory-bar .inventory-bar__items .inventory-slot').first();
  await expect(button.locator('.inventory-slot__count')).toHaveText('3');
  await expect(button.locator('.inventory-slot__freshness')).toHaveAttribute('data-percent', '0.25');
  await expect(button.locator('.inventory-slot__wetness')).toBeVisible();
  await page.evaluate(() => {
    const { store, entity, address } = (window as any).inventoryValueFixture;
    store.applySlotChanges([{ slot: address, itemId: 'berries', delta: -1 }]);
    entity.setFreshnessPercent(.5); entity.setWet(false);
  });
  await expect(button.locator('.inventory-slot__count')).toHaveText('2');
  await expect(button.locator('.inventory-slot__freshness')).toHaveAttribute('data-percent', '0.5');
  await expect(button.locator('.inventory-slot__wetness')).toBeHidden();
  expect(await page.evaluate(() => {
    const { slot, item, bar, address } = (window as any).inventoryValueFixture;
    return { unchanged: slot.item.peek() === item, count: bar.getSlot(address).count };
  })).toEqual({ unchanged: true, count: 2 });
  await page.evaluate(() => {
    const fixture = (window as any).inventoryValueFixture;
    const { store, address, show } = fixture;
    fixture.detached = store.extract(address, 2);
    store.add('torch', 1); show();
    store.setRemainingFuel(address, 37.5);
    fixture.detached.setFreshnessPercent(.1); fixture.detached.setWet(true);
  });
  await expect(button.locator('.inventory-slot__percent')).toHaveText('50%');
  await expect(button.locator('.inventory-slot__freshness')).toBeHidden();
  await expect(button.locator('.inventory-slot__wetness')).toBeHidden();
  await page.evaluate(() => {
    const { store, address, bar } = (window as any).inventoryValueFixture;
    bar.remove(); store.setRemainingFuel(address, 15);
  });
  expect(await page.evaluate(() => (window as any).inventoryValueFixture.bar.shadowRoot
    .querySelector('.inventory-slot__percent').textContent)).toBe('50%');
  await page.evaluate(() => document.body.append((window as any).inventoryValueFixture.bar));
  await expect(button.locator('.inventory-slot__percent')).toHaveText('20%');
  await page.evaluate(() => {
    const { store, bar } = (window as any).inventoryValueFixture;
    bar.remove(); store.dispose();
  });
});

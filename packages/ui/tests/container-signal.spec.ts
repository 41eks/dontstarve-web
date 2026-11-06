import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

test('renders container slot insts through shared slots and releases replaced panel bindings', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/fixture.html');
  await page.evaluate(async urls => {
    const { Container } = await import(urls.container);
    const { ItemEntity, StorageSlot } = await import(urls.inventory);
    const panel = document.querySelector('dst-chest-panel')!;
    const create = () => new Container({}, () => new StorageSlot(), (record: any) => new ItemEntity(record));
    const toItem = (item: any) => ({
      id: item.prefab, name: item.prefab, icon: `${item.prefab}.tex`, count: 0, maxStack: 20, tile: item.tile,
    });
    const container = create();
    container.SetNumSlots(2);
    panel.open({ containerId: 'container:first', slotCount: 2 });
    const stop = panel.bindContainer(container.slots, toItem);
    container.OnLoad({ slots: [{ slotKey: '1', item: { itemId: 'log', count: 3 } }] });
    (window as any).containerBinding = { panel, container, create, toItem, stop };
  }, {
    container: `/@fs${fileURLToPath(new URL('../../componets/src/container.ts', import.meta.url))}`,
    inventory: `/@fs${fileURLToPath(new URL('../../inventory/src/index.ts', import.meta.url))}`,
  });
  const panel = page.locator('dst-chest-panel');
  await expect(panel.locator('.inventory-slot')).toHaveCount(2);
  await expect(panel.locator('[data-slot-key="1"]')).toHaveAttribute('data-item-id', 'log');
  await expect(panel.locator('[data-slot-key="1"] .inventory-slot__count')).toHaveText('3');
  await page.evaluate(() => {
    const { container } = (window as any).containerBinding;
    container.GetItemInSlot(2).components.stackable.count = 2;
  });
  // The inst's tile carries the count; the slot keeps the same inst.
  await expect(panel.locator('[data-slot-key="1"] .inventory-slot__count')).toHaveText('2');
  await page.evaluate(() => {
    const state = (window as any).containerBinding;
    state.panel.close();
    const next = state.create();
    next.SetNumSlots(2);
    state.panel.open({ containerId: 'container:second', slotCount: 2 });
    state.panel.bindContainer(next.slots, state.toItem);
    state.stop();
    state.container.GetItemInSlot(2).components.stackable.count = 9;
    next.OnLoad({ slots: [{ slotKey: '0', item: { itemId: 'cutgrass', count: 4 } }] });
    state.next = next;
  });
  await expect(panel.locator('[data-slot-key="0"]')).toHaveAttribute('data-item-id', 'cutgrass');
  await expect(panel.locator('[data-slot-key="1"]')).toHaveAttribute('data-item-id', '');
  await page.evaluate(() => {
    const state = (window as any).containerBinding;
    state.panel.remove();
    state.next.dispose(); state.container.dispose();
  });
  expect(errors).toEqual([]);
});

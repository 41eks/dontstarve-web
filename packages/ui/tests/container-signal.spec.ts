import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

test('renders container DTO signals through shared slots and releases replaced panel bindings', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/fixture.html');
  await page.evaluate(async urls => {
    const { Container } = await import(urls.container);
    const { ItemEntity, StorageSlot } = await import(urls.inventory);
    const panel = document.querySelector('dst-chest-panel')!;
    const create = () => new Container({}, () => new StorageSlot(), (record: any) => new ItemEntity(record));
    const toItem = (record: any) => ({
      id: record.itemId, name: record.itemId, icon: `${record.itemId}.tex`, count: record.count, maxStack: 20,
    });
    const container = create();
    container.SetNumSlots(2);
    panel.open({ containerId: 'container:first', slotCount: 2 });
    const stop = panel.bindContainer(container.toSignal(), toItem);
    container.OnLoad({ items: { '2': { itemId: 'log', count: 3 } } });
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
    container.publishDTO();
    container.SetNumSlots(3);
  });
  await expect(panel.locator('.inventory-slot')).toHaveCount(3);
  await expect(panel.locator('[data-slot-key="1"] .inventory-slot__count')).toHaveText('2');
  await expect(panel.locator('[data-slot-key="2"]')).toHaveAttribute('data-item-id', '');
  await page.evaluate(() => {
    const state = (window as any).containerBinding;
    state.panel.close();
    const next = state.create();
    next.SetNumSlots(2);
    state.panel.open({ containerId: 'container:second', slotCount: 2 });
    state.panel.bindContainer(next.toSignal(), state.toItem);
    state.stop();
    state.container.GetItemInSlot(2).components.stackable.count = 9;
    state.container.publishDTO();
    next.OnLoad({ items: { '1': { itemId: 'cutgrass', count: 4 } } });
    state.next = next;
  });
  await expect(panel.locator('[data-slot-key="0"]')).toHaveAttribute('data-item-id', 'cutgrass');
  await expect(panel.locator('[data-slot-key="1"]')).toHaveAttribute('data-item-id', '');
  await page.evaluate(() => {
    const state = (window as any).containerBinding;
    state.panel.remove();
    state.next.publishDTO();
    state.next.dispose(); state.container.dispose();
  });
  expect(errors).toEqual([]);
});

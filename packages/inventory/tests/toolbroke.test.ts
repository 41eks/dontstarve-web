import { expect, it, vi } from 'vitest';
import { InventorySlot, InventoryStore, inventorySlotAddress } from '../src';
import { Tool } from '../../componets/src/tool';
import { equipSamePrefab } from '../../prefab/src/player_common';

const specs = { bugnet: { name: '捕虫网', icon: 'bugnet.tex', maxStack: 1 } };

it('pushes toolbroke to the player once, before the depleted tool is removed', () => {
  const inventory = new InventoryStore([{
    address: inventorySlotAddress(0), slot: new InventorySlot({ itemId: 'bugnet', count: 1 }, specs),
  }], specs);
  const events: [string, unknown][] = [];
  inventory.bindActor({ hasTag: () => true, GetPosition: () => ({ x: 0, y: 0, z: 0 }),
    PushEvent: (name, data) => { events.push([name, data]); } });
  try {
    const net = inventory.getEntity(inventorySlotAddress(0))!;
    net.components.finiteuses.setMaxUses(2);
    net.components.tool = net.component('tool', () => new Tool(net));
    expect(net.components.finiteuses.use()).toBe(true);
    expect(events).toEqual([]);
    expect(net.components.finiteuses.use()).toBe(true);
    expect(events).toEqual([['toolbroke', { tool: net }]]);
    expect(net.isRemoved).toBe(true);
  } finally { inventory.dispose(); }
});

it('equips another item of the same prefab only when the slot is empty', () => {
  const item = { prefab: 'axe', components: { equippable: { equipslot: 'hand' } } };
  const equip = vi.fn(() => true);
  const inventory = (equipped: unknown) => ({
    GetEquippedItem: () => equipped as never, FindItem: (test: (i: never) => boolean) => test(item as never) ? item as never : null,
    EquipFromInventory: equip,
  });
  expect(equipSamePrefab(inventory({}), 'axe', 'hand')).toBe(false);
  expect(equipSamePrefab(inventory(null), 'pickaxe', 'hand')).toBe(false);
  expect(equipSamePrefab(inventory(null), 'axe', 'hand')).toBe(true);
  expect(equip).toHaveBeenCalledExactlyOnceWith(item);
});

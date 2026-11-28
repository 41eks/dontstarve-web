import { expect, it } from 'vitest';
import { backpackSlotAddress, equipmentSlotAddress, inventorySlotAddress } from '../src';
import { createEmptyEntity } from '../../prefab/src/prefabInstance';
import { createBuildingContainer } from '../../prefab/src/containers';
import { createInventoryStore } from '../../../tests/fixtures/testInventory';

it("makes each held item's owner its holder entity: the player, a worn backpack the player holds, or a chest", () => {
  const store = createInventoryStore([]);
  const player = createEmptyEntity('wilson').instance,
    chest = createEmptyEntity('treasurechest').instance;
  player.setPosition(4, 0, 6);
  chest.setPosition(-8, 0, 2);
  store.bindActor(player);
  const chestId = `world:treasurechest:${String(chest.entityId)}`,
    chestSlot = { containerId: chestId, slotKey: '0' };
  store.registerContainer(chestId, createBuildingContainer('treasurechest', chest));
  store.setStorageAccessible(chestId, true);
  try {
    store.replaceState(
      {
        bufferedBuilds: [],
        slots: [
          { address: inventorySlotAddress(0), item: { itemId: 'twigs', count: 2 } },
          { address: equipmentSlotAddress('body'), item: { itemId: 'backpack', count: 1 } },
        ],
      },
      {},
    );
    const twigs = store.getEntity(inventorySlotAddress(0))!,
      backpack = store.getEntity(equipmentSlotAddress('body'))!;
    const item = twigs.components.inventoryitem;
    expect(item.owner).toBe(player);
    expect(item.slot?.address).toEqual(inventorySlotAddress(0));
    expect(backpack.components.inventoryitem.owner).toBe(player);

    // In the worn backpack its owner is the backpack; GetGrandOwner and its world position reach the player.
    expect(store.transfer(inventorySlotAddress(0), backpackSlotAddress(backpack.id, 0), 2)).toBe(true);
    expect(store.getEntity(backpackSlotAddress(backpack.id, 0))).toBe(twigs);
    expect(item.owner).toBe(backpack);
    expect(item.GetGrandOwner()).toBe(player);
    expect(item.GetHeldPosition()).toEqual(player.getPosition());

    // container:GiveItem: in the chest the chest is the owner.
    expect(store.transfer(backpackSlotAddress(backpack.id, 0), chestSlot, 2)).toBe(true);
    expect(item.owner).toBe(chest);
    expect(item.slot?.address).toEqual(chestSlot);
    expect(item.GetHeldPosition()).toEqual(chest.getPosition());

    // Dropped, it has neither owner nor slot.
    store.DropItem(twigs);
    expect(item.owner).toBeNull();
    expect(item.slot).toBeNull();
  } finally {
    store.dispose();
    player.remove();
    chest.remove();
  }
});

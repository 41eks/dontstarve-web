import { expect, it, vi } from 'vitest';
import { InventoryStore, InventorySlot, HeadSlot, BodySlot, equipmentSlotAddress, inventorySlotAddress } from '@dontstarve-web/inventory';
import { bindPlayerHeadEquipment } from '../../../src/playerHeadEquipment';
import { bindPlayerBodyEquipment } from '../../../src/playerBodyEquipment';

it('drives hats and backpack presentation from restore/transfer signals and releases both bindings', () => {
  const head = equipmentSlotAddress('head'), body = equipmentSlotAddress('body'), bag = inventorySlotAddress(0);
  const store = new InventoryStore([
    { address: head, slot: new HeadSlot() }, { address: body, slot: new BodySlot() },
    { address: bag, slot: new InventorySlot() },
  ], {
    strawhat: { name: 'hat', icon: 'strawhat.tex', maxStack: 1, equippable: 'head' },
    backpack: { name: 'backpack', icon: 'backpack.tex', maxStack: 1, equippable: 'body' },
  }, { backpack_babybeef: { itemId: 'backpack', name: 'backpack', icon: 'backpack_babybeef.tex', atlas: 'images/inventoryimages.xml' } });
  const animation = { setHat: vi.fn(async () => {}), setBackpack: vi.fn(async () => {}) };
  const setBackpackActive = vi.fn();
  const headBinding = bindPlayerHeadEquipment({ headEquipmentExistenceState: store.headEquipmentExistenceState, animation });
  const bodyBinding = bindPlayerBodyEquipment({ bodyEquipmentExistenceState: store.bodyEquipmentExistenceState, animation, setBackpackActive });
  try {
    expect(animation.setHat).not.toHaveBeenCalled();
    expect(animation.setBackpack).not.toHaveBeenCalled();
    expect(setBackpackActive).not.toHaveBeenCalled();
    store.replaceState({ slots: [
      { address: head, item: { itemId: 'strawhat', count: 1 } },
      { address: body, item: { itemId: 'backpack', count: 1, skinId: 'backpack_babybeef' } },
    ], bufferedBuilds: [] }, {});
    expect(animation.setHat).toHaveBeenCalledExactlyOnceWith('strawhat', undefined);
    expect(animation.setBackpack).toHaveBeenCalledExactlyOnceWith(true, 'backpack_babybeef');
    expect(setBackpackActive).toHaveBeenCalledExactlyOnceWith(true, store.getEntity(body)!.id);
    const backpack = store.getEntity(body)!;
    backpack.components.inventoryitem.owner!.changed();
    expect(animation.setBackpack).toHaveBeenCalledOnce();
    expect(setBackpackActive).toHaveBeenCalledOnce();
    expect(store.transfer(body, bag, 1)).toBe(true);
    expect(animation.setBackpack).toHaveBeenLastCalledWith(false, undefined);
    expect(setBackpackActive).toHaveBeenLastCalledWith(false, undefined);
    expect(store.getEntity(bag)).toBe(backpack);
    expect(store.transfer(bag, body, 1)).toBe(true);
    expect(animation.setBackpack).toHaveBeenLastCalledWith(true, 'backpack_babybeef');
    store.headEquipmentExistenceState.set(null);
    expect(animation.setHat).toHaveBeenLastCalledWith(null, undefined);
    expect(store.getEntity(head)).toBeNull();
    headBinding.dispose(); bodyBinding.dispose();
    animation.setHat.mockClear(); animation.setBackpack.mockClear(); setBackpackActive.mockClear();
    store.transfer(body, bag, 1);
    expect(store.applySlotChanges([{ slot: head, itemId: 'strawhat', delta: 1 }])).toBe(true);
    expect(animation.setHat).not.toHaveBeenCalled();
    expect(animation.setBackpack).not.toHaveBeenCalled();
    expect(setBackpackActive).not.toHaveBeenCalled();
  } finally { headBinding.dispose(); bodyBinding.dispose(); store.dispose(); }
});

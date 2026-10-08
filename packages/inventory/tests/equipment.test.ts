import { expect, it, vi } from 'vitest';
import { createHeadEquipmentExistenceState, createBodyEquipmentExistenceState } from '@dontstarve-web/signals';
import { InventoryStore, InventorySlot, HandSlot, HeadSlot, BodySlot, equipmentSlotAddress, inventorySlotAddress } from '../src';

const head = equipmentSlotAddress('head'), body = equipmentSlotAddress('body');
const a = inventorySlotAddress(0), b = inventorySlotAddress(1);
const specs = {
  strawhat: { name: 'hat', icon: 'strawhat.tex', maxStack: 1, equippable: 'head' as const },
  backpack: { name: 'backpack', icon: 'backpack.tex', maxStack: 1, equippable: 'body' as const },
  cutgrass: { name: 'grass', icon: 'cutgrass.tex', maxStack: 40 },
};
const skins = {
  backpack_babybeef: { itemId: 'backpack', name: 'backpack', icon: 'backpack_babybeef.tex', atlas: 'images/inventoryimages.xml' },
};

it('publishes committed head/body identity, preserves transfers and restores the resulting equipment', () => {
  const store = new InventoryStore([
    { address: a, slot: new InventorySlot() }, { address: b, slot: new InventorySlot() },
    { address: head, slot: new HeadSlot() }, { address: body, slot: new BodySlot() },
  ], specs, skins);
  const headChanges = vi.fn(), bodyChanges = vi.fn();
  const stopHead = store.headEquipment.subscribe(equipment => headChanges(equipment, store.getEntity(head)));
  const stopBody = store.bodyEquipment.subscribe(equipment => bodyChanges(equipment, store.getEntity(body)));
  try {
    store.add('strawhat', 1); store.transfer(a, head, 1);
    store.add('backpack', 1, 'backpack_babybeef'); store.transfer(a, body, 1);
    const hat = store.getEntity(head)!, backpack = store.getEntity(body)!;
    const headEquipment = store.headEquipment.peek(), bodyEquipment = store.bodyEquipment.peek();
    expect(headEquipment).toEqual({ itemId: 'strawhat', EQUIPSLOTS: 'HEAD', entity: hat });
    expect(bodyEquipment).toEqual({ itemId: 'backpack', EQUIPSLOTS: 'BODY', skinId: 'backpack_babybeef', entity: backpack });
    expect(headChanges).toHaveBeenCalledExactlyOnceWith(headEquipment, hat);
    expect(bodyChanges).toHaveBeenCalledExactlyOnceWith(bodyEquipment, backpack);
    store.add('cutgrass', 3);
    hat.components.inventoryitem.owner!.changed();
    expect(store.transfer(body, head, 1)).toBe(false);
    expect(store.headEquipment.peek()).toBe(headEquipment);
    expect(store.bodyEquipment.peek()).toBe(bodyEquipment);
    expect(headChanges).toHaveBeenCalledOnce();
    expect(bodyChanges).toHaveBeenCalledOnce();

    expect(store.extract(body, 1, backpack)).toBe(backpack);
    expect(store.bodyEquipment.peek()).toBeNull();
    expect(backpack.isRemoved).toBe(false);
    expect(backpack.skinId).toBe('backpack_babybeef');
    expect(store.receive(backpack)).toBe(true);
    expect(store.getEntity(b)).toBe(backpack);
    expect(store.transfer(b, body, 1)).toBe(true);
    store.headEquipmentExistenceState.set(null);
    expect(store.getEntity(head)).toBeNull();
    expect(hat.isRemoved).toBe(true);
    expect(store.getEntity(body)).toBe(backpack);

    const saved = store.exportState(), snapshot = backpack.snapshot();
    store.replaceState(saved, {});
    expect(store.headEquipment.peek()).toBeNull();
    expect(store.bodyEquipment.peek()?.entity).toBe(store.getEntity(body));
    expect(store.getEntity(body)).not.toBe(backpack);
    expect(store.getEntity(body)?.snapshot()).toEqual(snapshot);
  } finally { stopHead(); stopBody(); store.dispose(); }
});

it('binds late head/body registrations once and releases all equipment subscriptions on disposal', () => {
  const headEquipmentExistenceState = createHeadEquipmentExistenceState();
  const bodyEquipmentExistenceState = createBodyEquipmentExistenceState();
  const subscribeHead = vi.spyOn(headEquipmentExistenceState, 'subscribe');
  const subscribeBody = vi.spyOn(bodyEquipmentExistenceState, 'subscribe');
  const store = new InventoryStore([], specs, skins, undefined, { headEquipmentExistenceState, bodyEquipmentExistenceState });
  try {
    expect(subscribeHead).not.toHaveBeenCalled();
    expect(subscribeBody).not.toHaveBeenCalled();
    store.registerSlots([
      { address: head, slot: new HeadSlot({ itemId: 'strawhat', count: 1 }) },
      { address: body, slot: new BodySlot({ itemId: 'backpack', count: 1 }) },
    ]);
    store.registerSlots([{ address: equipmentSlotAddress('hand'), slot: new HandSlot() }]);
    expect(() => store.registerSlots([{ address: head, slot: new HeadSlot() }])).toThrow('Duplicate slot address');
    expect(subscribeHead).toHaveBeenCalledOnce();
    expect(subscribeBody).toHaveBeenCalledOnce();
    expect(store.headEquipmentExistenceState).toBe(headEquipmentExistenceState);
    expect(store.bodyEquipmentExistenceState).toBe(bodyEquipmentExistenceState);
    const remove = vi.spyOn(store, 'applySlotChanges');
    store.dispose();
    headEquipmentExistenceState.set(null);
    bodyEquipmentExistenceState.set(null);
    expect(remove).not.toHaveBeenCalled();
  } finally { store.dispose(); }
});

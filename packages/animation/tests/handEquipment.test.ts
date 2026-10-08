import type { WilsonAnimationController } from '../../prefab/src/player';
import { afterEach, expect, it, vi } from 'vitest';
import { createHandEquipmentExistenceState, type HandEquipment } from '@dontstarve-web/signals';
import { ItemEntity, InventoryStore, InventorySlot, HandSlot, inventorySlotAddress, equipmentSlotAddress } from '@dontstarve-web/inventory';
import { getTorchController } from '../../prefab/src/torch';
import { PreloadSounds } from '../../prefab/src/sound';
import { bindPlayerHandEquipment } from '../../../src/playerHandEquipment';

vi.mock('../../prefab/src/sound', () => ({
  PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })),
}));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

function presentation() {
  return { animation: { setCarryItem: vi.fn<WilsonAnimationController['setCarryItem']>(async () => {}), playItemTransition: vi.fn<WilsonAnimationController['playItemTransition']>() },
    setLightActive: vi.fn(), setHandAction: vi.fn() };
}

it('equips from the restore signal write, unequips before replacement and releases on shutdown', async () => {
  const a = inventorySlotAddress(0), b = inventorySlotAddress(1), hand = equipmentSlotAddress('hand');
  const store = new InventoryStore([
    { address: a, slot: new InventorySlot() }, { address: b, slot: new InventorySlot() },
    { address: hand, slot: new HandSlot() },
  ], { torch: { name: 'torch', icon: 'torch.tex', maxStack: 1, maxFuel: 75, equippable: 'hand' } },
  { torch_barber: { itemId: 'torch', name: 'torch', icon: 'torch_barber.tex', atlas: 'images/inventoryimages.xml' } });
  const ui = presentation();
  const binding = await bindPlayerHandEquipment({ ...ui, handEquipmentExistenceState: store.handEquipmentExistenceState });
  try {
    expect(ui.animation.setCarryItem).not.toHaveBeenCalled();
    expect(ui.setHandAction).not.toHaveBeenCalled();
    store.replaceState({ slots: [
      { address: a, item: { itemId: 'torch', count: 1, remainingFuel: 20 } },
      { address: hand, item: { entityId: 'saved_torch', itemId: 'torch', count: 1, skinId: 'torch_barber', remainingFuel: 10 } },
    ], bufferedBuilds: [] }, {});
    expect(ui.animation.setCarryItem).toHaveBeenCalledExactlyOnceWith('torch', 'torch_barber');
    const oldEntity = store.getEntity(hand)!, nextEntity = store.getEntity(a)!;
    expect(oldEntity.id).toBe('saved_torch');
    const oldTorch = getTorchController(oldEntity), nextTorch = getTorchController(nextEntity);
    const events: string[] = [];
    const oldUnequip = oldTorch.onunequip.bind(oldTorch), nextEquip = nextTorch.onequip.bind(nextTorch);
    vi.spyOn(oldTorch, 'onunequip').mockImplementation(() => { events.push('unequip'); oldUnequip(); });
    const equip = vi.spyOn(nextTorch, 'onequip').mockImplementation(slot => { events.push('equip'); nextEquip(slot); });
    expect(PreloadSounds).toHaveBeenCalledBefore(ui.animation.setCarryItem);
    expect(oldTorch.isBurning).toBe(true);
    expect(ui.animation.setCarryItem).toHaveBeenLastCalledWith('torch', 'torch_barber');
    expect(ui.setLightActive).toHaveBeenLastCalledWith(true);
    binding.update(0.25);
    store.applySlotChanges([
      { slot: hand, itemId: 'torch', skinId: 'torch_barber', delta: -1 },
      { slot: b, itemId: 'torch', skinId: 'torch_barber', delta: 1 },
      { slot: a, itemId: 'torch', delta: -1 }, { slot: hand, itemId: 'torch', delta: 1 },
    ]);
    expect(events).toEqual(['unequip', 'equip']);
    expect(store.handEquipment.peek()?.entity).toBe(nextEntity);
    expect(oldEntity.components.fueled.remaining).toBe(9.75);
    expect(oldTorch.isBurning).toBe(false);
    binding.update(0.5); binding.flush();
    expect(nextEntity.components.fueled.remaining).toBe(19.5);
    store.setRemainingFuel(hand, 18);
    expect(equip).toHaveBeenCalledOnce();
    binding.playTransition('item_out', 'torch');
    expect(ui.animation.playItemTransition).toHaveBeenCalledExactlyOnceWith('item_out', 'torch');
    const stillEquipped = store.handEquipment.peek();
    nextTorch.extinguish();
    expect(store.handEquipment.peek()).toBe(stillEquipped);
    expect(store.getEntity(hand)).toBe(nextEntity);
    expect(ui.animation.setCarryItem).toHaveBeenLastCalledWith('torch', undefined);
    expect(ui.setLightActive).toHaveBeenLastCalledWith(false);
    store.setRemainingFuel(hand, 17);
    expect(equip).toHaveBeenCalledOnce();
    store.transfer(hand, a, 1); store.transfer(a, hand, 1);
    expect(nextTorch.isBurning).toBe(true);
    const remove = vi.spyOn(nextEntity, 'remove');
    binding.update(18); binding.flush();
    expect(store.handEquipmentExistenceState.peek()).toBeNull();
    expect(store.getEntity(hand)).toBeNull();
    expect(nextEntity.isRemoved).toBe(true);
    expect(remove).not.toHaveBeenCalled(); // The signal subscriber commits removal, not the prefab owner callback.
    expect(ui.animation.setCarryItem).toHaveBeenLastCalledWith(null, undefined);
    const saved = store.exportState();
    store.replaceState(saved, {});
    expect(store.get(hand)).toBeNull();
    binding.dispose();
    const calls = ui.animation.setCarryItem.mock.calls.length;
    store.transfer(b, hand, 1);
    store.handEquipmentExistenceState.set(null);
    binding.update(10);
    expect(ui.animation.setCarryItem).toHaveBeenCalledTimes(calls);
  } finally { binding.dispose(); store.dispose(); }
});

it('preserves the latest equipment when unequip synchronously supersedes a transition', async () => {
  const entity = new ItemEntity({ itemId: 'torch', count: 1 });
  const initial: HandEquipment = { itemId: 'torch', EQUIPSLOTS: 'HANDS', entity };
  const staff: HandEquipment = { itemId: 'yellowstaff', EQUIPSLOTS: 'HANDS' };
  const hammer: HandEquipment = { itemId: 'hammer', EQUIPSLOTS: 'HANDS' };
  const slot = createHandEquipmentExistenceState();
  const ui = presentation();
  const binding = await bindPlayerHandEquipment({ ...ui, handEquipmentExistenceState: slot });
  try {
    slot.set(initial);
    const torch = getTorchController(entity), unequip = torch.onunequip.bind(torch);
    vi.spyOn(torch, 'onunequip').mockImplementation(() => { unequip(); slot.set(hammer); });
    slot.set(staff);
    expect(slot.peek()).toBe(hammer);
    expect(ui.animation.setCarryItem).toHaveBeenLastCalledWith('hammer', undefined);
    expect(ui.animation.setCarryItem.mock.calls.some(([item]) => item === 'yellowstaff')).toBe(false);
    expect(ui.setHandAction).toHaveBeenLastCalledWith(null);
    slot.set(staff);
    expect(ui.setHandAction).toHaveBeenLastCalledWith(': 施放法术');
  } finally { binding.dispose(); entity.destroy(); }
});

import { expect, it, vi } from 'vitest';
import { createHandEquipmentExistenceState, type HandEquipment } from '../src';

it('accepts hand equipment and null, rejecting invalid slots without changing state or notifying', () => {
  const handEquipmentExistenceState = createHandEquipmentExistenceState();
  const item: HandEquipment = { itemId: 'torch', EQUIPSLOTS: 'HANDS' };
  handEquipmentExistenceState.set(item);
  const listener = vi.fn();
  const unsubscribe = handEquipmentExistenceState.subscribe(listener);
  try {
    // @ts-expect-error A body slot cannot be assigned to the hand signal.
    expect(() => handEquipmentExistenceState.set({ itemId: 'backpack', EQUIPSLOTS: 'BODY' })).toThrow('EQUIPSLOTS');
    // @ts-expect-error Hand equipment must explicitly declare its slot.
    expect(() => handEquipmentExistenceState.set({ itemId: 'torch' })).toThrow('EQUIPSLOTS');
    expect(handEquipmentExistenceState.peek()).toBe(item);
    expect(listener).not.toHaveBeenCalled();
    handEquipmentExistenceState.set(null);
    expect(handEquipmentExistenceState.peek()).toBeNull();
    expect(listener).toHaveBeenCalledExactlyOnceWith(null, item);
  } finally { unsubscribe(); }
});

it('creates independent states and observes subsequent writes synchronously without replay', () => {
  const handEquipmentExistenceState = createHandEquipmentExistenceState();
  const other = createHandEquipmentExistenceState();
  const first: HandEquipment = { itemId: 'torch', EQUIPSLOTS: 'HANDS' };
  const second: HandEquipment = { itemId: 'torch', EQUIPSLOTS: 'HANDS' };
  expect(handEquipmentExistenceState.peek()).toBeNull();
  expect(other.peek()).toBeNull();
  other.set(second);
  handEquipmentExistenceState.set(first);
  const listener = vi.fn();
  const stop = handEquipmentExistenceState.subscribe(listener);
  expect(listener).not.toHaveBeenCalled();
  handEquipmentExistenceState.set(null);
  handEquipmentExistenceState.set(second);
  expect(listener.mock.calls).toEqual([[null, first], [second, null]]);
  stop();
  handEquipmentExistenceState.set(null);
  expect(listener).toHaveBeenCalledTimes(2);
  expect(other.peek()).toBe(second);
});

import { afterEach, expect, it, vi } from 'vitest';
import { handEquipmentState, type HandEquipment } from '../src';

afterEach(() => handEquipmentState.set(null));

it('accepts hand equipment and null, rejecting invalid slots without changing state or notifying', () => {
  const item: HandEquipment = { itemId: 'torch', EQUIPSLOTS: 'HANDS' };
  handEquipmentState.set(item);
  const listener = vi.fn();
  const unsubscribe = handEquipmentState.subscribe(listener);
  try {
    // @ts-expect-error A body slot cannot be assigned to the hand signal.
    expect(() => handEquipmentState.set({ itemId: 'backpack', EQUIPSLOTS: 'BODY' })).toThrow('EQUIPSLOTS');
    // @ts-expect-error Hand equipment must explicitly declare its slot.
    expect(() => handEquipmentState.set({ itemId: 'torch' })).toThrow('EQUIPSLOTS');
    expect(handEquipmentState.peek()).toBe(item);
    expect(listener).not.toHaveBeenCalled();
    handEquipmentState.set(null);
    expect(handEquipmentState.peek()).toBeNull();
    expect(listener).toHaveBeenCalledExactlyOnceWith(null, item);
  } finally { unsubscribe(); }
});

it('does not replay the current value and observes subsequent writes synchronously until released', () => {
  const first: HandEquipment = { itemId: 'torch', EQUIPSLOTS: 'HANDS' };
  const second: HandEquipment = { itemId: 'torch', EQUIPSLOTS: 'HANDS' };
  handEquipmentState.set(first);
  const listener = vi.fn();
  const stop = handEquipmentState.subscribe(listener);
  expect(listener).not.toHaveBeenCalled();
  handEquipmentState.set(null);
  handEquipmentState.set(second);
  expect(listener.mock.calls).toEqual([[null, first], [second, null]]);
  stop();
  handEquipmentState.set(null);
  expect(listener).toHaveBeenCalledTimes(2);
});

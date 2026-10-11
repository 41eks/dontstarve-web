import { expect, test } from '@playwright/test';
import { createSignal } from '@dontstarve-web/signals';
import { createSlot, type SlotItem } from '../src/slot/slot-model';
import {
  bindSlotContextMenuInput,
  type SlotContextMenuRequest,
  type SlotSecondaryInput,
} from '../src/slot/slot-input';

test('samples the current UI slot on every input without replaying actions on slot changes', () => {
  const slot = createSlot({ address: { containerId: 'player:inventory', slotKey: '0' } });
  const input = createSignal<SlotSecondaryInput | null>(null);
  const binding = bindSlotContextMenuInput(input, slot);
  const requests: SlotContextMenuRequest[] = [];
  binding.request.subscribe(request => { if (request) requests.push(request); });
  const item: SlotItem = {
    entityId: 'first', id: 'seeds', name: '种子', count: 3, maxStack: 40, icon: 'seeds.tex',
  };
  slot.setItem(item);
  input.set({ shiftKey: false });
  input.set({ shiftKey: false });
  expect(requests).toHaveLength(2);
  expect(requests[0]).toMatchObject({ action: 'use', item: { entityId: 'first', count: 3 } });

  item.count = 2;
  slot.setItem({ ...item, entityId: 'replacement', skinId: 'skin' });
  expect(requests).toHaveLength(2);
  expect(requests[0].item?.count).toBe(3);
  input.set({ shiftKey: true });
  expect(requests[2]).toMatchObject({ action: 'drop', item: { entityId: 'replacement', skinId: 'skin', count: 2 } });
  binding.dispose();
});

test('releasing and reconnecting input bindings never replays a previous request', () => {
  const slot = createSlot({ address: { containerId: 'player:equipment', slotKey: 'hand' } });
  const input = createSignal<SlotSecondaryInput | null>(null);
  const binding = bindSlotContextMenuInput(input, slot);
  input.set({ shiftKey: true });
  const previous = binding.request.peek();
  expect(previous).toMatchObject({ action: 'drop', item: null });
  binding.dispose();
  binding.dispose();
  input.set({ shiftKey: false });
  expect(binding.request.peek()).toBe(previous);

  const next = bindSlotContextMenuInput(input, slot);
  expect(next.request.peek()).toBeNull();
  input.set({ shiftKey: false });
  expect(next.request.peek()).toMatchObject({ action: 'use', item: null });
  next.dispose();
});

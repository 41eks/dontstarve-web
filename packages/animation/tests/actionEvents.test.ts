import { expect, it, vi } from 'vitest';
import { EventEmitter } from '../../signals/src/EventEmitter';
import { bindActionCancellation, type PlayerActionEvents } from '../../stategraphs/src/actionEvents';

it('preserves UI interruption scopes, skips the new owner and releases subscriptions', () => {
  const actionEvents = new EventEmitter<PlayerActionEvents>(), world = { actionEvents };
  const owners = { hand: {}, net: {}, food: {}, flower: {}, building: {}, deploy: {}, movement: {} };
  const cancels = Object.fromEntries(Object.keys(owners).map(group => [group, vi.fn()]));
  const stops = Object.entries(owners).map(([group, owner]) =>
    bindActionCancellation(world, owner, group as keyof typeof owners, cancels[group]));
  try {
    actionEvents.emit('action:interrupt', { reason: 'slot-select' });
    expect(Object.keys(cancels).filter(group => cancels[group].mock.calls.length))
      .toEqual(['hand', 'food', 'flower', 'deploy']);
    Object.values(cancels).forEach(cancel => cancel.mockClear());
    actionEvents.emit('action:begin', { owner: owners.hand, action: 'TILL' });
    expect(Object.keys(cancels).filter(group => cancels[group].mock.calls.length))
      .toEqual(['net', 'food', 'flower', 'building', 'deploy']);
    Object.values(cancels).forEach(cancel => cancel.mockClear());
    actionEvents.emit('action:interrupt', { reason: 'emote' });
    expect(Object.values(cancels).every(cancel => cancel.mock.calls.length === 1)).toBe(true);
    stops.forEach(stop => stop());
    Object.values(cancels).forEach(cancel => cancel.mockClear());
    actionEvents.emit('action:interrupt', { reason: 'emote' });
    expect(Object.values(cancels).every(cancel => cancel.mock.calls.length === 0)).toBe(true);
  } finally { stops.forEach(stop => stop()); }
});

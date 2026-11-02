import { expect, it, vi } from 'vitest';
import { EventEmitter } from '../../signals/src/EventEmitter';
import { bindActionCancellation, type PlayerActionEvents } from '../../stategraphs/src/actionEvents';

it('cancels synchronously for another owner, skips itself and releases both subscriptions', () => {
  const actionEvents = new EventEmitter<PlayerActionEvents>(), world = { actionEvents };
  const owner = {}, cancel = vi.fn();
  const stop = bindActionCancellation(world, owner, cancel);
  try {
    actionEvents.emit('action:begin', { owner, action: 'MINE' });
    expect(cancel).not.toHaveBeenCalled();
    actionEvents.emit('action:begin', { owner: {}, action: 'SLEEPIN' });
    expect(cancel).toHaveBeenCalledOnce();

    cancel.mockClear();
    actionEvents.emit('action:interrupt', { reason: 'drop' });
    expect(cancel).not.toHaveBeenCalled();
    actionEvents.emit('action:interrupt', { reason: 'slot-select' });
    expect(cancel).toHaveBeenCalledOnce();

    stop(); cancel.mockClear();
    actionEvents.emit('action:begin', { owner: {}, action: 'PICK' });
    actionEvents.emit('action:interrupt', { reason: 'emote' });
    expect(cancel).not.toHaveBeenCalled();
  } finally { stop(); }
});

it('lets the caller filter UI interruptions without restricting new actions', () => {
  const actionEvents = new EventEmitter<PlayerActionEvents>(), world = { actionEvents };
  const cancel = vi.fn();
  const stop = bindActionCancellation(world, {}, cancel, reason => reason === 'emote');
  try {
    actionEvents.emit('action:interrupt', { reason: 'slot-select' });
    expect(cancel).not.toHaveBeenCalled();
    actionEvents.emit('action:interrupt', { reason: 'emote' });
    expect(cancel).toHaveBeenCalledOnce();
    actionEvents.emit('action:begin', { owner: {}, action: 'MIGRATE' });
    expect(cancel).toHaveBeenCalledTimes(2);
  } finally { stop(); }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PlayerActionPicker } from '../src/playeractionpicker.ts';

test('shared picking resolves one entity and chooses independent button actions by source priority', () => {
  const root = { parent: null }, child = { parent: root };
  let casts = 0, begin = 0, end = 0;
  const pointer = {
    beginFrame: () => begin++, endFrame: () => end++, dispose() {},
    raycastPointer: models => { casts++; assert.deepEqual(models, [root]); return { object: child }; },
  };
  const picker = new PlayerActionPicker(pointer);
  const net = { action: 'NET' }, mine = { action: 'MINE' }, sweep = { action: 'CASTSPELL', modifier: 'RESKIN' };
  picker.register(() => [{ action: net, button: 'left', model: root }]);
  // Registration order cannot override the higher-priority NET action.
  picker.register(() => [{ action: mine, button: 'left', model: root }]);
  picker.register(() => [{ action: sweep, button: 'right', model: root }]);
  assert.deepEqual(picker.getMouseActions(), { left: net, right: sweep });
  assert.equal(casts, 1);
  assert.equal(begin, 1);
  assert.equal(end, 1);
});

test('an unavailable foreground target blocks picking through it and unregistering preserves other sources', () => {
  const front = { parent: null }, back = { parent: null };
  let foreground = true;
  const pointer = {
    beginFrame() {}, endFrame() {}, dispose() {},
    raycastPointer: models => ({ object: foreground && models.includes(front) ? front : back }),
  };
  const picker = new PlayerActionPicker(pointer);
  const point = { action: 'TERRAFORM' }, net = { action: 'NET' };
  const removeFront = picker.register(() => [{ action: { action: 'PICK' }, button: 'left', model: front, available: false }]);
  picker.register(() => [{ action: net, button: 'left', model: back }]);
  picker.register(() => [{ action: point, button: 'right' }]);
  assert.deepEqual(picker.getMouseActions(), { left: undefined, right: point });
  removeFront(); foreground = false;
  assert.deepEqual(picker.getMouseActions(), { left: net, right: point });
});

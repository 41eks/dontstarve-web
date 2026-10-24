import { Group, Object3D, Scene } from 'three';
import { registerMouseTarget } from '../src/mouseTargets.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PlayerActionPicker } from '../src/playeractionpicker.ts';

test('shared picking resolves one entity and chooses independent button actions by source priority', t => {
  const root = new Group(), child = new Object3D();
  root.add(child); new Scene().add(root);
  const mouseTarget = registerMouseTarget(root, () => true);
  t.after(() => mouseTarget.dispose());
  let casts = 0, begin = 0, end = 0;
  const pointer = {
    beginFrame: () => begin++, endFrame: () => end++, dispose() {},
    pickMouseTarget: () => { casts++; return { object: child }; },
  };
  const picker = new PlayerActionPicker(pointer);
  const net = { action: 'NET' }, mine = { action: 'MINE' }, sweep = { action: 'CASTSPELL', modifier: 'RESKIN' };
  picker.register(() => [{ action: net, button: 'left', model: root }]);
  // Registration order cannot override the higher-priority NET action.
  picker.register(() => [{ action: mine, button: 'left', model: root }]);
  picker.register(() => [{ action: { action: 'HARVEST' }, button: 'right', model: root }]);
  picker.register(() => [{ action: sweep, button: 'right', model: root, source: 'equipped' }]);
  assert.deepEqual(picker.getMouseActions(), { left: net, right: sweep });
  assert.equal(casts, 1);
  assert.equal(begin, 1);
  assert.equal(end, 1);
});

test('an unavailable foreground target blocks picking through it and unregistering preserves other sources', t => {
  const front = new Group(), back = new Group();
  new Scene().add(front, back);
  const frontTarget = registerMouseTarget(front, () => true), backTarget = registerMouseTarget(back, () => true);
  t.after(() => { frontTarget.dispose(); backTarget.dispose(); });
  let foreground = true;
  const pointer = {
    beginFrame() {}, endFrame() {}, dispose() {},
    pickMouseTarget: () => ({ object: foreground ? front : back }),
  };
  const picker = new PlayerActionPicker(pointer);
  const point = { action: 'TERRAFORM' }, net = { action: 'NET' };
  const removeFront = picker.register(() => [{ action: { action: 'PICK' }, button: 'left', model: front, available: false }]);
  picker.register(() => [{ action: net, button: 'left', model: back }]);
  picker.register(() => [{ action: point, button: 'right' }]);
  assert.deepEqual(picker.getMouseActions(), { left: undefined, right: point });
  removeFront();
  assert.deepEqual(picker.getMouseActions(), { left: undefined, right: point });
  frontTarget.dispose(); foreground = false;
  assert.deepEqual(picker.getMouseActions(), { left: net, right: point });
});

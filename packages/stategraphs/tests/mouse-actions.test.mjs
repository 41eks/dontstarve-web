import { Group, Object3D, Scene } from 'three';
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { PointerRaycaster } from '../src/pointerRaycaster.ts';
import { PlayerActionPicker } from '../src/playeractionpicker.ts';
import { disposeActionEntity, findActionEntity, registerActionEntity } from '../../prefab/src/actionEntity.ts';
import { prefabInstance } from '../../prefab/src/prefabInstance.ts';
import { withEntity } from '../../animation/tests/entityFixture.ts';

/** A picker whose ray only reports the object the test says is under the pointer. */
function pointerFor(pick, groundPoint = () => undefined) {
  const pointer = new PointerRaycaster({ renderer: {} });
  pointer.groundPoint = groundPoint;
  pointer.pickMouseTarget = pick;
  pointer.updateHover();
  return pointer;
}

function actionEntity(model) {
  const entity = registerActionEntity(prefabInstance(withEntity(model, 'pickable')));
  new Scene().add(model);
  return entity;
}

test('Wortox point specials are fallbacks after equipped actions and never displace active-item actions', () => {
  let active = false;
  const item = { prefab: 'log' };
  const doer = { components: { inventory: { GetActiveItem: () => (active ? item : undefined) } } };
  const picker = new PlayerActionPicker(pointerFor(() => undefined));
  picker.bindPlayer(doer, () => undefined);
  const blink = { action: 'BLINK' },
    cast = { action: 'CASTSPELL' },
    deploy = { action: 'DEPLOY' };
  picker.register(() => [{ action: blink, button: 'right', source: 'special' }]);
  assert.equal(picker.getMouseActions().right, blink);
  const stopCast = picker.register(() => [{ action: cast, button: 'right' }]);
  assert.equal(picker.getMouseActions().right, cast);
  stopCast();
  active = true;
  assert.equal(picker.getMouseActions().right, undefined);
  picker.register(() => [{ action: deploy, button: 'right', source: 'inventory' }]);
  assert.equal(picker.getMouseActions().right, deploy);
  active = false;
  picker.dispose();
});

test('shared picking resolves one entity and chooses independent button actions by source priority', t => {
  const root = new Group(),
    child = new Object3D();
  root.add(child);
  const entity = actionEntity(root);
  t.onTestFinished(() => disposeActionEntity(entity));
  let casts = 0,
    begin = 0,
    end = 0;
  const pointer = pointerFor(() => {
    casts++;
    return { object: child };
  });
  pointer.beginFrame = () => begin++;
  pointer.endFrame = () => end++;
  const picker = new PlayerActionPicker(pointer);
  const net = { action: 'NET' },
    mine = { action: 'MINE' },
    sweep = { action: 'CASTSPELL', modifier: 'RESKIN' };
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
  const front = new Group(),
    back = new Group();
  const frontEntity = actionEntity(front),
    backEntity = actionEntity(back);
  t.onTestFinished(() => {
    disposeActionEntity(frontEntity);
    disposeActionEntity(backEntity);
  });
  let foreground = true;
  const pointer = pointerFor(() => ({ object: foreground ? front : back }));
  const picker = new PlayerActionPicker(pointer);
  const point = { action: 'TERRAFORM' },
    net = { action: 'NET' };
  const removeFront = picker.register(() => [
    { action: { action: 'PICK' }, button: 'left', model: front, available: false },
  ]);
  picker.register(() => [{ action: net, button: 'left', model: back }]);
  picker.register(() => [{ action: point, button: 'right' }]);
  assert.deepEqual(picker.getMouseActions(), { left: undefined, right: point });
  removeFront();
  assert.deepEqual(picker.getMouseActions(), { left: undefined, right: point });
  disposeActionEntity(findActionEntity(front));
  foreground = false;
  pointer.updateHover();
  assert.deepEqual(picker.getMouseActions(), { left: net, right: point });
});

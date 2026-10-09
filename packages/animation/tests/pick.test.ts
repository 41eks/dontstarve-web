import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { getPickActions, PickActionController } from '../../stategraphs/src/pick';
import { PlayerActionPicker } from '../../stategraphs/src/playeractionpicker';
import { Pickable } from '../../prefab/src/components/pickable';
import type { ActionWorldContext } from '../../stategraphs/src/actionContext';
import type { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import { EventEmitter } from '../../signals/src/EventEmitter';
import type { PlayerActionEvents } from '../../stategraphs/src/actionEvents';

afterEach(() => vi.restoreAllMocks());

it('uses component-owned pickable tags and blocks fire/intense without consulting prefab IDs', () => {
  const scene = new THREE.Scene(), model = new THREE.Group();
  scene.add(model);
  model.userData.tags = ['plant', 'custom'];
  const component = new Pickable(model, 'log', 10);
  expect(getPickActions(scene)[0].available).toBe(true);
  component.canInteractWith = false;
  expect(component.canBePicked).toBe(true);
  expect(getPickActions(scene)[0].available).toBe(false);
  expect(component.pick({ giveItem: () => true })).toBe(false);
  component.canInteractWith = true;
  for (const tag of ['fire', 'intense']) {
    model.userData.tags.push(tag);
    expect(getPickActions(scene)[0].available).toBe(false);
    model.userData.tags.pop();
  }
  component.pick({ giveItem: () => true });
  expect(model.userData.tags).toEqual(['plant', 'custom']);
  expect(getPickActions(scene)[0].available).toBe(false);
  component.update(10);
  expect(getPickActions(scene)[0].available).toBe(true);
  component.dispose();
  expect(getPickActions(scene)).toEqual([]);
  expect(model.userData.tags).toEqual(['plant', 'custom']);
});

it('dispatches the selected PICK, preserves failed reception, and releases only its own input/provider', () => {
  const scene = new THREE.Scene(), parent = new THREE.Group(), model = new THREE.Group();
  parent.position.set(10, 0, 20); model.position.set(1, 0, 2);
  parent.add(model); scene.add(parent);
  const component = new Pickable(model, 'log', 10, 2);
  const pointer = { trackPointer() {}, beginFrame() {}, endFrame() {},
    raycastPointer: () => ({ object: model }), dispose: vi.fn() } as unknown as PointerRaycaster;
  const picker = new PlayerActionPicker(pointer), canvas = new EventTarget();
  const actionEvents = new EventEmitter<PlayerActionEvents>(), begin = vi.fn();
  const stopEvents = actionEvents.on('action:begin', begin);
  const world = { scene, mouseActions: picker, actionEvents, renderer: { domElement: canvas } } as unknown as ActionWorldContext;
  const giveItem = vi.fn(() => false), onPicked = vi.fn();
  const action = new PickActionController(world, { giveItem }, onPicked);
  const click = (button = 0, canceled = false) => {
    const event = Object.assign(new Event('pointerdown', { cancelable: true }), { button });
    if (canceled) event.preventDefault();
    canvas.dispatchEvent(event);
  };
  click(2); click(0, true);
  expect(giveItem).not.toHaveBeenCalled();
  click();
  expect(giveItem).toHaveBeenCalledWith('log', 2, new THREE.Vector3(11, 0, 22));
  expect(component.exportState()).toEqual({});
  expect(onPicked).not.toHaveBeenCalled();
  expect(begin).not.toHaveBeenCalled();
  giveItem.mockReturnValue(true);
  click(); click();
  expect(giveItem).toHaveBeenCalledTimes(2);
  expect(onPicked).toHaveBeenCalledOnce();
  expect(begin).toHaveBeenCalledExactlyOnceWith({ owner: action, action: 'PICK' });
  component.update(10);
  action.dispose(); action.dispose();
  expect(pointer.dispose).not.toHaveBeenCalled();
  click();
  expect(giveItem).toHaveBeenCalledTimes(2);
  expect(picker.getMouseActions().left).toBeUndefined();
  component.dispose(); picker.dispose(); stopEvents();
});

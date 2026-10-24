import { registerMouseTarget } from '../../stategraphs/src/mouseTargets';
import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { getPickActions, PickActionController, PICK_REACH } from '../../stategraphs/src/pick';
import { PlayerActionPicker } from '../../stategraphs/src/playeractionpicker';
import { WilsonStateGraph } from '../../stategraphs/src/SGwilson';
import { Pickable } from '../../prefab/src/components/pickable';
import type { ActionAnimationController, ActionWorldContext } from '../../stategraphs/src/actionContext';
import type { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import { EventEmitter } from '../../signals/src/EventEmitter';
import type { PlayerActionEvents } from '../../stategraphs/src/actionEvents';

afterEach(() => vi.restoreAllMocks());

it('uses component-owned pickable tags and blocks fire/intense without consulting prefab IDs', () => {
  const scene = new THREE.Scene(), model = new THREE.Group();
  scene.add(model);
  model.userData.tags = ['plant', 'custom'];
  const component = new Pickable(model, 'log', 10);
  expect(getPickActions(model)[0].available).toBe(true);
  component.canInteractWith = false;
  expect(component.canBePicked).toBe(true);
  expect(getPickActions(model)[0].available).toBe(false);
  expect(component.pick({ giveItem: () => true })).toBe(false);
  component.canInteractWith = true;
  for (const tag of ['fire', 'intense']) {
    model.userData.tags.push(tag);
    expect(getPickActions(model)[0].available).toBe(false);
    model.userData.tags.pop();
  }
  component.pick({ giveItem: () => true });
  expect(model.userData.tags).toEqual(['plant', 'custom']);
  expect(getPickActions(model)[0].available).toBe(false);
  component.update(10);
  expect(getPickActions(model)[0].available).toBe(true);
  component.dispose();
  expect(getPickActions(model)).toEqual([]);
  expect(model.userData.tags).toEqual(['plant', 'custom']);
});

it('walks to reach, commits a prepared PICK and releases canceled products without changing the plant', async () => {
  vi.stubGlobal('window', new EventTarget());
  const scene = new THREE.Scene(), parent = new THREE.Group(), model = new THREE.Group(), player = new THREE.Group();
  parent.position.set(20, 0, 0); model.position.set(0, 0, 0);
  parent.add(model); scene.add(parent); scene.add(player);
  model.userData.tags = ['plant'];
  model.userData.getGroundPosition = () => new THREE.Vector3(20, 0, 0);
  const component = new Pickable(model, 'log', 10, 2);
  const mouseTarget = registerMouseTarget(model, () => true);
  const pointer = { trackPointer() {}, beginFrame() {}, endFrame() {},
    pickMouseTarget: () => ({ object: model }), dispose: vi.fn() } as unknown as PointerRaycaster;
  const picker = new PlayerActionPicker(pointer), canvas = new EventTarget();
  const actionEvents = new EventEmitter<PlayerActionEvents>(), begin = vi.fn();
  const stopEvents = actionEvents.on('action:begin', begin);
  const stategraph = new WilsonStateGraph({ playAnimation: () => .2, playSound() {}, setCasting() {}, onStateChanged() {} });
  const animation = { stategraph, cancelEmote() {}, setFacing: vi.fn() } as unknown as ActionAnimationController;
  const locomotor = { destination: undefined as THREE.Vector3 | undefined, goToPoint: vi.fn(() => true), stop: vi.fn() };
  const world = { scene, player, camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(),
    mouseActions: picker, actionEvents, renderer: { domElement: canvas } } as unknown as ActionWorldContext;
  const giveItem = vi.fn(() => true);
  const releaseProduct = vi.fn();
  const prepare = vi.fn(async () => ({ giveItem, dispose: releaseProduct }));
  let manual = false;
  const controller = new PickActionController(world, animation, locomotor, prepare, () => manual);
  const click = () => {
    const event = Object.assign(new Event('pointerdown', { cancelable: true }), { button: 0 });
    canvas.dispatchEvent(event);
  };
  click();
  await Promise.resolve();
  expect(giveItem).not.toHaveBeenCalled();
  expect(begin).toHaveBeenCalledExactlyOnceWith({ owner: controller, action: 'PICK' });
  controller.update();
  expect(locomotor.goToPoint).toHaveBeenCalledWith(new THREE.Vector3(20 - PICK_REACH * .8, 0, 0));
  expect(stategraph.stateName).not.toBe('dolongaction');
  player.position.x = 20 - PICK_REACH + .5;
  controller.update();
  expect(stategraph.stateName).toBe('dolongaction');
  stategraph.update(1);
  expect(giveItem).toHaveBeenCalledWith('log', 2, new THREE.Vector3(20, 0, 0));
  expect(component.exportState()).toMatchObject({ picked: true });
  expect(component.canBePicked).toBe(false);
  expect(prepare).toHaveBeenCalledWith('log', 2);
  expect(releaseProduct).toHaveBeenCalledTimes(1);

  giveItem.mockReturnValue(false);
  component.update(10);
  expect(component.canBePicked).toBe(true);
  player.position.x = 0;
  click();
  expect(begin).toHaveBeenCalledTimes(2);
  manual = true;
  controller.update();
  await Promise.resolve();
  expect(locomotor.stop).toHaveBeenCalled();
  expect(releaseProduct).toHaveBeenCalledTimes(2);
  manual = false;
  player.position.x = 20 - PICK_REACH + .5;
  click();
  await Promise.resolve();
  controller.update();
  stategraph.update(1);
  expect(giveItem).toHaveBeenCalledTimes(2);
  expect(component.exportState()).toEqual({});
  expect(component.canBePicked).toBe(true);
  expect(releaseProduct).toHaveBeenCalledTimes(3);

  controller.dispose(); controller.dispose();
  expect(pointer.dispose).not.toHaveBeenCalled();
  click();
  expect(giveItem).toHaveBeenCalledTimes(2);
  expect(picker.getMouseActions().left).toBeUndefined();
  component.dispose(); mouseTarget.dispose(); picker.dispose(); stopEvents();
});

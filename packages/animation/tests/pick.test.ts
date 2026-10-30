import { actionEntity, disposeActionEntity } from '../../prefab/src/actionEntity';
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
import { SpriteState } from '../../display/src/spriteState';
import { PrefabInstance, createEmptyEntity } from '../../prefab/src/prefabInstance';

afterEach(() => vi.restoreAllMocks());

it('uses component-owned pickable tags and blocks fire/intense without consulting prefab IDs', () => {
  const scene = new THREE.Scene();
  const { instance, display } = createEmptyEntity('grass');
  const model = display.model; scene.add(model);
  instance.addTag('plant'); instance.addTag('custom');
  const component = new Pickable(instance, 'log', 10);
  expect(getPickActions(model)[0].available).toBe(true);
  component.canInteractWith = false;
  expect(component.canBePicked).toBe(true);
  expect(getPickActions(model)[0].available).toBe(false);
  expect(component.pick({ giveItem: () => true })).toBe(false);
  component.canInteractWith = true;
  for (const tag of ['fire', 'intense']) {
    instance.addTag(tag);
    expect(getPickActions(model)[0].available).toBe(false);
    instance.removeTag(tag);
  }
  component.pick({ giveItem: () => true });
  expect(instance.listTags()).toEqual(['plant', 'custom']);
  expect(getPickActions(model)[0].available).toBe(false);
  component.update(10);
  expect(getPickActions(model)[0].available).toBe(true);
  component.dispose();
  expect(getPickActions(model)).toEqual([]);
  expect(instance.listTags()).toEqual(['plant', 'custom']);
  instance.remove(); display.dispose();
});

it('walks to reach, commits a prepared PICK and releases canceled products without changing the plant', async () => {
  vi.stubGlobal('window', new EventTarget());
  const scene = new THREE.Scene(), player = new THREE.Group();
  const { instance, display } = createEmptyEntity('grass');
  const model = display.model; instance.position.set(20, 0, 0);
  scene.add(model); scene.add(player); instance.addTag('plant');
  const component = new Pickable(instance, 'log', 10, 2);
  actionEntity(model, 'grass');
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
  const playerInstance = new PrefabInstance('wortox', new SpriteState({ name: 'idle' }));
  playerInstance.attach(player);
  const giveItem = vi.fn(() => true);
  const releaseProduct = vi.fn();
  const prepare = vi.fn(async () => ({ giveItem, dispose: releaseProduct }));
  let manual = false;
  const controller = new PickActionController(world, animation, locomotor, prepare, playerInstance.sprite, () => manual);
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
  expect(playerInstance.sprite.sprite.peek()).toMatchObject({ facing: 5, mirrored: false });
  expect(animation.setFacing).not.toHaveBeenCalled();
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

  controller.dispose(); instance.remove(); display.dispose(); controller.dispose();
  expect(pointer.dispose).not.toHaveBeenCalled();
  click();
  expect(giveItem).toHaveBeenCalledTimes(2);
  expect(picker.getMouseActions().left).toBeUndefined();
  component.dispose(); disposeActionEntity(model); picker.dispose(); stopEvents();
});

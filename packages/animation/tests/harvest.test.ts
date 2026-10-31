import { createEmptyEntity } from '../../prefab/src/prefabInstance';


import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { HarvestActionController, getHarvestActions, type HarvestTarget } from '../../stategraphs/src/harvest';
import { WilsonStateGraph } from '../../stategraphs/src/SGwilson';
import { Stewer } from '../../componets/src/stewer';
import type { ActionAnimationController, ActionWorldContext } from '../../stategraphs/src/actionContext';
import { EventEmitter } from '../../signals/src/EventEmitter';
import type { PlayerActionEvents } from '../../stategraphs/src/actionEvents';

afterEach(() => vi.unstubAllGlobals());

it('walks to the foot point, revalidates a buffered harvest and releases pending reception on cancellation', async () => {
  vi.stubGlobal('window', new EventTarget());
  const scene = new THREE.Scene(), player = new THREE.Group();
  const { instance, display } = createEmptyEntity('cookpot');
  const model = display.model;
  instance.position.set(20, 0, 0); scene.add(model);
  const container = { canbeopened: true, IsFull: () => false, IsOpen: () => false,
    GetAllItems: () => [], Close() {}, DestroyContents() {}, subscribeLifecycle: () => () => {} };
  const stewer = new Stewer({ prefab: 'cookpot', components: { container },
    getPosition: () => instance.position, addTag: tag => instance.addTag(tag), removeTag: tag => instance.removeTag(tag) });
  instance.components.stewer = stewer;
  stewer.OnLoad({ product: 'kabobs', done: true });
  const stategraph = new WilsonStateGraph({ playAnimation: () => .2, playSound() {}, setCasting() {}, onStateChanged() {} });
  const animation = { stategraph, cancelEmote() {}, setFacing: vi.fn() } as unknown as ActionAnimationController;
  const locomotor = { destination: undefined, goToPoint: vi.fn(() => true), stop: vi.fn() };
  const receiver = { giveItem: vi.fn(() => true), dispose: vi.fn() };
  const actionEvents = new EventEmitter<PlayerActionEvents>();
  const world = { scene, player, camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(),
    renderer: { domElement: new EventTarget() }, actionEvents } as unknown as ActionWorldContext;
  let manual = false;
  const controller = new HarvestActionController(world, animation, locomotor,
    () => receiver, () => manual);
  const target = getHarvestActions(model)[0].action.target as HarvestTarget;
  expect(controller.request(target)).toBe(true);
  controller.update();
  expect(locomotor.goToPoint).toHaveBeenCalledWith(new THREE.Vector3(16.8, 0, 0));
  expect(instance.position.toArray()).toEqual([20, 0, 0]);
  expect(receiver.giveItem).not.toHaveBeenCalled();
  player.position.x = 17;
  controller.update();
  expect(stategraph.stateName).toBe('dolongaction');
  stategraph.update(.5);
  manual = true; controller.update(); stategraph.update(2);
  expect(receiver.giveItem).not.toHaveBeenCalled();
  expect(receiver.dispose).toHaveBeenCalledOnce();
  expect(stewer.IsDone()).toBe(true);
  manual = false;
  receiver.dispose.mockClear();
  controller.request(target);
  controller.update();
  model.removeFromParent();
  stategraph.update(1); controller.update(); stategraph.update(1); controller.update();
  expect(receiver.giveItem).not.toHaveBeenCalled();
  expect(receiver.dispose).toHaveBeenCalledOnce();
  scene.add(model);
  controller.request(target);
  receiver.dispose.mockClear();
  controller.cancel();
  expect(receiver.dispose).toHaveBeenCalledOnce();
  instance.addTag('burnt');
  expect(getHarvestActions(model).every(action => action.available === false)).toBe(true);
  controller.dispose(); stewer.OnRemoveFromEntity(); instance.remove(); display.dispose();
});

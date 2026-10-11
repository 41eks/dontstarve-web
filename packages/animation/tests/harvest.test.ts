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
  const scene = new THREE.Scene(), model = new THREE.Group(), player = new THREE.Group();
  model.position.set(20, 8, 0); scene.add(model);
  const tags = new Set<string>();
  const container = { canbeopened: true, IsFull: () => false, IsOpen: () => false,
    GetAllItems: () => [], Close() {}, DestroyContents() {}, subscribeLifecycle: () => () => {} };
  const stewer = new Stewer({ prefab: 'cookpot', components: { container },
    getPosition: () => ({ x: 20, y: 0, z: 0 }), addTag: tag => tags.add(tag), removeTag: tag => tags.delete(tag) });
  model.userData.components = { stewer };
  model.userData.tags = { includes: (tag: string) => tags.has(tag) };
  model.userData.getGroundPosition = () => new THREE.Vector3(20, 0, 0);
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
    async () => receiver, () => manual);
  const target = getHarvestActions(scene)[0].action.target as HarvestTarget;
  expect(controller.request(target)).toBe(true);
  await Promise.resolve();
  controller.update();
  expect(locomotor.goToPoint).toHaveBeenCalledWith(new THREE.Vector3(16.8, 0, 0));
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
  await Promise.resolve(); controller.update();
  model.removeFromParent();
  stategraph.update(1); controller.update(); stategraph.update(1); controller.update();
  expect(receiver.giveItem).not.toHaveBeenCalled();
  expect(receiver.dispose).toHaveBeenCalledOnce();
  scene.add(model);
  controller.request(target);
  controller.cancel();
  receiver.dispose.mockClear();
  await Promise.resolve();
  expect(receiver.dispose).toHaveBeenCalledOnce();
  tags.add('burnt');
  expect(getHarvestActions(scene).every(action => action.available === false)).toBe(true);
  controller.dispose(); stewer.OnRemoveFromEntity();
});

import { createEmptyEntity } from '../../prefab/src/prefabInstance';
import { actionEntity, disposeActionEntity } from '../../prefab/src/actionEntity';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { afterEach, expect, it, vi } from 'vitest';
import { PlayerController } from '../../stategraphs/src/playercontroller';
import { WilsonStateGraph } from '../../stategraphs/src/SGwilson';
import { Stewer } from '../../componets/src/stewer';
import { Locomotor } from '../../prefab/src/locomotor';
import { WORLD_SCALE } from '../../prefab/src/tile';
import type { ActionPerformer, ActionWorldContext } from '../../stategraphs/src/actionContext';
import { EventEmitter } from '../../signals/src/EventEmitter';
import { createEquipmentExistenceState } from '../../signals/src';
import type { PlayerActionEvents } from '../../stategraphs/src/actionEvents';
import { sceneActions } from './sceneActions';

afterEach(() => vi.unstubAllGlobals());

it('walks to a finished pot, gives its product to the doer at the hit frame, and keeps it when cancelled or burnt', () => {
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
  actionEntity(model, 'cookpot');
  stewer.OnLoad({ product: 'kabobs', done: true });
  const stategraph = new WilsonStateGraph({ playAnimation: () => .2, playSound() {}, setCasting() {}, onStateChanged() {} });
  const animation = { stategraph, cancelEmote() {}, setFacing: vi.fn() } as unknown as ActionPerformer;
  const locomotor = new Locomotor({ position: player.position, velocity: new THREE.Vector3() } as unknown as CANNON.Body,
    { physicsRadius: .5 * WORLD_SCALE });
  const product = { itemId: 'kabobs' };
  const inventory = { GetNumSlots: () => 15, GiveItem: vi.fn(() => true), entities: { create: vi.fn(() => product), destroy: vi.fn() } };
  const doer = { hasTag: (tag: string) => tag === 'player', PushEvent: vi.fn(), getPosition: () => player.position, components: { inventory } };
  const world = { scene, player, camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(),
    renderer: { domElement: new EventTarget() }, actionEvents: new EventEmitter<PlayerActionEvents>() } as unknown as ActionWorldContext;
  let manual = false;
  const controller = new PlayerController(world, animation, locomotor, createEquipmentExistenceState('HANDS'), doer as never, () => manual);
  const harvest = () => controller.DoAction(controller.createAction({ action: 'HARVEST', target: actionEntity(model, 'cookpot') })!);
  try {
    // componentactions SCENE.stewer: a pot done cooking offers HARVEST on both buttons.
    expect(sceneActions(model, doer)).toEqual(['HARVEST']);
    expect(sceneActions(model, doer, true)).toEqual(['HARVEST']);
    expect(harvest()).toBe(true);
    expect(locomotor.destination).toBeDefined();
    player.position.x = 18.1; locomotor.update(16, 1 / 30);
    expect(stategraph.stateName).toBe('dolongaction');
    stategraph.update(.5);
    manual = true; controller.update(); stategraph.update(2);
    expect(inventory.GiveItem).not.toHaveBeenCalled();
    expect(stewer.IsDone()).toBe(true);
    manual = false;
    expect(harvest()).toBe(true);
    stategraph.update(2);
    expect(inventory.entities.create).toHaveBeenCalledExactlyOnceWith({ itemId: 'kabobs', count: 1 });
    expect(inventory.GiveItem).toHaveBeenCalledExactlyOnceWith(product, new THREE.Vector3(20, 0, 0));
    expect(stewer.IsDone()).toBe(false);
    stewer.OnLoad({ product: 'kabobs', done: true });
    instance.addTag('burnt');
    expect(sceneActions(model, doer)).toEqual([]);
  } finally { controller.dispose(); stewer.OnRemoveFromEntity(); disposeActionEntity(model); instance.remove(); display.dispose(); }
});

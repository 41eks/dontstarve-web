import { actionEntity, disposeActionEntity } from '../../prefab/src/actionEntity';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { afterEach, expect, it, vi } from 'vitest';
import { PlayerActionPicker } from '../../stategraphs/src/playeractionpicker';
import { PlayerController } from '../../stategraphs/src/playercontroller';
import { WilsonStateGraph } from '../../stategraphs/src/SGwilson';
import { Pickable } from '../../prefab/src/components/pickable';
import { Locomotor } from '../../prefab/src/locomotor';
import { WORLD_SCALE } from '../../prefab/src/tile';
import type { ActionWorldContext } from '../../stategraphs/src/actionContext';
import type { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import { EventEmitter } from '../../signals/src/EventEmitter';
import { createEquipmentExistenceState } from '../../signals/src';
import type { PlayerActionEvents } from '../../stategraphs/src/actionEvents';
import { createEmptyEntity } from '../../prefab/src/prefabInstance';
import { canDoSceneAction, sceneActions } from './sceneActions';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('uses component-owned pickable tags and blocks fire/intense without consulting prefab IDs', () => {
  const scene = new THREE.Scene();
  const { instance, display } = createEmptyEntity('grass');
  const model = display.model; scene.add(model);
  instance.addTag('plant'); instance.addTag('custom');
  const component = new Pickable(instance, 'log', 10);
  actionEntity(model, 'grass');
  expect(canDoSceneAction('PICK', model)).toBe(true);
  component.canInteractWith = false;
  expect(component.canBePicked).toBe(true);
  expect(canDoSceneAction('PICK', model)).toBe(false);
  expect(component.pick({ giveItem: () => true })).toBe(false);
  component.canInteractWith = true;
  for (const tag of ['fire', 'intense']) {
    instance.addTag(tag);
    expect(sceneActions(model)).not.toContain('PICK');
    instance.removeTag(tag);
  }
  component.pick({ giveItem: () => true });
  expect(instance.listTags().filter(tag => tag !== 'tickingarea')).toEqual(['plant', 'custom']);
  expect(canDoSceneAction('PICK', model)).toBe(false);
  component.update(10);
  expect(canDoSceneAction('PICK', model)).toBe(true);
  component.dispose();
  expect(sceneActions(model)).toEqual([]);
  expect(instance.listTags().filter(tag => tag !== 'tickingarea')).toEqual(['plant', 'custom']);
  disposeActionEntity(model); instance.remove(); display.dispose();
});

it('walks to the arrive distance, gives the PICK product to the doer inventory and releases unclaimed products', () => {
  vi.stubGlobal('window', new EventTarget());
  const scene = new THREE.Scene(), player = new THREE.Group();
  const { instance, display } = createEmptyEntity('grass');
  const model = display.model; instance.setPosition(20, 0, 0);
  scene.add(model); scene.add(player); instance.addTag('plant');
  const component = new Pickable(instance, 'log', 10, 2);
  actionEntity(model, 'grass');
  const pointer = { trackPointer() {}, beginFrame() {}, endFrame() {},
    pickMouseTarget: () => ({ object: model }), dispose: vi.fn() } as unknown as PointerRaycaster;
  const picker = new PlayerActionPicker(pointer), canvas = new EventTarget();
  const actionEvents = new EventEmitter<PlayerActionEvents>(), begin = vi.fn();
  const stopEvents = actionEvents.on('action:begin', begin);
  const stategraph = new WilsonStateGraph({ playAnimation: () => .2, playSound() {}, onStateChanged() {} });
  const animation = { stategraph };
  const locomotor = new Locomotor({ position: player.position, velocity: new THREE.Vector3() } as unknown as CANNON.Body,
    { physicsRadius: .5 * WORLD_SCALE });
  const world = { scene, player, camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(),
    mouseActions: picker, actionEvents, renderer: { domElement: canvas } } as unknown as ActionWorldContext;
  // pickable:Pick spawns the product and the picker's inventory takes it.
  const product = { isRemoved: false };
  const inventory = { GetNumSlots: () => 15, EquipHasTag: () => false, GiveItem: vi.fn(() => true),
    entities: { create: vi.fn(() => product), destroy: vi.fn() } };
  const doer = { hasTag: (tag: string) => tag === 'player', PushEvent: vi.fn(), GetPosition: () => player.position,
    getPosition: () => player.position, components: { inventory } };
  let manual = false;
  const controller = new PlayerController(world, animation.stategraph, locomotor, createEquipmentExistenceState('HANDS'), doer as never, () => manual);
  const click = () => {
    const event = Object.assign(new Event('pointerdown', { cancelable: true }), { button: 0 });
    canvas.dispatchEvent(event);
    return event;
  };
  try {
    expect(picker.getMouseActions().left).toMatchObject({ action: 'PICK', target: { prefab: 'grass' }, doer });
    expect(click().defaultPrevented).toBe(true);
    expect(begin).toHaveBeenCalledExactlyOnceWith({ owner: controller, action: 'PICK' });
    expect(locomotor.destination).toBeDefined();
    expect(stategraph.stateName).not.toBe('dolongaction');
    player.position.x = 20 - 1.9; locomotor.update(16, 1 / 30);
    expect(stategraph.stateName).toBe('dolongaction');
    stategraph.update(1);
    expect(inventory.entities.create).toHaveBeenCalledExactlyOnceWith({ itemId: 'log', count: 2 });
    expect(inventory.GiveItem).toHaveBeenCalledWith(product, new THREE.Vector3(20, 0, 0));
    expect(component.exportState()).toMatchObject({ picked: true });
    expect(inventory.entities.destroy).not.toHaveBeenCalled();

    // An inventory that refuses the product leaves the plant unpicked and destroys the spawned product.
    inventory.GiveItem.mockReturnValue(false);
    component.update(10);
    expect(component.canBePicked).toBe(true);
    player.position.x = 0;
    click();
    expect(begin).toHaveBeenCalledTimes(2);
    manual = true;
    controller.update();
    expect(locomotor.bufferedAction).toBeUndefined();
    manual = false;
    player.position.x = 20 - 1.9;
    click();
    stategraph.update(1);
    expect(inventory.GiveItem).toHaveBeenCalledTimes(2);
    expect(component.exportState()).toEqual({});
    expect(component.canBePicked).toBe(true);
    expect(inventory.entities.destroy).toHaveBeenCalledExactlyOnceWith(product);
  } finally {
    controller.dispose(); instance.remove(); display.dispose();
    expect(pointer.dispose).not.toHaveBeenCalled();
    expect(picker.getMouseActions().left).toBeUndefined();
    component.dispose(); disposeActionEntity(model); picker.dispose(); stopEvents();
  }
});

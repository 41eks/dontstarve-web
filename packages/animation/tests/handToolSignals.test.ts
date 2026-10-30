import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createEquipmentExistenceState } from '../../signals/src';
import { PickaxeActionController } from '../../stategraphs/src/pickaxe';
import { HammerActionController, getHammerActionTarget, type HammerTarget } from '../../stategraphs/src/hammer';
import { ReskinActionController } from '../../stategraphs/src/reskin_tool';
import type { ActionWorldContext, ActionAnimationController } from '../../stategraphs/src/actionContext';
import { frontTasks, registerFrontTask } from '../../../src/animate';
import { actionTool, reskinEntityFields } from './actionFixtures';
import { Workable } from '../../componets/src/workable';
import { ItemEntity } from '../../inventory/src/entity';
import { SpriteState } from '../../display/src/spriteState';
import { PrefabInstance, createEmptyEntity } from '../../prefab/src/prefabInstance';
import { actionEntity } from '../../prefab/src/actionEntity';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';

vi.mock('../../../src/universal', () => ({}));

beforeEach(() => vi.stubGlobal('window', new EventTarget()));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function context() {
  return { player: new THREE.Group(), camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(),
    renderer: { domElement: new EventTarget() } } as unknown as ActionWorldContext;
}

it('registers only the equipped controller, handles restored equipment and removes captured tasks on replacement/disposal', () => {
  const equipment = createEquipmentExistenceState('HANDS'), world = context();
  world.registerFrameTask = registerFrontTask;
  const first = actionTool('goldenpickaxe');
  equipment.set(first);
  const animation = { isMining: false, isHammering: false, isCasting: false, isNetting: false,
    cancelMine: vi.fn(), cancelHammer: vi.fn() } as unknown as ActionAnimationController;
  const locomotor = { goToPoint: () => true, stop: vi.fn(), destination: undefined };
  const hammer = new HammerActionController(world, animation, locomotor, equipment, new SpriteState({ name: 'idle' }));
  const pickaxe = new PickaxeActionController(world, animation, locomotor, equipment, () => []);
  const hammerUpdate = vi.spyOn(hammer, 'update'), pickaxeUpdate = vi.spyOn(pickaxe, 'update');
  try {
    expect(frontTasks).toHaveLength(1);
    const originalTask = frontTasks[0];
    originalTask(0.1);
    expect(pickaxeUpdate).toHaveBeenCalledExactlyOnceWith(0.1);
    expect(hammerUpdate).not.toHaveBeenCalled();
    equipment.set({ ...first });
    expect(frontTasks).toEqual([originalTask]);
    equipment.set(actionTool('goldenpickaxe'));
    expect(frontTasks).toHaveLength(1);
    expect(frontTasks[0]).not.toBe(originalTask);
    originalTask(0.2);
    expect(pickaxeUpdate).toHaveBeenCalledOnce();
    const replacedTask = frontTasks[0];
    equipment.set(actionTool('hammer'));
    expect(frontTasks).toHaveLength(1);
    replacedTask(0.2);
    frontTasks[0](0.3);
    expect(pickaxeUpdate).toHaveBeenCalledOnce();
    expect(hammerUpdate).toHaveBeenCalledExactlyOnceWith(0.3);
    const captured = [...frontTasks];
    equipment.set(null);
    expect(frontTasks).toEqual([]);
    captured.forEach(task => task(0.4));
    expect(hammerUpdate).toHaveBeenCalledOnce();
    equipment.set(actionTool('hammer'));
    hammer.dispose(); pickaxe.dispose();
    expect(frontTasks).toEqual([]);
    equipment.set(first);
    expect(frontTasks).toEqual([]);
  } finally { hammer.dispose(); pickaxe.dispose(); }
});

it('uses tool components, preserves component republishing and immediately cancels same-ID replacement', () => {
  const equipment = createEquipmentExistenceState('HANDS');
  equipment.set({ itemId: 'torch', EQUIPSLOTS: 'HANDS' });
  const first = actionTool('goldenpickaxe');
  let hit: (() => void) | undefined;
  const animation = { isMining: false, isCasting: false, isNetting: false, cancelEmote: vi.fn(), setFacing: vi.fn(),
    playMine: vi.fn((callback: () => void) => { hit = callback; animation.isMining = true; return true; }),
    cancelMine: vi.fn(() => { animation.isMining = false; }) };
  const entity = new ItemEntity({ itemId: 'rock1', count: 1 });
  entity.components.workable = new Workable(entity);
  entity.components.workable.SetWorkAction('MINE');
  const playHit = vi.fn();
  entity.components.workable.SetOnWorkCallback(playHit);
  const target = { entity, id: 'rock', model: new THREE.Group(), position: new THREE.Vector3(1, 0, 0),
    isValid: () => true };
  const controller = new PickaxeActionController(context(), animation as unknown as ActionAnimationController,
    { goToPoint: () => true, stop: vi.fn(), destination: undefined }, equipment, () => [target]);
  expect(controller.request(target)).toBe(false);
  equipment.set(first);
  expect(controller.request(target)).toBe(true);
  controller.update(0);
  animation.cancelMine.mockClear();
  equipment.set({ ...first });
  expect(animation.cancelMine).not.toHaveBeenCalled();
  hit?.();
  expect(playHit).toHaveBeenCalledOnce();
  animation.isMining = false;
  expect(controller.request(target)).toBe(true);
  controller.update(0);
  const replacement = actionTool('goldenpickaxe');
  equipment.set(replacement);
  expect(animation.isMining).toBe(false);
  hit?.();
  expect(playHit).toHaveBeenCalledOnce();
  expect(equipment.peek()).toBe(replacement);
  controller.dispose();
  const cancellations = animation.cancelMine.mock.calls.length;
  equipment.set(null);
  expect(animation.cancelMine).toHaveBeenCalledTimes(cancellations);
});

it('declares hammer facing on the player instance before starting the action', () => {
  const equipment = createEquipmentExistenceState('HANDS');
  equipment.set(actionTool('hammer'));
  const world = context();
  const instance = new PrefabInstance('wortox', new SpriteState({ name: 'idle' }));
  instance.attach(world.player);
  let facingAtAction: { facing?: number; mirrored?: boolean } | undefined;
  const animation = { isHammering: false, isCasting: false, isNetting: false,
    cancelEmote: vi.fn(), cancelHammer: vi.fn(), playHammer: vi.fn(() => {
      facingAtAction = instance.sprite.sprite.peek();
      return true;
    }), setFacing: vi.fn() };
  const entity = new ItemEntity({ itemId: 'skeleton', count: 1 });
  entity.components.workable = new Workable(entity);
  entity.components.workable.SetWorkAction('HAMMER');
  const target = { entity, id: 'skeleton', model: new THREE.Group(), position: new THREE.Vector3(-1, 0, 0),
    isValid: () => true, playHit: vi.fn() };
  const controller = new HammerActionController(world, animation as unknown as ActionAnimationController,
    { goToPoint: () => true, stop: vi.fn(), destination: undefined }, equipment, instance.sprite);
  try {
    expect(controller.request(target)).toBe(true);
    controller.update(0);
    expect(instance.sprite.sprite.peek()).toMatchObject({ facing: 5, mirrored: true });
    expect(facingAtAction).toMatchObject({ facing: 5, mirrored: true });
    expect(animation.playHammer).toHaveBeenCalledOnce();
    expect(animation.setFacing).not.toHaveBeenCalled();
  } finally { controller.dispose(); }
});

it('finds registered hammer targets from pointer input and revalidates buffered work and removal', () => {
  const world = context(), equipment = createEquipmentExistenceState('HANDS');
  const tool = actionTool('hammer');
  equipment.set(tool);
  const { instance, display } = createEmptyEntity('wall_stone');
  display.mount(new THREE.Scene());
  instance.position.set(1, 0, 0);
  instance.entityId = 'wall';
  const entity = actionEntity(display.model, instance.prefab, instance);
  const workable = entity.components.workable = new Workable(instance);
  workable.SetWorkAction('HAMMER'); workable.SetWorkLeft(3);
  const worked = vi.fn();
  workable.SetOnWorkCallback(worked);
  const target: HammerTarget = { id: 'wall', entity, instance, display, position: instance.position,
    isValid: () => !instance.isRemoved, playHit: vi.fn() };
  entity.hammerTarget = target;
  vi.spyOn(PointerRaycaster.prototype, 'trackPointer').mockImplementation(() => {});
  vi.spyOn(PointerRaycaster.prototype, 'pickMouseTarget').mockReturnValue({ object: display.model } as THREE.Intersection);
  let hit: (() => boolean) | undefined;
  const animation = { isHammering: false, isCasting: false, isNetting: false, cancelEmote: vi.fn(),
    cancelHammer: vi.fn(), playHammer: vi.fn((callback: () => boolean) => { hit = callback; return true; }) };
  const controller = new HammerActionController(world, animation as unknown as ActionAnimationController,
    { goToPoint: () => true, stop: vi.fn(), destination: undefined }, equipment, new SpriteState({ name: 'idle' }));
  const click = () => {
    const event = Object.assign(new Event('pointerdown', { cancelable: true }), { button: 2 });
    world.renderer.domElement.dispatchEvent(event);
    controller.update(0);
    return event;
  };
  try {
    expect(getHammerActionTarget(display.model)).toBe(target);
    expect(click().defaultPrevented).toBe(true);
    expect(hit?.()).toBe(true);
    expect(worked).toHaveBeenCalledOnce();
    expect(target.playHit).not.toHaveBeenCalled();
    expect(workable.GetWorkLeft()).toBe(2);
    click(); workable.SetWorkable(false);
    expect(hit?.()).toBe(false);
    expect(worked).toHaveBeenCalledOnce();
    workable.SetWorkable(true); click(); instance.remove();
    expect(hit?.()).toBe(false);
    expect(getHammerActionTarget(display.model)).toBeUndefined();
    expect(entity.hammerTarget).toBeUndefined();
    expect(worked).toHaveBeenCalledOnce();
  } finally { controller.dispose(); instance.remove(); display.dispose(); workable.dispose(); }
});

it('discards a pending reskin after the equipped entity changes during loading and releases subscriptions', async () => {
  const equipment = createEquipmentExistenceState('HANDS');
  const first = actionTool('reskin_tool');
  equipment.set(first);
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const sprite = new SpriteState({ name: '' }), model = new THREE.Group();
  // The display is still loading the skin the cast would choose when the equipment changes.
  const target = { ...reskinEntityFields, id: 'target', prefabId: 'icebox', model, position: new THREE.Vector3(1, 0, 0), sprite,
    get skinId() { return sprite.skinId.peek(); }, isValid: () => true,
    display: { model, preloadSkin: async () => { await ready; } } as never };
  const animation = { isReskinning: false, cancelEmote: vi.fn(), cancelReskin: vi.fn(), setFacing: vi.fn() };
  const fx = { play: vi.fn(), dispose: vi.fn() };
  const effects = { prepare: vi.fn(() => fx) };
  const controller = new ReskinActionController(context(), animation as unknown as ActionAnimationController,
    { goToPoint: () => true, stop: vi.fn(), destination: undefined }, equipment, effects);
  const request = controller.request(target);
  equipment.set(actionTool('reskin_tool'));
  release();
  expect(await request).toBe(false);
  expect(sprite.skinId.peek()).toBeUndefined();
  expect(fx.play).not.toHaveBeenCalled();
  controller.dispose();
  animation.cancelReskin.mockClear();
  equipment.set(null);
  expect(animation.cancelReskin).not.toHaveBeenCalled();
});

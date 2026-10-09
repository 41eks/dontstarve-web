import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHandEquipmentExistenceState } from '../../signals/src';
import { PickaxeActionController } from '../../stategraphs/src/pickaxe';
import { HammerActionController } from '../../stategraphs/src/hammer';
import { ReskinActionController } from '../../stategraphs/src/reskin_tool';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import type { ActionWorldContext, ActionAnimationController } from '../../stategraphs/src/actionContext';
import { frontTasks, registerFrontTask } from '../../../src/animate';

vi.mock('../../../src/universal', () => ({}));

beforeEach(() => vi.stubGlobal('window', new EventTarget()));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function context() {
  return { player: new THREE.Group(), camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(),
    renderer: { domElement: new EventTarget() } } as unknown as ActionWorldContext;
}

it('registers only the equipped controller, handles restored equipment and removes captured tasks on replacement/disposal', () => {
  const equipment = createHandEquipmentExistenceState(), world = context();
  world.registerFrameTask = registerFrontTask;
  const first = { itemId: 'goldenpickaxe', EQUIPSLOTS: 'HANDS' as const,
    entity: { id: 'pickaxe', prefab: 'goldenpickaxe', isRemoved: false } };
  equipment.set(first);
  const animation = { isMining: false, isHammering: false, isCasting: false, isNetting: false,
    cancelMine: vi.fn(), cancelHammer: vi.fn() } as unknown as ActionAnimationController;
  const locomotor = { goToPoint: () => true, stop: vi.fn(), destination: undefined };
  const hammer = new HammerActionController(world, animation, locomotor, equipment, () => []);
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
    equipment.set({ ...first, entity: { ...first.entity, id: 'replacement' } });
    expect(frontTasks).toHaveLength(1);
    expect(frontTasks[0]).not.toBe(originalTask);
    originalTask(0.2);
    expect(pickaxeUpdate).toHaveBeenCalledOnce();
    const replacedTask = frontTasks[0];
    equipment.set({ itemId: 'hammer', EQUIPSLOTS: 'HANDS' });
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
    equipment.set({ itemId: 'hammer', EQUIPSLOTS: 'HANDS' });
    hammer.dispose(); pickaxe.dispose();
    expect(frontTasks).toEqual([]);
    equipment.set(first);
    expect(frontTasks).toEqual([]);
  } finally { hammer.dispose(); pickaxe.dispose(); }
});

it('uses its own tool IDs, preserves component republishing and immediately cancels same-ID replacement', () => {
  const equipment = createHandEquipmentExistenceState();
  equipment.set({ itemId: 'torch', EQUIPSLOTS: 'HANDS' });
  const entity = { id: 'first', prefab: 'goldenpickaxe', isRemoved: false };
  const first = { itemId: 'goldenpickaxe', EQUIPSLOTS: 'HANDS' as const, entity };
  let hit: (() => void) | undefined;
  const animation = { isMining: false, isCasting: false, isNetting: false, cancelEmote: vi.fn(), setFacing: vi.fn(),
    playMine: vi.fn((callback: () => void) => { hit = callback; animation.isMining = true; return true; }),
    cancelMine: vi.fn(() => { animation.isMining = false; }) };
  const target = { id: 'rock', model: new THREE.Group(), position: new THREE.Vector3(1, 0, 0),
    isValid: () => true, playHit: vi.fn() };
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
  expect(target.playHit).toHaveBeenCalledOnce();
  animation.isMining = false;
  expect(controller.request(target)).toBe(true);
  controller.update(0);
  const replacement = { ...first, entity: { ...entity, id: 'replacement' } };
  equipment.set(replacement);
  expect(animation.isMining).toBe(false);
  hit?.();
  expect(target.playHit).toHaveBeenCalledOnce();
  expect(equipment.peek()).toBe(replacement);
  controller.dispose();
  const cancellations = animation.cancelMine.mock.calls.length;
  equipment.set(null);
  expect(animation.cancelMine).toHaveBeenCalledTimes(cancellations);
});

it('discards a prepared reskin after the equipped entity changes during loading and releases subscriptions', async () => {
  const equipment = createHandEquipmentExistenceState();
  const first = { itemId: 'reskin_tool', EQUIPSLOTS: 'HANDS' as const,
    entity: { id: 'first', prefab: 'reskin_tool', isRemoved: false } };
  equipment.set(first);
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const prepared = { apply: vi.fn(() => true), dispose: vi.fn() };
  const target = { id: 'target', prefabId: 'icebox', model: new THREE.Group(), position: new THREE.Vector3(1, 0, 0),
    isValid: () => true, prepareNextSkin: async () => { await ready; return prepared; } };
  const animation = { isReskinning: false, cancelEmote: vi.fn(), cancelReskin: vi.fn(), setFacing: vi.fn() };
  const effects = { prepare: vi.fn(async () => {}), spawn: vi.fn() };
  const controller = new ReskinActionController(context(), animation as unknown as ActionAnimationController,
    { goToPoint: () => true, stop: vi.fn(), destination: undefined }, equipment, () => [target], effects);
  const request = controller.request(target);
  equipment.set({ ...first, entity: { ...first.entity, id: 'replacement' } });
  release();
  expect(await request).toBe(false);
  expect(prepared.apply).not.toHaveBeenCalled();
  expect(prepared.dispose).toHaveBeenCalledOnce();
  expect(effects.spawn).not.toHaveBeenCalled();
  controller.dispose();
  animation.cancelReskin.mockClear();
  equipment.set(null);
  expect(animation.cancelReskin).not.toHaveBeenCalled();
});

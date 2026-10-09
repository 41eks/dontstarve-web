import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHandEquipmentExistenceState } from '../../signals/src';
import { PickaxeActionController } from '../../stategraphs/src/pickaxe';
import { ReskinActionController } from '../../stategraphs/src/reskin_tool';
import { setupLightStaffCasting } from '../../stategraphs/src/yellowstaff';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import type { ActionWorldContext, ActionAnimationController } from '../../stategraphs/src/actionContext';

beforeEach(() => vi.stubGlobal('window', new EventTarget()));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function context() {
  return { player: new THREE.Group(), camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(),
    renderer: { domElement: new EventTarget() } } as unknown as ActionWorldContext;
}

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

it('selects the cold-light staff internally and cancels a same-ID replacement during preparation', async () => {
  const equipment = createHandEquipmentExistenceState();
  equipment.set({ itemId: 'yellowstaff', EQUIPSLOTS: 'HANDS' });
  const world = context(), canvas = world.renderer.domElement;
  Object.assign(canvas, { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) });
  vi.spyOn(PointerRaycaster.prototype, 'groundPoint').mockReturnValue(new THREE.Vector3(1, 0, 0));
  let release!: () => void, cast: (() => void) | undefined;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const stars = { prefabId: 'staffcoldlight' as const, prepare: vi.fn(() => ready), spawn: vi.fn(async () => {}) };
  const animation = { isCasting: false, setFacing: vi.fn(), stategraph: { cancelAction: vi.fn() },
    playStaffCast: vi.fn((callback: () => void) => { cast = callback; return true; }) };
  const stop = setupLightStaffCasting(world, animation as unknown as ActionAnimationController, stars, equipment, vi.fn(), vi.fn());
  const click = () => canvas.dispatchEvent(Object.assign(new Event('pointerdown', { cancelable: true }),
    { button: 2, clientX: 50, clientY: 50 }));
  click();
  expect(stars.prepare).not.toHaveBeenCalled();
  const first = { itemId: 'opalstaff', EQUIPSLOTS: 'HANDS' as const,
    entity: { id: 'first', prefab: 'opalstaff', isRemoved: false } };
  equipment.set(first);
  click();
  expect(stars.prepare).toHaveBeenCalledOnce();
  equipment.set({ ...first, entity: { ...first.entity, id: 'replacement' } });
  release(); await Promise.resolve();
  expect(animation.playStaffCast).not.toHaveBeenCalled();
  click(); await Promise.resolve();
  expect(animation.playStaffCast).toHaveBeenCalledOnce();
  cast?.();
  expect(stars.spawn).toHaveBeenCalledExactlyOnceWith(new THREE.Vector3(1, 0, 0));
  stop();
  animation.stategraph.cancelAction.mockClear();
  equipment.set(null);
  expect(animation.stategraph.cancelAction).not.toHaveBeenCalled();
});

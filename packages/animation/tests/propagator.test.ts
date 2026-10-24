import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { getBoundWatchWorldContent } from '../../signals/src';
import { bindTestWorld } from './worldContentFixture';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Propagator } from '../../componets/src/propagator';
import { actionEntity } from '../../prefab/src/actionEntity';
import { ItemEntity } from '../../inventory/src';
import { configureBurnableItemEntity, type BurnableItemController } from '../../prefab/src/burnableItems';
import type { GroundPrefabContext } from '../../prefab/src/groundPrefab';

afterEach(() => vi.restoreAllMocks());

it('uses the current spring radius for neighbour queries and heat falloff without restarting the timer', () => {
  const scheduler = new GameTimeScheduler();
  const { season, unbind } = bindTestWorld(scheduler);
  const source = actionEntity(new THREE.Group(), 'stafflight');
  const near = actionEntity(new THREE.Group(), 'log'), far = actionEntity(new THREE.Group(), 'cutgrass');
  near.model.position.x = 6;
  far.model.position.x = 7.5;
  const nearHeat = vi.fn(), farHeat = vi.fn();
  for (const [target, receive] of [[near, nearHeat], [far, farHeat]] as const) {
    target.components.propagator = new Propagator(target, 'small', () => [], 3, scheduler, getBoundWatchWorldContent());
    vi.spyOn(target.components.propagator, 'AddHeat').mockImplementation(receive);
  }
  const nearby = vi.fn((radius: number) => [near, far].filter(target => target.getPosition().length() <= radius));
  const propagator = new Propagator(source, 'default', nearby, 3, scheduler, getBoundWatchWorldContent());
  source.components.propagator = propagator;
  propagator.heatoutput = 15;
  propagator.spreading.set(true);
  scheduler.advance(.5);
  expect(nearby).toHaveBeenLastCalledWith(9);
  expect(nearHeat).toHaveBeenLastCalledWith(15 * (1 - 36 / 81) * .5);
  expect(farHeat).toHaveBeenCalledOnce();

  const deadline = propagator.timer.peek();
  season.set({ season: 'spring', progress: 0 });
  expect(propagator.propagationRange.peek()).toBeCloseTo(3 * .67);
  expect('set' in propagator.propagationRange).toBe(false);
  expect(propagator.timer.peek()).toBe(deadline);
  expect(nearHeat).toHaveBeenCalledOnce();
  scheduler.advance(.5);
  expect(nearby.mock.calls.at(-1)![0]).toBeCloseTo(9 * .67);
  expect(nearHeat.mock.calls.at(-1)![0]).toBeCloseTo(15 * Math.max(.1, 1 - 36 / (9 * .67) ** 2) * .5);
  expect(farHeat).toHaveBeenCalledOnce();

  season.set({ season: 'summer', progress: 0 });
  scheduler.advance(.5);
  expect(propagator.propagationRange.peek()).toBe(3);
  expect(nearby).toHaveBeenLastCalledWith(9);
  expect(farHeat).toHaveBeenCalledTimes(2);
  propagator.dispose(); near.components.propagator!.dispose(); far.components.propagator!.dispose();
  const calls = nearby.mock.calls.length;
  season.set({ season: 'spring', progress: 0 });
  scheduler.advance(1);
  expect(propagator.propagationRange.peek()).toBe(3);
  expect(propagator.timer.peek()).toEqual({ status: 'stopped' });
  expect(nearby).toHaveBeenCalledTimes(calls);
  scheduler.dispose(); unbind();
});

it('binds a persistent inventory propagator to world season and releases the previous dependency on rebinding', () => {
  vi.spyOn(Math, 'random').mockReturnValue(.5);
  const entity = new ItemEntity({ itemId: 'log', count: 1 });
  configureBurnableItemEntity(entity);
  const controller = entity.getComponent<BurnableItemController>('burnable_item')!;
  const propagator = controller.propagator;
  const worldA = bindTestWorld(new GameTimeScheduler()), first = worldA.season;
  first.set({ season: 'spring', progress: 0 });
  const presentation = () => ({ context: {} as unknown as GroundPrefabContext,
    ash: { spawn: vi.fn(() => true), dispose: vi.fn() } });
  const firstArt = presentation(), nextArt = presentation();
  expect(propagator.propagationRange.peek()).toBe(4);
  controller.bind(firstArt);
  expect(propagator.propagationRange.peek()).toBeCloseTo(4 * .67);
  controller.release(firstArt);
  const worldB = bindTestWorld(new GameTimeScheduler()), next = worldB.season;
  next.set({ season: 'winter', progress: 0 });
  controller.bind(nextArt);
  expect(propagator.propagationRange.peek()).toBe(4);
  const readFirst = vi.spyOn(first, 'get');
  first.set({ season: 'autumn', progress: 0 });
  expect(readFirst).not.toHaveBeenCalled();
  expect(propagator.propagationRange.peek()).toBe(4);
  next.set({ season: 'spring', progress: 0 });
  expect(propagator.propagationRange.peek()).toBeCloseTo(4 * .67);
  entity.destroy();
  next.set({ season: 'summer', progress: 0 });
  expect(propagator.propagationRange.peek()).toBeCloseTo(4 * .67);
});


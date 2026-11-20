import { prefabInstance } from '../../prefab/src/prefabInstance';
import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { getBoundWatchWorldContent } from '../../signals/src';
import { bindTestWorld } from './worldContentFixture';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Propagator } from '../../componets/src/propagator';
import { registerActionEntity } from '../../prefab/src/actionEntity';
import { withEntity } from './entityFixture';
import { configureBurnableItemEntity, type BurnableItemController } from '../../prefab/src/burnableItems';
import { testEnts } from './entsFixture';
import { testItem } from './testInventory';

afterEach(() => vi.restoreAllMocks());

it('uses the current spring radius for neighbour queries and heat falloff without restarting the timer', () => {
  const scheduler = new GameTimeScheduler();
  const { season, unbind } = bindTestWorld(scheduler);
  const source = registerActionEntity(prefabInstance(withEntity(new THREE.Group(), 'stafflight'))!);
  const near = registerActionEntity(prefabInstance(withEntity(new THREE.Group(), 'log'))!),
    far = registerActionEntity(prefabInstance(withEntity(new THREE.Group(), 'cutgrass'))!);
  near.setPosition(6, 0, 0);
  far.setPosition(7.5, 0, 0);
  const nearHeat = vi.fn(),
    farHeat = vi.fn();
  for (const [target, receive] of [
    [near, nearHeat],
    [far, farHeat],
  ] as const) {
    target.components.propagator = new Propagator(target, 'small', () => [], 3, scheduler, getBoundWatchWorldContent());
    vi.spyOn(target.components.propagator, 'AddHeat').mockImplementation(receive);
  }
  const nearby = vi.fn((radius: number) => [near, far].filter(target => target.getPosition().length() <= radius));
  const propagator = new Propagator(source, 'default', nearby, 3, scheduler, getBoundWatchWorldContent());
  source.components.propagator = propagator;
  propagator.heatoutput = 15;
  propagator.spreading.set(true);
  scheduler.advance(0.5);
  expect(nearby).toHaveBeenLastCalledWith(9);
  expect(nearHeat).toHaveBeenLastCalledWith(15 * (1 - 36 / 81) * 0.5);
  expect(farHeat).toHaveBeenCalledOnce();

  const deadline = propagator.timer.peek();
  season.set({ season: 'spring', progress: 0 });
  expect(propagator.propagationRange.peek()).toBeCloseTo(3 * 0.67);
  expect('set' in propagator.propagationRange).toBe(false);
  expect(propagator.timer.peek()).toBe(deadline);
  expect(nearHeat).toHaveBeenCalledOnce();
  scheduler.advance(0.5);
  expect(nearby.mock.calls.at(-1)![0]).toBeCloseTo(9 * 0.67);
  expect(nearHeat.mock.calls.at(-1)![0]).toBeCloseTo(15 * Math.max(0.1, 1 - 36 / (9 * 0.67) ** 2) * 0.5);
  expect(farHeat).toHaveBeenCalledOnce();

  season.set({ season: 'summer', progress: 0 });
  scheduler.advance(0.5);
  expect(propagator.propagationRange.peek()).toBe(3);
  expect(nearby).toHaveBeenLastCalledWith(9);
  expect(farHeat).toHaveBeenCalledTimes(2);
  propagator.dispose();
  near.components.propagator!.dispose();
  far.components.propagator!.dispose();
  const calls = nearby.mock.calls.length;
  season.set({ season: 'spring', progress: 0 });
  scheduler.advance(1);
  expect(propagator.propagationRange.peek()).toBe(3);
  expect(propagator.timer.peek()).toEqual({ status: 'stopped' });
  expect(nearby).toHaveBeenCalledTimes(calls);
  scheduler.dispose();
  unbind();
});

it('binds a persistent inventory propagator to world season and releases the previous dependency on rebinding', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const entity = testItem({ itemId: 'log', count: 1 });
  configureBurnableItemEntity(entity);
  const controller = entity.getComponent<BurnableItemController>('burnable_item')!;
  const propagator = controller.propagator;
  const worldA = bindTestWorld(new GameTimeScheduler()),
    first = worldA.season;
  first.set({ season: 'spring', progress: 0 });
  // The worlds DefaultBurntFn spawns ash into.
  const firstArt = { spawnGroundItem: vi.fn() },
    nextArt = { spawnGroundItem: vi.fn() };
  expect(propagator.propagationRange.peek()).toBe(4);
  controller.bind(firstArt);
  expect(propagator.propagationRange.peek()).toBeCloseTo(4 * 0.67);
  const worldB = bindTestWorld(new GameTimeScheduler()),
    next = worldB.season;
  next.set({ season: 'winter', progress: 0 });
  controller.bind(nextArt);
  expect(propagator.propagationRange.peek()).toBe(4);
  const readFirst = vi.spyOn(first, 'get');
  first.set({ season: 'autumn', progress: 0 });
  expect(readFirst).not.toHaveBeenCalled();
  expect(propagator.propagationRange.peek()).toBe(4);
  next.set({ season: 'spring', progress: 0 });
  expect(propagator.propagationRange.peek()).toBeCloseTo(4 * 0.67);
  entity.destroy();
  next.set({ season: 'summer', progress: 0 });
  expect(propagator.propagationRange.peek()).toBeCloseTo(4 * 0.67);
});

it('spreads an item fire through TheSim to the propagators in range, leaving out INLIMBO ones as propagator.lua does', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const ents = testEnts();
  const log = (x: number) => {
    const entity = ents.track(testItem({ itemId: 'log', count: 1 }));
    configureBurnableItemEntity(entity);
    entity.setPosition(x, 0, 0);
    return { entity, propagator: entity.getComponent<BurnableItemController>('burnable_item')!.propagator };
  };
  const source = log(0),
    near = log(6),
    held = log(6),
    far = log(30);
  held.entity.RemoveFromScene();
  const heated = [near, held, far].map(({ propagator }) =>
    vi.spyOn(propagator, 'AddHeat').mockImplementation(() => {}),
  );
  source.propagator.heatoutput = 15;
  source.propagator.spreading.set(true);
  source.propagator.Update(0.5);
  // MakeSmallPropagator's range is 4 units (12 here): only the log on the ground within it is heated.
  expect(heated.map(spy => spy.mock.calls.length > 0)).toEqual([true, false, false]);
  for (const { entity } of [source, near, held, far]) {
    entity.destroy();
  }
  ents.dispose();
});

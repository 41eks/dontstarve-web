import { expect, it, vi } from 'vitest';
import { createSignal } from '../../signals/src';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Sleeper } from '../../componets/src/sleeper';

it('reacts to day/night in a microtask, preserves other checks and cancels a queued effect on disposal', async () => {
  const isNight = createSignal(false), scheduler = new GameTimeScheduler();
  const components = { combat: { target: undefined as object | undefined }, locomotor: { Stop: vi.fn() } };
  const PushEvent = vi.fn();
  let busy = true;
  const sleeper = new Sleeper({ isValid: () => true, PushEvent, components, world: { isNight },
    sg: { hasStateTag: tag => tag === 'busy' && busy } }, scheduler, () => .5);

  isNight.set(true);
  await Promise.resolve();
  expect(sleeper.IsAsleep()).toBe(false);
  busy = false;
  // A failed night-entry test still leaves periodic checks for busy/combat changes.
  scheduler.advance(4);
  expect(sleeper.IsAsleep()).toBe(true);
  expect(PushEvent).toHaveBeenLastCalledWith('gotosleep');
  isNight.set(false);
  await Promise.resolve();
  expect(sleeper.IsAsleep()).toBe(false);
  expect(PushEvent).toHaveBeenLastCalledWith('onwakeup');
  expect(scheduler.now).toBe(4);
  isNight.set(true);
  await Promise.resolve();
  expect(sleeper.IsAsleep()).toBe(true);
  components.combat.target = {};
  scheduler.advance(4);
  expect(sleeper.IsAsleep()).toBe(false);

  sleeper.StopTesting();
  components.combat.target = undefined;
  isNight.set(false);
  isNight.set(true);
  await Promise.resolve();
  scheduler.advance(8);
  expect(sleeper.IsAsleep()).toBe(false);
  sleeper.StartTesting();
  isNight.set(false);
  isNight.set(true);
  await Promise.resolve();
  expect(sleeper.IsAsleep()).toBe(true);

  isNight.set(false);
  sleeper.dispose();
  const events = PushEvent.mock.calls.length;
  await Promise.resolve();
  scheduler.advance(8);
  expect(sleeper.IsAsleep()).toBe(true);
  expect(PushEvent).toHaveBeenCalledTimes(events);
  scheduler.dispose();
});

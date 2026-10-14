import { expect, it, vi } from 'vitest';
import { createSignal, getWatchWorldContent, type WorldPhase, type WorldContentEnvironment, type GetWatchWorldContent } from '../../signals/src';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Sleeper } from '../../componets/src/sleeper';

it('reacts to day/night after effects settle, preserves other checks and cancels a queued effect on disposal', async () => {
  const cycle = createSignal<WorldPhase>('day'), scheduler = new GameTimeScheduler();
  const sources: WorldContentEnvironment = { snowLevel: createSignal(0), wind: createSignal({ angle: 0, velocity: 1 }), perishTick: createSignal({ time: 0, total: 0 }), scheduler, temperature: createSignal(30), cycle, season: createSignal({ season: 'spring', progress: .5 }) };
  const components = { combat: { target: undefined as object | undefined }, locomotor: { Stop: vi.fn() } };
  const PushEvent = vi.fn();
  let busy = true;
  const sleeper = new Sleeper({ isValid: () => true, PushEvent, components,
    sg: { hasStateTag: tag => tag === 'busy' && busy } }, (key, register) => getWatchWorldContent(key, register, sources), () => .5);

  cycle.set('night');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(sleeper.IsAsleep()).toBe(false);
  busy = false;
  // A failed night-entry test still leaves periodic checks for busy/combat changes.
  scheduler.advance(4);
  expect(sleeper.IsAsleep()).toBe(true);
  expect(PushEvent).toHaveBeenLastCalledWith('gotosleep');
  cycle.set('day');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(sleeper.IsAsleep()).toBe(false);
  expect(PushEvent).toHaveBeenLastCalledWith('onwakeup');
  expect(scheduler.now).toBe(4);
  cycle.set('night');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(sleeper.IsAsleep()).toBe(true);
  cycle.set('dusk');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(sleeper.IsAsleep()).toBe(false);
  cycle.set('night');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(sleeper.IsAsleep()).toBe(true);
  components.combat.target = {};
  scheduler.advance(4);
  expect(sleeper.IsAsleep()).toBe(false);

  sleeper.StopTesting();
  components.combat.target = undefined;
  cycle.set('day');
  cycle.set('night');
  await new Promise(resolve => setTimeout(resolve, 0));
  scheduler.advance(8);
  expect(sleeper.IsAsleep()).toBe(false);
  sleeper.StartTesting();
  cycle.set('day');
  cycle.set('night');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(sleeper.IsAsleep()).toBe(true);

  cycle.set('day');
  sleeper.dispose();
  const events = PushEvent.mock.calls.length;
  await new Promise(resolve => setTimeout(resolve, 0));
  scheduler.advance(8);
  expect(sleeper.IsAsleep()).toBe(true);
  expect(PushEvent).toHaveBeenCalledTimes(events);
  scheduler.dispose();
});

it('nocturnal sleepers own independent cycle watches and wake at dusk or night', async () => {
  const scheduler = new GameTimeScheduler(), cycle = createSignal<WorldPhase>('day');
  const sources: WorldContentEnvironment = { snowLevel: createSignal(0), wind: createSignal({ angle: 0, velocity: 1 }), perishTick: createSignal({ time: 0, total: 0 }), scheduler, temperature: createSignal(30), cycle, season: createSignal({ season: 'spring', progress: .5 }) };
  const requests = vi.fn();
  const watch: GetWatchWorldContent = (key, register) => {
    requests(key); return getWatchWorldContent(key, register, sources);
  };
  const events = [vi.fn(), vi.fn()];
  const sleepers = events.map(PushEvent => new Sleeper({ isValid: () => true, PushEvent, components: {} }, watch, () => .5));
  sleepers.forEach(sleeper => sleeper.SetNocturnal(true));
  expect(requests).toHaveBeenCalledTimes(2);
  try {
    scheduler.advance(0);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(scheduler.now).toBe(0);
    expect(sleepers.map(sleeper => sleeper.IsAsleep())).toEqual([false, false]);
    scheduler.advance(4);
    expect(sleepers.map(sleeper => sleeper.IsAsleep())).toEqual([true, true]);
    cycle.set('dusk');
    sleepers[0].dispose();
    const disposedEvents = events[0].mock.calls.length;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(sleepers.map(sleeper => sleeper.IsAsleep())).toEqual([true, false]);
    cycle.set('day');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(sleepers[1].IsAsleep()).toBe(true);
    cycle.set('night');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(sleepers[1].IsAsleep()).toBe(false);
    scheduler.advance(8);
    expect(events[0]).toHaveBeenCalledTimes(disposedEvents);
  } finally { sleepers.forEach(sleeper => sleeper.dispose()); scheduler.dispose(); }
});

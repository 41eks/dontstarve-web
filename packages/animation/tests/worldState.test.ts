import { describe, expect, it, vi } from 'vitest';
import { createWorldState, createWorldClockUpdater } from '../../../src/worldState';
import { getDstCycle } from '../../../src/tuning';
import { clockstate, seasonstate, moonphasestate, WorldContentKey, createSignal, GetTileStateAtPoint } from '../../signals/src';
import { GetTileKeyAtPoint } from '../../componets/src/tileManager';
import { Vector3 } from 'three';

function updateClock(state: ReturnType<typeof createWorldState>, elapsedSeconds: number, dt: number) {
  const cycle = getDstCycle(elapsedSeconds);
  state.clock.set({ phase: cycle.phase, timeinphase: cycle.phaseProgress });
  state.worldtemperature.OnUpdate(dt);
}

describe('session world temperature', () => {
  it('binds cached tile queries to player snapshots and releases their pending updates with the world', async () => {
    const state = createWorldState({ elapsedSeconds: 0, systems: {} });
    const position = createSignal(GetTileKeyAtPoint(new Vector3()));
    const active = state.tickingarea(position, 0)!;
    const reads = vi.spyOn(state.playerpositions, 'get');
    try {
      expect(GetTileStateAtPoint(position, 0)).toBe(active);
      expect(active()).toBe(false);
      state.playerpositions.set([new Vector3()]);
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(active()).toBe(true);
      state.playerpositions.set([new Vector3(12, 0, 0)]);
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(active()).toBe(false);
      expect(GetTileStateAtPoint(position, 0)).toBe(active);
      state.playerpositions.set([new Vector3()]);
      state.dispose();
      reads.mockClear();
      state.playerpositions.set([new Vector3(24, 0, 0)]);
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(reads).not.toHaveBeenCalled();
      expect(active()).toBe(false);
      expect(() => GetTileStateAtPoint(position)).toThrow('not bound');
    } finally { reads.mockRestore(); state.dispose(); }
  });

  it('publishes independent player position snapshots every 60 active frames, including across clock flushes', () => {
    const state = createWorldState({ elapsedSeconds: 0, systems: {} });
    const players = [new Vector3(3, 0, 4), new Vector3(8, 0, 9)];
    const positions = vi.fn(() => players);
    const updater = createWorldClockUpdater(state, 0, positions);
    try {
      const initial = state.playerpositions.peek();
      expect(initial).toEqual(players);
      expect(initial[0]).not.toBe(players[0]);
      players[0].set(12, 0, 15);
      for (let frame = 0; frame < 59; frame++) {
        updater.update(frame % 2 === 0 ? .01 : .04);
        updater.update(0);
        if (frame === 29) updater.flush();
      }
      expect(state.playerpositions.peek()).toBe(initial);
      expect(initial[0]).toEqual(new Vector3(3, 0, 4));
      expect(positions).toHaveBeenCalledOnce();
      updater.update(.02);
      const published = state.playerpositions.peek();
      expect(published).toEqual(players);
      expect(published).not.toBe(initial);
      expect(positions).toHaveBeenCalledTimes(2);
      players.pop();
      players[0].set(20, 0, 30);
      for (let frame = 0; frame < 59; frame++) updater.update(.02);
      expect(state.playerpositions.peek()).toBe(published);
      expect(published).toHaveLength(2);
      expect(published[0]).toEqual(new Vector3(12, 0, 15));
      updater.update(.02);
      expect(state.playerpositions.peek()).toEqual([new Vector3(20, 0, 30)]);
    } finally { state.dispose(); }
  });

  it('injects component wind and perish signals at init, preserves live queries and stops world tasks on disposal', () => {
    const state = createWorldState({ elapsedSeconds: 0, systems: {} });
    const cleanups: (() => void)[] = [];
    const wind = state.getWatchWorldContent(WorldContentKey.Wind, stop => cleanups.push(stop));
    const perish = state.getWatchWorldContent(WorldContentKey.PerishClock, stop => cleanups.push(stop));
    const moon = state.getWatchWorldContent(WorldContentKey.Moon, stop => cleanups.push(stop));
    const windChanged = vi.fn(), perishChanged = vi.fn();
    wind.subscribe(windChanged); perish.subscribe(perishChanged);
    const updater = createWorldClockUpdater(state, 0);
    try {
      expect(state.wind).toBe(state.worldwind.windchange);
      expect(state.perishTick).toBe(state.perishClock.snapshot);
      expect(wind.peek()).toBe(state.wind.peek());
      expect(perish.peek()).toBe(state.perishTick.peek());
      expect(wind.scheduler).toBe(state.scheduler);
      expect(perish.scheduler).toBe(wind.scheduler);
      expect(perish.perishClock).toBe(state.perishClock);
      expect(moon.peek()).toEqual(state.moon.peek());
      state.SetMoonPhase('half', false);
      expect(moon.peek()).toEqual({ phase: 'half', waxing: false });

      updater.update(1);
      state.scheduler.advanceTo(updater.elapsedSeconds);
      expect(windChanged).toHaveBeenCalledExactlyOnceWith(state.wind.peek(), expect.any(Object));
      expect(perishChanged).not.toHaveBeenCalled();
      expect(perish.peek().time).toBe(0);
      expect(perish.perishClock?.GetTick().time).toBe(1);
      updater.flush();
      expect(perish.peek()).toBe(state.perishTick.peek());
      expect(perish.peek().time).toBe(1);
      expect(perishChanged).toHaveBeenCalledOnce();

      cleanups.splice(0).forEach(stop => stop());
      updater.update(31); state.scheduler.advanceTo(updater.elapsedSeconds); updater.flush();
      expect(windChanged).toHaveBeenCalledOnce();
      expect(perishChanged).toHaveBeenCalledOnce();
      expect(state.perishClock.GetTick().time).toBe(32);
      state.dispose();
      expect(state.worldwind.timerSnapshot.peek().status).toBe('stopped');
      state.scheduler.advance(100);
      expect(windChanged).toHaveBeenCalledOnce();
    } finally { cleanups.splice(0).forEach(stop => stop()); state.dispose(); }
  });

  it('settles clock, moon phase and temperature every 60 active frames using actual dt and flushes partial batches', () => {
    const initialElapsedSeconds = 10 * 480 - 0.5;
    const state = createWorldState({ elapsedSeconds: initialElapsedSeconds, systems: {} });
    const cleanups: (() => void)[] = [];
    const localCycle = state.getWatchWorldContent(WorldContentKey.Cycle, stop => cleanups.push(stop));
    const localTemperature = state.getWatchWorldContent(WorldContentKey.Temperature, stop => cleanups.push(stop));
    expect(localCycle.scheduler).toBe(state.scheduler);
    expect(localTemperature.scheduler).toBe(localCycle.scheduler);
    expect(localTemperature.peek()).toBe(state.temperature.peek());
    expect(localCycle.scheduler.now).toBe(initialElapsedSeconds);
    const observed = vi.fn();
    const cycleChanges = vi.fn(), stopCycle = state.cycle.subscribe(cycleChanges);
    expect(state.cycle.peek()).toBe('night');
    expect('set' in state.cycle).toBe(false);
    const nightChanges = vi.fn(), stopNight = state.isNight.subscribe(nightChanges);
    expect(state.isNight.peek()).toBe(true);
    expect('set' in state.isNight).toBe(false);
    const updater = createWorldClockUpdater(state, initialElapsedSeconds);
    const perishSnapshot = state.perishClock.snapshot.peek();
    const stop = state.temperature.subscribe(observed);
    const clock = state.clock.peek(), temperature = state.temperature.peek();
    expect(state.moonPhase.peek()).toBe('threequarter');
    let elapsed = 0;
    for (let frame = 0; frame < 59; frame++) {
      const dt = frame % 2 === 0 ? 0.02 : 0.04;
      elapsed += dt;
      updater.update(dt);
    }
    updater.update(0);
    expect(state.clock.peek()).toBe(clock);
    expect(state.temperature.peek()).toBe(temperature);
    expect(localTemperature.peek()).toBe(temperature);
    expect(state.perishClock.snapshot.peek()).toBe(perishSnapshot);
    expect(state.perishClock.GetTick().time).toBeCloseTo(initialElapsedSeconds + elapsed, 10);
    expect(state.worldtemperature.OnSave().noisetime).toBe(initialElapsedSeconds);
    expect(state.moonPhase.peek()).toBe('threequarter');
    expect(observed).not.toHaveBeenCalled();
    expect(nightChanges).not.toHaveBeenCalled();
    expect(cycleChanges).not.toHaveBeenCalled();
    elapsed += 0.1;
    updater.update(0.1);
    expect(observed).toHaveBeenCalledOnce();
    expect(localTemperature.peek()).toBe(state.temperature.peek());
    expect(state.clock.peek().phase).toBe('day');
    expect(cycleChanges).toHaveBeenCalledExactlyOnceWith('day', 'night');
    expect(state.isNight.peek()).toBe(false);
    expect(nightChanges).toHaveBeenCalledExactlyOnceWith(false, true);
    expect(state.moonPhase.peek()).toBe('full');
    expect(state.worldtemperature.OnSave().noisetime).toBeCloseTo(initialElapsedSeconds + elapsed, 10);
    expect(state.perishClock.snapshot.peek().time).toBeCloseTo(initialElapsedSeconds + elapsed, 10);
    const settled = state.temperature.peek();
    updater.update(0.25);
    expect(state.temperature.peek()).toBe(settled);
    updater.flush();
    expect(state.worldtemperature.OnSave().noisetime).toBeCloseTo(updater.elapsedSeconds, 10);
    const flushedClock = state.clock.peek();
    updater.flush();
    expect(state.clock.peek()).toBe(flushedClock);
    expect(nightChanges).toHaveBeenCalledOnce();
    expect(cycleChanges).toHaveBeenCalledOnce();
    const before = updater.elapsedSeconds;
    expect(() => updater.update(-1)).toThrow(RangeError);
    expect(updater.elapsedSeconds).toBe(before);
    stop(); cleanups.forEach(stop => stop()); state.dispose();
    expect(() => localCycle.scheduler.schedule(1, () => {})).toThrow('disposed');
    state.clock.set({ phase: 'night', timeinphase: 0 });
    expect(state.isNight.peek()).toBe(false);
    expect(nightChanges).toHaveBeenCalledOnce();
    expect(state.cycle.peek()).toBe('day');
    expect(cycleChanges).toHaveBeenCalledOnce();
    stopCycle();
    stopNight();
  });

  it('initializes legacy worlds at their current clock and publishes updates to a read-only signal', () => {
    const state = createWorldState({ elapsedSeconds: 419.5, systems: {
      season: { name: 'winter', daysRemaining: 7 },
    } });
    expect(state.clock).toBe(clockstate);
    expect(state.season).toBe(seasonstate);
    expect(state.moonPhase).toBe(moonphasestate);
    expect(state.worldtemperature.OnSave()).toMatchObject({ season: 'winter', seasontemperature: -25, noisetime: 419.5 });
    expect(state.temperature.peek()).toBe(state.worldtemperature.GetTemperature());
    expect('set' in state.temperature).toBe(false);
    const observed = vi.fn(), stop = state.temperature.subscribe(observed);
    updateClock(state, 421, 1.5);
    expect(state.worldtemperature.OnSave().noisetime).toBe(421);
    expect(observed).toHaveBeenCalled();
    expect(state.temperature.peek()).toBe(state.worldtemperature.GetTemperature());
    const transitions = observed.mock.calls.length;
    stop();
    updateClock(state, 422, 1);
    expect(observed).toHaveBeenCalledTimes(transitions);
    state.season.set({ season: 'summer', progress: 0.5 });
    expect(state.worldtemperature.OnSave().seasontemperature).toBe(95);
    const temperature = state.temperature.peek();
    state.dispose();
    state.season.set({ season: 'winter', progress: 0.5 });
    updateClock(state, 423, 1);
    expect(state.temperature.peek()).toBe(temperature);
    const next = createWorldState({ elapsedSeconds: 0, systems: {} });
    expect(next.clock).toBe(state.clock);
    expect(next.season).toBe(state.season);
    expect(next.worldtemperature.OnSave().season).toBe('spring');
    next.dispose();
  });
});

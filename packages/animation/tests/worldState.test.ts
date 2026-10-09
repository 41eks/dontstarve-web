import { describe, expect, it, vi } from 'vitest';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { createWorldState, createWorldClockUpdater } from '../../../src/worldState';
import { getDstCycle } from '../../../src/tuning';
import { deserializeSave, type SaveCatalog } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { executeDebugCommand } from '../../../src/debugCommands';
import { InventoryStore } from '../../inventory/src';
import { clockstate, seasonstate, moonphasestate } from '../../signals/src';

const catalog: SaveCatalog = { prefabs: [], items: {}, skins: {}, recipes: {}, recipeSkins: {}, buildings: {}, walls: [] };

function template() {
  const data = structuredClone(initialWorld);
  data.world.entities = {};
  data.world.systems = {};
  data.players.local.inventory.containers = {
    'player:inventory': { slotCount: 15, slots: [] },
    'player:equipment': { slotCount: 3, slots: [] },
  };
  return deserializeSave(JSON.stringify(data), catalog);
}

function updateClock(state: ReturnType<typeof createWorldState>, elapsedSeconds: number, dt: number) {
  const cycle = getDstCycle(elapsedSeconds);
  state.clock.set({ phase: cycle.phase, timeinphase: cycle.phaseProgress });
  state.worldtemperature.OnUpdate(dt);
}

describe('session world temperature', () => {
  it('settles clock, moon phase and temperature every 60 active frames using actual dt and flushes partial batches', () => {
    const initialElapsedSeconds = 10 * 480 - 0.5;
    const state = createWorldState({ elapsedSeconds: initialElapsedSeconds, systems: {} });
    const tick = vi.fn(), observed = vi.fn();
    const updater = createWorldClockUpdater(state, initialElapsedSeconds, tick);
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
    expect(state.worldtemperature.OnSave().noisetime).toBe(initialElapsedSeconds);
    expect(state.moonPhase.peek()).toBe('threequarter');
    expect(observed).not.toHaveBeenCalled();
    expect(tick.mock.calls).toEqual([[initialElapsedSeconds, 0]]);
    elapsed += 0.1;
    updater.update(0.1);
    expect(observed).toHaveBeenCalledOnce();
    expect(state.clock.peek().phase).toBe('day');
    expect(state.moonPhase.peek()).toBe('full');
    expect(state.worldtemperature.OnSave().noisetime).toBeCloseTo(initialElapsedSeconds + elapsed, 10);
    expect(tick).toHaveBeenLastCalledWith(expect.closeTo(initialElapsedSeconds + elapsed, 10), expect.closeTo(elapsed, 10));
    const settled = state.temperature.peek();
    updater.update(0.25);
    expect(state.temperature.peek()).toBe(settled);
    updater.flush();
    expect(state.worldtemperature.OnSave().noisetime).toBeCloseTo(updater.elapsedSeconds, 10);
    expect(tick).toHaveBeenLastCalledWith(expect.closeTo(initialElapsedSeconds + elapsed + 0.25, 10), 0.25);
    updater.flush();
    expect(tick).toHaveBeenCalledTimes(3);
    const before = updater.elapsedSeconds;
    expect(() => updater.update(-1)).toThrow(RangeError);
    expect(updater.elapsedSeconds).toBe(before);
    stop(); state.worldtemperature.dispose();
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
    state.worldtemperature.dispose();
    state.season.set({ season: 'winter', progress: 0.5 });
    updateClock(state, 423, 1);
    expect(state.temperature.peek()).toBe(temperature);
    const next = createWorldState({ elapsedSeconds: 0, systems: {} });
    expect(next.clock).toBe(state.clock);
    expect(next.season).toBe(state.season);
    expect(next.worldtemperature.OnSave().season).toBe('spring');
    next.worldtemperature.dispose();
  });

  it('exports the current world temperature through c_save and continues unchanged after reload', async () => {
    const save = template();
    save.world.elapsedSeconds = 10 * 480 + 419.5;
    save.world.systems.worldtemperature = {
      season: 'winter', seasontemperature: -17, phasetemperature: 0, noisetime: 12.25,
    };
    const state = createWorldState(save.world);
    expect(state.moonPhase.peek()).toBe('full');
    const updater = createWorldClockUpdater(state, save.world.elapsedSeconds);
    updater.update(1.5);
    const inventory = new InventoryStore([], {});
    let json = '';
    const result = await executeDebugCommand('c_save()', inventory, () => false, () => {
      updater.flush();
      json = serializeSave(save, {
        entities: {}, inventory: inventory.exportState(), playerTransform: save.players.local.transform,
        elapsedSeconds: updater.elapsedSeconds, worldtemperature: state.worldtemperature.OnSave(),
      }, catalog);
    });
    expect(result.ok).toBe(true);
    const saved = deserializeSave(json, catalog);
    expect(saved.world.systems.worldtemperature).toEqual(state.worldtemperature.OnSave());
    expect(save.world.systems.worldtemperature.noisetime).toBe(12.25);
    const restored = createWorldState(saved.world);
    expect(restored.moonPhase).toBe(moonphasestate);
    expect(restored.moonPhase.peek()).toBe('full');
    expect(restored.temperature.peek()).toBe(state.temperature.peek());
    updateClock(state, updater.elapsedSeconds + 29, 29);
    updateClock(restored, updater.elapsedSeconds + 29, 29);
    expect(restored.worldtemperature.OnSave()).toEqual(state.worldtemperature.OnSave());
    expect(restored.temperature.peek()).toBe(state.temperature.peek());
    inventory.dispose();
    state.worldtemperature.dispose(); restored.worldtemperature.dispose();
  });

  it('accepts old saves and validates negative temperatures and optional daylight without mutating input', () => {
    const save = template(), before = structuredClone(save);
    expect(save.world.systems.worldtemperature).toBeUndefined();
    const state = createWorldState(save.world);
    expect(save).toEqual(before);
    save.world.systems.worldtemperature = {
      daylight: false, season: 'winter', seasontemperature: -25, phasetemperature: -6, noisetime: 10,
    };
    expect(deserializeSave(JSON.stringify(save), catalog).world.systems.worldtemperature)
      .toEqual(save.world.systems.worldtemperature);
    save.world.systems.worldtemperature.noisetime = -1;
    expect(() => deserializeSave(JSON.stringify(save), catalog)).toThrow('world.systems.worldtemperature.noisetime');
    const bad = JSON.parse(JSON.stringify(save));
    bad.world.systems.worldtemperature.noisetime = 10;
    bad.world.systems.worldtemperature.daylight = 'false';
    expect(() => deserializeSave(JSON.stringify(bad), catalog)).toThrow('world.systems.worldtemperature.daylight');
    expect(state.temperature.peek()).toBe(state.worldtemperature.GetTemperature());
  });
});

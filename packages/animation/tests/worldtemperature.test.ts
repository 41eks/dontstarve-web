import { describe, expect, it, vi } from 'vitest';
import { WorldTemperature, type WorldTemperatureSeason } from '../../componets/src/worldtemperature';

describe('worldtemperature.lua temperature component', () => {
  it('combines seasonal curves, phase progress and noise, publishing reactively', () => {
    const perlin = vi.fn(() => 0.5), tick = vi.fn();
    const world = new WorldTemperature({ perlin, onTemperatureTick: tick });
    expect(tick.mock.calls).toEqual([[30]]);
    const seasons: [WorldTemperatureSeason, number[]][] = [
      ['autumn', [55, 30, 5]], ['winter', [5, -25, 5]],
      ['spring', [5, 30, 55]], ['summer', [55, 95, 55]],
    ];
    for (const [season, expected] of seasons) {
      [0, 0.5, 1].forEach((progress, index) => {
        world.OnSeasonTick({ season, progress });
        world.OnUpdate(0);
        expect(tick).toHaveBeenLastCalledWith(expect.closeTo(expected[index], 10));
      });
    }
    world.OnSeasonTick({ season: 'spring', progress: 0.5 });
    const updates = tick.mock.calls.length;
    world.OnClockTick({ phase: 'day', timeinphase: 0.5 });
    expect(tick).toHaveBeenCalledTimes(updates + 1);
    world.OnUpdate(12);
    expect(tick).toHaveBeenLastCalledWith(35);
    expect(perlin).toHaveBeenLastCalledWith(0, 0, expect.closeTo(0.3, 10));
    world.OnClockTick({ phase: 'night', timeinphase: 0.5 });
    world.OnUpdate(0);
    expect(tick).toHaveBeenLastCalledWith(24);
    world.OnClockTick({ phase: 'dusk', timeinphase: 0.75 });
    world.OnUpdate(0);
    expect(tick).toHaveBeenLastCalledWith(30);
    world.OnClockTick({ phase: 'night', timeinphase: 1 });
    world.OnUpdate(0);
    expect(world.GetTemperature()).toBeCloseTo(30);
  });

  it('keeps noise extremes unclamped and applies modifiers around their locus', () => {
    const perlin = vi.fn(() => 1), tick = vi.fn();
    const world = new WorldTemperature({ perlin, onTemperatureTick: tick });
    world.OnSeasonTick({ season: 'summer', progress: 0.5 });
    world.OnClockTick({ phase: 'day', timeinphase: 0.5 });
    world.OnUpdate(0);
    expect(world.GetTemperature()).toBe(108);
    world.SetTemperatureMod(0.6, 0);
    expect(tick).toHaveBeenLastCalledWith(64.8);
    world.SetTemperatureMod(0.5, 20);
    expect(tick).toHaveBeenLastCalledWith(64);
    perlin.mockReturnValue(0);
    world.SetTemperatureMod(1, 0);
    world.OnSeasonTick({ season: 'winter', progress: 0.5 });
    world.OnClockTick({ phase: 'night', timeinphase: 0.5 });
    world.OnUpdate(0);
    expect(world.GetTemperature()).toBe(-39);
  });

  it('preserves deterministic noise across JSON save/load and different update batches', () => {
    const world = new WorldTemperature();
    world.OnSeasonTick({ season: 'spring', progress: 0.4 });
    world.OnClockTick({ phase: 'night', timeinphase: 0.5 });
    world.SetTemperatureMod(0.6, 0);
    world.OnUpdate(13.25);
    expect(world.GetTemperature()).not.toBe(19 * 0.6);
    const saved = JSON.parse(JSON.stringify(world.OnSave()));
    expect(saved).toEqual({ season: 'spring', seasontemperature: 25, phasetemperature: -6, noisetime: 13.25 });
    const tick = vi.fn(), restored = new WorldTemperature({ onTemperatureTick: tick });
    restored.SetTemperatureMod(0.6, 0);
    restored.OnLoad(saved);
    expect(restored.OnSave()).toEqual(world.OnSave());
    expect(tick).toHaveBeenLastCalledWith(world.GetTemperature());
    world.OnUpdate(0.25);
    world.OnUpdate(0.75);
    restored.LongUpdate(1);
    expect(restored.GetTemperature()).toBe(world.GetTemperature());
    expect(restored.OnSave()).toEqual(world.OnSave());
    expect(restored.GetDebugString()).toContain('mult: 0.60 locus 0.0');
    restored.OnLoad({ daylight: true, season: 'winter' });
    expect(restored.OnSave()).toEqual({ daylight: true, season: 'winter', seasontemperature: -25, phasetemperature: 0, noisetime: 0 });
    expect(restored.GetTemperature()).toBe(-15);
  });

  it('rejects invalid updates and loads without changing state or publishing', () => {
    const tick = vi.fn(), world = new WorldTemperature({ onTemperatureTick: tick });
    world.OnUpdate(17);
    const saved = world.OnSave(), temperature = world.GetTemperature();
    tick.mockClear();
    expect(() => world.OnUpdate(-1)).toThrow(RangeError);
    expect(() => world.OnSeasonTick({ season: 'winter', progress: NaN })).toThrow(RangeError);
    expect(() => world.OnClockTick({ phase: 'night', timeinphase: 1.1 })).toThrow(RangeError);
    expect(() => world.SetTemperatureMod(0.6, Infinity)).toThrow(RangeError);
    expect(() => world.OnLoad({ season: 'winter', seasontemperature: -25, phasetemperature: NaN })).toThrow(RangeError);
    expect(world.OnSave()).toEqual(saved);
    expect(world.GetTemperature()).toBe(temperature);
    expect(tick).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from 'vitest';
import { createSignal, seasonstate } from '../../signals/src';
import { Weather } from '../../componets/src/weather';
import { createWorldState, createWorldClockUpdater } from '../../../src/worldState';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { inventoryStateFromSave } from '../../../src/save/inventoryState';
import { SAVE_CATALOG } from '../../../src/save/catalog';

describe('snow weather', () => {
  it('starts snow in winter, accumulates cover, keeps it when stopped and melts it when warm', async () => {
    seasonstate.set({ season: 'winter', progress: 0.5 });
    const temperature = createSignal(-25);
    const weather = new Weather({ totalDayTime: 480, temperature: () => temperature.get(), random: () => 0.5 });
    weather.ForcePrecipitation();
    weather.OnUpdate(0);
    expect(weather.preciptype.peek()).toBe('snow');
    expect(weather.rainRate.peek()).toBe(0);
    const rate = weather.snowRate.peek();
    weather.OnUpdate(10);
    expect(weather.snowLevel.peek()).toBeCloseTo(rate * 10 / 300);
    expect(weather.snowCover.peek()).toBeCloseTo(weather.snowLevel.peek() * 3);
    expect('set' in weather.snowLevel).toBe(false);
    expect('set' in weather.snowRate).toBe(false);
    expect('set' in weather.snowCover).toBe(false);

    weather.ForcePrecipitation(false);
    weather.OnUpdate(1);
    const cover = weather.snowLevel.peek();
    expect(weather.preciptype.peek()).toBe('none');
    expect(weather.snowRate.peek()).toBe(0);
    weather.OnUpdate(100);
    expect(weather.snowLevel.peek()).toBe(cover);
    temperature.set(20);
    await Promise.resolve();
    weather.OnUpdate(0.01);
    expect(weather.snowLevel.peek()).toBeCloseTo(cover - (1 / 120 + 1 / 20) * 0.01);
    weather.OnUpdate(100);
    expect(weather.snowCover.peek()).toBe(0);
    weather.dispose();
  });

  it('responds to temperature and season signals with source threshold hysteresis and releases subscriptions', async () => {
    seasonstate.set({ season: 'winter', progress: 0.5 });
    const temperature = createSignal(-25);
    const weather = new Weather({ totalDayTime: 480, temperature: () => temperature.get(), random: () => 0.5 });
    weather.ForcePrecipitation(); weather.OnUpdate(0);
    temperature.set(10);
    await Promise.resolve();
    expect(weather.preciptype.peek()).toBe('snow');
    temperature.set(10.01);
    await Promise.resolve();
    expect(weather.preciptype.peek()).toBe('rain');
    expect(weather.snowRate.peek()).toBe(0);
    temperature.set(5);
    await Promise.resolve();
    expect(weather.preciptype.peek()).toBe('rain');
    temperature.set(4.99);
    await Promise.resolve();
    expect(weather.preciptype.peek()).toBe('snow');
    seasonstate.set({ season: 'spring', progress: 0 });
    await Promise.resolve();
    expect(weather.preciptype.peek()).toBe('rain');
    const saved = weather.OnSave();
    weather.dispose();
    temperature.set(-25);
    seasonstate.set({ season: 'winter', progress: 0.5 });
    await Promise.resolve();
    expect(weather.OnSave()).toEqual(saved);
  });

  it('settles the default winter snowfall in 60-frame batches and preserves season, weather and cover through export/reload', () => {
    const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
    const world = createWorldState(template.world);
    const updater = createWorldClockUpdater(world, template.world.elapsedSeconds);
    expect(world.season.peek().season).toBe('winter');
    expect(world.temperature.peek()).toBeLessThan(5);
    expect(world.weather.preciptype.peek()).toBe('snow');
    const initial = world.weather.OnSave();
    for (let frame = 0; frame < 59; frame++) updater.update(frame % 2 === 0 ? 0.02 : 0.04);
    expect(world.weather.OnSave()).toEqual(initial);
    updater.update(0.1);
    expect(world.weather.snowLevel.peek()).toBeGreaterThan(initial.snowlevel!);
    const settled = world.weather.OnSave();
    updater.update(0.25);
    expect(world.weather.OnSave()).toEqual(settled);
    updater.flush();
    const saved = world.weather.OnSave();
    expect(saved.snowlevel).toBeGreaterThan(settled.snowlevel!);
    const json = serializeSave(template, {
      entities: template.world.entities, playerTransform: template.players.local.transform,
      inventory: inventoryStateFromSave(template), elapsedSeconds: updater.elapsedSeconds,
      worldtemperature: world.worldtemperature.OnSave(), weather: saved,
    }, SAVE_CATALOG);
    world.dispose();
    const document = deserializeSave(json, SAVE_CATALOG);
    const restored = createWorldState(document.world);
    expect(restored.season.peek().season).toBe('winter');
    expect(restored.weather.OnSave()).toEqual(saved);
    expect(restored.weather.snowRate.peek()).toBeGreaterThan(0);
    expect(restored.weather.snowCover.peek()).toBeCloseTo(saved.snowlevel! * 3);
    // Older weather saves load without cover. Invalid new fields reject atomically.
    const legacy = { ...saved }; delete legacy.snowlevel;
    restored.weather.OnLoad(legacy);
    expect(restored.weather.snowLevel.peek()).toBe(0);
    const before = restored.weather.OnSave();
    expect(() => restored.weather.OnLoad({ ...saved, snowlevel: 1.01 })).toThrow('snowlevel');
    expect(restored.weather.OnSave()).toEqual(before);
    const invalid = structuredClone(document);
    invalid.world.systems.weather!.snowlevel = -1;
    expect(() => deserializeSave(JSON.stringify(invalid), SAVE_CATALOG)).toThrow('snowlevel');
    restored.dispose();
  });
});

import { describe, expect, it } from 'vitest';
import { createSignal, seasonstate } from '../../signals/src';
import { Weather } from '../../componets/src/weather';

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

});

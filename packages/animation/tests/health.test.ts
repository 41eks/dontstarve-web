import { describe, expect, it } from 'vitest';
import { Health } from '../../componets/src/health';

describe('basic health component', () => {
  it('heals and damages without exceeding the health bounds, including zero health', () => {
    const health = new Health();
    expect(health.currenthealth).toBe(100);
    expect(health.IsHurt()).toBe(false);
    expect(health.DoDelta(-25.5)).toBe(-25.5);
    expect(health.currenthealth).toBe(74.5);
    expect(health.GetPercent()).toBe(0.745);
    expect(health.IsHurt()).toBe(true);
    health.DoDelta(200);
    expect(health.currenthealth).toBe(100);
    health.DoDelta(-200);
    expect(health.currenthealth).toBe(0);
    expect(health.IsDead()).toBe(true);
    health.DoDelta(10);
    expect(health.currenthealth).toBe(10);
    expect(health.IsDead()).toBe(false);
  });

  it('refills on setting the maximum and clamps absolute values and percentages', () => {
    const health = new Health(150);
    health.DoDelta(-70);
    health.SetMaxHealth(200);
    expect(health.currenthealth).toBe(200);
    health.SetVal(-10);
    expect(health.IsDead()).toBe(true);
    health.SetPercent(0.25);
    expect(health.currenthealth).toBe(50);
    health.SetPercent(2);
    expect(health.currenthealth).toBe(200);
    health.SetPercent(-1);
    expect(health.currenthealth).toBe(0);
    health.SetVal(300);
    expect(health.currenthealth).toBe(200);
  });

  it.each([0, 83.5, 150])('round-trips current health %s and its maximum through JSON', (current) => {
    const health = new Health(150);
    health.SetVal(current);
    const saved = health.OnSave();
    const restored = new Health();
    restored.OnLoad(JSON.parse(JSON.stringify(saved)));
    expect(restored.OnSave()).toEqual({ health: current, maxhealth: 150 });
    saved.health = 1;
    saved.maxhealth = 1;
    expect(health.OnSave()).toEqual({ health: current, maxhealth: 150 });
  });

  it('loads Lua health and setpiece percentages, preferring health when both are present', () => {
    const health = new Health(150);
    health.OnLoad({ health: 75 });
    expect(health.GetPercent()).toBe(0.5);
    health.OnLoad({ maxhealth: 200, percent: 0.25 });
    expect(health.currenthealth).toBe(50);
    health.OnLoad({ health: 30, percent: 0.8 });
    expect(health.currenthealth).toBe(30);
    health.OnLoad({ maxhealth: 10 });
    expect(health.currenthealth).toBe(10);
    health.OnLoad({ health: -20 });
    expect(health.currenthealth).toBe(0);
    health.OnLoad({ health: 300 });
    expect(health.currenthealth).toBe(10);
  });

  it.each([NaN, Infinity, -Infinity])('rejects invalid numbers %s without corrupting state', (invalid) => {
    const health = new Health(150);
    health.SetVal(50);
    const before = health.OnSave();
    expect(() => health.DoDelta(invalid)).toThrow(RangeError);
    expect(() => health.SetVal(invalid)).toThrow(RangeError);
    expect(() => health.SetPercent(invalid)).toThrow(RangeError);
    expect(() => health.SetMaxHealth(invalid)).toThrow(RangeError);
    expect(() => health.OnLoad({ maxhealth: 200, health: invalid })).toThrow(RangeError);
    expect(health.OnSave()).toEqual(before);
  });

  it('rejects nonpositive maximum health', () => {
    expect(() => new Health(0)).toThrow(RangeError);
    const health = new Health();
    expect(() => health.SetMaxHealth(-1)).toThrow(RangeError);
    expect(() => health.OnLoad({ maxhealth: 0, health: 0 })).toThrow(RangeError);
    expect(health.OnSave()).toEqual({ health: 100, maxhealth: 100 });
  });
});

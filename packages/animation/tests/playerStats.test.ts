import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../../../src/save/initialSave', () => ({
  initialSave: { players: { local: { stats: { health: 140, hunger: 90, sanity: 120 } } } },
}));
import { applyPlayerFoodEffects, getPlayerStats, playerStats, setPlayerSanityPercent } from '../../../src/playerStats';

beforeEach(() => {
  playerStats.health.set(140); playerStats.hunger.set(90); playerStats.sanity.set(120);
});

it('restores all stats into signals and exports detached numerical snapshots', () => {
  expect(playerStats.health.percent.peek()).toBe(140 / 150);
  expect(playerStats.hunger.percent.peek()).toBe(0.6);
  expect(playerStats.sanity.percent.peek()).toBe(0.6);
  const initial = getPlayerStats();
  setPlayerSanityPercent(0.175);
  expect(playerStats.sanity.peek()).toBe(35);
  const saved = getPlayerStats();
  expect(JSON.parse(JSON.stringify(saved))).toEqual({ health: 140, hunger: 90, sanity: 35 });
  expect(initial).toEqual({ health: 140, hunger: 90, sanity: 120 });
  expect(() => setPlayerSanityPercent(-1)).toThrow('理智比例');
  expect(getPlayerStats()).toEqual(saved);
  playerStats.sanity.set(100);
  playerStats.health.set(75);
  playerStats.hunger.set(30);
  expect(getPlayerStats()).toEqual({ health: 75, hunger: 30, sanity: 100 });
  expect(saved).toEqual({ health: 140, hunger: 90, sanity: 35 });
});

it('publishes food effects and bounded stat changes until subscriptions are released', () => {
  const health = vi.fn(), hungerPercent = vi.fn();
  const stopHealth = playerStats.health.subscribe(health);
  const stopHunger = playerStats.hunger.percent.subscribe(hungerPercent);
  try {
    applyPlayerFoodEffects({ health: 8, hunger: 25, sanity: 33 });
    expect(health).toHaveBeenCalledExactlyOnceWith(148, 140);
    expect(hungerPercent).toHaveBeenCalledExactlyOnceWith(115 / 150, 0.6);
    applyPlayerFoodEffects({ health: 100, hunger: 100, sanity: 0 });
    expect(getPlayerStats()).toEqual({ health: 150, hunger: 150, sanity: 153 });
    playerStats.health.set(200);
    expect(health).toHaveBeenCalledTimes(2);
    playerStats.hunger.set(-1);
    expect(playerStats.hunger.percent.peek()).toBe(0);
    expect(() => playerStats.health.set(NaN)).toThrow('Health must be finite');
    expect(() => playerStats.hunger.set(Infinity)).toThrow('Hunger must be finite');
    expect(getPlayerStats()).toEqual({ health: 150, hunger: 0, sanity: 153 });
    stopHealth(); stopHunger();
    playerStats.health.set(50); playerStats.hunger.set(50);
    expect(health).toHaveBeenCalledTimes(2);
    expect(hungerPercent).toHaveBeenCalledTimes(3);
  } finally { stopHealth(); stopHunger(); }
});

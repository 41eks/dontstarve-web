import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../../../src/save/initialSave', () => ({
  initialSave: { players: { local: { stats: { health: 140, hunger: 90, sanity: 120 } } } },
}));
vi.mock('../../../src/player', async () => {
  const { initialSave } = await import('../../../src/save/initialSave');
  const { playerStatsFixture } = await import('./playerStatsFixture');
  return { playerInstance: playerStatsFixture(initialSave.players.local.stats!) };
});
import { applyPlayerFoodEffects, getPlayerStats, playerStats, setPlayerSanityPercent } from '../../../src/playerStats';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { createPickupInventory } from './pickupFixture';
import { playerStatsFixture } from './playerStatsFixture';

beforeEach(() => {
  playerStats.health.SetVal(140); playerStats.hunger.SetCurrent(90); playerStats.sanity.SetCurrent(120);
});

it('keeps the sanity hysteresis state through c_setsanity, c_save and reload', async () => {
  const inventory = createPickupInventory();
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  let exported = '';
  try {
    const save = () => {
      exported = serializeSave(template, { entities: {}, elapsedSeconds: 0,
        playerTransform: { position: [3, 0, -6], rotationY: 0 }, inventory: inventory.exportState(), playerStats: getPlayerStats(),
      }, SAVE_CATALOG);
    };
    expect((await executeDebugCommand('c_setsanity(.15); c_setsanity(.16); c_save()', inventory,
      undefined, save, setPlayerSanityPercent)).ok).toBe(true);
    const document = deserializeSave(exported, SAVE_CATALOG);
    expect(document.players.local.stats).toMatchObject({ sanity: 32, sanitySane: false, hunger: 90 });
    const restored = playerStatsFixture(document.players.local.stats!);
    expect(restored.components.sanity!.IsInsane()).toBe(true);
    expect(restored.components.sanity!.current).toBe(32);
    expect(restored.components.hunger!.current).toBe(90);
    restored.components.sanity!.SetCurrent(35);
    expect(restored.components.sanity!.IsSane()).toBe(true);
    restored.remove();
  } finally { inventory.dispose(); }
});

it('restores all stats into signals and exports detached numerical snapshots', () => {
  expect(playerStats.health.percent.peek()).toBe(140 / 150);
  expect(playerStats.hunger.percent.peek()).toBe(0.6);
  expect(playerStats.sanity.percent.peek()).toBe(0.6);
  const initial = getPlayerStats();
  setPlayerSanityPercent(0.175);
  expect(playerStats.sanity.current).toBe(35);
  const saved = getPlayerStats();
  expect(JSON.parse(JSON.stringify(saved))).toEqual({ health: 140, hunger: 90, sanity: 35 });
  expect(initial).toEqual({ health: 140, hunger: 90, sanity: 120 });
  expect(() => setPlayerSanityPercent(-1)).toThrow('理智比例');
  expect(getPlayerStats()).toEqual(saved);
  playerStats.sanity.SetCurrent(100);
  playerStats.health.SetVal(75);
  playerStats.hunger.SetCurrent(30);
  expect(getPlayerStats()).toEqual({ health: 75, hunger: 30, sanity: 100 });
  expect(saved).toEqual({ health: 140, hunger: 90, sanity: 35 });
});

it('publishes food effects and bounded stat changes until subscriptions are released', () => {
  const health = vi.fn(), hungerPercent = vi.fn();
  const stopHealth = playerStats.health.current.subscribe(health);
  const stopHunger = playerStats.hunger.percent.subscribe(hungerPercent);
  try {
    applyPlayerFoodEffects({ health: 8, hunger: 25, sanity: 33 });
    expect(health).toHaveBeenCalledExactlyOnceWith(148, 140);
    expect(hungerPercent).toHaveBeenCalledExactlyOnceWith(115 / 150, 0.6);
    applyPlayerFoodEffects({ health: 100, hunger: 100, sanity: 0 });
    expect(getPlayerStats()).toEqual({ health: 150, hunger: 150, sanity: 153 });
    playerStats.health.SetVal(200);
    expect(health).toHaveBeenCalledTimes(2);
    playerStats.hunger.SetCurrent(-1);
    expect(playerStats.hunger.percent.peek()).toBe(0);
    expect(() => playerStats.health.SetVal(NaN)).toThrow('health must be finite');
    expect(() => playerStats.hunger.SetCurrent(Infinity)).toThrow('Hunger must be finite');
    expect(getPlayerStats()).toEqual({ health: 150, hunger: 0, sanity: 153 });
    stopHealth(); stopHunger();
    playerStats.health.SetVal(50); playerStats.hunger.SetCurrent(50);
    expect(health).toHaveBeenCalledTimes(2);
    expect(hungerPercent).toHaveBeenCalledTimes(3);
  } finally { stopHealth(); stopHunger(); }
});

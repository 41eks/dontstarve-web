import { expect, it, vi } from 'vitest';

vi.mock('../../../src/save/initialSave', () => ({
  initialSave: { players: { local: { stats: { health: 140, hunger: 90, sanity: 120 } } } },
}));
import { getPlayerStats, playerStats, setPlayerSanityPercent } from '../../../src/playerStats';

it('restores sanity into a signal and exports detached numerical stats without changing other stats', () => {
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
  expect(getPlayerStats().sanity).toBe(100);
  expect(saved.sanity).toBe(35);
});

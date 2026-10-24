import { expect, it } from 'vitest';
import { WaveManager, type WaveMap } from '../../componets/src/wavemanager';

const OCEAN = 9;
const LAND = 4;
// Land for x < 0, ocean for x >= 0, void beyond |x| >= 120.
const map: WaveMap = {
  tileSize: 12,
  tileAt: (x, z) => (Math.abs(x) >= 120 || Math.abs(z) >= 120 ? 0 : x < 0 ? LAND : OCEAN),
  isLandTile: tile => tile === LAND,
  isOceanTile: tile => tile === OCEAN,
};

function create(player: { x: number; z: number } | null, shore: [number, number, number][], shimmer: [string, number, number][]) {
  let seed = 1;
  return new WaveManager({
    map, scale: 3, tiles: new Map([[OCEAN, 'shore']]),
    spawner: { spawnShore: (x, z, bearing) => shore.push([x, z, bearing]), spawnShimmer: (kind, x, z) => shimmer.push([kind, x, z]) },
    cameraDistance: () => 30, playerPosition: () => player,
    random: () => (seed = (seed * 16807) % 2147483647) / 2147483647,
  });
}

it('classifies ocean points as blocked, open water, or shore wave bearing', () => {
  const manager = create(null, [], []);
  expect(manager.getWaveBearing(6, 6)).toBe(false); // land touches the tile's edge band
  expect(typeof manager.getWaveBearing(11, 6)).toBe('number');
  expect(manager.getWaveBearing(60, 6)).toBe(true);
});

it('spawns waves only on ocean tiles around the player, none without a player', () => {
  const shore: [number, number, number][] = [];
  const shimmer: [string, number, number][] = [];
  const idle = create(null, shore, shimmer);
  idle.OnUpdate(1);
  expect(shore.length + shimmer.length).toBe(0);

  const manager = create({ x: 40, z: 0 }, shore, shimmer);
  for (let i = 0; i < 20; i++) manager.OnUpdate(0.1);
  expect(shimmer.length).toBeGreaterThan(0);
  expect([...shore, ...shimmer].every(([a, b, c]) => (typeof a === 'string' ? (b as number) : (a as number)) >= 0 && c !== undefined)).toBe(true);
  expect(shimmer.every(([kind]) => kind === 'wave_shimmer')).toBe(true);
});

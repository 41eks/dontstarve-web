// components/wavemanager.lua. Lua world units are scaled by `scale` (TILE_SCALE 4 -> TILE_SIZE).
export const WAVE_PER_SEC = 80;

export interface WaveMap {
  readonly tileSize: number;
  tileAt(x: number, z: number): number;
  isLandTile(tile: number): boolean;
  isOceanTile(tile: number): boolean;
}

export type ShimmerKind = 'wave_shimmer' | 'wave_shimmer_med' | 'wave_shimmer_deep';

/** Prefab spawning is the host's: wave_shore/wave_shimmer* are non-persistent, self-removing fx. */
export interface WaveSpawner {
  spawnShimmer(kind: ShimmerKind, x: number, z: number): void;
  spawnShore(x: number, z: number, bearingDegrees: number): void;
}

type TrySpawn = (self: WaveManager, x: number, z: number) => void;
interface Shimmer { tile: number; spawnRate: number; tryspawn: TrySpawn }

const DEGREES = Math.PI / 180;
const mod = (value: number, size: number) => ((value % size) + size) % size;

export interface WaveManagerOptions {
  map: WaveMap;
  spawner: WaveSpawner;
  /** Lua-unit scale of the host world (WORLD_SCALE). */
  scale: number;
  /** Ocean tile id -> the Lua tryspawn it uses; shore waves for coastal tiles, shimmer variants for deeper ones. */
  tiles: ReadonlyMap<number, 'shore' | 'med' | 'deep'>;
  /** TheCamera:GetDistance(), in DST units. */
  cameraDistance(): number;
  /** ThePlayer position; null while there is no player. */
  playerPosition(): { x: number; z: number } | null;
  random?: () => number;
}

export class WaveManager {
  shimmerPerSecMod = 1;
  private readonly shimmer: Shimmer[] = [];
  private readonly blockers = new Map<object, { x: number; z: number; dist: number }>();
  private readonly options: WaveManagerOptions;
  private readonly random: () => number;

  constructor(options: WaveManagerOptions) {
    this.options = options;
    this.random = options.random ?? Math.random;
    const tryspawn = { shore: this.trySpawnWavesOrShore, med: this.trySpawnShimmerMedium, deep: this.trySpawnShimmerDeep };
    for (const [tile, kind] of options.tiles) this.shimmer.push({ tile, spawnRate: 0, tryspawn: tryspawn[kind] });
  }

  RegisterBlocker(inst: object, x: number, z: number, dist: number): void { this.blockers.set(inst, { x, z, dist }); }
  UnregisterBlocker(inst: object): void { this.blockers.delete(inst); }

  OnUpdate(dt: number): void {
    const player = this.options.playerPosition();
    if (!player) return;
    const { scale } = this.options;
    const percent = (Math.min(Math.max(this.options.cameraDistance(), 30), 100) - 30) / 70;
    const mult = 0.5 * percent + 1;
    const radius = ((75 - 30) * percent + 30) * scale;
    for (const shimmer of this.shimmer) {
      shimmer.spawnRate += WAVE_PER_SEC * this.shimmerPerSecMod * mult * dt;
      while (shimmer.spawnRate > 1) {
        const x = player.x + radius * this.unitRand();
        const z = player.z + radius * this.unitRand();
        if (this.canSpawn(x, z, shimmer.tile)) shimmer.tryspawn(this, x, z);
        shimmer.spawnRate -= 1;
      }
    }
  }

  private unitRand(): number { return this.random() * 2 - 1; }

  private canSpawn(x: number, z: number, tile: number): boolean {
    if (this.options.map.tileAt(x, z) !== tile) return false;
    for (const blocker of this.blockers.values()) {
      if ((blocker.x - x) ** 2 + (blocker.z - z) ** 2 < blocker.dist ** 2) return false;
    }
    return true;
  }

  /** Map:IsSurroundedByWater: the centre and eight points on the circle are all ocean. */
  private isSurroundedByWater(x: number, z: number, radius: number): boolean {
    const { map, scale } = this.options;
    const r = radius * scale;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const length = Math.hypot(i, j) || 1;
      if (!map.isOceanTile(map.tileAt(x + i / length * r, z + j / length * r))) return false;
    }
    return true;
  }

  private readonly trySpawnShimmerMedium: TrySpawn = (_, x, z) => {
    if (this.isSurroundedByWater(x, z, 4)) this.options.spawner.spawnShimmer('wave_shimmer_med', x, z);
  };

  private readonly trySpawnShimmerDeep: TrySpawn = (_, x, z) => {
    if (this.isSurroundedByWater(x, z, 5)) this.options.spawner.spawnShimmer('wave_shimmer_deep', x, z);
  };

  private readonly trySpawnWavesOrShore: TrySpawn = (_, x, z) => {
    const bearing = this.getWaveBearing(x, z);
    if (bearing === false) return;
    if (bearing === true) this.options.spawner.spawnShimmer('wave_shimmer', x, z);
    else this.options.spawner.spawnShore(x, z, bearing);
  };

  /** false: too close to land; true: open water; number: shore wave rotation in degrees. */
  getWaveBearing(ex: number, ez: number): boolean | number {
    const { map, scale } = this.options;
    const { tileSize } = map;
    const tileAt = (dx: number, dz: number) => map.isLandTile(map.tileAt(
      (Math.floor(ex / tileSize) + dx + 0.5) * tileSize, (Math.floor(ez / tileSize) + dz + 0.5) * tileSize));
    const corner = (dx: number, dz: number) => [(Math.floor(ex / tileSize) + dx) * tileSize, (Math.floor(ez / tileSize) + dz) * tileSize];
    let radius = 3.5 * scale;
    const tx = mod(ex, tileSize);
    const tz = mod(ez, tileSize);
    const left = tx - radius < 0;
    const right = tx + radius > tileSize;
    const up = tz - radius < 0;
    const down = tz + radius > tileSize;
    const near: [number, number, boolean][] = [
      [-1, -1, left && up], [0, -1, up], [1, -1, right && up],
      [-1, 0, left], [1, 0, right],
      [-1, 1, left && down], [0, 1, down], [1, 1, right && down],
    ];
    let xtotal = 0;
    let ztotal = 0;
    let n = 0;
    let nearbyLand = false;
    for (const [dx, dz, blocking] of near) {
      if (!tileAt(dx, dz)) continue;
      if (blocking) return false;
      nearbyLand = true;
      const [cx, cz] = corner(dx, dz);
      xtotal += cx; ztotal += cz; n += 1;
    }
    radius = 4.5 * scale;
    let minx = 0, maxx = 0, minz = 0, maxz = 0;
    if (!nearbyLand) {
      minx = Math.floor((tx - radius) / tileSize); maxx = Math.floor((tx + radius) / tileSize);
      minz = Math.floor((tz - radius) / tileSize); maxz = Math.floor((tz + radius) / tileSize);
    }
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      if (Math.abs(dx) < 2 && Math.abs(dz) < 2) continue;
      if (!tileAt(dx, dz)) continue;
      if (!nearbyLand) nearbyLand = dx >= minx && dx <= maxx && dz >= minz && dz <= maxz;
      const [cx, cz] = corner(dx, dz);
      xtotal += cx; ztotal += cz; n += 1;
    }
    if (n === 0) return true;
    if (!nearbyLand) return false;
    return -Math.atan2(ztotal / n - ez, xtotal / n - ex) / DEGREES - 90;
  }
}

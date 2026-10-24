import type { Vector3 } from 'three';
import { batch, createEffect, createMemo, createSignal, readonlySignal, watchSignal, type Memo, type ReadonlySignal, type Signal } from '../../signals/src/signal';
import { TILE_SIZE } from '../../prefab/src/tile';
import type { TileStateQuery } from '../../signals/src/worldContent';
import { tilePerfMeasure } from './tilePerf';

interface TileGrid {
  readonly size: number;
  readonly count: number;
  readonly offset: number;
}

let currentGrid: TileGrid | undefined;

/** 世界创建时注入存档的世界坐标尺寸；旧世界释放不能解除新世界的绑定。 */
export function BindTileMapSize(size: number): () => void {
  if (!Number.isFinite(size) || size <= 0) throw new RangeError('Tile map size must be finite and positive');
  const min = Math.floor(-size / 2 / TILE_SIZE);
  const grid: TileGrid = { size, count: Math.ceil(size / 2 / TILE_SIZE) - min, offset: -min };
  currentGrid = grid;
  return () => { if (currentGrid === grid) currentGrid = undefined; };
}

/** 每个位置源、半径拥有独立网格，包含与存档地图范围相交的全部地皮。 */
interface TileStateGrid {
  titlestates: Signal<boolean>[][];
  memoCount: number;
}

function updateTileStates(
  titlestates: Signal<boolean>[][],
  previous: [number, number] | undefined,
  tile: [number, number] | undefined,
  radius: number,
  grid: TileGrid,
): void {
  batch(() => {
    const update = (x: number, z: number, active: boolean) => {
      const state = titlestates[x][z];
      if (state.peek() !== active) state.set(active);
    };
    const last = grid.count - 1;
    const playerX = tile ? tile[0] + grid.offset : NaN;
    const playerZ = tile ? tile[1] + grid.offset : NaN;
    // 只关闭旧区域中已离开范围的格子，重叠区域保持原值。
    if (previous) {
      const oldX = previous[0] + grid.offset, oldZ = previous[1] + grid.offset;
      for (let x = Math.max(0, oldX - radius); x <= Math.min(last, oldX + radius); x++) {
        for (let z = Math.max(0, oldZ - radius); z <= Math.min(last, oldZ + radius); z++) {
          if (!tile || Math.max(Math.abs(x - playerX), Math.abs(z - playerZ)) > radius) update(x, z, false);
        }
      }
    }
    if (!tile) return;
    if (playerX >= 0 && playerX <= last && playerZ >= 0 && playerZ <= last) update(playerX, playerZ, true);
    // 从新玩家格向外激活，半径外立即停止；地图外的玩家跳过完全不相交的内圈。
    const firstRing = Math.max(1, -playerX, playerX - last, -playerZ, playerZ - last);
    const maxRing = Math.min(radius,
      Math.max(Math.abs(playerX), Math.abs(playerX - last), Math.abs(playerZ), Math.abs(playerZ - last)));
    for (let offset = 0; offset <= maxRing - firstRing; offset++) {
      const ring = firstRing + offset;
      const left = playerX - ring, right = playerX + ring;
      const top = playerZ - ring, bottom = playerZ + ring;
      if (top >= 0 && top <= last) {
        for (let x = Math.max(0, left); x <= Math.min(last, right); x++) update(x, top, true);
      }
      if (right >= 0 && right <= last) {
        for (let z = Math.max(0, top + 1); z <= Math.min(last, bottom); z++) update(right, z, true);
      }
      if (bottom >= 0 && bottom <= last) {
        for (let x = Math.min(last, right - 1); x >= Math.max(0, left); x--) update(x, bottom, true);
      }
      if (left >= 0 && left <= last) {
        for (let z = Math.min(last, bottom - 1); z >= Math.max(0, top + 1); z--) update(left, z, true);
      }
    }
  });
}

/** 地图外或非有限坐标的 tile key。 */
export const INVALID_TILE_KEY = -1;

/** 按当前世界尺寸生成数字 key（x 索引 * 网格宽 + z 索引）；未绑定、地图外或非有限坐标返回 INVALID_TILE_KEY。 */
export function GetTileKeyAtPoint(position: Vector3): number {
  return tileKeyAtPoint(position, currentGrid);
}

function tileKeyAtPoint(position: Vector3, grid: TileGrid | undefined): number {
  if (!grid || !Number.isFinite(position.x) || !Number.isFinite(position.z)
    || position.x < -grid.size / 2 || position.x >= grid.size / 2
    || position.z < -grid.size / 2 || position.z >= grid.size / 2) return INVALID_TILE_KEY;
  const x = Math.floor(position.x / TILE_SIZE) + grid.offset, z = Math.floor(position.z / TILE_SIZE) + grid.offset;
  return x * grid.count + z;
}

/**
 * 实体自己的 tile 位置：只发布 tile key，数字相等时 Signal 不通知，
 * 所以同一 tile 内移动不会重算下游 memo，也不分配新向量。
 * 位置的权威数据在实体上：tracker 通过读取函数取当前向量，原地修改和整个替换引用都会被发现。
 * 实体每次给位置赋值后调用 `moved()`，累计 `interval`（默认 60）次才刷新一次 key；休眠实体不更新位置，也就不会刷新。
 * 掉落、传送等一次性的位置跳变用 `sync()` 立即刷新。
 * tracker 保留创建时所属世界的网格配置，后续世界绑定不会改变它的 key 编码。
 */
export class TileTracker {
  private readonly state: Signal<number>;
  readonly tile: ReadonlySignal<number>;
  private readonly getPosition: () => Vector3;
  private readonly interval: number;
  private readonly grid = currentGrid;
  private writes = 0;
  constructor(getPosition: () => Vector3, interval = 60) {
    if (!Number.isInteger(interval) || interval < 1) throw new RangeError('Tile tracker interval must be a positive integer');
    this.getPosition = getPosition; this.interval = interval;
    this.state = createSignal(tileKeyAtPoint(getPosition(), this.grid));
    this.tile = readonlySignal(this.state);
  }
  /** 一次位置赋值之后调用；第 `interval` 次时刷新 key 并重新计数。 */
  moved(): void { if (++this.writes >= this.interval) this.sync(); }
  /** 立即读取当前位置并更新 key，同时重新计数。 */
  sync(): void { this.writes = 0; this.state.set(tileKeyAtPoint(this.getPosition(), this.grid)); }
}

/** 返回世界坐标所在的有符号地皮索引 [x, z]；负坐标向下取整。 */
export function GetTileCoordsAtPoint(position: Vector3): [x: number, z: number] {
  return [Math.floor(position.x / TILE_SIZE), Math.floor(position.z / TILE_SIZE)];
}

interface TileStateCache {
  readonly grid: TileGrid;
  get(tile: ReadonlySignal<number>, radius: number): Memo<boolean> | undefined;
  dispose(): void;
}

interface TileStateTarget {
  tile: Signal<number>;
  stop: () => void;
  memos: Map<number, Memo<boolean>>;
}

const caches = new WeakMap<ReadonlySignal<Vector3 | undefined>, TileStateCache>();

function createTileStateCache(source: ReadonlySignal<Vector3 | undefined>, mapGrid: TileGrid): TileStateCache {
  const targets = new Map<ReadonlySignal<number>, TileStateTarget>();
  const grids = new Map<number, TileStateGrid>();
  let stopWatching!: () => void;
  const player = watchSignal(source, stop => { stopWatching = stop; });
  let playerTile: [number, number] | undefined;
  let initialized = false;
  // 位置变化只触发这个管理器；跨 tile 后统一写入变化的格子。
  createEffect(() => {
    const point = player.get();
    const next = point && Number.isFinite(point.x) && Number.isFinite(point.z) ? GetTileCoordsAtPoint(point) : undefined;
    if (initialized && next?.[0] === playerTile?.[0] && next?.[1] === playerTile?.[1]) return;
    initialized = true;
    const previous = playerTile;
    playerTile = next;
    tilePerfMeasure('player tile change', () => `${previous ?? '-'} -> ${playerTile ?? '-'} radii=${grids.size} targets=${targets.size}`, () => batch(() => {
      for (const [radius, grid] of grids) updateTileStates(grid.titlestates, previous, playerTile, radius, mapGrid);
    }));
  });
  let disposed = false;
  const cache: TileStateCache = {
    grid: mapGrid,
    get(tile, radius) {
      let target = targets.get(tile);
      const cached = target?.memos.get(radius);
      if (cached) return cached;
      if (!target) {
        let stop!: () => void;
        const local = watchSignal(tile, cleanup => { stop = cleanup; });
        if (local.peek() === INVALID_TILE_KEY) {
          stop();
          if (targets.size === 0) cache.dispose();
          return undefined;
        }
        target = { tile: local, stop, memos: new Map() };
        targets.set(tile, target);
      }
      let grid = grids.get(radius);
      if (!grid) {
        grid = {
          titlestates: Array.from({ length: mapGrid.count }, () =>
            Array.from({ length: mapGrid.count }, () => createSignal(false))),
          memoCount: 0,
        };
        updateTileStates(grid.titlestates, undefined, playerTile, radius, mapGrid);
        grids.set(radius, grid);
      }
      const ownedGrid = grid;
      const ownedTarget = target;
      const active = createMemo(() => {
        const key = ownedTarget.tile.get();
        if (key < 0) return false;
        return ownedGrid.titlestates[Math.floor(key / mapGrid.count)]?.[key % mapGrid.count]?.get() ?? false;
      });
      grid.memoCount++;
      const disposeMemo = active.dispose;
      let removed = false;
      active.dispose = () => {
        if (removed) return;
        removed = true;
        ownedTarget.memos.delete(radius);
        if (ownedTarget.memos.size === 0) {
          targets.delete(tile);
          ownedTarget.stop();
        }
        if (--ownedGrid.memoCount === 0) grids.delete(radius);
        try { disposeMemo(); } finally {
          if (targets.size === 0) cache.dispose();
        }
      };
      target.memos.set(radius, active);
      return active;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      caches.delete(source);
      try {
        for (const target of [...targets.values()]) {
          for (const memo of [...target.memos.values()]) memo.dispose();
        }
      } finally {
        stopWatching();
      }
    },
  };
  return cache;
}

/**
 * 绑定玩家位置源，返回接收位置 Signal 和方形半径（默认 10 格）的查询函数。
 * 同一玩家位置源、位置 Signal 和半径复用 memo；初始位置无效或网格外返回 undefined。
 * 位置更新后自动切换格子，移出网格或变为无效位置时返回 false。
 * memo 属于缓存，消费者只释放自己的订阅，由场景统一 DisposeTileStates()。
 */
export function GetTileStateAtPoint(playerPosition: ReadonlySignal<Vector3 | undefined>): TileStateQuery {
  const grid = currentGrid;
  if (!grid) throw new Error('Tile map size is not bound');
  return (position, radius = 10) => {
    if (!Number.isInteger(radius) || radius < 0) throw new RangeError('Tile activity radius must be a non-negative integer');
    let cache = caches.get(playerPosition);
    if (cache && cache.grid !== grid) {
      cache.dispose();
      cache = undefined;
    }
    if (!cache) {
      cache = createTileStateCache(playerPosition, grid);
      caches.set(playerPosition, cache);
    }
    return cache.get(position, radius);
  };
}

/** 场景释放该位置源的全部共享 memo 和位置监听；之后查询会创建新缓存。 */
export function DisposeTileStates(playerPosition: ReadonlySignal<Vector3 | undefined>): void {
  caches.get(playerPosition)?.dispose();
}

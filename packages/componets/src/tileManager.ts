import type { Vector3 } from 'three';
import { batch, createEffect, createMemo, createSignal, watchSignal, type Memo, type ReadonlySignal, type Signal } from '../../signals/src/signal';
import { TILE_SIZE } from '../../prefab/src/tile';
import type { TileStateQuery } from '../../signals/src/worldContent';

const TILE_COUNT = 84;
const TILE_OFFSET = TILE_COUNT / 2;

/** 每个位置源、半径拥有独立网格；[0..83][0..83] 对应地皮 [-42..41][-42..41]。 */
interface TileStateGrid {
  titlestates: Signal<boolean>[][];
  memoCount: number;
}

function updateTileStates(
  titlestates: Signal<boolean>[][],
  previous: [number, number] | undefined,
  tile: [number, number] | undefined,
  radius: number,
): void {
  batch(() => {
    const update = (x: number, z: number, active: boolean) => {
      const state = titlestates[x][z];
      if (state.peek() !== active) state.set(active);
    };
    const last = TILE_COUNT - 1;
    const playerX = tile ? tile[0] + TILE_OFFSET : NaN;
    const playerZ = tile ? tile[1] + TILE_OFFSET : NaN;
    // 只关闭旧区域中已离开范围的格子，重叠区域保持原值。
    if (previous) {
      const oldX = previous[0] + TILE_OFFSET, oldZ = previous[1] + TILE_OFFSET;
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

/** 返回世界坐标所在的有符号地皮索引 [x, z]；负坐标向下取整。 */
export function GetTileCoordsAtPoint(position: Vector3): [x: number, z: number] {
  return [Math.floor(position.x / TILE_SIZE), Math.floor(position.z / TILE_SIZE)];
}

interface TileStateCache {
  get(x: number, z: number, radius: number): Memo<boolean>;
  dispose(): void;
}

const caches = new WeakMap<ReadonlySignal<Vector3 | undefined>, TileStateCache>();

function createTileStateCache(source: ReadonlySignal<Vector3 | undefined>): TileStateCache {
  const memos = new Map<string, Memo<boolean>>();
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
    batch(() => {
      for (const [radius, grid] of grids) updateTileStates(grid.titlestates, previous, playerTile, radius);
    });
  });
  let disposed = false;
  const cache: TileStateCache = {
    get(x, z, radius) {
      const key = `${x},${z},${radius}`;
      const cached = memos.get(key);
      if (cached) return cached;
      let grid = grids.get(radius);
      if (!grid) {
        grid = {
          titlestates: Array.from({ length: TILE_COUNT }, () =>
            Array.from({ length: TILE_COUNT }, () => createSignal(false))),
          memoCount: 0,
        };
        updateTileStates(grid.titlestates, undefined, playerTile, radius);
        grids.set(radius, grid);
      }
      const state = grid.titlestates[x + TILE_OFFSET][z + TILE_OFFSET];
      const active = createMemo(() => state.get());
      grid.memoCount++;
      const ownedGrid = grid;
      const disposeMemo = active.dispose;
      let removed = false;
      active.dispose = () => {
        if (removed) return;
        removed = true;
        memos.delete(key);
        if (--ownedGrid.memoCount === 0) grids.delete(radius);
        try { disposeMemo(); } finally {
          if (memos.size === 0) cache.dispose();
        }
      };
      memos.set(key, active);
      return active;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      caches.delete(source);
      try {
        for (const memo of [...memos.values()]) memo.dispose();
      } finally {
        stopWatching();
      }
    },
  };
  return cache;
}

/**
 * 绑定玩家位置源，返回只接收固定位置和方形半径（默认 10 格）的查询函数。
 * 同一玩家位置源、tile 和半径复用 memo；无效位置或网格外返回 undefined。
 * memo 属于缓存，消费者只释放自己的订阅，由场景统一 DisposeTileStates()。
 */
export function GetTileStateAtPoint(playerPosition: ReadonlySignal<Vector3 | undefined>): TileStateQuery {
  return (position, radius = 10) => {
    if (!Number.isInteger(radius) || radius < 0) throw new RangeError('Tile activity radius must be a non-negative integer');
    if (!Number.isFinite(position.x) || !Number.isFinite(position.z)) return undefined;
    const [x, z] = GetTileCoordsAtPoint(position);
    if (x < -TILE_OFFSET || x >= TILE_OFFSET || z < -TILE_OFFSET || z >= TILE_OFFSET) return undefined;

    let cache = caches.get(playerPosition);
    if (!cache) {
      cache = createTileStateCache(playerPosition);
      caches.set(playerPosition, cache);
    }
    return cache.get(x, z, radius);
  };
}

/** 场景释放该位置源的全部共享 memo 和位置监听；之后查询会创建新缓存。 */
export function DisposeTileStates(playerPosition: ReadonlySignal<Vector3 | undefined>): void {
  caches.get(playerPosition)?.dispose();
}

import { onSignalChange } from '../../signals/tests/signalChanges';
import { useTestTileMap } from './tileMapFixture';
import { expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { createSignal, readonlySignal, type ReadonlySignal } from '../../signals/src/signal';
import * as signals from '../../signals/src/signal';
import {
  BindTileMapSize,
  DisposeTileStates,
  GetTileKeyAtPoint,
  GetTileStateAtPoint,
  INVALID_TILE_KEY,
  TileTracker,
} from '../../componets/src/tileManager';

useTestTileMap();

const tileAt = (position: Vector3) => createSignal(GetTileKeyAtPoint(position));

/** A view of signal whose get() is a spy. */
function spiedSignal<T>(signal: ReadonlySignal<T>) {
  return {
    get value() {
      return signal.value;
    },
    get: vi.fn(() => signal.get()),
  };
}

it('uses injected dimensions for grids, keys and exact bounds, including partial edge tiles', async () => {
  for (const [size, count] of [
    [48, 4],
    [1200, 100],
    [84, 8],
    [1000, 84],
  ]) {
    const unbind = BindTileMapSize(size);
    const player = createSignal(new Vector3(-size / 2, 0, -size / 2));
    const position = player.value.clone();
    const tracker = new TileTracker(() => position);
    const query = GetTileStateAtPoint(player);
    const active = query(tracker.tile, 0)!;
    try {
      expect(tracker.tile.value).toBe(0);
      expect(active.get()).toBe(true);
      player.set(new Vector3(size / 2 - 0.01, 0, size / 2 - 0.01));
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(active.get()).toBe(false);
      position.copy(player.value);
      tracker.sync();
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(tracker.tile.value).toBe(count * count - 1);
      expect(active.get()).toBe(true);
      for (const point of [
        new Vector3(size / 2, 0, 0),
        new Vector3(0, 0, size / 2),
        new Vector3(-size / 2 - 0.01, 0, 0),
        new Vector3(0, 0, -size / 2 - 0.01),
      ]) {
        expect(GetTileKeyAtPoint(point)).toBe(INVALID_TILE_KEY);
        expect(query(tileAt(point))).toBeUndefined();
      }
      position.x = size / 2;
      tracker.sync();
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(active.get()).toBe(false);
    } finally {
      DisposeTileStates(player);
      unbind();
    }
  }
  expect(() => GetTileStateAtPoint(createSignal(new Vector3()))).toThrow('not bound');
  for (const size of [0, -1, NaN, Infinity]) {
    expect(() => BindTileMapSize(size)).toThrow(RangeError);
  }
});

it('follows moving target signals across tiles and releases their bridges on disposal', async () => {
  const player = createSignal(new Vector3());
  const live = new Vector3(),
    mover = new TileTracker(() => live);
  const move = (to: Vector3) => {
    live.copy(to);
    mover.sync();
  };
  const source = spiedSignal(mover.tile);
  const query = GetTileStateAtPoint(player);
  const active = query(source, 0)!;
  const wider = query(source, 1)!;
  try {
    const sameOwner = query(source, 0)!;
    expect(sameOwner).toBe(active);
    sameOwner.dispose();
    expect(source.get).toHaveBeenCalledOnce();
    expect([active.get(), wider.get()]).toEqual([true, true]);
    move(new Vector3(12, 0, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect([active.get(), wider.get()]).toEqual([false, true]);
    move(new Vector3(504, 0, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect([active.get(), wider.get()]).toEqual([false, false]);
    move(new Vector3());
    await new Promise(resolve => setTimeout(resolve, 0));
    expect([active.get(), wider.get()]).toEqual([true, true]);
    active.dispose();
    move(new Vector3(24, 0, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(active.get()).toBe(true);
    expect(wider.get()).toBe(false);
    DisposeTileStates(player);
    source.get.mockClear();
    move(new Vector3());
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(source.get).not.toHaveBeenCalled();
    expect(wider.get()).toBe(false);
  } finally {
    DisposeTileStates(player);
  }
});

it('derives activity from player tiles with the default square radius, including negative edges and teleportation', async () => {
  const player = createSignal(new Vector3());
  const active = GetTileStateAtPoint(player)(tileAt(new Vector3(-0.1, 50, -0.1)))!;
  const transitions: boolean[] = [];
  const stop = onSignalChange(active, value => transitions.push(value));
  try {
    expect(active.get()).toBe(true);
    player.set(new Vector3(119.9, 0, 119.9));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(active.get()).toBe(true);
    expect(transitions).toEqual([]);
    player.set(new Vector3(120, 0, 120));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(active.get()).toBe(false);
    player.set(new Vector3(-499, 0, -499));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(active.get()).toBe(false);
    player.set(new Vector3(-12, 0, -12));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(active.get()).toBe(true);
    expect(transitions).toEqual([false, true]);
  } finally {
    stop();
    active.dispose();
  }
});

it('supports a configurable radius and rejects invalid targets and radii', async () => {
  const player = createSignal(new Vector3(-0.1, 0, 0));
  const active = GetTileStateAtPoint(readonlySignal(player))(tileAt(new Vector3(-12, 0, 0)), 0)!;
  try {
    expect(active.get()).toBe(true);
    player.set(new Vector3(0, 0, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(active.get()).toBe(false);
    player.set(new Vector3(NaN, 0, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(active.get()).toBe(false);
    player.set(new Vector3(-12, 0, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(active.get()).toBe(true);
    expect(GetTileStateAtPoint(player)(tileAt(new Vector3(0, 0, Infinity)))).toBeUndefined();
    expect(() => GetTileStateAtPoint(player)(tileAt(new Vector3()), -1)).toThrow(RangeError);
    expect(() => GetTileStateAtPoint(player)(tileAt(new Vector3()), 0.5)).toThrow(RangeError);
  } finally {
    active.dispose();
  }
});

it('releases the player bridge on disposal while other consumers remain active', async () => {
  const player = createSignal(new Vector3());
  const source = spiedSignal(player);
  const removed = GetTileStateAtPoint(source)(tileAt(new Vector3()), 0)!;
  const retained = GetTileStateAtPoint(player)(tileAt(new Vector3()), 0)!;
  try {
    expect(source.get).toHaveBeenCalledOnce();
    removed.dispose();
    removed.dispose();
    player.set(new Vector3(12, 0, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(source.get).toHaveBeenCalledOnce();
    expect(removed.get()).toBe(true);
    expect(retained.get()).toBe(false);
  } finally {
    removed.dispose();
    retained.dispose();
  }
});

it('keeps a shared tile memo until its last owner disposes it', async () => {
  const player = createSignal(new Vector3()),
    query = GetTileStateAtPoint(player),
    tile = tileAt(new Vector3());
  const first = query(tile)!,
    second = query(tile)!;
  try {
    expect(second).toBe(first);
    first.dispose();
    player.set(new Vector3(600, 0, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(second.get()).toBe(false);
    second.dispose();
    player.set(new Vector3());
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(second.get()).toBe(false);
    const next = query(tile)!;
    expect(next).not.toBe(first);
    expect(next.get()).toBe(true);
    next.dispose();
  } finally {
    DisposeTileStates(player);
  }
});

it('reuses tile signal memos and a single player bridge while keeping radius and source caches separate', async () => {
  const player = createSignal(new Vector3());
  const source = spiedSignal(player);
  const otherPlayer = createSignal(new Vector3());
  const position = tileAt(new Vector3(-0.1, 0, 1));
  const active = GetTileStateAtPoint(source)(position)!;
  const sameTile = GetTileStateAtPoint(source)(position, 10)!;
  const anotherTile = GetTileStateAtPoint(source)(tileAt(new Vector3(12, 0, 0)))!;
  const smallerRadius = GetTileStateAtPoint(source)(tileAt(new Vector3(-1, 0, 1)), 0)!;
  const otherSource = GetTileStateAtPoint(otherPlayer)(tileAt(new Vector3(-1, 0, 1)))!;
  const first = vi.fn(),
    second = vi.fn();
  const stopFirst = onSignalChange(active, first);
  const stopSecond = onSignalChange(sameTile, second);
  try {
    expect(sameTile).toBe(active);
    expect(anotherTile).not.toBe(active);
    expect(smallerRadius).not.toBe(active);
    expect(otherSource).not.toBe(active);
    expect(source.get).toHaveBeenCalledOnce();
    expect(active.get()).toBe(true);
    expect(smallerRadius.get()).toBe(false);
    stopFirst();
    player.set(new Vector3(120, 0, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(sameTile.get()).toBe(false);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(GetTileStateAtPoint(source)(position)).toBe(active);
    expect(source.get).toHaveBeenCalledTimes(2);
    expect(otherSource.get()).toBe(true);
  } finally {
    stopFirst();
    stopSecond();
    DisposeTileStates(source);
    DisposeTileStates(otherPlayer);
  }
});

it('evicts disposed memos and recreates the cache after scene teardown without retaining old player subscriptions', async () => {
  const player = createSignal(new Vector3());
  const source = spiedSignal(player);
  const point = tileAt(new Vector3());
  const old = GetTileStateAtPoint(source)(point, 0)!;
  const retained = GetTileStateAtPoint(source)(tileAt(new Vector3(12, 0, 0)), 0)!;
  old.dispose();
  const replacement = GetTileStateAtPoint(source)(point, 0)!;
  try {
    expect(replacement).not.toBe(old);
    expect(source.get).toHaveBeenCalledOnce();
    old.dispose();
    expect(GetTileStateAtPoint(source)(point, 0)).toBe(replacement);
    DisposeTileStates(source);
    DisposeTileStates(source);
    player.set(new Vector3(12, 0, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(source.get).toHaveBeenCalledOnce();
    expect(replacement.get()).toBe(true);
    expect(retained.get()).toBe(false);
    const restored = GetTileStateAtPoint(source)(point, 0)!;
    expect(restored).not.toBe(replacement);
    expect(restored.get()).toBe(false);
    replacement.dispose();
    expect(GetTileStateAtPoint(source)(point, 0)).toBe(restored);
  } finally {
    DisposeTileStates(source);
  }
});

it('recalculates only changed tile memos when the shared grid updates', async () => {
  const originalMemo = signals.createMemo;
  const originalSignal = signals.createSignal;
  let gridReads = 0;
  const signalSpy = vi.spyOn(signals, 'createSignal').mockImplementation(<T>(value: T) => {
    const state = originalSignal(value);
    if (typeof value === 'boolean') {
      // Count the grid's untracked reads through a view of the same signal.
      return {
        get: () => state.get(),
        set: (next: T) => state.set(next),
        get value() {
          gridReads++;
          return state.value;
        },
      };
    }
    return state;
  });
  const calculations: { calls: number }[] = [];
  const spy = vi.spyOn(signals, 'createMemo').mockImplementation(<T>(compute: () => T) => {
    const counter = { calls: 0 };
    calculations.push(counter);
    return originalMemo(() => {
      counter.calls++;
      return compute();
    });
  });
  const player = createSignal(new Vector3());
  try {
    const unchanged = GetTileStateAtPoint(player)(tileAt(new Vector3()))!;
    const leaving = GetTileStateAtPoint(player)(tileAt(new Vector3(-120, 0, 0)))!;
    const entering = GetTileStateAtPoint(player)(tileAt(new Vector3(132, 0, 0)))!;
    const far = GetTileStateAtPoint(player)(tileAt(new Vector3(480, 0, 0)))!;
    const initialReads = gridReads;
    expect(calculations.map(counter => counter.calls)).toEqual([1, 1, 1, 1]);
    player.set(new Vector3(11.9, 0, 1));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(calculations.map(counter => counter.calls)).toEqual([1, 1, 1, 1]);
    expect(gridReads).toBe(initialReads);
    player.set(new Vector3(12, 0, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect([unchanged.get(), leaving.get(), entering.get(), far.get()]).toEqual([true, false, true, false]);
    expect(calculations.map(counter => counter.calls)).toEqual([1, 2, 2, 1]);
    expect(gridReads - initialReads).toBeGreaterThan(0);
    expect(gridReads - initialReads).toBeLessThanOrEqual(882);
    const readsBeforeTeleport = gridReads;
    player.set(new Vector3(480, 0, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect([unchanged.get(), leaving.get(), entering.get(), far.get()]).toEqual([false, false, false, true]);
    expect(calculations.map(counter => counter.calls)).toEqual([2, 2, 3, 2]);
    expect(gridReads - readsBeforeTeleport).toBeLessThanOrEqual(882);
    const latePosition = tileAt(new Vector3(492, 0, 0));
    const late = GetTileStateAtPoint(player)(latePosition)!;
    expect(late.get()).toBe(true);
    expect(GetTileStateAtPoint(player)(latePosition)).toBe(late);
  } finally {
    DisposeTileStates(player);
    spy.mockRestore();
    signalSpy.mockRestore();
  }
});

it('publishes changed tiles from the player outward in spiral order, including clipped map edges', async () => {
  for (const [center, expected] of [
    [
      [-1, -1],
      [
        [-1, -1],
        [-2, -2],
        [-1, -2],
        [0, -2],
        [0, -1],
        [0, 0],
        [-1, 0],
        [-2, 0],
        [-2, -1],
      ],
    ],
    [
      [-42, -42],
      [
        [-42, -42],
        [-41, -42],
        [-41, -41],
        [-42, -41],
      ],
    ],
  ] as [number[], number[][]][]) {
    const player = createSignal(new Vector3(240, 0, 240));
    const observed: number[][] = [];
    const stops: (() => void)[] = [];
    try {
      // 故意反序登记，发布顺序应由螺旋决定。
      for (const [x, z] of [...expected].reverse()) {
        const state = GetTileStateAtPoint(player)(tileAt(new Vector3(x * 12, 0, z * 12)), 1)!;
        stops.push(
          onSignalChange(state, active => {
            if (active) {
              observed.push([x, z]);
            }
          }),
        );
      }
      const oldCenter = GetTileStateAtPoint(player)(tileAt(new Vector3(240, 0, 240)), 1)!;
      expect(oldCenter.get()).toBe(true);
      player.set(new Vector3(center[0] * 12, 0, center[1] * 12));
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(observed).toEqual(expected);
      expect(oldCenter.get()).toBe(false);
      if (center[0] === -42) {
        player.set(new Vector3(-43 * 12, 0, -42 * 12));
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(
          expected.map(([x, z]) => GetTileStateAtPoint(player)(tileAt(new Vector3(x * 12, 0, z * 12)), 1)!.get()),
        ).toEqual([true, false, false, true]);
      }
    } finally {
      for (const stop of stops) {
        stop();
      }
      DisposeTileStates(player);
    }
  }
});

it('publishes only tile changes from a tracker and keeps the key stable inside a tile', async () => {
  const player = createSignal(new Vector3());
  const live = new Vector3(1, 0, 1),
    tracker = new TileTracker(() => live);
  const move = (x: number, y: number, z: number) => {
    live.set(x, y, z);
    tracker.sync();
  };
  const active = GetTileStateAtPoint(player)(tracker.tile, 0)!;
  const keys: number[] = [],
    transitions: boolean[] = [];
  const stopKeys = onSignalChange(tracker.tile, key => keys.push(key));
  const stop = onSignalChange(active, value => transitions.push(value));
  try {
    expect(active.get()).toBe(true);
    move(11.9, 0, 0.1); // same 12-unit tile: no notification
    expect(keys).toEqual([]);
    move(12, 0, 0);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(keys).toEqual([GetTileKeyAtPoint(new Vector3(12, 0, 0))]);
    expect(active.get()).toBe(false);
    move(0, 0, Infinity);
    expect(tracker.tile.value).toBe(INVALID_TILE_KEY);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(active.get()).toBe(false);
    move(0, 0, 0);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(transitions).toEqual([false, true]);
  } finally {
    stop();
    stopKeys();
    active.dispose();
    DisposeTileStates(player);
  }
});

it('refreshes a tracker only after 60 position writes, and immediately on sync', async () => {
  const player = createSignal(new Vector3());
  const owner = { position: new Vector3(1, 0, 1) };
  const tracker = new TileTracker(() => owner.position);
  const active = GetTileStateAtPoint(player)(tracker.tile, 0)!;
  const move = (x: number) => {
    owner.position.set(x, 0, 1);
    tracker.moved();
  };
  try {
    for (let write = 0; write < 59; write++) {
      move(25);
    }
    expect(tracker.tile.value).toBe(GetTileKeyAtPoint(new Vector3(1, 0, 1)));
    expect(active.get()).toBe(true);
    move(25); // the 60th write refreshes
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(tracker.tile.value).toBe(GetTileKeyAtPoint(new Vector3(25, 0, 1)));
    expect(active.get()).toBe(false);

    // A teleport that replaces the vector is picked up by an immediate sync, which also restarts the count.
    for (let write = 0; write < 30; write++) {
      tracker.moved();
    }
    owner.position = new Vector3(0, 0, 0);
    tracker.sync();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(active.get()).toBe(true);
    owner.position.set(25, 0, 1);
    for (let write = 0; write < 59; write++) {
      tracker.moved();
    }
    expect(tracker.tile.value).toBe(GetTileKeyAtPoint(new Vector3(0, 0, 0)));
    tracker.moved();
    expect(tracker.tile.value).toBe(GetTileKeyAtPoint(new Vector3(25, 0, 1)));
    expect(() => new TileTracker(() => owner.position, 0)).toThrow(RangeError);
  } finally {
    active.dispose();
    DisposeTileStates(player);
  }
});

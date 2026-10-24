import { expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { createSignal, readonlySignal } from '../../signals/src/signal';
import * as signals from '../../signals/src/signal';
import { DisposeTileStates, GetTileStateAtPoint } from '../../componets/src/tileManager';

it('derives activity from player tiles with the default square radius, including negative edges and teleportation', async () => {
  const player = createSignal(new Vector3());
  const active = GetTileStateAtPoint(player)(new Vector3(-0.1, 50, -0.1))!;
  const transitions: boolean[] = [];
  const stop = active.subscribe(value => transitions.push(value));
  try {
    expect(active()).toBe(true);
    player.set(new Vector3(119.9, 0, 119.9));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(active.get()).toBe(true);
    expect(transitions).toEqual([]);
    player.set(new Vector3(120, 0, 120));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(active()).toBe(false);
    player.set(new Vector3(-499, 0, -499));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(active()).toBe(false);
    player.set(new Vector3(-12, 0, -12));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(active()).toBe(true);
    expect(transitions).toEqual([false, true]);
  } finally { stop(); active.dispose(); }
});

it('supports a configurable radius and rejects invalid targets and radii', async () => {
  const player = createSignal(new Vector3(-0.1, 0, 0));
  const active = GetTileStateAtPoint(readonlySignal(player))(new Vector3(-12, 0, 0), 0)!;
  try {
    expect(active()).toBe(true);
    player.set(new Vector3(0, 0, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(active()).toBe(false);
    player.set(new Vector3(NaN, 0, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(active()).toBe(false);
    player.set(new Vector3(-12, 0, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(active()).toBe(true);
    expect(GetTileStateAtPoint(player)(new Vector3(504, 0, 0))).toBeUndefined();
    expect(GetTileStateAtPoint(player)(new Vector3(0, 0, Infinity))).toBeUndefined();
    expect(() => GetTileStateAtPoint(player)(new Vector3(), -1)).toThrow(RangeError);
    expect(() => GetTileStateAtPoint(player)(new Vector3(), 0.5)).toThrow(RangeError);
  } finally { active.dispose(); }
});

it('releases the player bridge on disposal while other consumers remain active', async () => {
  const player = createSignal(new Vector3());
  const source = { ...readonlySignal(player), get: vi.fn(() => player.get()) };
  const removed = GetTileStateAtPoint(source)(new Vector3(), 0)!;
  const retained = GetTileStateAtPoint(player)(new Vector3(), 0)!;
  try {
    expect(source.get).toHaveBeenCalledOnce();
    removed.dispose(); removed.dispose();
    player.set(new Vector3(12, 0, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(source.get).toHaveBeenCalledOnce();
    expect(removed()).toBe(true);
    expect(retained()).toBe(false);
  } finally { removed.dispose(); retained.dispose(); }
});

it('reuses tile memos and a single player bridge while keeping radius and source caches separate', async () => {
  const player = createSignal(new Vector3());
  const source = { ...readonlySignal(player), get: vi.fn(() => player.get()) };
  const otherPlayer = createSignal(new Vector3());
  const active = GetTileStateAtPoint(source)(new Vector3(-0.1, 0, 1))!;
  const sameTile = GetTileStateAtPoint(source)(new Vector3(-12, 25, 11.9), 10)!;
  const anotherTile = GetTileStateAtPoint(source)(new Vector3(12, 0, 0))!;
  const smallerRadius = GetTileStateAtPoint(source)(new Vector3(-1, 0, 1), 0)!;
  const otherSource = GetTileStateAtPoint(otherPlayer)(new Vector3(-1, 0, 1))!;
  const first = vi.fn(), second = vi.fn();
  const stopFirst = active.subscribe(first);
  const stopSecond = sameTile.subscribe(second);
  try {
    expect(sameTile).toBe(active);
    expect(anotherTile).not.toBe(active);
    expect(smallerRadius).not.toBe(active);
    expect(otherSource).not.toBe(active);
    expect(source.get).toHaveBeenCalledOnce();
    expect(active()).toBe(true);
    expect(smallerRadius()).toBe(false);
    stopFirst();
    player.set(new Vector3(120, 0, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(sameTile()).toBe(false);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(GetTileStateAtPoint(source)(new Vector3(-1, 0, 1))).toBe(active);
    expect(source.get).toHaveBeenCalledTimes(2);
    expect(otherSource()).toBe(true);
  } finally {
    stopFirst(); stopSecond();
    DisposeTileStates(source); DisposeTileStates(otherPlayer);
  }
});

it('evicts disposed memos and recreates the cache after scene teardown without retaining old player subscriptions', async () => {
  const player = createSignal(new Vector3());
  const source = { ...readonlySignal(player), get: vi.fn(() => player.get()) };
  const point = new Vector3();
  const old = GetTileStateAtPoint(source)(point, 0)!;
  const retained = GetTileStateAtPoint(source)(new Vector3(12, 0, 0), 0)!;
  old.dispose();
  const replacement = GetTileStateAtPoint(source)(point, 0)!;
  try {
    expect(replacement).not.toBe(old);
    expect(source.get).toHaveBeenCalledOnce();
    old.dispose();
    expect(GetTileStateAtPoint(source)(point, 0)).toBe(replacement);
    DisposeTileStates(source); DisposeTileStates(source);
    player.set(new Vector3(12, 0, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(source.get).toHaveBeenCalledOnce();
    expect(replacement()).toBe(true);
    expect(retained()).toBe(false);
    const restored = GetTileStateAtPoint(source)(point, 0)!;
    expect(restored).not.toBe(replacement);
    expect(restored()).toBe(false);
    replacement.dispose();
    expect(GetTileStateAtPoint(source)(point, 0)).toBe(restored);
  } finally { DisposeTileStates(source); }
});

it('recalculates only changed tile memos when the shared grid updates', async () => {
  const originalMemo = signals.createMemo;
  const originalSignal = signals.createSignal;
  let gridReads = 0;
  const signalSpy = vi.spyOn(signals, 'createSignal').mockImplementation(<T>(value: T) => {
    const state = originalSignal(value);
    if (typeof value === 'boolean') {
      const peek = state.peek;
      state.peek = () => { gridReads++; return peek(); };
    }
    return state;
  });
  const calculations: { calls: number }[] = [];
  const spy = vi.spyOn(signals, 'createMemo').mockImplementation(<T>(compute: () => T) => {
    const counter = { calls: 0 };
    calculations.push(counter);
    return originalMemo(() => { counter.calls++; return compute(); });
  });
  const player = createSignal(new Vector3());
  try {
    const unchanged = GetTileStateAtPoint(player)(new Vector3())!;
    const leaving = GetTileStateAtPoint(player)(new Vector3(-120, 0, 0))!;
    const entering = GetTileStateAtPoint(player)(new Vector3(132, 0, 0))!;
    const far = GetTileStateAtPoint(player)(new Vector3(480, 0, 0))!;
    const initialReads = gridReads;
    expect(calculations.map(counter => counter.calls)).toEqual([1, 1, 1, 1]);
    player.set(new Vector3(11.9, 0, 1));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(calculations.map(counter => counter.calls)).toEqual([1, 1, 1, 1]);
    expect(gridReads).toBe(initialReads);
    player.set(new Vector3(12, 0, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect([unchanged(), leaving(), entering(), far()]).toEqual([true, false, true, false]);
    expect(calculations.map(counter => counter.calls)).toEqual([1, 2, 2, 1]);
    expect(gridReads - initialReads).toBeGreaterThan(0);
    expect(gridReads - initialReads).toBeLessThanOrEqual(882);
    const readsBeforeTeleport = gridReads;
    player.set(new Vector3(480, 0, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect([unchanged(), leaving(), entering(), far()]).toEqual([false, false, false, true]);
    expect(calculations.map(counter => counter.calls)).toEqual([2, 2, 3, 2]);
    expect(gridReads - readsBeforeTeleport).toBeLessThanOrEqual(882);
    const late = GetTileStateAtPoint(player)(new Vector3(492, 0, 0))!;
    expect(late()).toBe(true);
    expect(GetTileStateAtPoint(player)(new Vector3(493, 0, 0))).toBe(late);
  } finally { DisposeTileStates(player); spy.mockRestore(); signalSpy.mockRestore(); }
});

it('publishes changed tiles from the player outward in spiral order, including clipped map edges', async () => {
  for (const [center, expected] of [
    [[-1, -1], [[-1, -1], [-2, -2], [-1, -2], [0, -2], [0, -1], [0, 0], [-1, 0], [-2, 0], [-2, -1]]],
    [[-42, -42], [[-42, -42], [-41, -42], [-41, -41], [-42, -41]]],
  ] as [number[], number[][]][]) {
    const player = createSignal(new Vector3(240, 0, 240));
    const observed: number[][] = [];
    const stops: (() => void)[] = [];
    try {
      // 故意反序登记，发布顺序应由螺旋决定。
      for (const [x, z] of [...expected].reverse()) {
        const state = GetTileStateAtPoint(player)(new Vector3(x * 12, 0, z * 12), 1)!;
        stops.push(state.subscribe(active => { if (active) observed.push([x, z]); }));
      }
      const oldCenter = GetTileStateAtPoint(player)(new Vector3(240, 0, 240), 1)!;
      expect(oldCenter()).toBe(true);
      player.set(new Vector3(center[0] * 12, 0, center[1] * 12));
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(observed).toEqual(expected);
      expect(oldCenter()).toBe(false);
      if (center[0] === -42) {
        player.set(new Vector3(-43 * 12, 0, -42 * 12));
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(expected.map(([x, z]) => GetTileStateAtPoint(player)(new Vector3(x * 12, 0, z * 12), 1)!()))
          .toEqual([true, false, false, true]);
      }
    } finally { for (const stop of stops) stop(); DisposeTileStates(player); }
  }
});

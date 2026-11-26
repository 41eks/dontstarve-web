import { onSignalChange } from './signalChanges';
import { expect, it } from 'vitest';
import { batch, createEffect, createMemo, createRenderEffect, createSignal, watchSignal } from '../src';

// Pins the scheduling table in packages/signals/AGENTS.md ("Effect scheduling"). Change both together.

const microtask = () => Promise.resolve();

it('createEffect runs once synchronously, then reruns in one coalesced microtask per change burst', async () => {
  const value = createSignal(0),
    runs: number[] = [];
  const stop = createEffect(() => runs.push(value.get()));
  expect(runs).toEqual([0]);
  value.set(1);
  value.set(2);
  value.set(3);
  expect(runs).toEqual([0]);
  await microtask();
  expect(runs).toEqual([0, 3]);
  stop();
});

it('createEffect inside batch() is still deferred to the microtask, not to the batch commit', async () => {
  const value = createSignal(0),
    runs: number[] = [];
  const stop = createEffect(() => runs.push(value.get()));
  batch(() => {
    value.set(1);
  });
  expect(runs).toEqual([0]);
  await microtask();
  expect(runs).toEqual([0, 1]);
  stop();
});

it('createEffect chains settle within the same microtask drain', async () => {
  const source = createSignal(0),
    relay = createSignal(0),
    seen: number[] = [];
  const stopRelay = createEffect(() => relay.set(source.get() * 10));
  const stopSeen = createEffect(() => seen.push(relay.get()));
  source.set(1);
  await microtask();
  expect(seen).toEqual([0, 10]);
  stopRelay();
  stopSeen();
});

it('disposing a createEffect cancels its queued rerun', async () => {
  const value = createSignal(0),
    runs: number[] = [];
  const stop = createEffect(() => runs.push(value.get()));
  value.set(1);
  stop();
  await microtask();
  expect(runs).toEqual([0]);
});

it('createRenderEffect reruns synchronously on each change, and once after a batch commits', () => {
  const value = createSignal(0),
    runs: number[] = [];
  const stop = createRenderEffect(() => runs.push(value.get()));
  value.set(1);
  value.set(2);
  expect(runs).toEqual([0, 1, 2]);
  batch(() => {
    value.set(3);
    value.set(4);
    expect(runs).toEqual([0, 1, 2]);
  });
  expect(runs).toEqual([0, 1, 2, 4]);
  stop();
});

it('createMemo is current synchronously and, read inside a batch, recomputes there while its observers wait for the commit', () => {
  const value = createSignal(1),
    seen: number[] = [],
    rendered: number[] = [];
  const doubled = createMemo(() => value.get() * 2);
  const quadrupled = createMemo(() => doubled.get() * 2);
  value.set(2);
  expect([doubled.get(), quadrupled.get()]).toEqual([4, 8]);
  const stop = onSignalChange(quadrupled, next => seen.push(next));
  const stopRender = createRenderEffect(() => rendered.push(quadrupled.get()));
  batch(() => {
    value.set(3);
    // A chain reads current values, through get or peek alike.
    expect([quadrupled.peek(), doubled.get()]).toEqual([12, 6]);
    value.set(4);
    expect(quadrupled.get()).toBe(16);
    expect([seen, rendered]).toEqual([[], [8]]);
  });
  // An observer hears once of the net change after the commit; render effects run once.
  expect([seen, rendered]).toEqual([[16], [8, 16]]);
  batch(() => {
    value.set(5);
    expect(quadrupled.get()).toBe(20);
    value.set(4);
    expect(quadrupled.get()).toBe(16);
  });
  // A batch that ends where it started notifies nobody.
  expect(seen).toEqual([16]);
  doubled.dispose();
  quadrupled.dispose();
  stop();
  stopRender();
});

it('a write settles the memos it changes in one loop before returning: a diamond computes once, a long chain stays flat', () => {
  const value = createSignal(0);
  let computes = 0;
  const plus = createMemo(() => value.get() + 1);
  const times = createMemo(() => value.get() * 2);
  const sum = createMemo(() => {
    computes++;
    return plus.get() + times.get();
  });
  const heard: [number, number][] = [],
    rendered: number[] = [];
  const stop = onSignalChange(sum, (next, previous) => heard.push([previous, next]));
  const stopRender = createRenderEffect(() => rendered.push(sum.get()));
  computes = 0;
  value.set(1);
  // Only the settled result is published: no intermediate value from one updated branch.
  expect([computes, heard, rendered, sum.get()]).toEqual([1, [[1, 4]], [1, 4], 4]);

  // Each level would otherwise nest the next one's computation.
  const deep = createSignal(0);
  let last = createMemo(() => deep.get());
  for (let level = 1; level < 20000; level++) {
    const previous = last;
    last = createMemo(() => previous.get() + 1);
  }
  deep.set(1);
  expect(last.get()).toBe(20000);
  stop();
  stopRender();
});

it('watchSignal bridges the source synchronously into its local signal, and after a batch commits', () => {
  const source = createSignal(0);
  let stop = () => {};
  const local = watchSignal(source, cleanup => {
    stop = cleanup;
  });
  expect(local.peek()).toBe(0);
  source.set(5);
  expect(local.peek()).toBe(5);
  batch(() => {
    source.set(6);
    expect(local.peek()).toBe(5);
  });
  expect(local.peek()).toBe(6);
  stop();
});

it('setting an identical (===) value notifies nobody', async () => {
  const value = createSignal({ a: 1 }),
    same = value.peek(),
    events: string[] = [];
  const stopEffect = createEffect(() => {
    value.get();
    events.push('effect');
  });
  const stopRender = createRenderEffect(() => {
    value.get();
    events.push('render');
  });
  events.length = 0;
  value.set(same);
  await microtask();
  expect(events).toEqual([]);
  value.set({ a: 1 });
  await microtask();
  expect(events.sort()).toEqual(['effect', 'render']);
  stopEffect();
  stopRender();
});

it('an effect writing a signal it reads does not retrigger itself', async () => {
  const value = createSignal(0);
  let runs = 0;
  const stop = createEffect(() => {
    runs++;
    value.set(value.get() + 1);
  });
  await microtask();
  await microtask();
  expect(runs).toBe(1);
  expect(value.peek()).toBe(1);
  stop();
});

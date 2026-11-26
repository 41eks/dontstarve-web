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

it('createMemo settles at each write, inside a batch too, while the effects reading it wait for the commit', () => {
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
    // A chain reads current values, through get or value alike.
    expect([quadrupled.value, doubled.get()]).toEqual([12, 6]);
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

it('settles memo values before synchronous observers of the source, regardless of registration order', () => {
  for (const memoFirst of [false, true]) {
    const source = createSignal(1);
    let doubled = memoFirst ? createMemo(() => source.get() * 2) : undefined;
    const rendered: [number, number | undefined][] = [];
    const stop = createRenderEffect(() => rendered.push([source.get(), doubled?.value]));
    doubled ??= createMemo(() => source.get() * 2);
    source.set(2);
    source.set(3);
    expect(rendered.slice(1)).toEqual([
      [2, 4],
      [3, 6],
    ]);
    stop();
    doubled.dispose();
  }
});

it('disposing a derived value preserves its snapshot without committing other render effects', () => {
  const source = createSignal(1);
  const doubled = createMemo(() => source.get() * 2);
  const rendered: number[] = [];
  const stop = createRenderEffect(() => rendered.push(source.get()));
  batch(() => {
    source.set(2);
    doubled.dispose();
    expect(doubled.value).toBe(4);
    expect(rendered).toEqual([1]);
  });
  expect(rendered).toEqual([1, 2]);
  stop();
});

it('settles the watched inputs of a disposing memo without committing unrelated render effects', () => {
  const source = createSignal(1);
  let release = () => {};
  const local = watchSignal(source, stop => {
    release = stop;
  });
  const doubled = createMemo(() => local.get() * 2);
  const incremented = createMemo(() => doubled.get() + 1);
  const unrelated = createSignal(0);
  const rendered: number[] = [];
  const stop = createRenderEffect(() => rendered.push(unrelated.get()));
  batch(() => {
    source.set(2);
    unrelated.set(1);
    incremented.dispose();
    expect(incremented.value).toBe(5);
    expect(rendered).toEqual([0]);
  });
  expect(rendered).toEqual([0, 1]);
  doubled.dispose();
  release();
  stop();
});

it('drops unfinished synchronous notifications after a render effect throws', () => {
  const source = createSignal(0);
  const unrelated = createSignal(0);
  const rendered: number[] = [];
  const stopThrowing = createRenderEffect(() => {
    if (source.get() === 1) {
      throw new Error('render error');
    }
  });
  const stop = createRenderEffect(() => rendered.push(source.get()));
  const stopUnrelated = createRenderEffect(() => unrelated.get());
  try {
    expect(() => source.set(1)).toThrow('render error');
    unrelated.set(1);
    expect(rendered).toEqual([0]);
    source.set(2);
    expect(rendered).toEqual([0, 2]);
  } finally {
    stopUnrelated();
    stop();
    stopThrowing();
  }
});

it('watchSignal bridges the source synchronously into its local signal, and after a batch commits', () => {
  const source = createSignal(0);
  let stop = () => {};
  const local = watchSignal(source, cleanup => {
    stop = cleanup;
  });
  expect(local.value).toBe(0);
  source.set(5);
  expect(local.value).toBe(5);
  batch(() => {
    source.set(6);
    expect(local.value).toBe(5);
  });
  expect(local.value).toBe(6);
  stop();
});

it('setting an identical (===) value notifies nobody', async () => {
  const value = createSignal({ a: 1 }),
    same = value.value,
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
  expect(value.value).toBe(1);
  stop();
});

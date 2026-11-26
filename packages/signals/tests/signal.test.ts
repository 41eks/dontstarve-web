import { expect, it, vi } from 'vitest';
import {
  batch,
  watchSignal,
  createEffect,
  createRenderEffect,
  createMemo,
  createSignal,
  onCleanUp,
  readonlySignal,
} from '../src';

it('notifies synchronous subscribers of every transition while batching effects', async () => {
  const value = createSignal<number | null>(0);
  const state = readonlySignal(value);
  const transitions: unknown[] = [],
    rendered: unknown[] = [];
  const unsubscribe = state.subscribe((next, previous) => transitions.push([previous, next, state.peek()]));
  const dispose = createEffect(() => rendered.push(state.get()));
  value.set(1);
  value.set(null);
  value.set(2);
  value.set(2);
  expect(transitions).toEqual([
    [0, 1, 1],
    [1, null, null],
    [null, 2, 2],
  ]);
  expect(rendered).toEqual([0]);
  await Promise.resolve();
  expect(rendered).toEqual([0, 2]);
  expect('set' in state).toBe(false);
  unsubscribe();
  dispose();
  value.set(3);
  await Promise.resolve();
  expect(transitions).toHaveLength(3);
  expect(rendered).toEqual([0, 2]);
});

it('disposes queued effects and their cleanup callbacks', async () => {
  const value = createSignal(0);
  const observed: number[] = [];
  let cleanupCount = 0;
  const dispose = createEffect(() => {
    observed.push(value.get());
    onCleanUp(() => (cleanupCount += 1));
  });
  value.set(1);
  await Promise.resolve();
  value.set(2);
  dispose();
  dispose();
  value.set(3);
  await Promise.resolve();
  expect(observed).toEqual([0, 1]);
  expect(cleanupCount).toBe(2);
});

it('retracks conditional dependencies and leaves peek reads untracked', async () => {
  const useFirst = createSignal(true),
    first = createSignal(1),
    second = createSignal(10),
    fuel = createSignal(75);
  const value = createMemo(() => (useFirst.get() ? first.get() : second.get()));
  const observed: (number | undefined)[] = [];
  const dispose = createEffect(() => {
    fuel.peek();
    observed.push(value());
  });
  fuel.set(74);
  await Promise.resolve();
  expect(observed).toEqual([1]);
  useFirst.set(false);
  await Promise.resolve();
  first.set(2);
  await Promise.resolve();
  expect(observed).toEqual([1, 10]);
  second.set(11);
  await Promise.resolve();
  expect(observed).toEqual([1, 10, 11]);
  dispose();
  value.dispose();
});

it('keeps memo reads cached and current synchronously, and releases dependencies on dispose', () => {
  const input = createSignal(2);
  let calculations = 0;
  const derived = createMemo(() => {
    calculations++;
    return input.get() * 3;
  });
  const observed: number[] = [];
  const stop = derived.subscribe(value => observed.push(value));
  expect(derived()).toBe(6);
  expect(derived.peek()).toBe(6);
  expect(calculations).toBe(1);
  input.set(4);
  expect(derived.get()).toBe(12);
  expect(observed).toEqual([12]);
  expect(calculations).toBe(2);
  batch(() => {
    input.set(5);
    batch(() => input.set(6));
  });
  expect(derived()).toBe(18);
  expect(observed).toEqual([12, 18]);
  expect(calculations).toBe(3);
  derived.dispose();
  derived.dispose();
  input.set(7);
  expect(derived()).toBe(18);
  expect(calculations).toBe(3);
  expect(observed).toEqual([12, 18]);
  stop();
});

it('publishes batched transitions only after all inputs and derived values commit', () => {
  const first = createSignal(1),
    second = createSignal(2);
  const total = createMemo(() => first.get() + second.get());
  const observed: number[][] = [];
  first.subscribe((value, previous) => observed.push([value, previous, second.peek(), total.peek()]));
  const cancelled: number[] = [];
  const stop = second.subscribe(value => cancelled.push(value));
  batch(() => {
    first.set(3);
    batch(() => {
      second.set(4);
      first.set(5);
    });
    stop();
    expect(observed).toEqual([]);
  });
  expect(observed).toEqual([
    [3, 1, 4, 9],
    [5, 3, 4, 9],
  ]);
  expect(cancelled).toEqual([]);
  total.dispose();
});

it('retains the final memo snapshot when an entity is disposed inside a timer transaction', () => {
  const removed = createSignal(false);
  const phase = createMemo(() => (removed.get() ? 'removed' : 'active'));
  const appearance = createMemo(() => ({ phase: phase.get() }));
  batch(() => {
    removed.set(true);
    phase.dispose();
    appearance.dispose();
  });
  expect(phase.peek()).toBe('removed');
  expect(appearance.peek()).toEqual({ phase: 'removed' });
  removed.set(false);
  expect(appearance.peek()).toEqual({ phase: 'removed' });
});

it('returns normal writable signals with separate local subscribers and an independently owned source bridge', () => {
  const source = createSignal({ season: 'spring' });
  let reads = 0;
  const view = readonlySignal(source);
  const input: typeof view = {
    peek: () => view.peek(),
    subscribe: listener => view.subscribe(listener),
    get() {
      reads++;
      return view.get();
    },
  };
  const firstCleanups: (() => void)[] = [],
    secondCleanups: (() => void)[] = [];
  const first = watchSignal(input, stop => firstCleanups.push(stop));
  const second = watchSignal(input, stop => secondCleanups.push(stop));
  const observed: string[] = [],
    sourceObserved: string[] = [];
  first.subscribe(value => observed.push(value.season));
  const stopSource = source.subscribe(value => sourceObserved.push(value.season));
  expect(reads).toBe(2);
  expect(first.get()).toBe(source.peek());
  expect('set' in view).toBe(false);
  for (const method of ['get', 'peek', 'set', 'subscribe'] as const) {
    expect(typeof first[method]).toBe('function');
  }
  first.set({ season: 'winter' });
  expect(first.peek().season).toBe('winter');
  expect(source.peek().season).toBe('spring');
  expect(second.peek().season).toBe('spring');
  source.set({ season: 'summer' });
  expect(first.peek()).toBe(source.peek());
  expect(second.peek()).toBe(source.peek());
  batch(() => {
    source.set({ season: 'autumn' });
    source.set({ season: 'winter' });
  });
  expect(observed).toEqual(['winter', 'summer', 'winter']);
  // One registered cleanup cancels local listeners and retains the final source snapshot.
  batch(() => {
    source.set({ season: 'spring' });
    for (const stop of firstCleanups.splice(0).reverse()) {
      stop();
    }
  });
  expect(first.peek().season).toBe('spring');
  expect(observed).toEqual(['winter', 'summer', 'winter']);
  const before = reads;
  source.set({ season: 'summer' });
  expect(reads).toBe(before + 1);
  expect(first.get().season).toBe('spring');
  expect(second.get().season).toBe('summer');
  expect(sourceObserved.at(-1)).toBe('summer');
  // The returned object remains a standard signal after its source bridge is disconnected.
  first.set({ season: 'autumn' });
  expect(first.peek().season).toBe('autumn');
  expect(source.peek().season).toBe('summer');
  stopSource();
  for (const stop of secondCleanups.splice(0).reverse()) {
    stop();
  }
});

it('keeps ordinary class createEffect subscriptions on the new signal and releases all class subscriptions at disposal', async () => {
  const source = createSignal('spring'),
    other = createSignal(0);
  const observed: string[] = [];
  let constructions = 0,
    cleanupCount = 0;
  class Observer {
    readonly season;
    private readonly cleanups: (() => void)[] = [];
    constructor() {
      constructions++;
      this.season = watchSignal(source, stop => this.cleanups.push(stop));
      createEffect(() => {
        this.season.get();
        other.get();
        onCleanUp(() => cleanupCount++);
      });
      this.season.subscribe(value => observed.push(`subscriber:${value}`));
      createEffect(() => {
        observed.push(`${this.season.get()}:${other.get()}`);
        onCleanUp(() => cleanupCount++);
      });
    }
    dispose() {
      for (const stop of this.cleanups.splice(0).reverse()) {
        stop();
      }
    }
  }
  let owner: Observer | undefined;
  const stopParent = createEffect(() => {
    owner = new Observer();
    onCleanUp(() => owner!.dispose());
  });
  source.set('summer');
  await Promise.resolve();
  expect(observed).toEqual(['spring:0', 'subscriber:summer', 'summer:0']);
  expect(constructions).toBe(1);
  expect(cleanupCount).toBe(2);
  source.set('autumn');
  owner!.dispose();
  owner!.dispose();
  other.set(1);
  source.set('winter');
  await Promise.resolve();
  expect(observed).toEqual(['spring:0', 'subscriber:summer', 'summer:0', 'subscriber:autumn']);
  expect(constructions).toBe(1);
  expect(cleanupCount).toBe(4);
  expect(owner!.season.peek()).toBe('autumn');
  stopParent();
});

it('can cancel the source bridge during lifecycle registration without modifying the returned signal interface', () => {
  const source = createSignal(0);
  const local = watchSignal(source, stop => {
    stop();
    stop();
  });
  source.set(1);
  expect(local.get()).toBe(0);
  local.set(2);
  expect(local.peek()).toBe(2);
  expect(source.peek()).toBe(1);
});

it('retains ownership across conditional dependency changes and leaves other class instances connected', async () => {
  const source = createSignal(1),
    useLocal = createSignal(true),
    other = createSignal(0);
  let stopFirst!: () => void, stopSecond!: () => void;
  const first = watchSignal(source, stop => {
    stopFirst = stop;
  });
  const second = watchSignal(source, stop => {
    stopSecond = stop;
  });
  const observed: number[] = [],
    sibling: number[] = [];
  createEffect(() => observed.push(useLocal.get() ? first.get() : other.get()));
  createEffect(() => sibling.push(second.get()));
  useLocal.set(false);
  await Promise.resolve();
  expect(observed).toEqual([1, 0]);
  stopFirst();
  stopFirst();
  other.set(2);
  useLocal.set(true);
  source.set(3);
  await Promise.resolve();
  expect(observed).toEqual([1, 0]);
  expect(sibling).toEqual([1, 3]);
  stopSecond();
});

it('releases an effect owned by two watched signals with either, and forgets effects released before their scope', () => {
  const source = createSignal(1);
  const stops: (() => void)[] = [];
  const first = watchSignal(source, stop => stops.push(stop));
  const second = watchSignal(source, stop => stops.push(stop));
  const runs = { both: 0, early: 0, last: 0 };
  createRenderEffect(() => {
    first.get();
    second.get();
    first.get();
    runs.both++;
  });
  const stopEarly = createRenderEffect(() => {
    second.get();
    runs.early++;
  });
  createRenderEffect(() => {
    second.get();
    runs.last++;
  });
  // first is read twice: its scope adopts the effect once, though both links schedule a run.
  source.set(2);
  expect(runs).toEqual({ both: 4, early: 2, last: 2 });

  // Releasing the middle effect itself leaves the scope's other effects in place.
  stopEarly();
  stops[0]();
  source.set(3);
  expect(runs).toEqual({ both: 4, early: 2, last: 3 });
  stops[1]();
  source.set(4);
  expect(runs).toEqual({ both: 4, early: 2, last: 3 });
  expect(second.peek()).toBe(3);
});

it('releases every local observer even if an effect cleanup fails', async () => {
  const source = createSignal(0),
    other = createSignal(0);
  let dispose!: () => void,
    finished = 0;
  const local = watchSignal(source, stop => {
    dispose = stop;
  });
  createEffect(() => {
    local.get();
    onCleanUp(() => {
      throw new Error('cleanup failed');
    });
  });
  createEffect(() => {
    local.get();
    other.get();
    onCleanUp(() => finished++);
  });
  const observed: number[] = [];
  local.subscribe(value => observed.push(value));
  expect(() => dispose()).toThrow('cleanup failed');
  expect(finished).toBe(1);
  other.set(1);
  source.set(1);
  local.set(1);
  await Promise.resolve();
  expect(observed).toEqual([]);
  expect(finished).toBe(1);
});

it('gates a watched bridge: holds the last value without reading the source while inactive and resyncs on wake', async () => {
  const source = createSignal(1),
    active = createSignal(true);
  const reads = vi.fn();
  const stops: (() => void)[] = [];
  const local = watchSignal<number>(
    {
      peek: () => source.peek(),
      subscribe: listener => source.subscribe(listener),
      get: () => {
        reads();
        return source.get();
      },
    },
    stop => stops.push(stop),
    active,
  );
  const seen: number[] = [];
  createEffect(() => seen.push(local.get()));
  source.set(2);
  expect(local.peek()).toBe(2);

  active.set(false);
  reads.mockClear();
  source.set(3);
  source.set(4);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(reads).not.toHaveBeenCalled(); // no dependency on the source while inactive
  expect(local.peek()).toBe(2);

  active.set(true);
  expect(local.peek()).toBe(4);
  source.set(5);
  expect(local.peek()).toBe(5);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(seen).toEqual([1, 2, 5]); // the wake sync and the next update batch into one effect run

  stops.forEach(stop => stop());
  active.set(false);
  active.set(true);
  source.set(6);
  expect(local.peek()).toBe(5);
});

it('runs render effects synchronously on each change, once per committed batch, with cleanup on dispose', () => {
  const value = createSignal(0),
    other = createSignal(0);
  const observed: number[] = [];
  let cleanupCount = 0;
  const dispose = createRenderEffect(() => {
    observed.push(value.get() + other.get());
    onCleanUp(() => cleanupCount++);
  });
  value.set(1);
  expect(observed).toEqual([0, 1]);
  batch(() => {
    value.set(2);
    other.set(3);
    expect(observed).toEqual([0, 1]);
  });
  expect(observed).toEqual([0, 1, 5]);
  dispose();
  value.set(4);
  expect(observed).toEqual([0, 1, 5]);
  expect(cleanupCount).toBe(3);
});

it('keeps links consistent as single inline links grow into arrays and entries are removed out of order', () => {
  const a = createSignal(0);
  const b = createSignal(0);
  const runs = [0, 0, 0, 0];
  const track = (index: number, ...sources: { get(): number }[]) =>
    createRenderEffect(() => {
      for (const source of sources) {
        source.get();
      }
      runs[index]++;
    });
  // a has four subscribers; effect 2 reads two signals; b's second subscriber has a single inline dep.
  const disposers = [track(0, a), track(1, a), track(2, a, b), track(3, b)];
  a.set(1);
  b.set(1);
  expect(runs).toEqual([2, 2, 3, 2]);

  // Removing a's first entry moves its last entry (effect 2, array deps) into the gap.
  disposers[0]();
  a.set(2);
  b.set(2);
  expect(runs).toEqual([2, 3, 5, 3]);

  // Removing effect 2 moves effect 3 (inline dep) into b's first entry.
  disposers[2]();
  a.set(3);
  b.set(3);
  expect(runs).toEqual([2, 4, 5, 4]);
  disposers[1]();
  disposers[3]();
  a.set(4);
  b.set(4);
  expect(runs).toEqual([2, 4, 5, 4]);

  // Released signals link new effects again. A repeated read links twice (each link schedules a run), and disposing
  // releases both links.
  const dispose = track(0, a, a);
  a.set(5);
  expect(runs[0]).toBe(5);
  dispose();
  a.set(6);
  expect(runs[0]).toBe(5);
});

it('follows exactly the signals of the latest run as reruns keep, replace, reorder and drop dependencies', () => {
  const signals = { a: createSignal(0), b: createSignal(0), c: createSignal(0) };
  const plan = createSignal<(keyof typeof signals)[]>(['a', 'b']);
  let runs = 0;
  const dispose = createRenderEffect(() => {
    for (const key of plan.get()) {
      signals[key].get();
    }
    runs++;
  });
  const reruns = (key: keyof typeof signals) => {
    const before = runs;
    signals[key].set(signals[key].peek() + 1);
    return runs - before;
  };
  const follows = () => Object.fromEntries((['a', 'b', 'c'] as const).map(key => [key, reruns(key)]));
  expect(follows()).toEqual({ a: 1, b: 1, c: 0 });
  for (const [next, expected] of [
    [['a', 'c'], { a: 1, b: 0, c: 1 }],
    [['c', 'a', 'b'], { a: 1, b: 1, c: 1 }],
    [['c'], { a: 0, b: 0, c: 1 }],
    [[], { a: 0, b: 0, c: 0 }],
    [['b', 'a'], { a: 1, b: 1, c: 0 }],
  ] as const) {
    plan.set([...next]);
    expect(follows()).toEqual(expected);
  }
  dispose();
  plan.set(['a', 'b', 'c']);
  expect(follows()).toEqual({ a: 0, b: 0, c: 0 });
});

it('reruns an effect when a signal it newly read changes later in the same run', () => {
  const useB = createSignal(false);
  const a = createSignal(0);
  const b = createSignal(0);
  const trigger = createSignal(0);
  // A render effect that writes b whenever trigger changes.
  createRenderEffect(() => {
    if (trigger.get()) {
      b.set(trigger.peek());
    }
  });
  const seen: number[] = [];
  createRenderEffect(() => {
    const value = useB.get() ? b.get() : a.get();
    if (useB.peek() && value === 0) {
      // b was read for the first time this run; it changes before the run ends.
      trigger.set(1);
    }
    seen.push(value);
  });
  useB.set(true);
  expect(seen).toEqual([0, 1, 0]);
  expect(b.peek()).toBe(1);
});

it('delivers each change to the listeners and effects present when it happened, as earlier ones add and remove others', () => {
  const value = createSignal(0);
  const heard: string[] = [];
  let stopSecond: () => void = () => {};
  value.subscribe(next => {
    heard.push(`first:${next}`);
    stopSecond();
    value.subscribe(later => heard.push(`added:${later}`));
  });
  stopSecond = value.subscribe(next => heard.push(`second:${next}`));
  batch(() => {
    value.set(1);
    value.set(2);
  });
  // Both changes were queued for first and second; first removes second before either reaches it.
  expect(heard).toEqual(['first:1', 'first:2']);
  value.set(3);
  expect(heard.slice(2)).toEqual(['first:3', 'added:3', 'added:3']);

  // Render effects: the first to run disposes a later one, which then does not run for that change.
  const runs = { early: 0, late: 0, queued: 0 };
  let disposeLate: () => void = () => {};
  const source = createSignal(0);
  createRenderEffect(() => {
    if (source.get()) {
      disposeLate();
    }
    runs.early++;
  });
  createEffect(() => {
    source.get();
    runs.queued++;
  });
  disposeLate = createRenderEffect(() => {
    source.get();
    runs.late++;
  });
  source.set(1);
  expect(runs).toEqual({ early: 2, late: 1, queued: 1 });
});

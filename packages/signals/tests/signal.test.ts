import { expect, it } from 'vitest';
import { batch, watchSignal, createEffect, createMemo, createSignal, onCleanUp, readonlySignal } from '../src';

it('notifies synchronous subscribers of every transition while batching effects', async () => {
  const value = createSignal<number | null>(0);
  const state = readonlySignal(value);
  const transitions: unknown[] = [], rendered: unknown[] = [];
  const unsubscribe = state.subscribe((next, previous) => transitions.push([previous, next, state.peek()]));
  const dispose = createEffect(() => rendered.push(state.get()));
  value.set(1); value.set(null); value.set(2); value.set(2);
  expect(transitions).toEqual([[0, 1, 1], [1, null, null], [null, 2, 2]]);
  expect(rendered).toEqual([0]);
  await Promise.resolve();
  expect(rendered).toEqual([0, 2]);
  expect('set' in state).toBe(false);
  unsubscribe(); dispose();
  value.set(3); await Promise.resolve();
  expect(transitions).toHaveLength(3);
  expect(rendered).toEqual([0, 2]);
});

it('disposes queued effects and their cleanup callbacks', async () => {
  const value = createSignal(0);
  const observed: number[] = [];
  let cleanupCount = 0;
  const dispose = createEffect(() => {
    observed.push(value.get());
    onCleanUp(() => cleanupCount += 1);
  });
  value.set(1); await Promise.resolve();
  value.set(2); dispose(); dispose();
  value.set(3); await Promise.resolve();
  expect(observed).toEqual([0, 1]);
  expect(cleanupCount).toBe(2);
});

it('retracks conditional dependencies and leaves peek reads untracked', async () => {
  const useFirst = createSignal(true), first = createSignal(1), second = createSignal(10), fuel = createSignal(75);
  const value = createMemo(() => useFirst.get() ? first.get() : second.get());
  const observed: (number | undefined)[] = [];
  const dispose = createEffect(() => { fuel.peek(); observed.push(value()); });
  fuel.set(74); await Promise.resolve();
  expect(observed).toEqual([1]);
  useFirst.set(false); await Promise.resolve();
  first.set(2); await Promise.resolve();
  expect(observed).toEqual([1, 10]);
  second.set(11); await Promise.resolve();
  expect(observed).toEqual([1, 10, 11]);
  dispose();
  value.dispose();
});

it('keeps memo reads cached and current synchronously, and releases dependencies on dispose', () => {
  const input = createSignal(2);
  let calculations = 0;
  const derived = createMemo(() => { calculations++; return input.get() * 3; });
  const observed: number[] = [];
  const stop = derived.subscribe(value => observed.push(value));
  expect(derived()).toBe(6);
  expect(derived.peek()).toBe(6);
  expect(calculations).toBe(1);
  input.set(4);
  expect(derived.get()).toBe(12);
  expect(observed).toEqual([12]);
  expect(calculations).toBe(2);
  batch(() => { input.set(5); batch(() => input.set(6)); });
  expect(derived()).toBe(18);
  expect(observed).toEqual([12, 18]);
  expect(calculations).toBe(3);
  derived.dispose(); derived.dispose();
  input.set(7);
  expect(derived()).toBe(18);
  expect(calculations).toBe(3);
  expect(observed).toEqual([12, 18]);
  stop();
});

it('publishes batched transitions only after all inputs and derived values commit', () => {
  const first = createSignal(1), second = createSignal(2);
  const total = createMemo(() => first.get() + second.get());
  const observed: number[][] = [];
  first.subscribe((value, previous) => observed.push([value, previous, second.peek(), total.peek()]));
  const cancelled: number[] = [];
  const stop = second.subscribe(value => cancelled.push(value));
  batch(() => {
    first.set(3);
    batch(() => { second.set(4); first.set(5); });
    stop();
    expect(observed).toEqual([]);
  });
  expect(observed).toEqual([[3, 1, 4, 9], [5, 3, 4, 9]]);
  expect(cancelled).toEqual([]);
  total.dispose();
});

it('retains the final memo snapshot when an entity is disposed inside a timer transaction', () => {
  const removed = createSignal(false);
  const phase = createMemo(() => removed.get() ? 'removed' : 'active');
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
  const input = { ...readonlySignal(source), get() { reads++; return source.get(); } };
  const firstCleanups: (() => void)[] = [], secondCleanups: (() => void)[] = [];
  const first = watchSignal(input, stop => firstCleanups.push(stop));
  const second = watchSignal(input, stop => secondCleanups.push(stop));
  const observed: string[] = [], sourceObserved: string[] = [];
  first.subscribe(value => observed.push(value.season));
  const stopSource = source.subscribe(value => sourceObserved.push(value.season));
  expect(reads).toBe(2); expect(first.get()).toBe(source.peek());
  expect(Object.keys(first).sort()).toEqual(['get', 'peek', 'set', 'subscribe']);
  first.set({ season: 'winter' });
  expect(first.peek().season).toBe('winter');
  expect(source.peek().season).toBe('spring'); expect(second.peek().season).toBe('spring');
  source.set({ season: 'summer' });
  expect(first.peek()).toBe(source.peek()); expect(second.peek()).toBe(source.peek());
  batch(() => { source.set({ season: 'autumn' }); source.set({ season: 'winter' }); });
  expect(observed).toEqual(['winter', 'summer', 'winter']);
  // One registered cleanup cancels local listeners and retains the final source snapshot.
  batch(() => {
    source.set({ season: 'spring' });
    for (const stop of firstCleanups.splice(0).reverse()) stop();
  });
  expect(first.peek().season).toBe('spring'); expect(observed).toEqual(['winter', 'summer', 'winter']);
  const before = reads;
  source.set({ season: 'summer' });
  expect(reads).toBe(before + 1);
  expect(first.get().season).toBe('spring'); expect(second.get().season).toBe('summer');
  expect(sourceObserved.at(-1)).toBe('summer');
  // The returned object remains a standard signal after its source bridge is disconnected.
  first.set({ season: 'autumn' }); expect(first.peek().season).toBe('autumn');
  expect(source.peek().season).toBe('summer');
  stopSource(); for (const stop of secondCleanups.splice(0).reverse()) stop();
});

it('keeps ordinary class createEffect subscriptions on the new signal and releases all class subscriptions at disposal', async () => {
  const source = createSignal('spring'), other = createSignal(0);
  const observed: string[] = [];
  let constructions = 0, cleanupCount = 0;
  class Observer {
    readonly season;
    private readonly cleanups: (() => void)[] = [];
    constructor() {
      constructions++;
      this.season = watchSignal(source, stop => this.cleanups.push(stop));
      createEffect(() => { this.season.get(); other.get(); onCleanUp(() => cleanupCount++); });
      this.season.subscribe(value => observed.push(`subscriber:${value}`));
      createEffect(() => {
        observed.push(`${this.season.get()}:${other.get()}`);
        onCleanUp(() => cleanupCount++);
      });
    }
    dispose() { for (const stop of this.cleanups.splice(0).reverse()) stop(); }
  }
  let owner: Observer | undefined;
  const stopParent = createEffect(() => { owner = new Observer(); onCleanUp(() => owner!.dispose()); });
  source.set('summer'); await Promise.resolve();
  expect(observed).toEqual(['spring:0', 'subscriber:summer', 'summer:0']); expect(constructions).toBe(1);
  expect(cleanupCount).toBe(2);
  source.set('autumn'); owner!.dispose(); owner!.dispose();
  other.set(1); source.set('winter'); await Promise.resolve();
  expect(observed).toEqual(['spring:0', 'subscriber:summer', 'summer:0', 'subscriber:autumn']); expect(constructions).toBe(1);
  expect(cleanupCount).toBe(4); expect(owner!.season.peek()).toBe('autumn');
  stopParent();
});

it('can cancel the source bridge during lifecycle registration without modifying the returned signal interface', () => {
  const source = createSignal(0);
  const local = watchSignal(source, stop => { stop(); stop(); });
  source.set(1); expect(local.get()).toBe(0);
  local.set(2); expect(local.peek()).toBe(2); expect(source.peek()).toBe(1);
});

it('retains ownership across conditional dependency changes and leaves other class instances connected', async () => {
  const source = createSignal(1), useLocal = createSignal(true), other = createSignal(0);
  let stopFirst!: () => void, stopSecond!: () => void;
  const first = watchSignal(source, stop => { stopFirst = stop; });
  const second = watchSignal(source, stop => { stopSecond = stop; });
  const observed: number[] = [], sibling: number[] = [];
  createEffect(() => observed.push(useLocal.get() ? first.get() : other.get()));
  createEffect(() => sibling.push(second.get()));
  useLocal.set(false); await Promise.resolve();
  expect(observed).toEqual([1, 0]);
  stopFirst(); stopFirst(); other.set(2); useLocal.set(true); source.set(3);
  await Promise.resolve();
  expect(observed).toEqual([1, 0]); expect(sibling).toEqual([1, 3]);
  stopSecond();
});

it('releases every local observer even if an effect cleanup fails', async () => {
  const source = createSignal(0), other = createSignal(0);
  let dispose!: () => void, finished = 0;
  const local = watchSignal(source, stop => { dispose = stop; });
  createEffect(() => { local.get(); onCleanUp(() => { throw new Error('cleanup failed'); }); });
  createEffect(() => { local.get(); other.get(); onCleanUp(() => finished++); });
  const observed: number[] = [];
  local.subscribe(value => observed.push(value));
  expect(() => dispose()).toThrow('cleanup failed');
  expect(finished).toBe(1);
  other.set(1); source.set(1); local.set(1); await Promise.resolve();
  expect(observed).toEqual([]); expect(finished).toBe(1);
});

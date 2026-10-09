import { expect, it } from 'vitest';
import { batch, createEffect, createMemo, createSignal, onCleanUp, readonlySignal } from '../src';

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

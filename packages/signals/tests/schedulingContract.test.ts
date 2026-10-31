import { expect, it } from 'vitest';
import { batch, createEffect, createMemo, createRenderEffect, createSignal, watchSignal } from '../src';

// Pins the scheduling table in packages/signals/AGENTS.md ("Effect scheduling"). Change both together.

const microtask = () => Promise.resolve();

it('createEffect runs once synchronously, then reruns in one coalesced microtask per change burst', async () => {
  const value = createSignal(0), runs: number[] = [];
  const stop = createEffect(() => runs.push(value.get()));
  expect(runs).toEqual([0]);
  value.set(1); value.set(2); value.set(3);
  expect(runs).toEqual([0]);
  await microtask();
  expect(runs).toEqual([0, 3]);
  stop();
});

it('createEffect inside batch() is still deferred to the microtask, not to the batch commit', async () => {
  const value = createSignal(0), runs: number[] = [];
  const stop = createEffect(() => runs.push(value.get()));
  batch(() => { value.set(1); });
  expect(runs).toEqual([0]);
  await microtask();
  expect(runs).toEqual([0, 1]);
  stop();
});

it('createEffect chains settle within the same microtask drain', async () => {
  const source = createSignal(0), relay = createSignal(0), seen: number[] = [];
  const stopRelay = createEffect(() => relay.set(source.get() * 10));
  const stopSeen = createEffect(() => seen.push(relay.get()));
  source.set(1);
  await microtask();
  expect(seen).toEqual([0, 10]);
  stopRelay(); stopSeen();
});

it('disposing a createEffect cancels its queued rerun', async () => {
  const value = createSignal(0), runs: number[] = [];
  const stop = createEffect(() => runs.push(value.get()));
  value.set(1); stop();
  await microtask();
  expect(runs).toEqual([0]);
});

it('createRenderEffect reruns synchronously on each change, and once after a batch commits', () => {
  const value = createSignal(0), runs: number[] = [];
  const stop = createRenderEffect(() => runs.push(value.get()));
  value.set(1); value.set(2);
  expect(runs).toEqual([0, 1, 2]);
  batch(() => { value.set(3); value.set(4); expect(runs).toEqual([0, 1, 2]); });
  expect(runs).toEqual([0, 1, 2, 4]);
  stop();
});

it('createMemo is current synchronously, and inside a batch reads its pre-batch value until commit', () => {
  const value = createSignal(1);
  const doubled = createMemo(() => value.get() * 2);
  value.set(2);
  expect(doubled.get()).toBe(4);
  batch(() => { value.set(3); expect(doubled.get()).toBe(4); });
  expect(doubled.get()).toBe(6);
  doubled.dispose();
});

it('subscribe is synchronous per change, is not called on subscribe, and is deferred to the batch commit', () => {
  const value = createSignal(0), seen: [number, number][] = [];
  const stop = value.subscribe((next, previous) => seen.push([previous, next]));
  expect(seen).toEqual([]);
  value.set(1);
  expect(seen).toEqual([[0, 1]]);
  batch(() => { value.set(2); value.set(3); expect(seen).toEqual([[0, 1]]); });
  expect(seen).toEqual([[0, 1], [1, 2], [2, 3]]);
  stop();
});

it('watchSignal bridges the source synchronously into its local signal, and after a batch commits', () => {
  const source = createSignal(0);
  let stop = () => {};
  const local = watchSignal(source, cleanup => { stop = cleanup; });
  expect(local.peek()).toBe(0);
  source.set(5);
  expect(local.peek()).toBe(5);
  batch(() => { source.set(6); expect(local.peek()).toBe(5); });
  expect(local.peek()).toBe(6);
  stop();
});

it('setting an identical (===) value notifies nobody', async () => {
  const value = createSignal({ a: 1 }), same = value.peek(), events: string[] = [];
  const stopEffect = createEffect(() => { value.get(); events.push('effect'); });
  const stopRender = createRenderEffect(() => { value.get(); events.push('render'); });
  const stopListen = value.subscribe(() => events.push('subscribe'));
  events.length = 0;
  value.set(same);
  await microtask();
  expect(events).toEqual([]);
  value.set({ a: 1 });
  await microtask();
  expect(events.sort()).toEqual(['effect', 'render', 'subscribe']);
  stopEffect(); stopRender(); stopListen();
});

it('an effect writing a signal it reads does not retrigger itself', async () => {
  const value = createSignal(0);
  let runs = 0;
  const stop = createEffect(() => { runs++; value.set(value.get() + 1); });
  await microtask(); await microtask();
  expect(runs).toBe(1);
  expect(value.peek()).toBe(1);
  stop();
});

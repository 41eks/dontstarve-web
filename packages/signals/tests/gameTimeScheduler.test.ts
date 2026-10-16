import { describe, expect, it, vi } from 'vitest';
import { GameTimeScheduler } from '../src/gameTimeScheduler';

describe('game-time task queue', () => {
  it('catches up at each deadline, preserving FIFO order and callback scheduling/cancellation', () => {
    const scheduler = new GameTimeScheduler(100);
    const observed: [string, number][] = [];
    const record = (name: string) => observed.push([name, scheduler.now]);
    scheduler.schedule(2, () => {
      record('first');
      cancel();
      scheduler.schedule(0, () => record('added at same deadline'));
      scheduler.schedule(1, () => record('added later'));
    });
    const cancel = scheduler.schedule(2, () => record('cancelled'));
    scheduler.schedule(2, () => record('second'));
    scheduler.schedule(1, () => record('early'));
    scheduler.advance(0);
    expect(observed).toEqual([]);
    scheduler.advanceTo(110);
    expect(observed).toEqual([
      ['early', 101], ['first', 102], ['second', 102], ['added at same deadline', 102], ['added later', 103],
    ]);
    expect(scheduler.now).toBe(110);
    cancel();
  });

  it('handles a large mixed queue with arbitrary cancellation and reinsertion', () => {
    const scheduler = new GameTimeScheduler();
    const expected: { id: number; at: number; order: number; cancelled: boolean }[] = [];
    const observed: number[] = [], stops: (() => void)[] = [];
    const add = (id: number, delay: number) => {
      expected.push({ id, at: scheduler.now + delay, order: expected.length, cancelled: false });
      stops.push(scheduler.schedule(delay, () => observed.push(id)));
    };
    for (let i = 0; i < 10_001; i++) add(i, (Math.imul(i + 1, 2654435761) >>> 0) % 1000);
    for (let i = 0; i < 10_001; i += 3) {
      stops[i](); stops[i](); expected[i].cancelled = true;
    }
    scheduler.advanceTo(500);
    // Old handles for already-fired tasks must not cancel replacements at recycled heap indices.
    for (let i = 0; i < 10_001; i++) {
      if (expected[i].at <= 500) stops[i]();
      else if (i % 7 === 0) { stops[i](); expected[i].cancelled = true; }
    }
    for (let i = 10_001; i < 11_000; i++) add(i, i % 500);
    scheduler.advanceTo(1000);
    expect(observed).toEqual(expected.filter(task => !task.cancelled)
      .sort((a, b) => a.at - b.at || a.order - b.order).map(task => task.id));
  });

  it('stops on disposal inside a callback and leaves cancellation handles safe', () => {
    const scheduler = new GameTimeScheduler(), run = vi.fn();
    scheduler.schedule(1, () => scheduler.dispose());
    const cancel = scheduler.schedule(1, run);
    scheduler.advanceTo(2);
    expect(run).not.toHaveBeenCalled();
    expect(scheduler.now).toBe(2);
    cancel(); cancel(); scheduler.dispose(); scheduler.advanceTo(3);
    expect(() => scheduler.schedule(0, run)).toThrow('disposed');
  });

  it('retains future tasks when a callback throws, without replaying the failed task', () => {
    const scheduler = new GameTimeScheduler(), run = vi.fn();
    const cancel = scheduler.schedule(1, () => { throw new Error('task failed'); });
    scheduler.schedule(2, run);
    expect(() => scheduler.advanceTo(3)).toThrow('task failed');
    expect(scheduler.now).toBe(1);
    cancel(); scheduler.advanceTo(3);
    expect(run).toHaveBeenCalledOnce();
    expect(scheduler.now).toBe(3);
  });
});

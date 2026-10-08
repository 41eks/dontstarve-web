import { expect, it, vi } from 'vitest';
import { createSanityState } from '../src';

it('publishes sanity points and derived ratios synchronously, clamping the supported range', () => {
  const sanity = createSanityState(35, 200);
  const points = vi.fn(), percent = vi.fn();
  const stopPoints = sanity.subscribe(points), stopPercent = sanity.percent.subscribe(percent);
  try {
    expect(sanity.peek()).toBe(35);
    expect(sanity.percent.peek()).toBe(0.175);
    expect(percent).not.toHaveBeenCalled();
    sanity.set(100);
    expect(points).toHaveBeenCalledExactlyOnceWith(100, 35);
    expect(percent).toHaveBeenCalledExactlyOnceWith(0.5, 0.175);
    sanity.set(250);
    expect(sanity.peek()).toBe(200);
    expect(sanity.percent.get()).toBe(1);
    sanity.set(201);
    expect(percent).toHaveBeenCalledTimes(2);
    sanity.set(-1);
    expect(sanity.peek()).toBe(0);
    expect(percent).toHaveBeenLastCalledWith(0, 1);
    stopPercent();
    sanity.set(35);
    expect(percent).toHaveBeenCalledTimes(3);
  } finally { stopPoints(); stopPercent(); }
});

it('rejects nonfinite values without changing state and keeps separate characters independent', () => {
  const sanity = createSanityState(35, 200), other = createSanityState(50, 100);
  const changes = vi.fn(), stop = sanity.subscribe(changes);
  try {
    expect(() => sanity.set(NaN)).toThrow('Sanity must be finite');
    expect(() => createSanityState(Infinity, 200)).toThrow('Sanity must be finite');
    expect(() => createSanityState(35, 0)).toThrow('Maximum sanity');
    expect(sanity.peek()).toBe(35);
    expect(changes).not.toHaveBeenCalled();
    other.set(100);
    expect(other.percent.peek()).toBe(1);
    expect(sanity.percent.peek()).toBe(0.175);
  } finally { stop(); }
});

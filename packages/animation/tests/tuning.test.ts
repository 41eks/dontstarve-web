import { describe, expect, it } from 'vitest';
import { getDstCycle } from '../../../src/tuning';

describe('DST default day cycle', () => {

  it.each([
    [0, 0, 'day', 0],
    [150, 0, 'day', 0.5],
    [300, 0, 'dusk', 0],
    [360, 0, 'dusk', 0.5],
    [420, 0, 'night', 0],
    [450, 0, 'night', 0.5],
    [480, 1, 'day', 0],
    [900, 1, 'night', 0],
  ])('at %s seconds reports cycles=%s, phase=%s', (seconds, cycles, phase, progress) => {
    expect(getDstCycle(Number(seconds))).toEqual({ cycles, phase, phaseProgress: progress });
  });

  it('stays in the old phase until each boundary', () => {
    expect(getDstCycle(299.999).phase).toBe('day');
    expect(getDstCycle(419.999).phase).toBe('dusk');
    expect(getDstCycle(479.999)).toMatchObject({ cycles: 0, phase: 'night' });
  });

  it('continues from saved elapsed time and can cross multiple days in one update', () => {
    const savedElapsed = 7 * 480 + 419.5;
    expect(getDstCycle(savedElapsed)).toMatchObject({ cycles: 7, phase: 'dusk' });
    expect(getDstCycle(savedElapsed + 0.5)).toMatchObject({ cycles: 7, phase: 'night' });
    expect(getDstCycle(savedElapsed + 3 * 480 + 60.5)).toEqual({ cycles: 11, phase: 'day', phaseProgress: 0 });
  });
});

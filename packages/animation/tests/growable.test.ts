import { expect, it, vi } from 'vitest';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Growable } from '../../componets/src/growable';

function setup() {
  const scheduler = new GameTimeScheduler();
  const fn = [vi.fn(), vi.fn(), vi.fn()], growfn = [vi.fn(), vi.fn(), vi.fn()];
  const component = new Growable(scheduler, [10, 20, 30].map((time, i) => ({ time: () => time, fn: fn[i], growfn: growfn[i] })));
  component.loopstages = true; component.StartGrowing();
  return { scheduler, component, fn, growfn };
}

it('keeps discrete deadlines stable, catches up complete stages, loops, and distinguishes stop from expiry', () => {
  const s = setup(), snapshot = s.component.state.timer.peek();
  try {
    s.scheduler.advance(4);
    expect(s.component.state.timer.peek()).toBe(snapshot);
    expect(s.component.OnSave()).toEqual({ stage: 1, time: 6 });
    s.scheduler.advance(56);
    expect(s.component.GetStage()).toBe(1);
    expect(s.component.state.timer.peek()).toEqual({ status: 'scheduled', endTime: 70 });
    expect(s.growfn.map(fn => fn.mock.calls.length)).toEqual([1, 1, 1]);
    s.component.StopGrowing(); s.scheduler.advance(100);
    expect(s.component.state.timer.peek()).toEqual({ status: 'stopped' });
    expect(s.component.DoGrowth()).toBe(false);
  } finally { s.component.dispose(); }
});

it('preserves sleeping stages through saves, catches up on wake, and keeps explicitly paused growth suspended', () => {
  const s = setup(), restored = setup();
  try {
    s.component.OnEntitySleep(); s.scheduler.advance(35);
    expect(s.component.GetStage()).toBe(1);
    const saved = s.component.OnSave();
    expect(saved).toEqual({ stage: 1, time: 0, sleeptime: 35 });
    restored.component.OnLoad(saved); restored.component.OnEntityWake();
    expect(restored.component.GetStage()).toBe(3);
    expect(restored.component.OnSave()).toEqual({ stage: 3, time: 15 });
    expect(restored.growfn.map(fn => fn.mock.calls.length)).toEqual([0, 0, 1]);
    restored.component.Pause('wax'); restored.scheduler.advance(100);
    expect(restored.component.GetStage()).toBe(3);
    restored.component.Resume('wax'); restored.scheduler.advance(15);
    expect(restored.component.GetStage()).toBe(1);
    restored.component.dispose(); restored.scheduler.advance(100);
    expect(restored.component.state.timer.peek()).toEqual({ status: 'stopped' });
  } finally { s.component.dispose(); restored.component.dispose(); }
});

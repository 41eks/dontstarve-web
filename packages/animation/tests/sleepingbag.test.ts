import { expect, it, vi } from 'vitest';
import { FiniteUses } from '../../componets/src/finiteuses';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { SleepingBag } from '../../componets/src/sleepingbag';
import { SleepingBagUser } from '../../componets/src/sleepingbaguser';
import { createSignal, type WorldPhase } from '../../signals/src';

function setup(hunger = 100) {
  const scheduler = new GameTimeScheduler(), phase = createSignal<WorldPhase>('night');
  const stats = { hunger, sanity: 50, health: 50 };
  const tags = new Set<string>();
  const goToWakeup = vi.fn();
  const user = new SleepingBagUser({
    scheduler, phase,
    hunger: { doDelta: delta => { stats.hunger = Math.max(0, stats.hunger + delta); }, isStarving: () => stats.hunger <= 0 },
    sanity: { doDelta: delta => { stats.sanity += delta; }, getPercentWithPenalty: () => stats.sanity / 200 },
    health: { doDelta: delta => { stats.health += delta; } },
    goToWakeup,
  });
  const bag = new SleepingBag({ addTag: tag => tags.add(tag), removeTag: tag => tags.delete(tag) });
  bag.health_tick = 2;
  return { scheduler, phase, stats, tags, goToWakeup, user, bag };
}

it('sleeps through once-per-second ticks and wakes when the phase leaves the bed phase, calling onwake once', () => {
  const { scheduler, phase, stats, tags, goToWakeup, user, bag } = setup();
  const onwake = vi.fn();
  bag.onwake = onwake;
  bag.DoSleep(user);
  expect([tags.has('hassleeper'), bag.InUse(), user.bed === bag]).toEqual([true, true, true]);
  // A second sleeper is refused while the bed is in use.
  const other = setup().user;
  bag.DoSleep(other);
  expect(other.bed).toBeUndefined();

  scheduler.advance(3);
  expect(stats).toEqual({ hunger: 97, sanity: 53, health: 56 });
  // Sleeping through dusk -> night is allowed; night -> day wakes the sleeper.
  phase.set('night');
  expect(onwake).not.toHaveBeenCalled();
  phase.set('day');
  expect(onwake).toHaveBeenCalledOnce();
  expect(goToWakeup).toHaveBeenCalledExactlyOnceWith({ goodsleep: false });
  expect([tags.has('hassleeper'), bag.InUse(), user.bed]).toEqual([false, false, undefined]);
  scheduler.advance(10);
  expect(stats.hunger).toBe(97);
});

it('wakes a starving sleeper, skips the wakeup state when interrupted, and wakes the sleeper when the bed is removed', () => {
  const starving = setup(2);
  starving.bag.DoSleep(starving.user);
  starving.scheduler.advance(2);
  // Hunger reached zero on the second tick: that tick still skips healing, then the sleeper is woken.
  expect(starving.stats).toMatchObject({ hunger: 0, health: 52 });
  expect(starving.bag.InUse()).toBe(false);
  expect(starving.goToWakeup).toHaveBeenCalledOnce();

  const interrupted = setup();
  interrupted.bag.DoSleep(interrupted.user);
  interrupted.bag.DoWakeUp(true);
  expect(interrupted.goToWakeup).not.toHaveBeenCalled();
  expect(interrupted.bag.InUse()).toBe(false);

  const removed = setup();
  removed.bag.DoSleep(removed.user);
  removed.bag.dispose();
  expect(removed.goToWakeup).toHaveBeenCalledOnce();
  expect(removed.tags.has('hassleeper')).toBe(false);
});

it('finiteuses reports percent changes, finishes once at zero and validates saved uses', () => {
  const events: unknown[] = [];
  const inst = { isRemoved: false, PushEvent: (name: string, data: unknown) => events.push([name, data]) };
  const uses = new FiniteUses(inst);
  const onfinished = vi.fn();
  uses.SetMaxUses(3);
  uses.SetUses(3);
  uses.SetOnFinished(onfinished);
  uses.Use();
  expect(uses.percent.peek()).toBeCloseTo(2 / 3);
  expect(onfinished).not.toHaveBeenCalled();
  uses.OnLoad({ uses: 1 });
  expect(uses.OnSave()).toEqual({ uses: 1 });
  expect(() => uses.OnLoad({ uses: 4 })).toThrow(RangeError);
  expect(uses.GetUses()).toBe(1);
  uses.Use();
  expect(onfinished).toHaveBeenCalledOnce();
  expect(uses.GetUses()).toBe(0);
  expect(events.at(-1)).toEqual(['percentusedchange', { percent: 0 }]);
  uses.dispose();
});

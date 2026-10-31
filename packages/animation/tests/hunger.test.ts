import { expect, it, vi } from 'vitest';
import { createSignal } from '@dontstarve-web/signals';
import { Hunger } from '../../componets/src/hunger';
import { Health } from '../../componets/src/health';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';

it('settles once per game second, starts starvation before damage, and stops starvation after eating', () => {
  const scheduler = new GameTimeScheduler(), health = new Health(150), events = vi.fn();
  const hunger = new Hunger({ components: { health }, PushEvent: events }, 150, scheduler);
  hunger.SetRate(2); hunger.SetKillRate(1.25); hunger.SetCurrent(1);
  try {
    scheduler.advance(.99);
    expect(hunger.current).toBe(1);
    scheduler.advance(.01);
    expect(hunger.IsStarving()).toBe(true);
    expect(health.currenthealth).toBe(150);
    scheduler.advance(2);
    expect(health.currenthealth).toBe(147.5);
    expect(events.mock.calls.filter(([name]) => name === 'startstarving')).toHaveLength(1);
    hunger.DoDelta(12.5);
    expect(events).toHaveBeenLastCalledWith('stopstarving');
    hunger.Pause(); scheduler.advance(100);
    expect(hunger.current).toBe(12.5);
    hunger.Resume(); scheduler.advance(1);
    expect(hunger.current).toBe(10.5);
    hunger.dispose(); scheduler.advance(100);
    expect(hunger.current).toBe(10.5);
    expect(hunger.timerState!.peek()).toEqual({ status: 'stopped' });
  } finally { hunger.dispose(); health.dispose(); scheduler.dispose(); }
});

it('honours invincibility, keyed burn modifiers and source removal, while long updates avoid starvation damage', async () => {
  const scheduler = new GameTimeScheduler(), health = new Health(150), removal = createSignal(false);
  const source = { removal };
  const hunger = new Hunger({ components: { health } }, 150, scheduler);
  hunger.SetRate(2);
  hunger.burnratemodifiers.SetModifier(source, 2, 'one');
  hunger.burnratemodifiers.SetModifier(source, 3, 'two');
  try {
    scheduler.advance(1); expect(hunger.current).toBe(138);
    removal.set(true); await new Promise(resolve => setTimeout(resolve, 0));
    scheduler.advance(1); expect(hunger.current).toBe(136);
    health.SetInvincible(true);
    scheduler.advance(5); expect(hunger.current).toBe(136);
    hunger.DoDelta(-1, true, true); expect(hunger.current).toBe(135);
    health.SetInvincible(false);
    hunger.LongUpdate(1000);
    expect(hunger.current).toBe(0); expect(health.currenthealth).toBe(150);
    const restored = new Hunger({ components: { health } }, 150);
    restored.OnLoad(JSON.parse(JSON.stringify(hunger.OnSave())));
    expect(restored.IsStarving()).toBe(true);
    restored.SetCurrent(200); expect(restored.OnSave()).toBeUndefined();
    restored.dispose();
  } finally { hunger.dispose(); health.dispose(); scheduler.dispose(); }
});

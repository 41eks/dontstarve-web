import { expect, it, vi } from 'vitest';
import { createSignal } from '../../signals/src';
import { Eater, type EaterFood } from '../src/eater';
import { Edible } from '../src/edible';
import { GameTimeScheduler } from '../src/gameTimeScheduler';
import { Hauntable } from '../src/hauntable';
import { SleepingBagUser } from '../src/sleepingbaguser';
import { Workable } from '../src/workable';
import { testItem } from '../../../tests/fixtures/testInventory';

const tagged = () => {
  const tags = new Set<string>();
  return {
    tags,
    addTag: (tag: string) => {
      tags.add(tag);
    },
    removeTag: (tag: string) => {
      tags.delete(tag);
    },
    PushEvent: vi.fn(),
  };
};

it('passes callbacks the inst first and the rest of the Lua arguments in source order', () => {
  // eater.lua oneatfn(inst, food, feeder), after the `oneat` event.
  const eaterInst = { ...tagged(), components: {} };
  const eater = new Eater(eaterInst),
    oneat = vi.fn();
  eater.SetOnEatFn(oneat);
  const food: EaterFood = {
    prefab: 'berries',
    components: { edible: new Edible(undefined) },
    hasTag: tag => tag === 'edible_VEGGIE',
  };
  const feeder = {};
  eater.Eat(food, feeder);
  expect(oneat).toHaveBeenCalledExactlyOnceWith(eaterInst, food, feeder);
  expect(eaterInst.PushEvent).toHaveBeenCalledBefore(oneat);

  // workable.lua onloadfn(inst, data).
  const entity = testItem({ itemId: 'test_workable', count: 1 });
  const work = entity.component('workable', () => new Workable(entity)),
    onload = vi.fn();
  work.SetOnLoadFn(onload);
  work.OnLoad({ workleft: 1 });
  expect(onload).toHaveBeenCalledExactlyOnceWith(entity, { workleft: 1 });

  // sleepingbaguser.lua cansleepfn(inst).
  const sleeperInst = {},
    cansleep = vi.fn(() => [false, 'TIRED'] as const);
  const sleeper = new SleepingBagUser(sleeperInst, {
    scheduler: new GameTimeScheduler(),
    phase: createSignal<'day' | 'dusk' | 'night'>('night'),
    goToWakeup: () => {},
  });
  sleeper.SetCanSleepFn(cansleep);
  expect(sleeper.ShouldSleep()).toEqual([false, 'TIRED']);
  expect(cansleep).toHaveBeenCalledExactlyOnceWith(sleeperInst);
});

it('treats a cleared hauntable onhaunt as Lua nil: only the haunted event fires', () => {
  const inst = tagged(),
    hauntable = new Hauntable(inst, new GameTimeScheduler());
  const doer = { hasTag: () => false, PushEvent: vi.fn() };
  hauntable.SetOnHauntFn(undefined);
  hauntable.DoHaunt(doer);
  expect(hauntable.IsHaunted()).toBe(false);
  expect(inst.tags.has('haunted')).toBe(false);
  expect(inst.PushEvent).toHaveBeenCalledExactlyOnceWith('haunted');

  // The default DefaultOnHauntFn still haunts.
  const defaulted = tagged();
  new Hauntable(defaulted, new GameTimeScheduler()).DoHaunt(doer);
  expect(defaulted.tags.has('haunted')).toBe(true);
});

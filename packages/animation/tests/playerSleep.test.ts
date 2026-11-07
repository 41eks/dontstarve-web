import { advancePlayer } from './playerVisual';
import { readFile } from 'node:fs/promises';
import { World } from 'cannon-es';
import { afterEach, expect, it, vi } from 'vitest';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { SleepingBag } from '../../componets/src/sleepingbag';
import { clockstate } from '../../signals/src';
import { BufferedAction } from '../../stategraphs/src';
import { createWilsonPlayerPrefab } from './playerVisual';

afterEach(() => { clockstate.set({ phase: 'day', timeinphase: 0 }); });

it('runs SGwilson tent through the player prefab: refusal, sleeping in a bag, waking and despawning in bed', async () => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const scheduler = new GameTimeScheduler();
  const { model, instance } = await createWilsonPlayerPrefab('/dst/data/anim', new World(), { scheduler });
  const animation = instance.animationController;
  const controls = { HideCraftingAndInventory: vi.fn(), ShowCraftingAndInventory: vi.fn() };
  instance.HUD = { Show() {}, Hide() {}, controls };
  const say = vi.spyOn(console, 'info').mockImplementation(() => {});
  const sleeper = instance.components.sleepingbaguser!;
  const tags = new Set(['tent']);
  const tent = { hasTag: (tag: string) => tags.has(tag), addTag: (tag: string) => { tags.add(tag); },
    removeTag: (tag: string) => { tags.delete(tag); }, components: {} as { sleepingbag?: SleepingBag } };
  const bag = tent.components.sleepingbag = new SleepingBag(tent);
  const frames = (count: number) => { for (let i = 0; i < count; i++) advancePlayer(animation, 1 / 30); };
  const sleepIn = () => {
    // ACTIONS.SLEEPIN.fn: sleepingbag:DoSleep(act.doer) reaches the player's sleepingbaguser.
    const action = new BufferedAction('SLEEPIN', () => { bag.DoSleep(sleeper); return true; }, () => true, { target: tent });
    expect(animation.stategraph.pushBufferedAction(action)).toBe(true);
    frames(7);
  };

  // A tent refuses the day (ANNOUNCE_NODAYSLEEP in the character's speech).
  sleepIn();
  expect([animation.stategraph.stateName, sleeper.bed, say.mock.lastCall]).toEqual(['idle', undefined, ['我不要打乱规律的作息时间。']]);

  clockstate.set({ phase: 'night', timeinphase: 0 });
  sleepIn();
  expect(animation.stategraph.hasStateTag('sleeping')).toBe(true);
  expect([sleeper.bed, tags.has('hassleeper'), instance.controllerEnabled]).toEqual([bag, true, false]);
  expect(controls.HideCraftingAndInventory).toHaveBeenCalledOnce();
  expect([instance.sprite.sprite.peek().visible, model.visible]).toEqual([false, false]);
  // Movement wakes the sleeper through its bed; leaving the tent shows the player again.
  animation.wakeFromBed();
  frames(1);
  expect([animation.stategraph.stateName, sleeper.bed, tags.has('hassleeper')]).toEqual(['wakeup', undefined, false]);
  expect([instance.sprite.sprite.peek().visible, model.visible]).toEqual([true, true]);
  frames(120);
  expect([animation.stategraph.stateName, instance.controllerEnabled]).toEqual(['idle', true]);
  expect(controls.ShowCraftingAndInventory).toHaveBeenCalled();

  // player_common.lua OnDespawn: the bed releases a sleeper that is removed in it.
  sleepIn();
  expect(sleeper.bed).toBe(bag);
  instance.remove();
  expect([bag.InUse(), tags.has('hassleeper')]).toEqual([false, false]);
  say.mockRestore();
});

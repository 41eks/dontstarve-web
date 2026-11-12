import { wakeFromBed } from '../../prefab/src/player_common';
import type { PlayerAction } from '../../stategraphs/src/actionfns';
import { PrefabInstance } from '../../prefab/src/prefabInstance';
import { SpriteState } from '../../display/src';
import { addComponent } from '../../prefab/src/components';
import { Talker } from '../../componets/src/talker';
import { advancePlayer } from './playerVisual';
import { readFile } from 'node:fs/promises';
import { World } from 'cannon-es';
import { afterEach, expect, it, vi } from 'vitest';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { SleepingBag } from '../../componets/src/sleepingbag';
import { clockstate } from '../../signals/src';
import { BufferedAction } from '../../stategraphs/src';
import { createPlayerPrefab } from './playerVisual';

afterEach(() => { clockstate.set({ phase: 'day', timeinphase: 0 }); });

it('runs SGwilson tent through the player prefab: refusal, sleeping in a bag, waking and despawning in bed', async () => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const scheduler = new GameTimeScheduler();
  const { model, instance } = await createPlayerPrefab('/dst/data/anim', new World(), { scheduler });
  const animation = instance;
  const controls = { HideCraftingAndInventory: vi.fn(), ShowCraftingAndInventory: vi.fn() };
  instance.HUD = { Show() {}, Hide() {}, controls };
  const talker = addComponent(instance, 'talker', Talker, scheduler);
  const sleeper = instance.components.sleepingbaguser!;
  const tent = new PrefabInstance('tent', new SpriteState({ name: 'idle', billboard: true }));
  tent.addTag('tent');
  const bag = addComponent(tent, 'sleepingbag', SleepingBag);
  const tags = { has: (tag: string) => tent.hasTag(tag) };
  const frames = (count: number) => { for (let i = 0; i < count; i++) advancePlayer(animation, 1 / 30); };
  const sleepIn = () => {
    // ACTIONS.SLEEPIN.fn: sleepingbag:DoSleep(act.doer) reaches the player's sleepingbaguser.
    const action: PlayerAction<'SLEEPIN'> = new BufferedAction('SLEEPIN', () => { bag.DoSleep(sleeper); return true; }, () => true, { target: tent });
    expect(animation.sg.pushBufferedAction(action)).toBe(true);
    frames(7);
  };

  // A tent refuses the day (ANNOUNCE_NODAYSLEEP in the character's speech).
  sleepIn();
  // The refusal is said from idle, so SGwilson's ontalk handler enters talk.
  expect([animation.sg.stateName, sleeper.bed, talker.line.peek()]).toEqual(['talk', undefined, '我不要打乱规律的作息时间。']);

  clockstate.set({ phase: 'night', timeinphase: 0 });
  sleepIn();
  expect(animation.sg.hasStateTag('sleeping')).toBe(true);
  expect([sleeper.bed, tags.has('hassleeper'), instance.controllerEnabled]).toEqual([bag, true, false]);
  expect(controls.HideCraftingAndInventory).toHaveBeenCalledOnce();
  expect([instance.sprite.sprite.peek().visible, model.visible]).toEqual([false, false]);
  // Movement wakes the sleeper through its bed; leaving the tent shows the player again.
  wakeFromBed(animation);
  frames(1);
  expect([animation.sg.stateName, sleeper.bed, tags.has('hassleeper')]).toEqual(['wakeup', undefined, false]);
  expect([instance.sprite.sprite.peek().visible, model.visible]).toEqual([true, true]);
  frames(120);
  expect([animation.sg.stateName, instance.controllerEnabled]).toEqual(['idle', true]);
  expect(controls.ShowCraftingAndInventory).toHaveBeenCalled();

  // player_common.lua OnDespawn: the bed releases a sleeper that is removed in it.
  sleepIn();
  expect(sleeper.bed).toBe(bag);
  instance.remove();
  expect([bag.InUse(), tags.has('hassleeper')]).toEqual([false, false]);
});

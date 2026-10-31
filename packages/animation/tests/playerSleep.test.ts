import { readFile } from 'node:fs/promises';
import { World } from 'cannon-es';
import { expect, it, vi } from 'vitest';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { BufferedAction } from '../../stategraphs/src';
import { createWilsonPlayerPrefab } from './playerVisual';

it('hides the sleeping player through its sprite and display, and shows it on waking or teardown', async () => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const { model, instance } = await createWilsonPlayerPrefab('/dst/data/anim', new World(), { scheduler: new GameTimeScheduler() });
  const animation = instance.animationController;
  let bed: { DoWakeUp(nostatechange: boolean): void } | undefined;
  const setSleeperState = vi.fn();
  // SGwilson's tent reaches the bed and HUD through the application; hiding is the player's own sprite.
  animation.bindSleep({
    setSleeperState, failReason: () => undefined, announce() {}, canCommit: () => true,
    get hasBed() { return bed !== undefined; },
    wakeBed: nostatechange => bed?.DoWakeUp(nostatechange),
  });
  const frames = (count: number) => { for (let i = 0; i < count; i++) animation.update(1 / 30); };
  const sleepIn = () => {
    const target = { hasTag: () => false };
    const action = new BufferedAction('SLEEPIN', () => {
      bed = { DoWakeUp: nostatechange => { bed = undefined; if (!nostatechange) animation.goToWakeup(); } };
      return true;
    }, () => true, { target });
    expect(animation.stategraph.pushBufferedAction(action)).toBe(true);
    frames(7);
    expect(animation.stategraph.hasStateTag('sleeping')).toBe(true);
  };

  sleepIn();
  expect(setSleeperState).toHaveBeenLastCalledWith(true);
  expect([instance.sprite.sprite.peek().visible, model.visible]).toEqual([false, false]);
  // Movement wakes the sleeper through its bed; leaving the tent shows the player again.
  bed!.DoWakeUp(false);
  frames(1);
  expect(animation.stategraph.stateName).toBe('wakeup');
  expect([instance.sprite.sprite.peek().visible, model.visible]).toEqual([true, true]);

  frames(120);
  sleepIn();
  expect(model.visible).toBe(false);
  // Scene teardown: the bed releases the sleeper without a state change, then the host is unbound.
  bed!.DoWakeUp(true);
  animation.bindSleep(undefined);
  frames(1);
  expect([instance.sprite.sprite.peek().visible, model.visible]).toEqual([true, true]);
});

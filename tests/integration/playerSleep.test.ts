import type { PlayerAction } from '../../packages/stategraphs/src/actionfns';
import { PrefabInstance } from '../../packages/prefab/src/prefabInstance';
import { SpriteState } from '../../packages/display/src';
import { addComponent } from '../../packages/prefab/src/components';
import { Talker } from '../../packages/componets/src/talker';
import { advancePlayer, createPlayerPrefab } from '../fixtures/playerVisual';
import { readFile } from 'node:fs/promises';
import { World } from 'cannon-es';
import { afterEach, expect, it, vi } from 'vitest';
import { GameTimeScheduler } from '../../packages/componets/src/gameTimeScheduler';
import { SleepingBag } from '../../packages/componets/src/sleepingbag';
import { clockstate } from '../../packages/signals/src';
import {
  BufferedAction,
  PlayerController,
  PointerRaycaster,
  type ActionWorldContext,
} from '../../packages/stategraphs/src';
import { Locomotor } from '../../packages/prefab/src/locomotor';
import { testPlayer } from '../fixtures/testPlayer';
import * as THREE from 'three';
import { fixedCamera } from '../../packages/prefab/src/followcamera';
import { updateMovement } from '../../src/updatePlayerMovement';

vi.mock('../../src/InputManager', () => ({
  input: { isPressed: () => false, isManualMovement: { get: () => false }, isActionInterrupting: { get: () => false } },
}));

afterEach(() => {
  clockstate.set({ phase: 'day', timeinphase: 0 });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('runs SGwilson tent through the player prefab: refusal, sleeping in a bag, waking and despawning in bed', async () => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(await readFile(new URL(`../../public${url}`, import.meta.url))),
  );
  const scheduler = new GameTimeScheduler();
  const { model, instance, body } = await createPlayerPrefab('/dst/data/anim', new World(), { scheduler });
  const animation = instance;
  const doer = testPlayer({ entity: instance });
  const locomotor = new Locomotor(body);
  instance.locomotor = locomotor;
  const move = updateMovement(fixedCamera(45), model, body, locomotor);
  const world = {
    player: model,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    ground: new THREE.Group(),
    renderer: { domElement: new EventTarget() },
  } as unknown as ActionWorldContext;
  const controller = new PlayerController(world, instance.sg, locomotor, doer.components.inventory.handEquipment, doer);
  const point = new THREE.Vector3(12, 0, 0);
  vi.spyOn(PointerRaycaster.prototype, 'groundPoint').mockReturnValue(point);
  vi.spyOn(PointerRaycaster.prototype, 'pickMouseTarget').mockReturnValue(undefined);
  const click = () => controller.OnControl('PRIMARY', true, { clientX: 0, clientY: 0 });
  const controls = { HideCraftingAndInventory: vi.fn(), ShowCraftingAndInventory: vi.fn() };
  instance.HUD = { Show() {}, Hide() {}, controls };
  const talker = addComponent(instance, 'talker', Talker, scheduler);
  const sleeper = instance.components.sleepingbaguser!;
  const tent = new PrefabInstance('tent', new SpriteState({ name: 'idle', billboard: true }));
  tent.addTag('tent');
  const bag = addComponent(tent, 'sleepingbag', SleepingBag);
  const tags = { has: (tag: string) => tent.hasTag(tag) };
  const frames = (count: number) => {
    for (let i = 0; i < count; i++) {
      advancePlayer(animation, 1 / 30);
    }
  };
  const sleepIn = () => {
    // ACTIONS.SLEEPIN.fn: sleepingbag:DoSleep(act.doer) reaches the player's sleepingbaguser.
    const action: PlayerAction<'SLEEPIN'> = new BufferedAction(
      'SLEEPIN',
      () => {
        bag.DoSleep(sleeper);
        return true;
      },
      () => true,
      { target: tent },
    );
    expect(animation.sg.pushBufferedAction(action)).toBe(true);
    if (clockstate.value.phase === 'night') {
      expect(instance.controllerEnabled).toBe(false);
      expect(click()).toBe(false);
      expect(locomotor.destination).toBeUndefined();
    }
    frames(7);
  };

  // A tent refuses the day (ANNOUNCE_NODAYSLEEP in the character's speech).
  sleepIn();
  // The refusal is said from idle, so SGwilson's ontalk handler enters talk.
  expect([animation.sg.stateName, sleeper.bed, talker.line.value]).toEqual([
    'talk',
    undefined,
    '我不要打乱规律的作息时间。',
  ]);

  clockstate.set({ phase: 'night', timeinphase: 0 });
  sleepIn();
  expect(animation.sg.hasStateTag('sleeping')).toBe(true);
  expect([sleeper.bed, tags.has('hassleeper'), instance.controllerEnabled]).toEqual([bag, true, true]);
  expect(controls.HideCraftingAndInventory).toHaveBeenCalledOnce();
  expect([instance.sprite.sprite.value.visible, model.visible]).toEqual([false, false]);
  // Movement wakes the sleeper through its bed; leaving the tent shows the player again.
  expect(click()).toBe(true);
  expect(locomotor.destination).toEqual(point);
  move(16, 1 / 30);
  expect(locomotor.destination).toBeUndefined();
  frames(1);
  expect([animation.sg.stateName, sleeper.bed, tags.has('hassleeper')]).toEqual(['wakeup', undefined, false]);
  expect([instance.sprite.sprite.value.visible, model.visible]).toEqual([true, true]);
  frames(120);
  expect([animation.sg.stateName, instance.controllerEnabled]).toEqual(['idle', true]);
  expect(controls.ShowCraftingAndInventory).toHaveBeenCalled();

  // player_common.lua OnDespawn: the bed releases a sleeper that is removed in it.
  sleepIn();
  expect(sleeper.bed).toBe(bag);
  instance.remove();
  expect([bag.InUse(), tags.has('hassleeper')]).toEqual([false, false]);
  controller.dispose();
  doer.components.inventory.dispose();
});

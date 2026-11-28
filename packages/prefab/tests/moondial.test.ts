import { prefabInstance } from '../src/prefabInstance';
import { prefabInstance as lookupPrefabInstance } from '../src/prefabInstance';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { bindTestWorld } from '../../../tests/fixtures/worldContentFixture';
import { MOONDIAL_ID, MoondialInstance } from '../src/moondial';
import { animationLengths } from '../src/animationTimings';
import { FRAMES } from '../../stategraphs/src/stategraph';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { displayLightOverride } from '../../display/src/displaySprites';
import { smallHash } from '../../animation/src/animationAssets';
import type { WorldContext } from '../src/worldContext';
import * as sound from '../src/sound';
import { getDstClock, TUNING } from '../../../src/tuning';
import { reskinEntity, reskinTargetOf } from '../src/reskin_tool';
import { workTargets } from '../../../tests/fixtures/workTargets';
import { managedBuildings } from '../../../tests/fixtures/managedBuildings';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function createPlacement() {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  );
  const stop = vi.fn();
  const play = vi.spyOn(sound, 'PlaySound').mockReturnValue({ stop, isPlaying: () => true, setVolume: vi.fn() });
  const scheduler = new GameTimeScheduler();
  const { moon, getWatchWorldContent, unbind } = bindTestWorld(scheduler);
  const world = {
    scene: new THREE.Scene(),
    player: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(),
    ground: new THREE.Group(),
    renderer: { domElement: new EventTarget() },
    scheduler,
    getWatchWorldContent,
  } as unknown as WorldContext;
  const placement = managedBuildings(world, { consume: () => false });
  return {
    placement,
    scheduler,
    moon,
    play,
    stop,
    dispose: () => {
      placement.dispose();
      unbind();
      scheduler.dispose();
    },
  };
}

/** The world's own 20-day clock: TheWorld.state.moonphase / iswaxingmoon on a given day. */
const dayMoon = (day: number) => {
  const { moonPhase, waxing } = getDstClock(day * TUNING.TOTAL_DAY_TIME);
  return { phase: moonPhase, waxing };
};

it('keeps phase look and playback through reskin and records only its skin', async () => {
  const { placement, moon, dispose } = await createPlacement();
  try {
    placement.spawn(MOONDIAL_ID);
    const sprite = prefabInstance(workTargets('HAMMER')[0].display.model)!.sprite;
    // The transition clip plays out only once the display has drawn the dial.
    await vi.waitFor(() => expect(sprite.loaded).toBe(true));
    moon.set(dayMoon(14)); // waning half
    // WatchWorldState reaches the dial in its effect, before the reskin.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(reskinEntity(reskinTargetOf(prefabInstance(workTargets('HAMMER')[0].model))!)).toBe(true);
    const model = workTargets('HAMMER')[0].display.model;
    expect(lookupPrefabInstance(model)?.skinId).toBe('moondial_an');
    expect(prefabInstance(model)!.sprite.currentAnimation).toBe('wane_to_half');
    expect(displayLightOverride(model)).toBe(0.1);
    // The waning look is the dial's own AnimState, so the new skin's sprite is dressed with it too.
    const declared = sprite.sprite.value.appearance.get('anim-state')!;
    if (declared.kind !== 'anim-state') {
      throw new Error('Missing the dial AnimState');
    }
    expect(declared.state.value.overrides.get(smallHash('reflection_half'))?.sources).toEqual([
      { archive: 'moondial_waning_build.zip', symbol: smallHash('reflection_half') },
    ]);
    expect(placement.exportRecords()[0].record.skinname).toBe('moondial_an');
    placement.dispose();
    const readMoon = vi.spyOn(moon, 'get');
    moon.set({ phase: 'full', waxing: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(readMoon).not.toHaveBeenCalled();
  } finally {
    dispose();
  }
});

it('runs the placed timeline and returns to idle without advancing the display', async () => {
  const { placement, scheduler, play, dispose } = await createPlacement();
  try {
    const inst = placement.prefabs.spawnAs(MoondialInstance, MOONDIAL_ID, new THREE.Vector3());
    expect(inst.components.inspectable?.GetStatus()).toBe('GENERIC');
    inst.PushEvent('onbuilt');
    expect(inst.sg.stateName).toBe('placed');

    scheduler.advance(4 * FRAMES);
    expect(play).not.toHaveBeenCalled();
    scheduler.advance(FRAMES);
    expect(play).toHaveBeenCalledWith('dontstarve/common/together/moondial/craft', inst.position);
    expect(inst.sg.stateName).toBe('placed');

    const duration = animationLengths('moondial.zip').get('place_new')!;
    scheduler.advance(duration);
    expect(inst.sg.stateName).toBe('idle');
    expect(inst.sprite.sprite.value.clip.name).toBe('idle_new');
  } finally {
    dispose();
  }
});

import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createSignal, readonlySignal, type WorldMoonPhase } from '@dontstarve-web/signals';
import { AnimatedBuildingPlacement } from '../../prefab/src/animatedBuildingPlacement';
import { MOONDIAL_DEFINITION, MOONDIAL_ID } from '../../prefab/src/moondial';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { getPrefabLightOverride, getPrefabLocalLight } from '../../prefab/src/localLight';
import type { SpriteController } from '../src/sprite';
import type { WorldContext } from '../../prefab/src/worldContext';
import * as sound from '../../prefab/src/sound';
import { getDstClock, TUNING } from '../../../src/tuning';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function createPlacement() {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const stop = vi.fn();
  const play = vi.spyOn(sound, 'PlaySound').mockReturnValue({ stop, isPlaying: () => true, setVolume: vi.fn() });
  const scheduler = new GameTimeScheduler();
  const moon = createSignal<{ phase: WorldMoonPhase; waxing: boolean }>({ phase: 'new', waxing: true });
  const world = { scene: new THREE.Scene(), player: new THREE.Group(), camera: new THREE.PerspectiveCamera(),
    ground: new THREE.Group(), renderer: { domElement: new EventTarget() }, scheduler, moon: readonlySignal(moon) } as unknown as WorldContext;
  const placement = new AnimatedBuildingPlacement(world, { [MOONDIAL_ID]: MOONDIAL_DEFINITION }, () => false);
  return { placement, scheduler, moon, play, stop };
}

const finish = (sprite: SpriteController, seconds = 4) => { for (let i = 0; i < seconds * 30; i++) sprite.update(1 / 30); };
const soundsPlayed = (play: ReturnType<typeof vi.spyOn>) => play.mock.calls.map(call => String(call[0]).split('/').pop());

/** The world's own 20-day clock: TheWorld.state.moonphase / iswaxingmoon on a given day. */
const dayMoon = (day: number) => {
  const { moonPhase, waxing } = getDstClock(day * TUNING.TOTAL_DAY_TIME);
  return { phase: moonPhase, waxing };
};

it('keeps phase look and playback through reskin and records only its skin', async () => {
  const { placement, moon } = await createPlacement();
  try {
    await placement.spawn(MOONDIAL_ID);
    moon.set(dayMoon(14)); // waning half
    const reskin = await placement.reskinTargets[0].prepareNextSkin();
    expect(reskin.apply()).toBe(true);
    const model = placement.hammerTargets[0].model;
    expect(model.userData.skinId).toBe('moondial_an');
    expect((model.userData.animationController as SpriteController).currentAnimation).toBe('wane_to_half');
    expect(getPrefabLightOverride(model)).toBe(.1);
    expect(placement.exportRecords()[0].record.components.building).toMatchObject({ skinId: 'moondial_an' });
  } finally { placement.dispose(); }
});

import { PrefabDisplayGroup } from '../../display/src';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DwarfStarManager } from '../../prefab/src/stafflight';
import { DisposeSounds, PlaySound, PreloadSounds, PrewarmSounds, UpdateSoundListener, inverseSquareAttenuation, SOUND_MAX_DISTANCE } from '../../prefab/src/sound';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { DynamicMusic } from '../../componets/src/dynamicmusic';
import { createSignal } from '../../signals/src/signal';
import { SoundPresentationScheduler } from '../../sound/src';

afterEach(() => { DisposeSounds(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function setup() {
  const events = new EventTarget();
  vi.stubGlobal('window', events);
  const sources: {
    buffer: AudioBuffer | null; loop: boolean; playbackRate: { value: number }; onended: (() => void) | null;
    start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
  const gains: { gain: { value: number }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
  const context = {
    state: 'suspended', destination: {},
    resume: vi.fn(async () => { context.state = 'running'; }),
    close: vi.fn(async () => { context.state = 'closed'; }),
    decodeAudioData: vi.fn(async () => ({}) as AudioBuffer),
    createGain: vi.fn(() => {
      const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
      gains.push(gain);
      return gain;
    }),
    createBufferSource: vi.fn(() => {
      const source = { buffer: null as AudioBuffer | null, loop: false, playbackRate: { value: 1 }, onended: null as (() => void) | null,
        start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn() };
      sources.push(source);
      return source;
    }),
  };
  vi.stubGlobal('AudioContext', class { constructor() { return context; } });
  const archive = await readFile(new URL('../../../public/dst/data/anim/star_hot.zip', import.meta.url));
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('star_hot.zip')) return new Response(archive);
    return new Response(new Uint8Array([0, 1]));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { events, sources, gains, context, fetchMock };
}

it('prewarms registered sounds while suspended, waits for decoding and reuses shared layers and variants', async () => {
  const s = await setup();
  let finish!: (buffer: AudioBuffer) => void;
  s.context.decodeAudioData.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  let ready = false;
  const loading = PrewarmSounds().then(() => { ready = true; });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(s.context.decodeAudioData).toHaveBeenCalled();
  expect(ready).toBe(false);
  expect(s.context.state).toBe('suspended');
  expect(s.context.resume).not.toHaveBeenCalled();
  expect(s.sources).toHaveLength(0);
  finish({} as AudioBuffer);
  await loading;
  const urls = s.fetchMock.mock.calls.map(([url]) => url);
  expect(new Set(urls).size).toBe(urls.length);
  expect(s.context.decodeAudioData).toHaveBeenCalledTimes(urls.length);
  expect(urls).toEqual(expect.arrayContaining([
    '/dst/data/sound/sfx.fsb-796.wav', '/dst/data/sound/sfx.fsb-797.wav',
    '/dst/data/sound/common.fsb-158.wav', '/dst/data/sound/common.fsb-284.wav',
    '/dst/data/sound/sfx.fsb-423.wav', '/dst/data/sound/sfx.fsb-424.wav',
  ]));
  await PrewarmSounds();
  await PreloadSounds('dontstarve/common/staff_coldlight_LP', 'dontstarve/wilson/hit');
  PlaySound('dontstarve/common/staff_coldlight_LP');
  PlaySound('dontstarve/wilson/hit');
  expect(s.sources).toHaveLength(4);
  expect(s.sources.every(source => source.start.mock.calls.length === 1)).toBe(true);
  expect(s.fetchMock).toHaveBeenCalledTimes(urls.length);
  expect(s.context.decodeAudioData).toHaveBeenCalledTimes(urls.length);
  s.events.dispatchEvent(new Event('pointerdown'));
  expect(s.context.resume).toHaveBeenCalledOnce();
});

it('skips prewarming without Web Audio and can prepare when it becomes available', async () => {
  vi.stubGlobal('AudioContext', undefined);
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  await PrewarmSounds();
  expect(fetchMock).not.toHaveBeenCalled();
  const s = await setup();
  await PrewarmSounds();
  expect(s.context.decodeAudioData).toHaveBeenCalled();
});

describe('dwarf star source sounds', () => {

  it('mutes at and beyond the cutoff, with a configurable maximum distance', () => {
    const listener = new THREE.Vector3(), position = new THREE.Vector3();
    expect(inverseSquareAttenuation(position, listener)).toBe(1);
    expect(inverseSquareAttenuation(position.set(12, 0, 0), listener)).toBe(1);
    expect(inverseSquareAttenuation(position.set(SOUND_MAX_DISTANCE - 1, 0, 0), listener)).toBeGreaterThan(0);
    expect(inverseSquareAttenuation(position.set(SOUND_MAX_DISTANCE, 0, 0), listener)).toBe(0);
    expect(inverseSquareAttenuation(position.set(SOUND_MAX_DISTANCE + 1, 0, 0), listener)).toBe(0);
    expect(inverseSquareAttenuation(position.set(30, 0, 0), listener, 12, 30)).toBe(0);
    position.set(12, 0, 12);
    expect(inverseSquareAttenuation(position, listener)).toBe(.5);
    expect(position.toArray()).toEqual([12, 0, 12]);
    expect(listener.toArray()).toEqual([0, 0, 0]);
  });

  it('attenuates independent stars as the player moves and releases their gains', async () => {
    const s = await setup();
    const manager = new DwarfStarManager(new PrefabDisplayGroup(new THREE.Scene()), '/dst/data/anim');
    // The scene decodes every event before it starts, so a star's loop begins when it is spawned.
    await PrewarmSounds();
    UpdateSoundListener(new THREE.Vector3());
    const near = await manager.spawn(new THREE.Vector3());
    const far = await manager.spawn(new THREE.Vector3(24, 0, 0));
    expect(s.gains.map(({ gain }) => gain.value)).toEqual([1, 1, 0.25, 0.25].map(volume => volume * .7));
    expect(s.sources.map((source) => source.connect.mock.calls[0][0])).toEqual(s.gains);
    UpdateSoundListener(new THREE.Vector3(48, 0, 0));
    expect(s.gains.map(({ gain }) => gain.value)).toEqual([1 / 16, 1 / 16, 0.25, 0.25].map(volume => volume * .7));
    far.position.x = 48;
    UpdateSoundListener(new THREE.Vector3(48, 0, 0));
    expect(s.gains.map(({ gain }) => gain.value)).toEqual([1 / 16, 1 / 16, 1, 1].map(volume => volume * .7));
    UpdateSoundListener(new THREE.Vector3(144, 0, 0));
    expect(s.gains.map(({ gain }) => gain.value)).toEqual([0, 0, 0, 0]);
    expect(s.sources.every((source) => source.stop.mock.calls.length === 0)).toBe(true);
    UpdateSoundListener(new THREE.Vector3(48, 0, 0));
    expect(s.gains.map(({ gain }) => gain.value)).toEqual([1 / 16, 1 / 16, 1, 1].map(volume => volume * .7));
    expect(near.position.x).toBe(0);
    // Player-local sounds bypass distance attenuation; SetVolume scales only their own gain.
    await PreloadSounds('dontstarve/wilson/use_gemstaff');
    const local = PlaySound('dontstarve/wilson/use_gemstaff');
    expect(s.sources[4].connect).toHaveBeenCalledWith(s.gains[4]);
    expect(s.gains[4].connect).toHaveBeenCalledWith(s.context.destination);
    expect(s.gains[4].gain.value).toBe(.7);
    local.setVolume(.5);
    UpdateSoundListener(new THREE.Vector3(144, 0, 0));
    expect(s.gains[4].gain.value).toBe(.35);
    expect(local.isPlaying()).toBe(true);
    local.stop();
    expect(local.isPlaying()).toBe(false);
    UpdateSoundListener(new THREE.Vector3(48, 0, 0));
    s.sources[0].onended!();
    manager.dispose();
    expect(s.gains.every((gain) => gain.disconnect.mock.calls.length === 1)).toBe(true);
    UpdateSoundListener(new THREE.Vector3());
    expect(s.gains.map(({ gain }) => gain.value)).toEqual([1 / 16, 1 / 16, 1, 1, .5].map(volume => volume * .7));
  });

  it('preloads all polar light layers and stops each independent summon together', async () => {
    const s = await setup();
    await PreloadSounds('dontstarve/common/staff_coldlight_LP', 'dontstarve/common/staffteleport');
    expect(s.fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/dst/data/sound/sfx.fsb-796.wav', '/dst/data/sound/sfx.fsb-797.wav',
      '/dst/data/sound/common.fsb-158.wav', '/dst/data/sound/common.fsb-284.wav',
    ]);
    const first = PlaySound('dontstarve/common/staff_coldlight_LP');
    const second = PlaySound('dontstarve/common/staff_coldlight_LP');
    expect(s.sources.map((source) => source.loop)).toEqual(Array(6).fill(true));
    expect(s.sources[0].buffer).toBe(s.sources[3].buffer);
    first.stop();
    first.stop();
    expect(s.sources.slice(0, 3).every((source) => source.stop.mock.calls.length === 1
      && source.disconnect.mock.calls.length === 1)).toBe(true);
    expect(s.sources.slice(3).every((source) => source.stop.mock.calls.length === 0)).toBe(true);
    second.stop();
    expect(s.sources.every((source) => source.disconnect.mock.calls.length === 1)).toBe(true);
  });

  it('preloads moonstaff placement and plays wood with one source-defined rock variant', async () => {
    const s = await setup();
    const event = 'dontstarve/common/together/moonbase/moonstaff_place';
    await PreloadSounds(event);
    expect(s.fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/dst/data/sound/common.fsb-233.wav',
      ...[857, 859, 861, 862, 863, 864, 865, 847, 848, 849, 850, 851, 852, 853, 854, 855, 856, 858]
        .map(stream => `/dst/data/sound/sfx.fsb-${stream}.wav`),
    ]);
    const first = PlaySound(event);
    const second = PlaySound(event);
    expect(s.sources.map(source => source.loop)).toEqual([false, false, false, false]);
    expect(s.sources.every(source => source.start.mock.calls.length === 1)).toBe(true);
    expect(s.sources[0].buffer).toBe(s.sources[2].buffer);
    first.stop();
    expect(s.sources.slice(0, 2).every(source => source.disconnect.mock.calls.length === 1)).toBe(true);
    expect(s.sources.slice(2).every(source => source.stop.mock.calls.length === 0)).toBe(true);
    second.stop();
  });

  it('does not reject preloading on audio failure and retries the failed event', async () => {
    const s = await setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    s.context.decodeAudioData.mockRejectedValueOnce(new Error('decode failed'));
    await PreloadSounds('dontstarve/common/staff_star_create');
    expect(s.sources).toHaveLength(0);
    expect(warn).toHaveBeenCalledOnce();
    await PreloadSounds('dontstarve/common/staff_star_create');
    const sound = PlaySound('dontstarve/common/staff_star_create');
    expect(s.context.decodeAudioData).toHaveBeenCalledTimes(2);
    expect(s.sources.map((source) => source.loop)).toEqual([false]);
    sound.stop();
    sound.stop();
    expect(s.sources[0].stop).toHaveBeenCalledOnce();
  });

  it('mixes independent beam layers and extends the player music until ten seconds after its last trigger', async () => {
    const s = await setup();
    await PreloadSounds('dontstarve/common/together/moonbase/beam', 'dontstarve/music/music_epicfight_moonbase', 'dontstarve/music/music_epicfight_moonbase_b');
    const beam = PlaySound('dontstarve/common/together/moonbase/beam');
    expect(s.sources.map(source => source.loop)).toEqual([true, true]);
    expect(s.gains[2].gain.value).toBeCloseTo(.63589698);
    beam.setParameter?.('intensity', .6);
    expect(s.gains[2].gain.value).toBeGreaterThan(.702564);
    beam.setParameter?.('intensity', .9); expect(s.gains[2].gain.value).toBe(1);
    beam.stop(); expect(s.sources.every(source => source.stop.mock.calls.length === 1)).toBe(true);
    const scheduler = new GameTimeScheduler(), music = new DynamicMusic(scheduler, path => PlaySound(path));
    music.TriggerMoonbase(1); const deadline = music.timer.peek();
    scheduler.advance(5); music.TriggerMoonbase(1);
    expect(music.timer.peek()).not.toEqual(deadline);
    expect(s.sources).toHaveLength(3);
    music.TriggerMoonbase(2); expect(s.sources[2].stop).toHaveBeenCalledOnce();
    scheduler.advance(9.99); expect(s.sources[3].stop).not.toHaveBeenCalled();
    scheduler.advance(.01); expect(s.sources[3].stop).toHaveBeenCalledOnce();
    expect(music.timer.peek().status).toBe('expired');
    music.dispose(); scheduler.dispose();
  });

  it('does not start or retain sounds if disposed during loading', async () => {
    const s = await setup();
    let finish!: (buffer: AudioBuffer) => void;
    // A pending PlaySound must remain cancelled even if its decode completes later.
    const pending = new Promise<AudioBuffer>((resolve) => { finish = resolve; });
    s.context.decodeAudioData.mockReturnValue(pending);
    const loading = PreloadSounds('dontstarve/common/staff_star_create');
    const sound = PlaySound('dontstarve/common/staff_star_create');
    DisposeSounds();
    finish({} as AudioBuffer);
    await loading;
    sound.stop();
    expect(s.sources).toHaveLength(0);
    expect(s.context.close).toHaveBeenCalledOnce();
    s.events.dispatchEvent(new Event('pointerdown'));
    expect(s.context.resume).not.toHaveBeenCalled();
  });
});

it('selects registered waterfall sounds by player position and releases them on removal', async () => {
  const s = await setup();
  await PreloadSounds('grotto/common/waterfall_LP');
  const playerPosition = createSignal<readonly THREE.Vector3[]>([new THREE.Vector3()]);
  const gameTime = new GameTimeScheduler();
  const presentation = new SoundPresentationScheduler(playerPosition, gameTime);
  try {
    const removePool = presentation.registerWaterfallPool(new THREE.Vector3(), 2, false);
    gameTime.advance(5 / 30);
    expect(s.sources).toHaveLength(2);
    expect(s.sources.every(source => source.loop)).toBe(true);
    expect(s.gains[0].gain.value).toBeCloseTo(.8 * .7);

    playerPosition.set([new THREE.Vector3(1000, 0, 0)]);
    expect(s.gains[0].gain.value).toBe(0);
    gameTime.advance(5 / 30);
    expect(s.sources.every(source => source.stop.mock.calls.length === 1)).toBe(true);

    playerPosition.set([new THREE.Vector3()]);
    gameTime.advance(5 / 30);
    expect(s.sources).toHaveLength(4);
    removePool();
    expect(s.sources.slice(2).every(source => source.stop.mock.calls.length === 1)).toBe(true);
    gameTime.advance(5 / 30);
    expect(s.sources).toHaveLength(4);
  } finally {
    presentation.dispose();
    gameTime.dispose();
  }
});

it('keeps three waterfall emitters and moves one through a volume fade as the nearest pools change', async () => {
  const s = await setup();
  await PreloadSounds('grotto/common/waterfall_LP');
  const playerPosition = createSignal<readonly THREE.Vector3[]>([new THREE.Vector3()]);
  const gameTime = new GameTimeScheduler();
  const presentation = new SoundPresentationScheduler(playerPosition, gameTime);
  try {
    for (const x of [0, 10, 20, 30]) presentation.registerWaterfallPool(new THREE.Vector3(x, 0, 0), 2, false);
    gameTime.advance(5 / 30);
    expect(s.sources).toHaveLength(6);
    playerPosition.set([new THREE.Vector3(30, 0, 0)]);
    gameTime.advance(5 / 30);
    gameTime.advance(.4);
    expect(s.sources).toHaveLength(6);
    expect(s.sources.every(source => source.stop.mock.calls.length === 0)).toBe(true);
    expect(s.gains[2].gain.value).toBeCloseTo(.8 * .7);
  } finally {
    presentation.dispose();
    gameTime.dispose();
  }
});


it('mole sleep uses one short lowered sample rather than a raw sniff loop', async () => {
  const s = await setup();
  await PreloadSounds('dontstarve_DLC001/creatures/mole/sniff', 'dontstarve_DLC001/creatures/mole/sleep');
  const sniff = PlaySound('dontstarve_DLC001/creatures/mole/sniff');
  const sleep = PlaySound('dontstarve_DLC001/creatures/mole/sleep');
  expect(s.sources.map(source => source.loop)).toEqual([false, false]);
  expect(s.sources[0].playbackRate.value).toBe(1);
  expect(s.sources[1].playbackRate.value).toBeCloseTo(2 ** -.25);
  expect(s.gains[1].gain.value).toBeCloseTo(.07079457491636276 * .7);
  sniff.stop(); expect(s.sources[0].stop).toHaveBeenCalledTimes(1);
  expect(s.sources[1].stop).not.toHaveBeenCalled();
  s.sources[1].onended!(); expect(sleep.isPlaying()).toBe(false);
});

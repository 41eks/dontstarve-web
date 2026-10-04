import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DwarfStarManager } from '../../prefab/src/stafflight';
import { DisposeSounds, PlaySound, PreloadSounds, UpdateSoundListener, inverseSquareAttenuation, SOUND_MAX_DISTANCE } from '../../prefab/src/sound';

afterEach(() => { DisposeSounds(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function setup() {
  const events = new EventTarget();
  vi.stubGlobal('window', events);
  const sources: {
    buffer: AudioBuffer | null; loop: boolean; onended: (() => void) | null;
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
      const source = { buffer: null as AudioBuffer | null, loop: false, onended: null as (() => void) | null,
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

describe('dwarf star source sounds', () => {
  it('mutes at and beyond the cutoff, with a configurable maximum distance', () => {
    expect(inverseSquareAttenuation(0)).toBe(1);
    expect(inverseSquareAttenuation(12)).toBe(1);
    expect(inverseSquareAttenuation(SOUND_MAX_DISTANCE - 1)).toBeGreaterThan(0);
    expect(inverseSquareAttenuation(SOUND_MAX_DISTANCE)).toBe(0);
    expect(inverseSquareAttenuation(SOUND_MAX_DISTANCE + 1)).toBe(0);
    expect(inverseSquareAttenuation(30, 12, 30)).toBe(0);
  });

  it('attenuates independent stars as the player moves and releases their gains', async () => {
    const s = await setup();
    const manager = new DwarfStarManager(new THREE.Scene(), '/dst/data/anim');
    UpdateSoundListener(new THREE.Vector3());
    const near = await manager.spawn(new THREE.Vector3());
    const far = await manager.spawn(new THREE.Vector3(24, 0, 0));
    expect(s.gains.map(({ gain }) => gain.value)).toEqual([1, 1, 0.25, 0.25]);
    expect(s.sources.map((source) => source.connect.mock.calls[0][0])).toEqual(s.gains);
    // Height does not change ground distance, including jumps and the player's model offset.
    UpdateSoundListener(new THREE.Vector3(48, 30, 0));
    expect(s.gains.map(({ gain }) => gain.value)).toEqual([1 / 16, 1 / 16, 0.25, 0.25]);
    far.position.x = 48;
    UpdateSoundListener(new THREE.Vector3(48, 0, 0));
    expect(s.gains.map(({ gain }) => gain.value)).toEqual([1 / 16, 1 / 16, 1, 1]);
    UpdateSoundListener(new THREE.Vector3(144, 0, 0));
    expect(s.gains.map(({ gain }) => gain.value)).toEqual([0, 0, 0, 0]);
    expect(s.sources.every((source) => source.stop.mock.calls.length === 0)).toBe(true);
    UpdateSoundListener(new THREE.Vector3(48, 0, 0));
    expect(s.gains.map(({ gain }) => gain.value)).toEqual([1 / 16, 1 / 16, 1, 1]);
    expect(near.position.x).toBe(0);
    // Player-local sounds still bypass distance attenuation.
    await PreloadSounds('dontstarve/wilson/use_gemstaff');
    PlaySound('dontstarve/wilson/use_gemstaff');
    expect(s.sources[4].connect).toHaveBeenCalledWith(s.context.destination);
    s.sources[0].onended!();
    manager.dispose();
    expect(s.gains.every((gain) => gain.disconnect.mock.calls.length === 1)).toBe(true);
    UpdateSoundListener(new THREE.Vector3());
    expect(s.gains.map(({ gain }) => gain.value)).toEqual([1 / 16, 1 / 16, 1, 1]);
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

  it('shares decoded samples while every summon owns its creation sound and loop', async () => {
    const s = await setup();
    const manager = new DwarfStarManager(new THREE.Scene(), '/prefix/dst/data/anim');
    try {
      await manager.prepare();
      const first = await manager.spawn(new THREE.Vector3());
      const second = await manager.spawn(new THREE.Vector3(2, 0, 3));
      const restored = await manager.spawn(new THREE.Vector3(4, 0, 5), { id: 'e_saved', remainingSeconds: 0.1 });
      expect(s.fetchMock.mock.calls.map(([url]) => url)).toEqual([
        '/prefix/dst/data/anim/star_hot.zip',
        '/dst/data/sound/common.fsb-273.wav',
        '/dst/data/sound/common.fsb-274.wav',
      ]);
      expect(s.context.decodeAudioData).toHaveBeenCalledTimes(2);
      // A restored star starts only its continuous sound.
      expect(s.sources.map((source) => source.loop)).toEqual([false, true, false, true, true]);
      expect(s.sources.every((source) => source.start.mock.calls.length === 1)).toBe(true);
      expect(s.sources[0].buffer).toBe(s.sources[2].buffer);
      expect(s.sources[1].buffer).toBe(s.sources[3].buffer);
      expect(s.context.resume).not.toHaveBeenCalled();
      s.events.dispatchEvent(new Event('pointerdown'));
      expect(s.context.resume).toHaveBeenCalledOnce();

      // Expiry starts disappear; the source Lua kills the loop at animover.
      const quaternion = new THREE.Quaternion();
      manager.update(0.1, quaternion);
      expect(s.sources[4].stop).not.toHaveBeenCalled();
      for (let i = 0; i < 11; i++) manager.update(0.1, quaternion);
      expect(s.sources[4].stop).toHaveBeenCalledOnce();
      expect(s.sources[4].disconnect).toHaveBeenCalledOnce();
      expect(restored.parent).toBeNull();
      expect(first.parent).not.toBeNull();
      expect(second.parent).not.toBeNull();
      expect(s.sources[1].stop).not.toHaveBeenCalled();
      expect(s.sources[3].stop).not.toHaveBeenCalled();

      // Naturally completed creation audio disconnects without being stopped twice.
      s.sources[0].onended!();
      manager.dispose();
      manager.dispose();
      expect(s.sources[0].stop).not.toHaveBeenCalled();
      expect(s.sources.every((source) => source.disconnect.mock.calls.length === 1)).toBe(true);
      expect(s.sources.slice(1).every((source) => source.stop.mock.calls.length === 1)).toBe(true);
      // The shared service remains available to player sounds after star disposal.
      expect(s.context.close).not.toHaveBeenCalled();
      DisposeSounds();
      expect(s.context.close).toHaveBeenCalledOnce();
      s.context.state = 'suspended';
      s.events.dispatchEvent(new Event('keydown'));
      expect(s.context.resume).toHaveBeenCalledOnce();
    } finally { manager.dispose(); }
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

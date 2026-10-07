import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { PortalManager } from '../../prefab/src/portal';
import { PlaySound, PreloadSounds } from '../../prefab/src/sound';
import { loadAnim } from '../src/animationAssets';

vi.mock('../../prefab/src/sound', () => ({
  PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop: vi.fn() })),
}));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

async function setup() {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(
    new URL(`../../../public${url}`, import.meta.url))));
  const manager = new PortalManager(new THREE.Scene(), '/dst/data/anim');
  const model = await manager.spawn(new THREE.Vector3(4, 0, 6));
  // Observe frames actually submitted by the source sprite, rather than a
  // second timer that could agree with the audio while the art drifts away.
  const controller = model.userData.animationController as { update(dt: number): void; showFrame(index: number): void };
  const showFrame = controller.showFrame.bind(controller);
  let displayedFrame = 0;
  vi.spyOn(controller, 'showFrame').mockImplementation((index) => { showFrame(index); displayedFrame = index; });
  const events = [0]; // The initial idle entry precedes installing the observer.
  vi.mocked(PlaySound).mockImplementation(() => {
    events.push(displayedFrame);
    return { stop: vi.fn() };
  });
  return { manager, model, controller, events, frame: () => displayedFrame };
}

it('plays Jacob at frames 0 and 30 of every source two-second idle loop without cumulative drift', async () => {
  const s = await setup();
  try {
    const idle = (await loadAnim('portal_moonrock.zip', '/dst/data/anim')).animations.find(({ name }) => name === 'idle_loop')!;
    expect([idle.frames.length, idle.frameRate]).toEqual([60, 30]);
    expect(PreloadSounds).toHaveBeenCalledWith('dontstarve/common/together/spawn_vines/spawnportal_jacob');
    expect(vi.mocked(PreloadSounds).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(PlaySound).mock.invocationCallOrder[0]);
    // Ten complete loops plus one frame ensures we cross the last wrap even
    // when floating-point accumulation renders the preceding frame at 20s.
    for (let i = 0; i < 601; i++) s.manager.update(1 / 30, new THREE.Quaternion());
    expect(s.events).toEqual([0, ...Array.from({ length: 10 }, () => [30, 0]).flat()]);
    expect(vi.mocked(PlaySound).mock.calls.every(([path, position]) =>
      path === 'dontstarve/common/together/spawn_vines/spawnportal_jacob' && position === s.model.position)).toBe(true);
  } finally { s.manager.dispose(); }
});

it('keeps audio on sprite frame crossings during stalls and uneven updates, and stops the latest call on disposal', async () => {
  const s = await setup();
  try {
    // The shared sprite controller clamps one update to 0.1 animation seconds.
    s.manager.update(2, new THREE.Quaternion());
    expect(s.frame()).toBe(3);
    expect(s.events).toEqual([0]);
    for (const dt of [0, -1, NaN, Infinity]) s.manager.update(dt, new THREE.Quaternion());
    expect(s.frame()).toBe(3);
    expect(s.events).toEqual([0]);
    const steps = [0.017, 0.083, 0.04, 0.071, 0.5];
    let previous = s.frame();
    let expectedCalls = 1;
    for (let i = 0; i < 120; i++) {
      s.manager.update(steps[i % steps.length], new THREE.Quaternion());
      const current = s.frame();
      if ((previous < 30 && current >= 30) || current < previous) expectedCalls++;
      expect(PlaySound).toHaveBeenCalledTimes(expectedCalls);
      previous = current;
    }
    const handles = vi.mocked(PlaySound).mock.results.map(({ value }) => value);
    const latest = handles.at(-1)!;
    expect(latest.stop).not.toHaveBeenCalled();
    s.manager.dispose();
    expect(latest.stop).toHaveBeenCalledOnce();
    const count = vi.mocked(PlaySound).mock.calls.length;
    s.controller.update(2); s.manager.update(2, new THREE.Quaternion());
    expect(PlaySound).toHaveBeenCalledTimes(count);
  } finally { s.manager.dispose(); }
});

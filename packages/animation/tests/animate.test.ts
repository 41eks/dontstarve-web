import * as THREE from 'three';
import type { World } from 'cannon-es';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const view = vi.hoisted(() => ({ render: vi.fn(), update: vi.fn(), cursor: vi.fn() }));
vi.mock('../../../src/universal', () => ({
  scene: {}, cursorUi: { update: view.cursor }, dstLighting: { render: view.render, update: view.update },
  resizeRendererToDisplaySize: () => ({ width: 800, height: 600, needsResize: false }),
}));
vi.mock('../../../src/debugFps', () => ({ createDebugFpsDisplay: () => ({ update: vi.fn(), dispose: vi.fn() }) }));
import { animate, frontTasks, middleTasks, backTasks } from '../../../src/animate';

const frames = new Map<number, FrameRequestCallback>();
let now = 60_000;
beforeEach(() => {
  let nextId = 0;
  now = 60_000;
  frames.clear();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextId, callback); return nextId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => {
  frontTasks.length = middleTasks.length = backTasks.length = 0;
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks();
});

function frame() {
  const [id, callback] = frames.entries().next().value!;
  frames.delete(id); callback(now);
}

it('starts on a fresh frame, resolves readiness after exactly one draw and excludes loading time', async () => {
  const step = vi.fn(), updates = vi.fn();
  backTasks.push(updates);
  const loop = animate({ step } as unknown as World, new THREE.PerspectiveCamera());
  expect(step).not.toHaveBeenCalled();
  expect(view.render).not.toHaveBeenCalled();
  now += 16;
  frame();
  await loop.ready;
  expect(view.render).toHaveBeenCalledOnce();
  expect(updates).toHaveBeenLastCalledWith(0);
  now += 100;
  frame();
  expect(updates).toHaveBeenLastCalledWith(.1);
  expect(view.render).toHaveBeenCalledTimes(2);
  loop.stop();
  expect(frames.size).toBe(0);
});

it('cancels startup before the first frame without advancing or drawing the scene', async () => {
  const step = vi.fn();
  const loop = animate({ step } as unknown as World, new THREE.PerspectiveCamera());
  const stale = frames.values().next().value!;
  const cancelled = expect(loop.ready).rejects.toThrow('Scene stopped before its first frame');
  loop.stop();
  await cancelled;
  stale(now);
  expect(step).not.toHaveBeenCalled();
  expect(view.render).not.toHaveBeenCalled();
  expect(frames.size).toBe(0);
});

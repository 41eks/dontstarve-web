import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSignal, readonlySignal } from '@dontstarve-web/signals';
import { PondManager } from '../../prefab/src/pond';

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('freezes above snowlevel 0.02, thaws below it, applies to later ponds and stops listening on dispose', async () => {
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const snow = createSignal(0), scene = new THREE.Scene();
  const ponds = new PondManager(scene, '/dst/data/anim', readonlySignal(snow));
  const first = await ponds.spawn(new THREE.Vector3());
  expect(first.userData.frozen).toBe(false);
  expect(first.userData.actionEntity.hasTag('slipperyfeettarget')).toBe(false);
  snow.set(.02); await tick(); expect(first.userData.frozen).toBe(false);
  snow.set(.03); await tick(); expect(first.userData.frozen).toBe(true);
  const later = await ponds.spawn(new THREE.Vector3(5, 0, 0));
  expect(later.userData.frozen).toBe(true);
  expect([first, later].map(m => m.userData.actionEntity.hasTag('slipperyfeettarget'))).toEqual([true, true]);
  snow.set(0); await tick(); expect([first, later].map(m => m.userData.frozen)).toEqual([false, false]);
  expect([first, later].map(m => m.userData.actionEntity.hasTag('slipperyfeettarget'))).toEqual([false, false]);
  ponds.dispose(); snow.set(1); await tick();
  expect(first.userData.frozen).toBe(false);
});

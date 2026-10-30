import { findActionEntity } from '../../prefab/src/actionEntity';
import { testMap } from './tileMapFixture';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PondManager } from '../../prefab/src/pond';
import { GameTimeScheduler } from '../../signals/src';
import { createWorldState } from '../../../src/worldState';

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('freezes above snowlevel 0.02, thaws below it, applies to later ponds and stops listening on dispose', async () => {
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const world = createWorldState({ map: testMap(), elapsedSeconds: 0, systems: {} }), scene = new THREE.Scene();
  const snow = { set: (snowlevel: number) => world.weather.OnLoad({ ...world.weather.OnSave(), snowlevel }) };
  const ponds = new PondManager(scene, '/dst/data/anim', new GameTimeScheduler(), world.getWatchWorldContent);
  try {
    const first = await ponds.spawn(new THREE.Vector3());
    expect(first.userData.frozen).toBe(false);
    expect(findActionEntity(first).hasTag('slipperyfeettarget')).toBe(false);
    snow.set(.02); await tick(); expect(first.userData.frozen).toBe(false);
    snow.set(.03); await tick(); expect(first.userData.frozen).toBe(true);
    const later = await ponds.spawn(new THREE.Vector3(5, 0, 0));
    expect(later.userData.frozen).toBe(true);
    expect([first, later].map(m => findActionEntity(m).hasTag('slipperyfeettarget'))).toEqual([true, true]);
    snow.set(0); await tick(); expect([first, later].map(m => m.userData.frozen)).toEqual([false, false]);
    expect([first, later].map(m => findActionEntity(m).hasTag('slipperyfeettarget'))).toEqual([false, false]);
    snow.set(1); ponds.dispose(); await tick();
    expect(first.userData.frozen).toBe(false);
    expect(world.weather.snowLevel.peek()).toBe(1);
  } finally { ponds.dispose(); world.dispose(); }
});

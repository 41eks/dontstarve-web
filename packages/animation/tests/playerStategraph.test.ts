import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWilsonPlayer, type WilsonAnimationController } from '../../prefab/src/player';
import { DisposeSounds } from '../../prefab/src/sound';

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const relative = String(url).slice(String(url).indexOf('dst/data/') + 9);
    return new Response(await readFile(new URL(`../../../public/dst/data/${relative}`, import.meta.url)));
  }));
});
afterEach(() => { DisposeSounds(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('loads the Willow build with shared player animations and renders every facing with equipment', async () => {
  const player = await createWilsonPlayer('/dst/data/anim');
  const animation = player.userData.animationController as WilsonAnimationController;
  expect(player.name).toBe('Willow');
  expect(player.userData.stategraph).toBe(animation.stategraph);
  const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
  expect(urls).toContain('/dst/data/anim/willow.zip');
  expect(urls).not.toContain('/dst/data/anim/wilson.zip');
  await animation.setHat('strawhat');
  await animation.setCarryItem('torch');
  const visual = player.children[0];
  const mesh = visual.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
  for (const facing of ['up', 'down', 'side'] as const) {
    for (const mirrored of [false, true]) {
      animation.setFacing(facing, mirrored);
      animation.start('walk');
      animation.update(1 / 30);
      expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
      expect(Array.from(mesh.geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
      expect(mesh.material.some((material) => material.name.startsWith('hat:'))).toBe(true);
      expect(mesh.material.every((material) => material.forceSinglePass)).toBe(true);
      expect(visual.children).toHaveLength(1);
    }
  }
});

it('keeps the source mining timeline when Willow changes facing and emits one action notification', async () => {
  const player = await createWilsonPlayer('/dst/data/anim');
  const animation = player.userData.animationController as WilsonAnimationController;
  await animation.setCarryItem('pickaxe');
  const hit = vi.fn(), events: string[] = [];
  animation.stategraph.listenForEvent('performaction', (data) => {
    events.push((data as { action: { action: string } }).action.action);
  });
  expect(animation.playMine(hit)).toBe(true);
  for (let frame = 1; frame <= 15; frame++) {
    if (frame === 5) animation.setFacing('up');
    if (frame === 12) animation.setFacing('side', true);
    animation.update(1 / 30);
  }
  expect(hit).not.toHaveBeenCalled();
  expect(animation.stategraph.stateName).toBe('mine');
  animation.update(1 / 30);
  expect(hit).toHaveBeenCalledOnce();
  expect(events).toEqual(['MINE']);
  for (let frame = 0; frame < 60; frame++) animation.update(1 / 30);
  expect(hit).toHaveBeenCalledOnce();
  expect(animation.stategraph.stateName).toBe('idle');
});

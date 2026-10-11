import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createBernieGroundSprite } from '../../prefab/src/bernie';
import { GroundItemAssets } from '../../prefab/src/groundItems';

beforeEach(() => vi.stubGlobal('fetch', async (url: string) => {
  const path = String(url).slice('/dst/data/'.length);
  return new Response(await readFile(new URL(`../../../public/dst/data/${path}`, import.meta.url)));
}));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([undefined, 'bernie_cat'])('plays Lua growth/shrink queues with source art (%s)', async (skinId) => {
  let sanity = 1;
  const assets = new GroundItemAssets('/dst/data/anim');
  const sprite = await createBernieGroundSprite(assets, { getSanityPercent: () => sanity }, skinId);
  const { model } = sprite;
  const mesh = model.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
  const state = () => [model.userData.prefab, model.userData.animation];
  const advance = (frames: number) => {
    for (let i = 0; i < frames; i++) {
      sprite.update(1 / 30);
      expect(model.children[0].children).toHaveLength(1);
      expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
      if (skinId) expect(mesh.material.some((material) => material.name.includes(skinId))).toBe(true);
    }
  };
  const positions = (target = mesh) => Array.from(target.geometry.getAttribute('position').array)
    .slice(0, target.geometry.drawRange.count / 6 * 4 * 3);
  try {
    model.position.set(2, 0.25, 3);
    model.userData.entityId = 'same-bernie';
    expect(state()).toEqual(['bernie_active', 'idle_loop']);
    sanity = 0.1;
    sprite.update(0);
    expect(state()).toEqual(['bernie_big', 'activate']);
    expect(model.children[0].scale.x).toBeCloseTo(0.014);
    const firstGrowthFrame = positions();
    advance(41);
    expect(state()).toEqual(['bernie_big', 'activate']);
    expect(positions()).not.toEqual(firstGrowthFrame);
    advance(1);
    expect(state()).toEqual(['bernie_big', 'idle_loop_nodir']);
    advance(14);
    expect(state()[1]).toBe('idle_loop_nodir');
    advance(1);
    expect(state()).toEqual(['bernie_big', 'idle_loop']);

    sanity = 0.15;
    sprite.update(0);
    expect(state()).toEqual(['bernie_big', 'deactivate']);
    advance(21);
    expect(state()[1]).toBe('deactivate');
    advance(1);
    expect(state()).toEqual(['bernie_big', 'deactivate_pst']);
    expect(model.children[0].scale.x).toBeCloseTo(0.014);
    advance(10);
    expect(state()[1]).toBe('deactivate_pst');
    advance(1);
    expect(state()).toEqual(['bernie_active', 'activate']);
    expect(model.children[0].scale.x).toBeCloseTo(0.02);
    advance(21);
    expect(state()).toEqual(['bernie_active', 'idle_loop_nodir']);
    advance(15);
    expect(state()).toEqual(['bernie_active', 'idle_loop']);
    expect(model.position.toArray()).toEqual([2, 0.25, 3]);
    expect(model.userData).toMatchObject({ entityId: 'same-bernie', itemId: 'bernie_inactive', skinId });

    // idle_nodir -> idle_loop preserves time (frame 15), rather than restarting.
    // Independently render an idle sprite at the same source time for comparison.
    const idle = await createBernieGroundSprite(assets, { getSanityPercent: () => 1 }, skinId);
    for (let i = 0; i < 15; i++) idle.update(1 / 30);
    const idleMesh = idle.model.children[0].children[0] as typeof mesh;
    expect(positions()).toEqual(positions(idleMesh));
    idle.dispose();
  } finally { sprite.dispose(); assets.dispose(); }
});

it('finishes a busy transformation using the latest sanity and cancels it on inventory/load events', async () => {
  let sanity = 1;
  const assets = new GroundItemAssets('/dst/data/anim');
  const sprite = await createBernieGroundSprite(assets, { getSanityPercent: () => sanity });
  const animation = () => sprite.model.userData.animation;
  const advance = (frames: number) => { for (let i = 0; i < frames; i++) sprite.update(1 / 30); };
  try {
    sanity = 0.1;
    advance(5);
    sanity = 1;
    advance(5);
    expect(animation()).toBe('activate');
    sanity = 0.1;
    advance(47);
    expect(animation()).toBe('idle_loop');
    sprite.update(0);
    expect(animation()).toBe('idle_loop');
    sanity = 1;
    advance(5);
    expect(animation()).toBe('deactivate');
    sanity = 0.1;
    advance(64);
    expect(animation()).toBe('idle_loop');
    expect(sprite.model.userData.prefab).toBe('bernie_active');
    sprite.update(0);
    expect(animation()).toBe('activate');
    sprite.model.dispatchEvent({ type: 'onputininventory' });
    advance(90);
    expect(sprite.model.userData).toMatchObject({ prefab: 'bernie_inactive', animation: 'inactive' });
    sprite.model.dispatchEvent({ type: 'ondropped' });
    expect(sprite.model.userData).toMatchObject({ prefab: 'bernie_big', animation: 'idle_loop' });
    sanity = 1;
    advance(5);
    sprite.model.dispatchEvent({ type: 'onload' });
    expect(sprite.model.userData).toMatchObject({ prefab: 'bernie_active', animation: 'idle_loop' });
    sprite.dispose();
    sanity = 0.1;
    advance(90);
    expect(animation()).toBe('idle_loop');
  } finally { sprite.dispose(); assets.dispose(); }
});

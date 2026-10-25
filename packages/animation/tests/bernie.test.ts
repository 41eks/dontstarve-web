import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BernieAssets, createBernieGroundSprite } from '../../prefab/src/bernie';
import { prefabInstance } from '../../prefab/src/prefabInstance';

beforeEach(() => vi.stubGlobal('fetch', async (url: string) => {
  const path = String(url).slice('/dst/data/'.length);
  return new Response(await readFile(new URL(`../../../public/dst/data/${path}`, import.meta.url)));
}));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([undefined, 'bernie_cat'])('plays Lua growth/shrink queues with source art (%s)', async (skinId) => {
  let sanity = 1;
  const assets = new BernieAssets('/dst/data/anim');
  const sprite = await createBernieGroundSprite(assets, { getSanityPercent: () => sanity }, skinId);
  const { model } = sprite;
  // The display's root holds the drawn sprite, whose scaled visual holds the merged frame mesh.
  const visual = () => model.children[0].children[0];
  const mesh = visual().children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
  // The drawn form is the model name; the entity stays bernie_inactive.
  const state = () => [model.name.slice('GroundItem:'.length), model.userData.animation];
  const advance = (frames: number) => {
    for (let i = 0; i < frames; i++) {
      sprite.update(1 / 30);
      expect(visual().children).toHaveLength(1);
      expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
    }
  };
  const positions = (target = mesh) => Array.from(target.geometry.getAttribute('position').array)
    .slice(0, target.geometry.drawRange.count / 6 * 4 * 3);
  try {
    model.position.set(2, 0.25, 3);
    prefabInstance(model)!.entityId = 'same-bernie';
    expect(state()).toEqual(['bernie_active', 'idle_loop']);
    sanity = 0.1;
    sprite.update(0);
    expect(state()).toEqual(['bernie_big', 'activate']);
    expect(visual().scale.x).toBeCloseTo(0.014);
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
    expect(visual().scale.x).toBeCloseTo(0.014);
    advance(10);
    expect(state()[1]).toBe('deactivate_pst');
    advance(1);
    expect(state()).toEqual(['bernie_active', 'activate']);
    expect(visual().scale.x).toBeCloseTo(0.02);
    advance(21);
    expect(state()).toEqual(['bernie_active', 'idle_loop_nodir']);
    advance(15);
    expect(state()).toEqual(['bernie_active', 'idle_loop']);
    expect(model.position.toArray()).toEqual([2, 0.25, 3]);
    expect(prefabInstance(model)).toMatchObject({ entityId: 'same-bernie', skinId });
    expect(model.userData.itemId).toBe('bernie_inactive');

    // idle_nodir -> idle_loop preserves time (frame 15), rather than restarting.
    // Independently render an idle sprite at the same source time for comparison.
    const idle = await createBernieGroundSprite(assets, { getSanityPercent: () => 1 }, skinId);
    for (let i = 0; i < 15; i++) idle.update(1 / 30);
    const idleMesh = idle.model.children[0].children[0].children[0] as typeof mesh;
    expect(positions()).toEqual(positions(idleMesh));
    idle.dispose();
    // The skin's build replaces the base art at the same source time.
    if (skinId) {
      const plain = await createBernieGroundSprite(assets, { getSanityPercent: () => 1 });
      for (let i = 0; i < 15; i++) plain.update(1 / 30);
      expect(positions()).not.toEqual(positions(plain.model.children[0].children[0].children[0] as typeof mesh));
      plain.dispose();
    }
  } finally { sprite.dispose(); assets.dispose(); }
});

it('finishes a busy transformation using the latest sanity and cancels it on inventory/load events', async () => {
  let sanity = 1;
  const assets = new BernieAssets('/dst/data/anim');
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
    expect([sprite.model.name, animation()]).toEqual(['GroundItem:bernie_active', 'idle_loop']);
    sprite.update(0);
    expect(animation()).toBe('activate');
    sprite.model.dispatchEvent({ type: 'onputininventory' });
    advance(90);
    expect([sprite.model.name, animation()]).toEqual(['GroundItem:bernie_inactive', 'inactive']);
    sprite.model.dispatchEvent({ type: 'ondropped' });
    expect([sprite.model.name, animation()]).toEqual(['GroundItem:bernie_big', 'idle_loop']);
    sanity = 1;
    advance(5);
    sprite.model.dispatchEvent({ type: 'onload' });
    expect([sprite.model.name, animation()]).toEqual(['GroundItem:bernie_active', 'idle_loop']);
    sprite.dispose();
    sanity = 0.1;
    advance(90);
    expect(animation()).toBe('idle_loop');
  } finally { sprite.dispose(); assets.dispose(); }
});

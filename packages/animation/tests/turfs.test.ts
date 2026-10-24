import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GroundItemAssets, createGroundItemSprite } from '../../prefab/src/groundItems';
import { loadGroundTileAssets } from '../../prefab/src/groundTiles';
import { createRecipe } from '../../ui/src/categories/shared';

beforeEach(() => vi.stubGlobal('fetch', async (url: string) =>
  new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
afterEach(() => vi.unstubAllGlobals());

it('renders shared, renamed and independent turf poses from native builds and resolves crafting atlases', async () => {
  const assets = new GroundItemAssets('/dst/data/anim');
  try {
    // Sample the shared bank with a renamed clip, drama build, and separate CotL/beard builds.
    for (const [id, clip, build] of [
      ['turf_underrock', 'rock', 'turf'], ['turf_carpetfloor2', 'carpet2', 'turf_drama'],
      ['turf_cotl_brick', 'cotl_brick', 'turf_cotl'], ['turf_beard_rug', 'turf_beard', 'turf_beard'],
    ]) {
      const sprite = await createGroundItemSprite(assets, id);
      try {
        expect(sprite.currentAnimation).toBe(clip);
        const mesh = sprite.model.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
        expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
        expect(mesh.material.some(material => material.name === `ground:${build}`)).toBe(true);
        expect(Array.from(mesh.geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
        const pose = Array.from(mesh.geometry.getAttribute('position').array);
        sprite.update(10);
        expect(Array.from(mesh.geometry.getAttribute('position').array)).toEqual(pose);
      } finally { sprite.dispose(); }
    }
    expect(createRecipe('turf_woodfloor').inventoryAtlas).toBe('images/inventoryimages.xml');
    const cotl = createRecipe('turf_cotl_brick');
    expect(cotl.inventoryAtlas).toBe('images/inventoryimages3.xml');
    expect(cotl.inventoryIcon).toBe('turf_cotl_brick.tex');
    expect(cotl.skins).toEqual([]);
  } finally { assets.dispose(); }
});

it('loads the direct-path white road noise and the vault terrain independently of item names', async () => {
  for (const [name, path] of [
    ['ROAD', 'images/square.tex'], ['VAULT_CLEAN', 'levels/textures/Ground_noise_vault_clean.tex'],
  ] as const) {
    const assets = await loadGroundTileAssets('/dst/data', name);
    try {
      expect(assets.material.map!.name).toBe(path);
      expect(assets.material.map!.image.width).toBeGreaterThan(0);
      expect(assets.elements.size).toBe(48);
      expect(assets.material.depthWrite).toBe(false);
    } finally { assets.material.dispose(); }
  }
});

import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS, GROUND_ITEM_SKIN_SPECS, createGroundItemSprite } from '../../prefab/src/groundItems';
import { createWilsonPlayer, type WilsonAnimationController } from '../../prefab/src/player';
import { parseImageAtlasXml } from '../src/imageAtlas';

beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    const path = String(url).slice('/dst/data/'.length);
    return new Response(await readFile(new URL(`../../../public/dst/data/${path}`, import.meta.url)));
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('uses source ground art for base, ordinary, shared-build and invisible backpacks', async () => {
  expect(GROUND_ITEM_DEFINITIONS.backpack).toMatchObject({
    animationArchive: 'backpack.zip', buildArchives: ['swap_backpack.zip'], bank: 'backpack1', animation: 'anim',
  });
  const assets = new GroundItemAssets('/dst/data/anim');
  const skins = ['backpack_babybeef', 'backpack_catcoonp', 'backpack_invisible'];
  for (const skinId of [undefined, ...skins]) {
    const ground = await createGroundItemSprite(assets, 'backpack', skinId);
    const mesh = ground.model.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
    expect(mesh.geometry.drawRange.count, skinId).toBeGreaterThan(0);
    expect(Array.from(mesh.geometry.getAttribute('position').array).every(Number.isFinite), skinId).toBe(true);
    expect(ground.model.children[0].children).toHaveLength(1);
    if (skinId) expect(mesh.material.some((material) => material.name !== 'ground:swap_backpack'), skinId).toBe(true);
    ground.dispose();
  }
  assets.dispose();
});

it('uses skinned swap_body art in every player facing and hides invisible equipment', async () => {
  const player = await createWilsonPlayer('/dst/data/anim');
  const controller = player.userData.animationController as WilsonAnimationController;
  const mesh = player.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
  for (const skinId of ['backpack_babybeef', 'backpack_invisible']) {
    await controller.setBackpack(true, skinId);
    let hasSkinnedArt = false;
    for (const facing of ['up', 'down', 'side'] as const) {
      controller.setFacing(facing);
      controller.start('walk'); controller.update(1 / 30);
      hasSkinnedArt ||= mesh.material.some((material) => material.name.startsWith('ground:backpack_'));
      expect(mesh.material.some((material) => material.name === 'ground:swap_backpack'), skinId).toBe(false);
      expect(Array.from(mesh.geometry.getAttribute('position').array).every(Number.isFinite), skinId).toBe(true);
    }
    expect(hasSkinnedArt, skinId).toBe(skinId !== 'backpack_invisible');
  }
  await controller.setBackpack(false);
  expect(mesh.material.some((material) => material.name.startsWith('ground:backpack_'))).toBe(false);
});

it('resolves representative backpack icons and shared-build aliases from their actual atlases', async () => {
  const bytes = await readFile(new URL('../../../public/dst/data/databundles/images.zip', import.meta.url));
  const xmls = unzipSync(bytes, { filter: (entry) => /images\/inventoryimages\d*\.xml$/.test(entry.name) });
  for (const skinId of ['backpack_babybeef', 'backpack_catcoonp', 'backpack_mandrake_resurrected']) {
    const spec = GROUND_ITEM_SKIN_SPECS[skinId];
    expect(spec.itemId).toBe('backpack');
    expect(parseImageAtlasXml(new TextDecoder().decode(xmls[spec.atlas])).elements.has(spec.icon), skinId).toBe(true);
  }
  expect(GROUND_ITEM_DEFINITIONS.backpack.skinArchives.backpack_catcoonp).toBe('dynamic/backpack_catcoon.zip');
  expect(GROUND_ITEM_SKIN_SPECS.backpack_mandrake_resurrected.atlas).not.toBe('images/inventoryimages.xml');
});

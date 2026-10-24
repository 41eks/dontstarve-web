import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArchiveSpriteAssets, createArchiveSprite } from '../src/archiveSprite';
import { setSpriteEntityRenderOrder } from '../src/renderOrder';

beforeEach(() => vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  const path = String(url).slice(String(url).indexOf('/dst/data/') + '/dst/data/'.length);
  return new Response(await readFile(new URL(`../../../public/dst/data/${path}`, import.meta.url)));
})));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('creates split-archive sprites without prefab metadata and shares materials across independent geometry', async () => {
  vi.stubEnv('BASE_URL', '/preview/');
  const assets = new ArchiveSpriteAssets();
  const definition = { animationArchive: 'torch.zip', buildArchives: ['swap_torch.zip'],
    bank: 'torch', animation: 'idle', loop: false };
  const [first, second] = await Promise.all([
    createArchiveSprite(assets, definition, { name: 'first' }),
    createArchiveSprite(assets, definition, { name: 'second' }),
  ]);
  expect(fetch).toHaveBeenCalledWith('/preview/dst/data/anim/torch.zip');
  expect(fetch).toHaveBeenCalledWith('/preview/dst/data/anim/swap_torch.zip');
  const mesh = (model: THREE.Group) => model.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
  expect(first.model.name).toBe('first');
  expect(first.model.userData).toMatchObject({ billboard: true });
  expect(first.model.children[0].children).toHaveLength(1);
  expect(mesh(first.model).geometry.drawRange.count).toBeGreaterThan(0);
  expect(mesh(first.model).geometry).not.toBe(mesh(second.model).geometry);
  expect(mesh(first.model).material[0]).toBe(mesh(second.model).material[0]);
  expect(mesh(first.model).material[0].name).toBe('sprite:swap_torch');
  expect(mesh(first.model).material.every((material) => material.forceSinglePass)).toBe(true);
  setSpriteEntityRenderOrder(first.model, 42);
  expect(first.model.children[0].renderOrder).toBe(42);
  const disposeMaterial = vi.spyOn(mesh(first.model).material[0], 'dispose');
  first.dispose();
  expect(disposeMaterial).not.toHaveBeenCalled();
  expect(mesh(second.model).geometry.drawRange.count).toBeGreaterThan(0);
  second.dispose();
  assets.dispose();
  await Promise.resolve();
  expect(disposeMaterial).toHaveBeenCalledOnce();
});

it('pauses/resumes a source clip and accepts a caller-supplied food symbol override', async () => {
  const assets = new ArchiveSpriteAssets();
  const sprite = await createArchiveSprite(assets, {
    animationArchive: 'nightmarefuel.zip', buildArchives: ['nightmarefuel.zip'],
    bank: 'nightmarefuel', animation: 'idle_loop', loop: true,
    multColour: [1, 1, 1, 0.5], pointFiltering: true,
  });
  const mesh = sprite.model.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
  const translucent = mesh.material[0];
  const [shared, opaque] = await Promise.all([
    assets.loadBuild('nightmarefuel.zip', { multColour: [1, 1, 1, 0.5], pointFiltering: true }),
    assets.loadBuild('nightmarefuel.zip'),
  ]);
  expect(shared.materials[0]).toBe(translucent);
  expect(opaque.materials[0]).not.toBe(translucent);
  expect(translucent.opacity).toBe(0.5);
  expect(translucent.map!.magFilter).toBe(THREE.NearestFilter);
  expect(translucent.map!.minFilter).toBe(THREE.NearestFilter);
  expect(opaque.materials[0].opacity).toBe(1);
  expect(opaque.materials[0].map!.magFilter).toBe(THREE.LinearFilter);
  const disposeMaterial = vi.spyOn(translucent, 'dispose');
  const disposeTexture = vi.spyOn(translucent.map!, 'dispose');
  const positions = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  const version = positions.version;
  sprite.setPaused(true);
  for (let i = 0; i < 10; i++) sprite.update(0.1);
  expect(positions.version).toBe(version);
  sprite.setPaused(false);
  sprite.update(0.1);
  expect(positions.version).toBeGreaterThan(version);
  const food = await createArchiveSprite(assets, {
    animationArchive: 'cook_pot_food.zip', buildArchives: ['cook_pot_food.zip'],
    bank: 'cook_pot_food', animation: 'idle', loop: false,
    symbolOverrides: { swap_food: { archive: 'cook_pot_food.zip', symbol: 'meatballs' } },
  });
  const foodMesh = food.model.children[0].children[0] as THREE.Mesh;
  expect(foodMesh.geometry.drawRange.count).toBeGreaterThan(0);
  food.dispose();
  sprite.dispose();
  expect(disposeMaterial).not.toHaveBeenCalled();
  const disposedVersion = positions.version;
  sprite.setPaused(false);
  sprite.update(0.1);
  expect(positions.version).toBe(disposedVersion);
  assets.dispose();
  await Promise.resolve();
  expect(disposeMaterial).toHaveBeenCalledOnce();
  expect(disposeTexture).toHaveBeenCalledOnce();
});

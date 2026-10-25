import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArchiveSpriteAssets, createArchiveSprite, createSharedArchiveSprite } from '../src/archiveSprite';
import { setSpriteEntityRenderOrder } from '../src/renderOrder';
import { createAnimatedSpriteSource, loadBuildOverride, type SpriteController } from '../src/sprite';

beforeEach(() => vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  const path = String(url).slice(String(url).indexOf('/dst/data/') + '/dst/data/'.length);
  return new Response(await readFile(new URL(`../../../public/dst/data/${path}`, import.meta.url)));
})));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('matches native skinned berry layers and snow overrides while retaining independent shared appearances', async () => {
  const assets = new ArchiveSpriteAssets(), snow = await loadBuildOverride('/dst/data/anim', 'snow.zip');
  const reference = await createAnimatedSpriteSource('/dst/data/anim', 'berrybush.zip', {
    skinArchive: 'dynamic/berrybush_cawnival.zip',
  });
  const control = reference.create({ initialAnimation: 'idle', snowCovered: snow });
  const controller = control.userData.animationController as SpriteController;
  const definition = { animationArchive: 'berrybush.zip', buildArchives: ['berrybush.zip', 'snow.zip'], bank: 'berrybush',
    animation: 'idle', loop: true, symbolOverrides: { snow: { archive: 'snow.zip', symbol: 'snow' } } };
  const options = { skinArchive: 'dynamic/berrybush_cawnival.zip', instancedAnimations: 'all' as const };
  const first = await createSharedArchiveSprite(assets, definition, options);
  const second = await createSharedArchiveSprite(assets, definition, options);
  const mesh = (model: THREE.Object3D) => model.getObjectByProperty('isMesh', true) as THREE.Mesh;
  try {
    for (const layer of ['berries', 'berriesmore']) { controller.hideLayer(layer); first.setLayerHidden(layer, true); }
    controller.showLayer('snow'); controller.setFrame(0); first.setFrame(0);
    const positions = (model: THREE.Object3D) => {
      const geometry = mesh(model).geometry;
      return Array.from(geometry.getAttribute('position').array.slice(0, geometry.drawRange.count / 6 * 12));
    };
    expect(positions(first.model)).toEqual(positions(control));
    const withSnow = mesh(first.model).geometry;
    controller.hideLayer('snow'); first.setLayerHidden('snow', true);
    expect(positions(first.model)).toEqual(positions(control));
    expect(mesh(first.model).geometry.drawRange.count).toBeLessThan(withSnow.drawRange.count);
    // Identical appearance data shares immutable geometry; changing a sibling does not rewrite it.
    for (const layer of ['berries', 'berriesmore', 'snow']) second.setLayerHidden(layer, true);
    expect(mesh(first.model).geometry).toBe(mesh(second.model).geometry);
    const shared = mesh(second.model).geometry;
    first.setLayerHidden('berriesmost', true);
    expect(mesh(first.model).geometry.drawRange.count).toBeLessThan(shared.drawRange.count);
    expect(mesh(second.model).geometry).toBe(shared);
    first.setLayerHidden('berriesmost', false);
    expect(mesh(first.model).geometry).toBe(shared);
  } finally { first.dispose(); second.dispose(); reference.disposeSprite(control); reference.dispose(); snow.dispose(); assets.dispose(); }
});

it('shares later-selected clips without prefab clip lists while keeping opacity and completion callbacks local', async () => {
  const assets = new ArchiveSpriteAssets();
  const definition = { animationArchive: 'moonglass_bigwaterfall.zip', buildArchives: ['moonglass_bigwaterfall.zip'],
    bank: 'moonglass_bigwaterfall', animation: 'moonglass_1', loop: true };
  const first = await createSharedArchiveSprite(assets, definition, { opacity: .5 });
  const second = await createSharedArchiveSprite(assets, definition, { opacity: .8 });
  const mesh = (sprite: typeof first) => sprite.model.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
  try {
    expect(mesh(first).geometry).toBe(mesh(second).geometry);
    first.setOpacity(1);
    expect(mesh(first).material[0].opacity).toBe(1);
    expect(mesh(second).material[0].opacity).toBe(.8);
    const doneFirst = vi.fn(), doneSecond = vi.fn();
    first.playOnce('moonglass_1_mined', doneFirst);
    expect(mesh(first).geometry).not.toBe(mesh(second).geometry);
    second.playOnce('moonglass_1_mined', doneSecond);
    expect(mesh(first).geometry).toBe(mesh(second).geometry);
    for (let i = 0; i < 300 && doneFirst.mock.calls.length === 0; i++) first.update(.1);
    expect(doneFirst).toHaveBeenCalledOnce();
    expect(doneSecond).not.toHaveBeenCalled();
    first.update(.1);
    expect(doneFirst).toHaveBeenCalledOnce();
  } finally { first.dispose(); second.dispose(); assets.dispose(); }
});

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

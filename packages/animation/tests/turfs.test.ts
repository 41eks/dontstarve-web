import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GroundItemAssets, createGroundItemSprite } from '../../prefab/src/groundItems';
import { loadGroundTileAssets } from '../../prefab/src/groundTiles';
import { createRecipe } from '../../ui/src/categories/shared';
import { createInventoryStore } from '../../../src/inventory';
import { inventorySlotAddress } from '../../inventory/src';
import { TurfMap, WORLD_TILES } from '../../prefab/src/turfMap';
import { turfItemForTile } from '../../prefab/src/turfs';

vi.mock('../../prefab/src/sound', () => ({ PlaySound: vi.fn(), PreloadSounds: vi.fn(async () => {}) }));

beforeEach(() => vi.stubGlobal('fetch', async (url: string) =>
  new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
afterEach(() => vi.unstubAllGlobals());

it('renders shared, renamed and independent turf poses from native builds and resolves crafting atlases', async () => {
  const assets = new GroundItemAssets();
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
      expect((assets.material.map as THREE.DataTexture).image.width).toBeGreaterThan(0);
      expect(assets.elements.size).toBe(48);
      expect(assets.material.depthWrite).toBe(false);
    } finally { assets.material.dispose(); }
  }
});

it('deploys one CotL turf on dirt, rejects covered ground and restores terrain art and diggability', async () => {
  const inventory = createInventoryStore([{ slot_index: 0, id: 'turf_cotl_brick', num: 2 }]);
  const map = new TurfMap(48);
  const point = new THREE.Vector3(6, 0, 6), address = inventorySlotAddress(0);
  const deployer = { position: new THREE.Vector3(), PushEvent: vi.fn() };
  let restored: TurfMap | undefined;
  try {
    const entity = inventory.getEntity(address)!;
    expect(entity.hasTag('groundtile')).toBe(true);
    expect(entity.components.deployable!.CanDeploy(point, map)).toBe(false);
    expect(inventory.get(address)!.count).toBe(2);
    expect(map.dig(point)).toBe(true);
    const visual = await map.createVisual('/dst/data');
    const mini = await map.tileLayerImages();
    await map.prepareTurf('COTL_BRICK');
    const item = inventory.extract(address, 1, entity)!;
    expect(item.components.deployable!.Deploy(point, deployer, map)).toBe(true);
    expect(item.isRemoved).toBe(true);
    expect(inventory.get(address)!.count).toBe(1);
    expect(WORLD_TILES.COTL_BRICK).toBe(256); // TileManager's first non-legacy land ID, after ROAD=2.
    expect(map.getTileAtWorld(point)).toBe(WORLD_TILES.COTL_BRICK);
    expect(map.canPlaceTurf(point)).toBe(false);
    expect(entity.components.deployable!.CanDeploy(point, map)).toBe(false);
    expect(deployer.PushEvent).toHaveBeenCalledWith('deployitem', { prefab: 'turf_cotl_brick' });
    const brick = visual.getObjectByName('TurfBlend:COTL_BRICK') as THREE.Mesh;
    expect(brick.visible).toBe(true);
    expect(brick.geometry.getIndex()!.count).toBe(9 * 6);
    expect(mini.has(WORLD_TILES.COTL_BRICK)).toBe(true);
    expect(map.tileLayerQuads().get(WORLD_TILES.COTL_BRICK)).toHaveLength(9);
    restored = new TurfMap(48, map.exportTiles());
    const restoredVisual = await restored.createVisual('/dst/data');
    const restoredBrick = restoredVisual.getObjectByName('TurfBlend:COTL_BRICK') as THREE.Mesh;
    expect(restoredBrick.geometry.getAttribute('groundTileUv').array).toEqual(brick.geometry.getAttribute('groundTileUv').array);
    expect(turfItemForTile(restored.getTileAtWorld(point))).toBe('turf_cotl_brick');
    expect(restored.dig(point)).toBe(true);
    expect(restored.getTileAtWorld(point)).toBe(WORLD_TILES.DIRT);
    expect(restoredBrick.visible).toBe(false);
  } finally { restored?.dispose(); map.dispose(); inventory.dispose(); }
});

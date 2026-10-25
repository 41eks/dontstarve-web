import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { atlasReloadsSettled, createAtlasTexture, loadBuild } from '../src/animationAssets';
import { raycastSprite } from '../src/spriteRaycast';

beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => { vi.unstubAllGlobals(); });

/** A ray through the centre of one atlas texel of a unit plane drawn with `texture`. */
function picks(texture: THREE.DataTexture, x: number, y: number): boolean {
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.addGroup(0, Infinity, 0);
  const mesh = new THREE.Mesh(geometry, [new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: .01 })]);
  mesh.raycast = raycastSprite;
  mesh.updateMatrixWorld();
  const { width, height } = texture.image;
  const raycaster = new THREE.Raycaster(new THREE.Vector3((x + .5) / width - .5, (y + .5) / height - .5, 5), new THREE.Vector3(0, 0, -1));
  const hits: THREE.Intersection[] = [];
  mesh.raycast(raycaster, hits);
  geometry.dispose(); mesh.material[0].dispose();
  return hits.length > 0;
}

it('releases build atlas RGBA after the GPU upload, keeps alpha picking and decodes it again for a new GPU copy', async () => {
  const { atlases: [atlas] } = await loadBuild('bulb_plant_single.zip', '/dst/data/anim');
  const original = atlas.pixels!.slice();
  const texel = (alpha: (value: number) => boolean) => {
    const index = atlas.alpha!.findIndex(alpha);
    return [index % atlas.width, Math.floor(index / atlas.width)] as const;
  };
  const opaque = texel(value => value === 255), clear = texel(value => value === 0);
  const first = createAtlasTexture(atlas), second = createAtlasTexture(atlas);
  // Every texture of the atlas shares one Source, so the renderer keeps one GPU copy.
  expect(second.source).toBe(first.source);

  first.onUpdate!(first); // The renderer uploaded the shared pixels.
  expect(atlas.pixels).toBeUndefined();
  expect(first.image.data).toBeNull();
  expect(picks(second, ...opaque)).toBe(true);
  expect(picks(second, ...clear)).toBe(false);

  // A GPU copy made without data (a restored context) decodes the page again and binds every texture of it.
  const version = second.version;
  first.onUpdate!(first);
  await atlasReloadsSettled();
  expect(first.image.data).toEqual(original);
  expect(second.version).toBeGreaterThan(version);
  first.onUpdate!(first);
  expect(first.image.data).toBeNull();
  first.dispose(); second.dispose();
}, 20000);

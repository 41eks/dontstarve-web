import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { atlasReloadsSettled, createAtlasTexture, createMaterials, loadBuild } from '../src/animationAssets';
import { raycastSprite } from '../src/spriteRaycast';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** A ray through the centre of one atlas texel of a unit plane drawn with `texture`. */
function picks(texture: THREE.Texture, x: number, y: number): boolean {
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.addGroup(0, Infinity, 0);
  const mesh = new THREE.Mesh(geometry, [
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.01 }),
  ]);
  mesh.raycast = raycastSprite;
  mesh.updateMatrixWorld();
  const { width, height } = texture;
  const raycaster = new THREE.Raycaster(
    new THREE.Vector3((x + 0.5) / width - 0.5, (y + 0.5) / height - 0.5, 5),
    new THREE.Vector3(0, 0, -1),
  );
  const hits: THREE.Intersection[] = [];
  mesh.raycast(raycaster, hits);
  geometry.dispose();
  mesh.material[0].dispose();
  return hits.length > 0;
}

it('releases build atlas RGBA after the GPU upload, keeps alpha picking and decodes it again for a new GPU copy', async () => {
  const {
    atlases: [atlas],
  } = await loadBuild('bulb_plant_single.zip', '/dst/data/anim');
  const original = atlas.pixels!.slice();
  const texel = (alpha: (value: number) => boolean) => {
    const index = atlas.alpha!.findIndex(alpha);
    return [index % atlas.width, Math.floor(index / atlas.width)] as const;
  };
  const opaque = texel(value => value === 255),
    clear = texel(value => value === 0);
  // An RGBA build (loaded without atlas compression) makes DataTextures.
  const first = createAtlasTexture(atlas) as THREE.DataTexture,
    second = createAtlasTexture(atlas) as THREE.DataTexture;
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
  first.dispose();
  second.dispose();
}, 20000);

it('uploads a compressed build atlas as its BC blocks, keeps alpha picking and reads the blocks again', async () => {
  const [compressedBuild, rgbaBuild] = await Promise.all([
    loadBuild('bulb_plant_single.zip', '/dst/data/anim', true),
    loadBuild('bulb_plant_single.zip', '/dst/data/anim'),
  ]);
  const [atlas] = compressedBuild.atlases;
  // The two forms are cached apart: the RGBA build still serves DOM readers.
  expect(rgbaBuild.atlases[0]).not.toBe(atlas);
  expect(atlas.bcType).toBe(3);
  expect(atlas.pixels).toBeUndefined();
  expect(atlas.alpha).toEqual(rgbaBuild.atlases[0].alpha);
  const blocks = atlas.blocks!.slice();
  const opaque = atlas.alpha!.findIndex(value => value === 255),
    clear = atlas.alpha!.findIndex(value => value === 0);

  const [material] = createMaterials(compressedBuild);
  const texture = material.map as THREE.CompressedTexture;
  expect(texture).toBeInstanceOf(THREE.CompressedTexture);
  expect(texture.format).toBe(THREE.RGBA_S3TC_DXT5_Format);
  // DXT5 colour is premultiplied: sampled raw and decoded by the material, including its clones.
  expect(texture.colorSpace).toBe(THREE.NoColorSpace);
  const shader = { fragmentShader: '#include <map_pars_fragment>\nvoid main() {\n#include <map_fragment>\n}' };
  material.clone().onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  expect(shader.fragmentShader).toContain('diffuseColor *= dstPremultipliedSrgbTexel(texture2D(map, vMapUv));');
  expect(material.clone().customProgramCacheKey()).toBe('dst-premultiplied-srgb-atlas');

  texture.onUpdate!(texture); // The renderer uploaded the blocks.
  expect(atlas.blocks).toBeUndefined();
  expect(texture.source.dataReady).toBe(false);
  expect(picks(texture, opaque % atlas.width, Math.floor(opaque / atlas.width))).toBe(true);
  expect(picks(texture, clear % atlas.width, Math.floor(clear / atlas.width))).toBe(false);

  // A GPU copy made without data reads the blocks again, not RGBA.
  texture.onUpdate!(texture);
  await atlasReloadsSettled();
  expect(texture.source.dataReady).toBe(true);
  expect(texture.mipmaps[0].data).toEqual(blocks);
  texture.dispose();
  material.dispose();
}, 20000);

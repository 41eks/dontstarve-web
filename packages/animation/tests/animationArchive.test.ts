import { readFile } from 'node:fs/promises';
import { unzipSync, zipSync } from 'fflate';
import { afterEach, expect, it, vi } from 'vitest';
import { createMaterials, loadAnim, loadBuild, loadAnimationArchive, loadSpriteSkinArchive } from '../src/animationAssets';

afterEach(() => vi.unstubAllGlobals());

const chestArchive = () => readFile(new URL('../../../public/dst/data/anim/treasure_chest.zip', import.meta.url));

it('shares concurrent and repeated parsed assets while keeping GPU textures independent', async () => {
  const bytes = await chestArchive();
  const fetchAsset = vi.fn(async () => new Response(bytes));
  vi.stubGlobal('fetch', fetchAsset);
  const [build, animation, archive] = await Promise.all([
    loadBuild('treasure_chest.zip', '/dst/data/anim'),
    loadAnim('treasure_chest.zip', '/dst/data/anim/'),
    loadAnimationArchive('treasure_chest.zip', '/dst/data/anim'),
  ]);
  expect(archive.buildPackage).toBe(build);
  expect(archive.animations).toBe(animation);
  expect((await loadSpriteSkinArchive('treasure_chest.zip', '/dst/data/anim')).buildPackage).toBe(build);
  expect(fetchAsset).toHaveBeenCalledOnce();
  const first = createMaterials(build);
  const second = createMaterials(build);
  expect(first[0]).not.toBe(second[0]);
  expect(first[0].map).not.toBe(second[0].map);
  expect((first[0].map!.image as { data: Uint8Array }).data)
    .toBe((second[0].map!.image as { data: Uint8Array }).data);
  for (const material of [...first, ...second]) { material.map!.dispose(); material.dispose(); }
}, 30_000);

it('retries a failed shared archive load', async () => {
  const bytes = await chestArchive();
  const fetchAsset = vi.fn()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockImplementation(async () => new Response(bytes));
  vi.stubGlobal('fetch', fetchAsset);
  const failed = await Promise.allSettled([
    loadBuild('treasure_chest.zip', '/dst/data/anim'),
    loadAnim('treasure_chest.zip', '/dst/data/anim'),
  ]);
  expect(failed.every(({ status }) => status === 'rejected')).toBe(true);
  expect((await loadAnimationArchive('treasure_chest.zip', '/dst/data/anim')).buildPackage.atlases[0].pixels.length).toBeGreaterThan(0);
  expect(fetchAsset).toHaveBeenCalledTimes(2);
});

it('accepts build-only skins without weakening required animation validation', async () => {
  const entries = unzipSync(await chestArchive());
  delete entries['anim.bin'];
  vi.stubGlobal('fetch', vi.fn(async () => new Response(zipSync(entries))));
  const skin = await loadSpriteSkinArchive('build-only.zip', '/dst/data/anim');
  expect(skin.animations).toBeUndefined();
  expect(skin.buildPackage.build.symbols.size).toBeGreaterThan(0);
  await expect(loadAnim('build-only.zip', '/dst/data/anim')).rejects.toThrow('does not contain anim.bin');
});

import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArchiveSpriteAssets, createSharedArchiveSprite, type ArchiveSprite } from '../src/archiveSprite';

beforeEach(() => vi.stubGlobal('fetch', async (url: string) =>
  new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const definition = {
  animationArchive: 'mushroom_tree_tall.zip',
  buildArchives: ['mushroom_tree_tall.zip', 'mushroom_tree_tall_bloom.zip'],
  bank: 'mushroom_tree',
  hiddenSymbols: [1, 2, 3].flatMap(index => [`swap_acidglob${index}`, `swap_acidglob_bloom${index}`]),
  animation: 'idle_loop', loop: true,
};
const mesh = (sprite: ArchiveSprite) => sprite.model.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
function finish(sprite: ArchiveSprite, next: string) {
  for (let i = 0; i < 300 && sprite.currentAnimation !== next; i++) sprite.update(.1);
  expect(sprite.currentAnimation).toBe(next);
}

it('shares idle, work and fall frames across tinted trees while playback and resource lifetimes stay independent', async () => {
  const assets = new ArchiveSpriteAssets();
  const first = await createSharedArchiveSprite(assets, definition, { colour: [.5, .5, .5] });
  const second = await createSharedArchiveSprite(assets, definition, { colour: [.9, .9, .9] });
  try {
    const sharedIdle = mesh(first).geometry;
    expect(mesh(second).geometry).toBe(sharedIdle);
    expect(mesh(first).material[0]).not.toBe(mesh(second).material[0]);
    expect(mesh(first).material[0].map).toBe(mesh(second).material[0].map);
    expect(mesh(first).material[0].color.r).toBeCloseTo(.5);
    expect(mesh(second).material[0].color.r).toBeCloseTo(.9);
    first.setFrame(5);
    expect(mesh(first).geometry).not.toBe(mesh(second).geometry);
    second.setFrame(5);
    expect(mesh(first).geometry).toBe(mesh(second).geometry);
    const idlePositions = [...mesh(second).geometry.getAttribute('position').array];
    first.playOnce('chop', () => first.start('idle_loop'));
    const workGeometry = mesh(first).geometry;
    expect(workGeometry).not.toBe(mesh(second).geometry);
    expect(first.currentAnimation).toBe('chop');
    expect(second.currentAnimation).toBe('idle_loop');
    second.playOnce('chop');
    expect(mesh(second).geometry).toBe(workGeometry);
    second.start('idle_loop'); second.setFrame(5);
    // A second hit restarts the local work animation without affecting other trees.
    first.update(.1); first.playOnce('chop', () => first.start('idle_loop'));
    finish(first, 'idle_loop');
    first.setFrame(5);
    expect(mesh(first).geometry).toBe(mesh(second).geometry);
    expect([...mesh(second).geometry.getAttribute('position').array]).toEqual(idlePositions);
    first.playOnce('fall', () => first.start('idle_stump'));
    const fallGeometry = mesh(first).geometry;
    finish(first, 'idle_stump');
    expect(second.currentAnimation).toBe('idle_loop');
    second.playOnce('fall', () => second.start('idle_stump'));
    expect(mesh(second).geometry).toBe(fallGeometry);
    finish(second, 'idle_stump');
    expect(mesh(first).geometry).toBe(mesh(second).geometry);

    const sharedStump = mesh(second).geometry;
    const sharedDisposed = vi.fn(), workDisposed = vi.fn(), textureDisposed = vi.fn();
    sharedStump.addEventListener('dispose', sharedDisposed);
    workGeometry.addEventListener('dispose', workDisposed);
    mesh(second).material[0].map!.addEventListener('dispose', textureDisposed);
    first.dispose();
    expect(workDisposed).not.toHaveBeenCalled();
    expect(sharedDisposed).not.toHaveBeenCalled();
    expect(textureDisposed).not.toHaveBeenCalled();
    second.setFrame(0);
    expect(mesh(second).geometry).toBe(sharedStump);
    second.dispose();
    expect(sharedDisposed).not.toHaveBeenCalled();
    assets.dispose();
    await Promise.resolve();
    expect(sharedDisposed).toHaveBeenCalledOnce();
    expect(workDisposed).toHaveBeenCalledOnce();
    expect(textureDisposed).toHaveBeenCalledOnce();
  } finally { first.dispose(); second.dispose(); assets.dispose(); }
});

it('keeps bloom builds and hidden-symbol variants separate without changing neighbouring trees', async () => {
  const assets = new ArchiveSpriteAssets();
  const first = await createSharedArchiveSprite(assets, definition);
  const second = await createSharedArchiveSprite(assets, definition);
  try {
    const normal = mesh(second).geometry;
    first.setBuildArchive('mushroom_tree_tall_bloom.zip');
    expect(mesh(first).geometry).not.toBe(normal);
    expect(mesh(second).geometry).toBe(normal);
    second.setBuildArchive('mushroom_tree_tall_bloom.zip');
    const bloom = mesh(first).geometry;
    expect(mesh(second).geometry).toBe(bloom);
    // Appearance changes during a one-shot clip must still select the new idle cache on return.
    first.playOnce('chop', () => first.start('idle_loop'));
    first.setBuildArchive('mushroom_tree_tall.zip');
    finish(first, 'idle_loop');
    expect(mesh(second).geometry).toBe(bloom);
    expect(mesh(first).geometry).not.toBe(bloom);
    second.setBuildArchive('mushroom_tree_tall.zip');
    first.setFrame(0); second.setFrame(0);
    const normalAgain = mesh(first).geometry;
    expect(mesh(second).geometry).toBe(normalAgain);
    first.setSymbolHidden('trnk_top', true);
    expect(mesh(first).geometry.drawRange.count).toBeLessThan(normalAgain.drawRange.count);
    expect(mesh(second).geometry).toBe(normalAgain);
    second.setSymbolHidden('trnk_top', true);
    expect(mesh(first).geometry).toBe(mesh(second).geometry);
    first.setSymbolHidden('trnk_top', false);
    expect(mesh(first).geometry).toBe(normalAgain);
  } finally { first.dispose(); second.dispose(); assets.dispose(); }
});

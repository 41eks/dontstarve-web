
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createAnimatedSprite, loadBuildOverride, type SpriteController } from '../src/sprite';
import { birdcage_init_fn } from '../src/prefabskin';
import { BIRDCAGE_DEFINITION } from '../../prefab/src/birdcage';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const relative = url.slice(url.indexOf('/dst/data/') + '/dst/data/'.length);
    return new Response(await readFile(new URL(`../../../public/dst/data/${relative}`, import.meta.url)));
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function spawn(animation: string, skinId?: string) {
  const skin = skinId === undefined ? undefined : birdcage_init_fn(skinId);
  return createAnimatedSprite('/dst/data/anim', skin?.archive ?? BIRDCAGE_DEFINITION.archive, {
    initialAnimation: animation, scale: BIRDCAGE_DEFINITION.scale, skinArchive: skin?.skinArchive,
  });
}

function meshOf(model: THREE.Group) {
  const meshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>[] = [];
  model.traverse(object => { if (object instanceof THREE.Mesh) meshes.push(object as typeof meshes[number]); });
  expect(meshes).toHaveLength(1);
  return meshes[0];
}

it('AddOverrideBuild draws the caged bird from its own build and ClearOverrideBuild restores the cage-only frame', async () => {
  const model = await spawn('idle_bird');
  const controller = model.userData.animationController as SpriteController;
  const bare = meshOf(model).geometry.drawRange.count;
  const canary = await loadBuildOverride('/dst/data/anim', 'canary_build.zip');
  controller.addOverrideBuild('canary_build', canary);
  expect(fetch).toHaveBeenCalledWith('/dst/data/anim/canary_build.zip');
  // The bird symbols come from the second build, so the frame uses both atlases and more geometry.
  expect(meshOf(model).material.length).toBeGreaterThan(1);
  expect(meshOf(model).geometry.drawRange.count).toBeGreaterThan(bare);
  controller.clearOverrideBuild('canary_build');
  expect(meshOf(model).geometry.drawRange.count).toBe(bare);
  canary.dispose();
});

it('keeps the bird override on a skinned cage, with gothicp using the gothic build', async () => {
  const model = await spawn('idle_bird', 'birdcage_gothicp');
  expect(fetch).toHaveBeenCalledWith('/dst/data/anim/dynamic/birdcage_gothic.zip');
  expect(fetch).not.toHaveBeenCalledWith('/dst/data/anim/dynamic/birdcage_gothicp.zip');
  const controller = model.userData.animationController as SpriteController;
  const bird = await loadBuildOverride('/dst/data/anim', 'crow_build.zip');
  const before = meshOf(model).geometry.drawRange.count;
  controller.addOverrideBuild('crow_build', bird);
  expect(meshOf(model).geometry.drawRange.count).toBeGreaterThan(before);
  expect(Object.keys(BIRDCAGE_DEFINITION.skinArchives!)).toHaveLength(8);
  bird.dispose();
});

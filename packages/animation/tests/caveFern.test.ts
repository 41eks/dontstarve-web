import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { CaveFernManager } from '../../prefab/src/cave_fern';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { bindTestWorld, tickWorld } from './worldContentFixture';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { createMemo, createSignal } from '../../signals/src';
import { SpriteState } from '@dontstarve-web/display';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('preserves cave fern poses and components across residency, then picks foliage and cutgrass and removes them', async () => {
  const archives = new Map<string, Uint8Array>();
  for (const file of ['cave_ferns.zip', 'cave_ferns_withered_build.zip', 'fire.zip']) {
    archives.set(file, await readFile(new URL(`../../../public/dst/data/anim/${file}`, import.meta.url)));
  }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(new Uint8Array(archives.get(url.split('/').pop()!)!))));
  vi.stubGlobal('window', new EventTarget());

  const scene = new THREE.Scene();
  const scheduler = new GameTimeScheduler();
  const awake = createSignal(true);
  const { camerarotation } = bindTestWorld(scheduler);
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), .8);
  camerarotation.set(rotation);
  const ferns = new CaveFernManager(scene, '/dst/data/anim', {
    tickingarea: () => createMemo(() => awake.get()),
    prepareSpawn: async () => ({ spawn: () => true, dispose() {} }),
  });

  const fern = await ferns.spawn('cave_fern', new THREE.Vector3(2, 0, 3));
  const withered = await ferns.spawn('cave_fern_withered', new THREE.Vector3(-2, 0, 3));
  // cave_fern.lua: a random f1..f10 pose, saved as data.anim; the plant has no workable, so DIG cannot target it.
  const pose = (model: THREE.Group) => model.userData.animationController.currentAnimation as string;
  expect(pose(fern)).toMatch(/^f([1-9]|10)$/);
  expect(fern.userData.components.workable).toBeUndefined();
  expect(ferns.digTargets).toEqual([]);
  const records = ferns.exportRecords();
  expect(records.map(({ prefabId, record }) => [prefabId, record.components.variant?.anim])).toEqual([
    ['cave_fern', pose(fern)], ['cave_fern_withered', pose(withered)]]);
  expect(() => PREFAB_DEFINITIONS.caveFerns.parseComponents(
    { variant: { anim: 'f11' } }, 'x', { grounded: true } as never)).toThrow();

  const restored = await ferns.spawn('cave_fern', new THREE.Vector3(5, 0, 5), { ...records[0].record, id: 'restored' });
  expect(pose(restored)).toBe(pose(fern));

  const plants = [fern, withered];
  const components = plants.map(plant => plant.userData.components);
  const meshCount = (plant: THREE.Group) => {
    let count = 0;
    plant.traverse(object => { if ((object as THREE.Mesh).isMesh) count++; });
    return count;
  };
  await new Promise(resolve => setTimeout(resolve, 0));
  for (const plant of plants) {
    expect(plant.userData.animationController).toBeInstanceOf(SpriteState);
    expect(meshCount(plant)).toBeGreaterThan(0);
  }
  awake.set(false);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(ferns.renderEntities).toEqual([]);
  expect(ferns.exportRecords().slice(0, 2)).toEqual(records);
  for (const [index, plant] of plants.entries()) {
    expect(meshCount(plant)).toBe(0);
    expect(plant.parent).toBeNull();
    expect(plant.userData.components).toBe(components[index]);
  }
  awake.set(true);
  await new Promise(resolve => setTimeout(resolve, 0));
  for (const [index, plant] of plants.entries()) {
    expect(meshCount(plant)).toBeGreaterThan(0);
    expect(plant.parent).toBe(scene);
    expect(pose(plant)).toBe(records[index].record.components.variant!.anim);
    expect(plant.children[0].quaternion.angleTo(rotation)).toBeLessThan(1e-7);
  }
  expect(ferns.exportRecords().slice(0, 2)).toEqual(records);

  const given: string[] = [];
  expect(fern.userData.components.pickable.quickpick).toBe(true);
  expect(fern.userData.components.pickable.pick({ giveItem: (id: string) => { given.push(id); return true; } })).toBe(true);
  expect(withered.userData.components.pickable.pick({ giveItem: (id: string) => { given.push(id); return true; } })).toBe(true);
  expect(given).toEqual(['foliage', 'cutgrass']);
  tickWorld(scheduler, ferns, 1 / 30, new THREE.Quaternion());
  // remove_when_picked: nothing remains to save or render but the restored fern.
  expect(ferns.exportRecords().map(({ record }) => record.id)).toEqual(['restored']);
  // The display leaves the scene in its effect.
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(scene.children).not.toContain(fern);
  awake.set(false);
  await new Promise(resolve => setTimeout(resolve, 0));
  awake.set(true);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(scene.children).not.toContain(fern);
  expect(scene.children).not.toContain(withered);
  ferns.dispose();
});

import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { CaveFernManager } from '../../prefab/src/cave_fern';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { bindTestWorld, tickWorld } from './worldContentFixture';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('picks cave ferns for foliage and cutgrass, removes them, and restores the saved pose', async () => {
  const archives = new Map<string, Uint8Array>();
  for (const file of ['cave_ferns.zip', 'cave_ferns_withered_build.zip', 'fire.zip']) {
    archives.set(file, await readFile(new URL(`../../../public/dst/data/anim/${file}`, import.meta.url)));
  }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(new Uint8Array(archives.get(url.split('/').pop()!)!))));
  vi.stubGlobal('window', new EventTarget());

  const scene = new THREE.Scene();
  const scheduler = new GameTimeScheduler();
  bindTestWorld(scheduler);
  const ferns = new CaveFernManager(scene, '/dst/data/anim', { prepareSpawn: async () => ({ spawn: () => true, dispose() {} }) });

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

  const given: string[] = [];
  expect(fern.userData.components.pickable.quickpick).toBe(true);
  expect(fern.userData.components.pickable.pick({ giveItem: (id: string) => { given.push(id); return true; } })).toBe(true);
  expect(withered.userData.components.pickable.pick({ giveItem: (id: string) => { given.push(id); return true; } })).toBe(true);
  expect(given).toEqual(['foliage', 'cutgrass']);
  tickWorld(scheduler, ferns, 1 / 30, new THREE.Quaternion());
  // remove_when_picked: nothing remains to save or render but the restored fern.
  expect(ferns.exportRecords().map(({ record }) => record.id)).toEqual(['restored']);
  expect(scene.children).not.toContain(fern);
  ferns.dispose();
});

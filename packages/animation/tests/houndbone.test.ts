import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { HoundboneManager } from '../../prefab/src/houndbone';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import type { GroundItemDefinition } from '../../prefab/src/groundPrefab';
import { prefabInstance } from '../../prefab/src/prefabInstance';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('hammers a hound bone once into boneshards, adds a houndstooth chance for piece3 only, and restores its type', async () => {
  const archives = new Map<string, Uint8Array>();
  for (const file of ['hound_base.zip', 'structure_collapse_fx.zip']) {
    archives.set(file, await readFile(new URL(`../../../public/dst/data/anim/${file}`, import.meta.url)));
  }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(new Uint8Array(archives.get(url.split('/').pop()!)!))));
  vi.stubGlobal('window', new EventTarget());

  const dropped: string[] = [];
  const scene = new THREE.Scene();
  const bones = new HoundboneManager(scene, {
    spawnGroundItem: (definition: GroundItemDefinition) => { dropped.push(definition.itemId); return undefined; },
  });

  const record = (bonetype: number, id: string) => ({ id, transform: { position: [1, 0, 2] as [number, number, number], rotationY: 0 },
    components: { houndbone: { bonetype } } });
  const one = await bones.spawn(new THREE.Vector3(1, 0, 2), record(1, 'a'));
  const three = await bones.spawn(new THREE.Vector3(3, 0, 2), record(3, 'c'));
  // houndbone.lua: bonetype n plays piece<n>; the entity carries the `bone` tag and a HAMMER workable of 1.
  expect(one.userData.animationController.currentAnimation).toBe('piece1');
  expect(three.userData.animationController.currentAnimation).toBe('piece3');
  expect(prefabInstance(one)!.listTags()).toContain('bone');
  expect(bones.exportRecords().map(({ record }) => record.components.houndbone?.bonetype)).toEqual([1, 3]);
  expect(() => PREFAB_DEFINITIONS.houndbones.parseComponents({ houndbone: { bonetype: 4 } }, 'x', { grounded: true } as never)).toThrow();

  const restored = await bones.spawn(new THREE.Vector3(5, 0, 5));
  expect([1, 2, 3]).toContain(bones.exportRecords().find(({ record }) => record.id === restored.userData.instance?.entityId)?.record.components.houndbone?.bonetype);

  const target = bones.hammerTargets.find(({ model }) => model === one)!;
  target.playHit();
  // The single hit finishes the work: boneshard drops, the bone leaves the scene and the save.
  expect(dropped).toEqual(['boneshard']);
  expect(bones.exportRecords().map(({ record }) => record.id)).not.toContain('a');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(scene.children).not.toContain(one);
  bones.dispose();
});

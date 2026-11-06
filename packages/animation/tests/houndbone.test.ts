import { prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import { createTestWorldFx } from './worldFxFixture';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { houndbonePrefabs, HOUNDBONE_ID } from '../../prefab/src/houndbone';
import { PrefabDisplayGroup } from '@dontstarve-web/display';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import type { GroundItemDefinition } from '../../prefab/src/groundPrefab';
import { PrefabEntityManager, prefabInstance, type PrefabInstance } from '../../prefab/src/prefabInstance';
import { workTargets } from './workTargets';

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
  const displays = new PrefabDisplayGroup(scene);
  const bones = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', {});
  bones.register(houndbonePrefabs({
    fx: createTestWorldFx(scene),
    spawnGroundItem: (definition: GroundItemDefinition) => { dropped.push(definition.itemId); return undefined; },
  }) as never);

  const record = (bonetype: number, id: string) => ({ id, transform: { position: [1, 0, 2] as [number, number, number], rotationY: 0 },
    components: { houndbone: { bonetype } } });
  const one = bones.spawn(HOUNDBONE_ID, new THREE.Vector3(1, 0, 2), record(1, 'a')).transform.model;
  const three = bones.spawn(HOUNDBONE_ID, new THREE.Vector3(3, 0, 2), record(3, 'c')).transform.model;
  // houndbone.lua: bonetype n plays piece<n>; the entity carries the `bone` tag and a HAMMER workable of 1.
  expect(prefabInstance(one)!.sprite.currentAnimation).toBe('piece1');
  expect(prefabInstance(three)!.sprite.currentAnimation).toBe('piece3');
  expect(prefabInstance(one)!.listTags()).toContain('bone');
  expect(bones.exportRecords().map(({ record }) => record.components.houndbone?.bonetype)).toEqual([1, 3]);
  expect(() => PREFAB_DEFINITIONS.houndbones.parseComponents({ houndbone: { bonetype: 4 } }, 'x', { grounded: true } as never)).toThrow();

  const restored = bones.spawn(HOUNDBONE_ID, new THREE.Vector3(5, 0, 5)).transform.model;
  expect([1, 2, 3]).toContain(bones.exportRecords().find(({ record }) => record.id === lookupPrefabInstance(restored)?.entityId)?.record.components.houndbone?.bonetype);

  const target = workTargets('HAMMER').find(target => target.model === one)!;
  target.work();
  const collapse = scene.getObjectByName('collapse_small');
  expect(collapse).toBeDefined();
  expect(prefabInstance(collapse)!.listTags()).toEqual(expect.arrayContaining(['FX', 'NOCLICK']));
  // The single hit finishes the work: boneshard drops, the bone leaves the scene and the save.
  expect(dropped).toEqual(['boneshard']);
  expect(bones.exportRecords().map(({ record }) => record.id)).not.toContain('a');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(scene.children).not.toContain(one);
  bones.dispose(); displays.dispose();
});

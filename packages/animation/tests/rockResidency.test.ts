import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { PrefabEntityManager, prefabInstance, type PrefabInstance } from '../../prefab/src/prefabInstance';
import { PrefabDisplayGroup } from '@dontstarve-web/display';
import { rockPrefabs } from '../../prefab/src/rocks';
import { skeletonPrefabs } from '../../prefab/src/skeleton';
import { houndbonePrefabs, HOUNDBONE_ID } from '../../prefab/src/houndbone';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { bindTestWorld } from './worldContentFixture';
import { workTargets } from './workTargets';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
async function waitForVisual(model: THREE.Object3D): Promise<void> {
  for (let attempt = 0; attempt < 30 && !prefabInstance(model)!.sprite.loaded; attempt++) await settle();
  expect(prefabInstance(model)!.sprite.loaded).toBe(true);
}
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const spawnGroundItem = () => undefined;
const meshes = (model: THREE.Object3D) => { const found: THREE.Mesh[] = []; model.traverse(o => { if (o instanceof THREE.Mesh) found.push(o); }); return found; };

it('releases rock, skeleton and houndbone sprites outside the tickingarea and redresses them on return', async () => {
  const awake = createSignal(true), scheduler = new GameTimeScheduler();
  const tickingarea = () => createMemo(() => awake.get());
  const scene = new THREE.Scene();
  const displays = new PrefabDisplayGroup(scene);
  const bones = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { tickingarea });
  bones.register(rockPrefabs({ scheduler, spawnGroundItem, spawnPrefab: (id, position) => bones.spawn(id, position) }) as never);
  bones.register(houndbonePrefabs({ spawnGroundItem }) as never);
  bones.register(skeletonPrefabs({ spawnGroundItem }) as never);
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), .6);
  // The displays turn themselves to the world's camera rotation.
  const content = bindTestWorld(scheduler);
  try {
    const rock = bones.spawn('rock1', new THREE.Vector3(4, 0, 6)).transform.model;
    const skeleton = bones.spawn('skeleton', new THREE.Vector3(8, 0, 6)).transform.model;
    const bone = bones.spawn(HOUNDBONE_ID, new THREE.Vector3(12, 0, 6)).transform.model;
    const models = [rock, skeleton, bone];
    await Promise.all(models.map(waitForVisual));
    const records = bones.exportRecords();
    const colour = (meshes(rock)[0].material as THREE.MeshBasicMaterial[])[0].color.r;
    const hammer = workTargets('HAMMER')[0];
    awake.set(false); await settle();
    for (const model of models) {
      expect(prefabInstance(model)!.status.peek()).toBe('asleep');
      expect(prefabInstance(model)!.sprite.loaded).toBe(false);
      expect(model.parent).toBeNull();
      expect(meshes(model)).toEqual([]);
    }
    expect(bones.renderEntities).toEqual([]);
    expect(bones.exportRecords()).toEqual(records);
    expect(hammer.isValid()).toBe(true);
    content.camerarotation.set(rotation);
    awake.set(true); await settle();
    await Promise.all(models.map(waitForVisual));
    displays.update(0);
    for (const model of models) {
      expect(prefabInstance(model)!.status.peek()).toBe('active');
      expect(prefabInstance(model)!.sprite.loaded).toBe(true);
      expect(model.parent).toBe(scene);
      expect(model.children[0].quaternion.equals(rotation)).toBe(true);
    }
    // Awake billboards turn in the task that publishes the rotation, before that frame renders.
    const turned = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.2);
    content.camerarotation.set(turned);
    for (const model of models) expect(model.children[0].quaternion.equals(turned)).toBe(true);
    expect((meshes(rock)[0].material as THREE.MeshBasicMaterial[])[0].color.r).toBe(colour);
    expect(bones.renderEntities).toHaveLength(3);
  } finally { bones.dispose(); displays.dispose(); content.unbind(); scheduler.dispose(); }
});

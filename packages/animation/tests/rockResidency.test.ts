import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { RockManager } from '../../prefab/src/rocks';
import { SkeletonManager } from '../../prefab/src/skeleton';
import { HoundboneManager } from '../../prefab/src/houndbone';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { bindTestWorld } from './worldContentFixture';

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
  const rocks = new RockManager(scene, '/dst/data/anim', { scheduler, tickingarea, spawnGroundItem });
  const skeletons = new SkeletonManager(scene, { tickingarea, spawnGroundItem });
  const bones = new HoundboneManager(scene, { tickingarea, spawnGroundItem });
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), .6);
  // The displays turn themselves to the world's camera rotation.
  const content = bindTestWorld(scheduler);
  try {
    const rock = await rocks.spawn('rock1', new THREE.Vector3(4, 0, 6));
    const skeleton = await skeletons.spawn('skeleton', new THREE.Vector3(8, 0, 6));
    const bone = await bones.spawn(new THREE.Vector3(12, 0, 6));
    const models = [rock, skeleton, bone];
    await Promise.all(models.map(waitForVisual));
    const records = [rocks.exportRecords(), skeletons.exportRecords(), bones.exportRecords()];
    const colour = (meshes(rock)[0].material as THREE.MeshBasicMaterial[])[0].color.r;
    const hammer = skeletons.hammerTargets[0];
    awake.set(false); await settle();
    for (const model of models) {
      expect(prefabInstance(model)!.status.peek()).toBe('asleep');
      expect(prefabInstance(model)!.sprite.loaded).toBe(false);
      expect(model.parent).toBeNull();
      expect(meshes(model)).toEqual([]);
    }
    expect([...rocks.renderEntities, ...skeletons.renderEntities, ...bones.renderEntities]).toEqual([]);
    expect([rocks.exportRecords(), skeletons.exportRecords(), bones.exportRecords()]).toEqual(records);
    expect(hammer.isValid()).toBe(true);
    content.camerarotation.set(rotation);
    awake.set(true); await settle();
    await Promise.all(models.map(waitForVisual));
    rocks.update(0, rotation); skeletons.update(0, rotation); bones.update(0, rotation);
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
    expect(rocks.renderEntities).toHaveLength(1);
  } finally { rocks.dispose(); skeletons.dispose(); bones.dispose(); content.unbind(); scheduler.dispose(); }
});

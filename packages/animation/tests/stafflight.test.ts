import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DwarfStarManager, dwarfStarLight, DWARF_STAR_DURATION, STAFF_LIGHT_ACTIVE_RADIUS } from '../../prefab/src/stafflight';
import { getPrefabLocalLight } from '../../prefab/src/localLight';
import { PlaySound } from '../../prefab/src/sound';
import type { SpriteAnimationController } from '../src/sprite';
import { setSpriteEntityRenderOrder } from '../src/renderOrder';

vi.mock('../../prefab/src/sound', () => ({
  PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop: vi.fn() })),
}));

const managers: DwarfStarManager[] = [];
beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(
    new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(async () => {
  for (const manager of managers.splice(0)) manager.dispose();
  await Promise.resolve();
  vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals();
});

function setup() {
  const scene = new THREE.Scene(), player = new THREE.Vector3();
  const manager = new DwarfStarManager(scene, '/dst/data/anim', 'stafflight', () => player);
  managers.push(manager);
  const update = (dt: number) => manager.update(dt, new THREE.Quaternion());
  return { manager, scene, player, update };
}

it('settles lifetime at frame 60 using actual dt and releases light, sound and geometry after disappearance', async () => {
  const { manager, scene, update } = setup();
  const model = await manager.spawn(new THREE.Vector3(), { id: 'e_star', remainingSeconds: 0.8 });
  const controller = model.userData.animationController as SpriteAnimationController;
  const play = vi.spyOn(controller, 'playOnce');
  const mesh = model.children[0].children[0].children[0] as THREE.Mesh;
  const disposeGeometry = vi.spyOn(mesh.geometry, 'dispose');
  const loop = vi.mocked(PlaySound).mock.results[0].value;
  for (let frame = 0; frame < 59; frame++) update(0.01);
  for (const dt of [0, -1, NaN, Infinity]) update(dt);
  expect(play).not.toHaveBeenCalled();
  // One long frame counts once, but its whole duration is consumed.
  update(0.31);
  expect(play).toHaveBeenCalledExactlyOnceWith('disappear', expect.any(Function));
  expect(loop.stop).not.toHaveBeenCalled();
  expect(model.parent).toBe(scene);
  expect(manager.exportRecords()).toEqual([]);
  for (let frame = 0; frame < 10; frame++) update(0.1);
  await Promise.resolve();
  expect(model.parent).toBeNull();
  expect(getPrefabLocalLight(model)).toBeUndefined();
  expect(loop.stop).toHaveBeenCalled();
  expect(disposeGeometry).toHaveBeenCalled();
});

it('unloads outside the circular XZ range and rebuilds in place after catching up without replaying appearance', async () => {
  const { manager, scene, player, update } = setup();
  const position = new THREE.Vector3(4, 0, 6);
  const model = await manager.spawn(position);
  const controller = model.userData.animationController as SpriteAnimationController;
  const animationUpdate = vi.spyOn(controller, 'update');
  const oldSprite = model.children[0];
  const mesh = oldSprite.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
  const disposeGeometry = vi.spyOn(mesh.geometry, 'dispose');
  const sharedMaterial = mesh.material[0];
  const disposeMaterial = vi.spyOn(sharedMaterial, 'dispose');
  const disposeTexture = vi.spyOn(sharedMaterial.map!, 'dispose');
  update(0.2);
  player.set(position.x + STAFF_LIGHT_ACTIVE_RADIUS, 500, position.z);
  update(0.1);
  expect(model.parent).toBe(scene);
  player.x += 0.001;
  update(0.1);
  expect(model.parent).toBeNull();
  expect(model.children).toHaveLength(0);
  expect(model.userData.animationController).toBeUndefined();
  expect(disposeGeometry).toHaveBeenCalledOnce();
  expect(disposeMaterial).not.toHaveBeenCalled();
  expect(disposeTexture).not.toHaveBeenCalled();
  expect(getPrefabLocalLight(model)).toBeUndefined();
  expect(manager.renderEntities).toEqual([]);
  const oldLoop = vi.mocked(PlaySound).mock.results[1].value;
  expect(oldLoop.stop).toHaveBeenCalledOnce();
  animationUpdate.mockClear();
  for (let frame = 0; frame < 120; frame++) update(0.1);
  expect(animationUpdate).not.toHaveBeenCalled();
  player.copy(position);
  update(0.2);
  expect(model.parent).toBe(scene);
  const newSprite = model.children[0];
  expect(newSprite).not.toBe(oldSprite);
  expect(newSprite.userData.entityId).toBe(model.userData.entityId);
  const newMesh = newSprite.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
  expect(newMesh.material[0]).toBe(sharedMaterial);
  expect(newMesh.geometry).not.toBe(mesh.geometry);
  expect(manager.renderEntities[0].object).toBe(newSprite);
  expect(manager.renderEntities[0].footPosition).toBe(model.position);
  setSpriteEntityRenderOrder(newSprite, 7);
  expect(newSprite.children[0].renderOrder).toBe(7);
  expect(PlaySound).toHaveBeenCalledTimes(3); // Creation, old loop, resumed loop.
  const record = manager.exportRecords()[0];
  expect(record.id).toBe(model.userData.entityId);
  expect(record.transform.position).toEqual(position.toArray());
  expect(record.components.timer.remainingSeconds).toBeCloseTo(DWARF_STAR_DURATION - 12.6);
  expect(getPrefabLocalLight(model)!.radius).toBeCloseTo(dwarfStarLight(12.6).radius);
  // Moving the entity handle also updates proximity in the current frame.
  model.position.x = player.x + STAFF_LIGHT_ACTIVE_RADIUS + 1;
  update(0.1);
  expect(model.parent).toBeNull();
  player.copy(model.position);
  update(0.1);
  expect(model.parent).toBe(scene);
  expect(manager.exportRecords()[0].transform.position).toEqual(model.position.toArray());
});

it('flushes partial and sleeping time for saves, restores identity and removes expired sleepers before waking', async () => {
  const { manager, player, update } = setup();
  const near = await manager.spawn(new THREE.Vector3(1, 0, 2), { id: 'e_near', remainingSeconds: 100 });
  const far = await manager.spawn(new THREE.Vector3(STAFF_LIGHT_ACTIVE_RADIUS + 5, 0, 0),
    { id: 'e_far', remainingSeconds: 100 });
  const expired = await manager.spawn(far.position.clone(), { id: 'e_expired', remainingSeconds: 0.5 });
  expect(far.parent).toBeNull();
  expect(far.children).toHaveLength(0);
  expect(expired.children).toHaveLength(0);
  expect(PlaySound).toHaveBeenCalledTimes(1);
  update(0.2); update(0.3);
  const records = manager.exportRecords();
  expect(records.map(({ id }) => id)).toEqual(['e_near', 'e_far']);
  expect(records.every(({ components }) => components.timer.remainingSeconds === 99.5)).toBe(true);
  expect(expired.parent).toBeNull();
  update(0.4);
  expect(manager.exportRecords().every(({ components }) => components.timer.remainingSeconds === 99.1)).toBe(true);
  const restored = setup();
  for (const record of manager.exportRecords()) await restored.manager.spawn(new THREE.Vector3(...record.transform.position), {
    id: record.id, remainingSeconds: record.components.timer.remainingSeconds,
  });
  expect(restored.manager.exportRecords()).toEqual(manager.exportRecords());
  const sounds = vi.mocked(PlaySound).mock.calls.length;
  update(100);
  player.copy(far.position);
  update(0.1);
  expect(far.parent).toBeNull();
  expect(far.children).toHaveLength(0);
  expect(far.userData.animationController).toBeUndefined();
  expect(PlaySound).toHaveBeenCalledTimes(sounds);
  manager.dispose();
  expect(near.parent).toBeNull();
});

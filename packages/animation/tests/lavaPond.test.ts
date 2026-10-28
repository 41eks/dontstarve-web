import { prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { COLLISION } from '../../componets/src/physicsState';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Heater } from '../../componets/src/heater';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { LavaPondManager, LAVA_POND_RADIUS } from '../../prefab/src/lava_pond';
import { FindEntities } from '../../prefab/src/actionEntity';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import type { SaveDocument } from '../../../src/save/types';
import { bindTestWorld } from './worldContentFixture';
import { prefabInstance } from '../../prefab/src/prefabInstance';

/** The inst.Light an entity's model declares. */
const declaredLight = (model: THREE.Object3D) => prefabInstance(model)?.light.peek();

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('queries fixed or observer-aware output, preserves Lua zero/fallback behavior and removes the heater tag', () => {
  const tags = new Set<string>(), inst = { addTag: (tag: string) => tags.add(tag), removeTag: (tag: string) => tags.delete(tag) };
  const heater = new Heater(inst), observer = { temperature: 35 };
  heater.SetHeat(500);
  expect(heater.GetHeat(observer)).toBe(500);
  observer.temperature = 70; expect(heater.GetHeat(observer)).toBe(500);
  expect(heater.IsExothermic()).toBe(true); expect(heater.IsEndothermic()).toBe(false);
  expect(heater.ShouldFalloff()).toBe(true); expect(heater.GetHeatRadiusCutoff()).toBeUndefined();
  heater.SetHeatFn((source, other) => { expect(source).toBe(inst); expect(other).toBe(observer); return 0; });
  expect(heater.GetHeat(observer)).toBe(0);
  heater.SetHeatFn(() => undefined); expect(heater.GetHeat(observer)).toBe(500);
  expect(Object.isFrozen(heater.configuration.peek())).toBe(true);
  expect('set' in heater.configuration).toBe(false);
  heater.dispose(); heater.dispose(); expect(tags.has('HASHEATER')).toBe(false);
});

it('creates source rock offsets, keeps each rock foot separate, blocks bodies and restores the saved layout without rerandomizing', async () => {
  const scene = new THREE.Scene(), physics = new CANNON.World(), scheduler = new GameTimeScheduler();
  const sequence = [0, 0, 0, 0, 0, .5, .9, .2, .2];
  const random = vi.fn(() => sequence.shift() ?? .5);
  const manager = new LavaPondManager(scene, physics, '/dst/data/anim', { scheduler, random });
  const restoredPhysics = new CANNON.World(), restoredScheduler = new GameTimeScheduler(100);
  const restoredRandom = vi.fn(() => .5);
  const restored = new LavaPondManager(new THREE.Scene(), restoredPhysics, '/dst/data/anim', { scheduler: restoredScheduler, random: restoredRandom });
  // The rocks' displays turn themselves to the world's camera rotation.
  const content = bindTestWorld(restoredScheduler);
  try {
    const model = await manager.spawn(new THREE.Vector3(12, 0, -8));
    const state = model.userData.lavaPond;
    expect(state.timer.peek()).toEqual({ status: 'scheduled', endTime: 0 });
    expect(manager.renderEntities).toEqual([]);
    scheduler.advance(0);
    expect(state.timer.peek().status).toBe('expired');
    expect(state.rocks.peek()).toHaveLength(2);
    expect(state.rocks.peek().map((rock: any) => rock.rocktype)).toEqual(['', '7']);
    const entries = manager.renderEntities;
    expect(entries.map(entry => lookupPrefabInstance(entry.object)?.prefab)).toEqual(['lava_pond_rock', 'lava_pond_rock7']);
    expect(entries[0].footPosition.x).toBe(12);
    expect(entries[0].footPosition.z).toBeCloseTo(-1.7);
    expect(FindEntities(entries[0].footPosition, .01).map(inst => inst.prefab))
      .toEqual(['lava_pond_rock']);
    expect(entries.every(entry => lookupPrefabInstance(entry.object)?.persists === false)).toBe(true);
    const source = FindEntities(model.position, 30, ['HASHEATER'], ['INLIMBO']);
    expect(source).toHaveLength(1); expect(source[0].components.heater!.GetHeat()).toBe(500);

    await new Promise(resolve => setTimeout(resolve, 0));
    const body = prefabInstance(model)!.physicsBody!;
    const moving = new CANNON.Body({ mass: 5, fixedRotation: true, shape: new CANNON.Sphere(4.5),
      position: new CANNON.Vec3(12 + 18, 4.5, -8) });
    moving.collisionFilterGroup = COLLISION.CHARACTERS;
    physics.addBody(moving);
    for (let frame = 0; frame < 180; frame++) { moving.velocity.set(-8, 0, 0); physics.step(1 / 60); }
    expect(moving.position.x - model.position.x).toBeGreaterThan(LAVA_POND_RADIUS + 4.5 - .2);
    expect(body.type).toBe(CANNON.Body.STATIC);
    physics.removeBody(moving);

    const records = manager.exportRecords();
    expect(records).toHaveLength(1); // Nonpersistent child rocks stay inside the pool layout.
    const save = structuredClone(initialWorld) as unknown as SaveDocument;
    save.world.entities = { lava_pond: [records[0].record] };
    const loaded = deserializeSave(JSON.stringify(save), SAVE_CATALOG);
    const record = loaded.world.entities.lava_pond[0];
    const reloaded = await restored.spawn(new THREE.Vector3(...record.transform.position), {
      ...record, components: { lavaPond: record.components.lavaPond },
    });
    expect(restoredRandom).not.toHaveBeenCalled();
    expect(restored.renderEntities).toHaveLength(2);
    restoredScheduler.advance(0); expect(restored.renderEntities).toHaveLength(2);
    expect(restored.exportRecords()).toEqual(records);
    const camera = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), .6);
    content.camerarotation.set(camera);
    await new Promise(resolve => setTimeout(resolve, 0));
    restored.update(0, camera);
    expect(restored.renderEntities.every(entry => entry.object.quaternion.equals(camera))).toBe(true);
    expect(reloaded.position.toArray()).toEqual(record.transform.position);
    manager.remove(model);
    expect(FindEntities(model.position, 30, ['HASHEATER']).map(entity => entity === reloaded.userData.actionEntity)).toEqual([true]);
    expect(physics.bodies).toEqual([]); expect(declaredLight(model)).toBeUndefined();
    expect(manager.renderEntities).toEqual([]); expect(manager.exportRecords()).toEqual([]);
  } finally { manager.dispose(); restored.dispose(); content.unbind(); scheduler.dispose(); restoredScheduler.dispose(); }
});

it('cancels pending child creation on removal and rejects malformed saved rock layouts before restoration', async () => {
  const scheduler = new GameTimeScheduler(), random = vi.fn(() => .5), scene = new THREE.Scene(), physics = new CANNON.World();
  const manager = new LavaPondManager(scene, physics, '/dst/data/anim', { scheduler, random });
  try {
    const model = await manager.spawn(new THREE.Vector3());
    const timer = model.userData.lavaPond.timer;
    const record = manager.exportRecords()[0].record;
    expect(record.components.lavaPond).toEqual({});
    manager.remove(model); scheduler.advance(100);
    expect(timer.peek().status).toBe('stopped'); expect(random).not.toHaveBeenCalled();
    expect(manager.renderEntities).toEqual([]); expect(scene.children).toEqual([]); expect(physics.bodies).toEqual([]);
    const save = structuredClone(initialWorld) as unknown as SaveDocument;
    save.world.entities = { lava_pond: [{ ...record, components: { lavaPond: { rocks: [{ rocktype: '2', offset: [1, 0, 2] }] } } }] };
    expect(deserializeSave(JSON.stringify(save), SAVE_CATALOG).world.entities.lava_pond[0].components.lavaPond?.rocks).toHaveLength(1);
    (save.world.entities.lava_pond[0].components.lavaPond!.rocks![0] as any).rocktype = '1';
    expect(() => deserializeSave(JSON.stringify(save), SAVE_CATALOG)).toThrow('unknown lava pond rock type');
  } finally { manager.dispose(); scheduler.dispose(); }
});

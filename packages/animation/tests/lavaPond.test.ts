import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { COLLISION } from '../../componets/src/physicsState';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrefabDisplayGroup } from '@dontstarve-web/display';
import { Heater } from '../../componets/src/heater';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { lavaPondPrefabs, LAVA_POND_RADIUS, type LavaPondInstance } from '../../prefab/src/lava_pond';
import { FindEntities } from '../../prefab/src/actionEntity';
import { PrefabEntityManager, type PrefabInstance } from '../../prefab/src/prefabInstance';
import { createInventoryStore } from '../../../src/inventory';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import type { SaveDocument } from '../../../src/save/types';

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(random: () => number, scheduler = new GameTimeScheduler()) {
  const scene = new THREE.Scene(), physics = new CANNON.World(), player = new THREE.Group(), inventory = createInventoryStore([]);
  const displays = new PrefabDisplayGroup(scene);
  const ponds = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { physics });
  ponds.register(lavaPondPrefabs({ scheduler, random, spawnPrefab: (prefab, position) => ponds.spawn(prefab, position) }) as never);
  const registry = new EntityRegistry([], ponds, () => player.position);
  registry.registerPrefabs(PREFAB_DEFINITIONS.lavaPonds);
  registry.registerPrefabs(PREFAB_DEFINITIONS.lavaPondRocks);
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  const save = () => serializeSave(template, { entities: registry.exportRecords(), inventory: inventory.exportState(), elapsedSeconds: 0,
    playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
  return { scene, physics, player, inventory, displays, ponds, registry, scheduler, save,
    dispose: () => { registry.dispose(); ponds.dispose(); displays.dispose(); inventory.dispose(); scheduler.dispose(); } };
}

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

it('creates source rock offsets as nonpersistent children, blocks bodies and keeps the layout through c_save without rerandomizing', async () => {
  const sequence = [0, 0, 0, 0, 0, .5, .9, .2, .2];
  const random = vi.fn(() => sequence.shift() ?? .5), restoredRandom = vi.fn(() => .5);
  const s = setup(random), restored = setup(restoredRandom, new GameTimeScheduler(100));
  try {
    s.player.position.set(12, 0, -8);
    expect((await executeDebugCommand('c_spawn("lava_pond")', s.inventory, id => s.registry.spawn(id))).ok).toBe(true);
    const [{ record: { id } }] = s.ponds.exportRecords();
    const pond = s.ponds.get(id) as LavaPondInstance;
    expect(pond.timer.peek()).toEqual({ status: 'scheduled', endTime: 0 });
    expect(pond.light.peek()).toMatchObject({ radius: 1.5 * 3, falloff: .66, intensity: .66 });
    expect(pond.minimap.icon).toBe('lava_pond.png');
    s.scheduler.advance(0);
    expect(pond.timer.peek().status).toBe('expired');
    expect(pond.rocks.peek()!.map(rock => rock.rocktype)).toEqual(['', '7']);
    const rocks = FindEntities(pond.position, 30).filter(inst => inst.prefab.startsWith('lava_pond_rock'));
    expect(rocks.map(rock => rock.prefab).sort()).toEqual(['lava_pond_rock', 'lava_pond_rock7']);
    const first = FindEntities(new THREE.Vector3(12, 0, -1.7), .01);
    expect(first.map(inst => inst.prefab)).toEqual(['lava_pond_rock']);
    const source = FindEntities(pond.position, 30, ['HASHEATER'], ['INLIMBO']);
    expect(source).toHaveLength(1); expect(source[0].components.heater!.GetHeat()).toBe(500);

    const body = pond.physicsBody!;
    const moving = new CANNON.Body({ mass: 5, fixedRotation: true, shape: new CANNON.Sphere(4.5), position: new CANNON.Vec3(12 + 18, 4.5, -8) });
    moving.collisionFilterGroup = COLLISION.CHARACTERS;
    s.physics.addBody(moving);
    for (let frame = 0; frame < 180; frame++) { moving.velocity.set(-8, 0, 0); s.physics.step(1 / 60); }
    expect(moving.position.x - pond.position.x).toBeGreaterThan(LAVA_POND_RADIUS + 4.5 - .2);
    expect(body.type).toBe(CANNON.Body.STATIC);
    s.physics.removeBody(moving);

    // Nonpersistent child rocks stay inside the pond's layout.
    let json = '';
    expect((await executeDebugCommand('c_save()', s.inventory, undefined, () => { json = s.save(); })).ok).toBe(true);
    const { entities } = deserializeSave(json, SAVE_CATALOG).world;
    expect(entities.lava_pond).toHaveLength(1); expect(entities.lava_pond_rock).toEqual([]);
    await restored.registry.restoreAll({ lava_pond: entities.lava_pond });
    expect(restoredRandom).not.toHaveBeenCalled();
    const reloaded = restored.ponds.get(id) as LavaPondInstance;
    expect(FindEntities(reloaded.position, 30).filter(inst => inst.prefab.startsWith('lava_pond_rock') && inst !== rocks[0] && inst !== rocks[1])).toHaveLength(2);
    restored.scheduler.advance(0);
    expect(restored.ponds.exportRecords()).toEqual(s.ponds.exportRecords());

    pond.remove();
    expect(FindEntities(pond.position, 30, ['HASHEATER'])).toHaveLength(1);
    expect(s.physics.bodies).toEqual([]);
    expect(s.ponds.exportRecords()).toEqual([]);
    expect(FindEntities(pond.position, 30).filter(inst => rocks.includes(inst))).toEqual([]);
  } finally { s.dispose(); restored.dispose(); }
});

it('cancels pending child creation on removal and rejects malformed saved rock layouts before restoration', async () => {
  const random = vi.fn(() => .5);
  const s = setup(random);
  try {
    const pond = s.ponds.spawn('lava_pond', new THREE.Vector3()) as LavaPondInstance;
    const [{ record }] = s.ponds.exportRecords();
    expect(record.components.lavaPond).toEqual({});
    pond.remove(); s.scheduler.advance(100);
    expect(pond.timer.peek().status).toBe('stopped'); expect(random).not.toHaveBeenCalled();
    expect(s.ponds.exportRecords()).toEqual([]); expect(s.physics.bodies).toEqual([]);
    const save = structuredClone(initialWorld) as unknown as SaveDocument;
    save.world.entities = { lava_pond: [{ ...record, components: { lavaPond: { rocks: [{ rocktype: '2', offset: [1, 0, 2] }] } } }] };
    expect(deserializeSave(JSON.stringify(save), SAVE_CATALOG).world.entities.lava_pond[0].components.lavaPond?.rocks).toHaveLength(1);
    (save.world.entities.lava_pond[0].components.lavaPond!.rocks![0] as any).rocktype = '1';
    expect(() => deserializeSave(JSON.stringify(save), SAVE_CATALOG)).toThrow('unknown lava pond rock type');
  } finally { s.dispose(); }
});

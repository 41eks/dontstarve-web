import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { rockWorld } from './rockWorldFixture';
import type { RockMoonShellInstance } from '../../prefab/src/rocks';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { workTargets } from './workTargets';
import { unzipSync, strFromU8 } from 'fflate';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { createInventoryStore } from '../../../src/inventory';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { createClusterSaveZip } from '../../../src/save/download';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { CLUSTER_SAVE_ZIP_TIMEOUT } from './importedSave';
import type { CaveinBoulderInstance } from '../../prefab/src/cavein_boulder';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop() {} })) }));
beforeEach(() => vi.stubGlobal('fetch', async (url: string) =>
  new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), drops: string[] = [];
  const manager = rockWorld(scene, { scheduler,
    spawnGroundItem: definition => { drops.push(definition.itemId); return undefined; },
  });
  return { scene, scheduler, manager, drops, dispose: () => { manager.dispose(); scheduler.dispose(); } };
}

it('mines moon rocks in six hits and cave-in boulders in three, preserving surviving identity and resetting work on load', async () => {
  const s = setup(), restored = setup();
  try {
    await s.manager.spawn('rock_moon', new THREE.Vector3(3, 0, 4));
    const boulder = await s.manager.spawn('cavein_boulder', new THREE.Vector3(6, 0, 4));
    const [moon, cavein] = workTargets('MINE', s.scene);
    performToolWork('MINE', cavein.entity, {});
    expect(cavein.entity.components.workable!.GetWorkLeft()).toBe(2);
    expect(prefabInstance(boulder)!.sprite.currentAnimation).toBe('idle');
    const surviving = s.manager.exportRecords().find(record => record.prefabId === 'cavein_boulder')!;
    await restored.manager.spawn(surviving.prefabId, new THREE.Vector3(...surviving.record.transform.position), surviving.record);
    expect(restored.manager.exportRecords()[0]).toEqual(surviving);
    expect(workTargets('MINE', restored.scene)[0].entity.components.workable!.GetWorkLeft()).toBe(3);
    vi.spyOn(Math, 'random').mockReturnValue(.9);
    for (let i = 0; i < 2; i++) performToolWork('MINE', cavein.entity, {});
    expect(s.drops).toEqual(['rocks', 'rocks']);
    expect(cavein.isValid()).toBe(false);
    for (let i = 0; i < 6; i++) performToolWork('MINE', moon.entity, {});
    expect(s.drops.slice(2)).toEqual(['rocks', 'flint', 'moonrocknugget', 'moonrocknugget']);
    expect(s.manager.exportRecords()).toEqual([]);
    expect(workTargets('MINE', s.scene)).toEqual([]);
  } finally { s.dispose(); restored.dispose(); }
});

it('breaks a moon shell after its minerals drop, synchronously spawns one orb and removes the unsaved shell at the erosion deadline', async () => {
  const s = setup();
  try {
    const model = await s.manager.spawn('rock_moon_shell', new THREE.Vector3(3, 0, 4));
    const [mine] = workTargets('MINE', s.scene);
    vi.spyOn(Math, 'random').mockReturnValue(.9);
    for (let i = 0; i < 5; i++) performToolWork('MINE', mine.entity, {});
    expect(prefabInstance(model)!.sprite.currentAnimation).toBe('low');
    expect(s.manager.exportRecords().map(record => record.prefabId)).toEqual(['rock_moon_shell']);
    const finished = vi.fn(() => {
      expect(s.drops).toEqual(['rocks', 'flint', 'moonrocknugget', 'moonrocknugget', 'moonrocknugget']);
      expect(s.manager.exportRecords().map(record => record.prefabId)).toEqual(['moonrockseed']);
    });
    prefabInstance(model)!.ListenForEvent('workfinished', finished);
    performToolWork('MINE', mine.entity, {});
    expect(finished).toHaveBeenCalledOnce();
    expect(prefabInstance(model)!.listTags()).toContain('NOCLICK');
    expect(prefabInstance(model)!.sprite.currentAnimation).toBe('break');
    expect(s.manager.exportRecords()[0].record.transform.position).toEqual([3, 0, 4]);
    expect(workTargets('MINE', s.scene)).toEqual([]);
    expect(performToolWork('MINE', mine.entity, {})).toBe(false);
    const { erode } = prefabInstance(model) as RockMoonShellInstance;
    expect(erode.delay.peek()).toEqual({ status: 'scheduled', endTime: 2 });
    s.scheduler.advance(2 + 15 / 30); // ErodeAway's thread steps once per tick, with no frame update.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(prefabInstance(model)!.sprite.sprite.peek().erosion).toBeCloseTo(.5); // the declared erosion reaches the drawn instance
    expect(s.scene.children).toContain(model);
    s.scheduler.advance(.5); // No rendering or presentation effect is needed to remove it.
    expect(prefabInstance(model)!.status.peek()).toBe('removed');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(s.scene.children).not.toContain(model);
    expect(erode.timer.peek().status).toBe('stopped');
    expect(s.manager.exportRecords().map(record => record.prefabId)).toEqual(['moonrockseed']);
  } finally { s.dispose(); }
});

it('cancels shell removal timers on scene disposal without touching an injected scheduler', async () => {
  const s = setup();
  try {
    const shell = await s.manager.spawn('rock_moon_shell', new THREE.Vector3());
    const [target] = workTargets('MINE', s.scene);
    for (let i = 0; i < 6; i++) performToolWork('MINE', target.entity, {});
    s.manager.dispose();
    s.scheduler.advance(10);
    expect(prefabInstance(shell)!.status.peek()).toBe('removed');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(s.scene.children).toEqual([]);
    expect((prefabInstance(shell) as RockMoonShellInstance).erode.delay.peek().status).toBe('stopped');
    let ran = false; s.scheduler.schedule(0, () => { ran = true; }); s.scheduler.advance(0);
    expect(ran).toBe(true);
  } finally { s.dispose(); }
});

function registered() {
  const scene = new THREE.Scene(), world = rockWorld(scene);
  const registry = new EntityRegistry([], world.prefabs, () => new THREE.Vector3(12, 0, -6)), inventory = createInventoryStore([]);
  registry.registerPrefabs(PREFAB_DEFINITIONS.rocks);
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  return { scene, world, registry, inventory,
    save: () => serializeSave(template, { entities: registry.exportRecords(), inventory: inventory.exportState(), elapsedSeconds: 0,
      playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG),
    dispose() { registry.dispose(); world.dispose(); inventory.dispose(); } };
}

it('c_spawn then c_save ZIP export reloads rocks and cave-in boulders with their identity, position and variation', async () => {
  const first = registered(); let zip!: Uint8Array, records!: ReturnType<EntityRegistry['exportRecords']>;
  vi.spyOn(Math, 'random').mockReturnValue(.8); // variation 7
  try {
    for (const id of ['rock_moon_shell', 'cavein_boulder', 'moonrockseed']) {
      expect((await executeDebugCommand(`c_spawn("${id}")`, first.inventory, prefab => first.registry.spawn(prefab))).ok).toBe(true);
    }
    expect((await executeDebugCommand('c_give("rock1")', first.inventory)).ok).toBe(false);
    // workable.savestate=false: a mined but surviving shell saves no progress.
    const [shell] = workTargets('MINE', 'rock_moon_shell');
    shell.work();
    records = first.registry.exportRecords();
    expect(records.cavein_boulder[0].components).toEqual({ caveinBoulder: { variation: 7 } });
    expect(records.rock_moon_shell[0].components).toEqual({});
    expect((await executeDebugCommand('c_save()', first.inventory, undefined, async () => {
      zip = await createClusterSaveZip(first.save(), 'forest');
    })).ok).toBe(true);
  } finally { first.dispose(); }
  const files = unzipSync(zip), text = strFromU8(files['Cluster_1/Master.json']);
  const exported = JSON.parse(text) as { session: { playerFile: string } };
  const { player } = JSON.parse(strFromU8(files[`Cluster_1/${exported.session.playerFile}`])) as { player: unknown };
  const saved = deserializeSave(text, SAVE_CATALOG, player), second = registered();
  vi.mocked(Math.random).mockReturnValue(.1); // A reload keeps the saved variation instead of rolling one.
  try {
    expect(saved.world.entities).toEqual(records);
    await second.registry.restoreAll(saved.world.entities);
    const instances = second.scene.children.map(model => prefabInstance(model)!);
    expect(instances.map(instance => [instance.prefab, instance.position.toArray()])).toEqual(expect.arrayContaining([
      ['rock_moon_shell', [12, 0, -6]], ['cavein_boulder', [12, 0, -6]], ['moonrockseed', [12, 0, -6]]]));
    expect((instances.find(instance => instance.prefab === 'cavein_boulder') as CaveinBoulderInstance).variation).toBe(7);
    expect(workTargets('MINE', 'rock_moon_shell')[0].entity.components.workable!.GetWorkLeft()).toBe(6);
    expect(second.registry.exportRecords()).toEqual(records);
  } finally { second.dispose(); }
}, CLUSTER_SAVE_ZIP_TIMEOUT);

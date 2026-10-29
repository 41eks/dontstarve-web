import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { SkeletonManager } from '../../prefab/src/skeleton';
import { GroundItemManager } from '../../../src/groundItems';
import { createInventoryStore } from '../../../src/inventory';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { actionTargetModel } from '../../stategraphs/src/actionTargetView';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const inventory = createInventoryStore([]), scene = new THREE.Scene(), player = new THREE.Group(), physics = new CANNON.World();
  const ground = new GroundItemManager(scene, new THREE.PerspectiveCamera(), { domElement: new EventTarget() } as THREE.WebGLRenderer,
    '/dst/data/databundles/images.zip', inventory, '/dst/data/anim', player);
  const skeletons = new SkeletonManager(scene, { physics, spawnGroundItem: (definition, position, options) => ground.spawnGroundItem(definition, position, options) });
  const registry = new EntityRegistry();
  registry.register(PREFAB_DEFINITIONS.skeletons, {
    restore: (id, record) => skeletons.spawn(id, new THREE.Vector3(...record.transform.position),
      { id: record.id, transform: record.transform, components: { skeleton: record.components.skeleton } }),
    debugSpawn: id => skeletons.spawn(id, player.position),
    exportRecords: () => skeletons.exportRecords(), dispose: () => skeletons.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.groundItems, {
    restore: () => { throw new Error('unused'); },
    debugSpawn: id => ground.spawnFromSave(`command:${id}`, { ...SAVE_CATALOG.items[id], itemId: id, count: 1 }, player.position),
    exportRecords: () => ground.exportRecords().map(record => ({ prefabId: 'ground_item', record })), dispose: () => ground.dispose(),
  });
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  const save = () => serializeSave(template, { entities: { skeleton_player: skeletons.exportRecords().map(entry => entry.record),
    ground_item: ground.exportRecords() },
  inventory: inventory.exportState(), elapsedSeconds: 0, playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
  return { inventory, scene, physics, ground, skeletons, registry, save, player, dispose: () => { registry.dispose(); inventory.dispose(); } };
}

it('hammers a described player skeleton into two boneshards and keeps its pose and description through save/load', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(.5);
  const s = setup(), restored = setup();
  try {
    expect((await executeDebugCommand('c_spawn("skeleton_player")', s.inventory, id => s.registry.spawn(id))).ok).toBe(true);
    const [target] = s.skeletons.hammerTargets;
    // math.random(1, 6) at .5 → idle4; Player_SetSkeletonDescription lowercases the cause.
    s.skeletons.setSkeletonDescription(actionTargetModel(target), 'waxwell', 'Maxwell', 'Starvation');
    expect(prefabInstance(actionTargetModel(target))!.listTags()).toEqual(expect.arrayContaining(['skeleton', 'playerskeleton']));
    expect(s.physics.bodies).toHaveLength(1);

    let json = '';
    expect((await executeDebugCommand('c_save()', s.inventory, undefined, () => { json = s.save(); })).ok).toBe(true);
    const [record] = deserializeSave(json, SAVE_CATALOG).world.entities.skeleton_player;
    expect(record.components.skeleton).toEqual({ anim: 4, char: 'waxwell', playername: 'Maxwell', cause: 'starvation' });
    await restored.skeletons.spawn('skeleton_player', new THREE.Vector3(...record.transform.position),
      { id: record.id, transform: record.transform, components: { skeleton: record.components.skeleton } });
    expect(restored.skeletons.exportRecords()).toEqual(s.skeletons.exportRecords());

    // SKELETON_WORK = 3 hammer hits; the last drops the `skeleton_player` table (two boneshards), collapses and removes it.
    const hammer = s.inventory.entities.create({ itemId: 'hammer', count: 1 });
    for (let i = 0; i < 2; i++) expect(performToolWork('HAMMER', target.entity, {}, hammer)).toBe(true);
    expect(s.skeletons.exportRecords()).toHaveLength(1);
    expect(performToolWork('HAMMER', target.entity, {}, hammer)).toBe(true);
    expect(s.skeletons.hammerTargets).toEqual([]); expect(s.skeletons.exportRecords()).toEqual([]);
    expect(s.physics.bodies).toHaveLength(0);
    await vi.waitFor(() => expect(s.ground.exportRecords().map(item => item.components.stack?.itemId)).toEqual(['boneshard', 'boneshard']));
  } finally { s.dispose(); restored.dispose(); }
}, 20000);

it('spawns a creature skeleton with its own pose range and shared table, dropping the scrapbook page on a low roll', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(.05);
  const s = setup(), restored = setup();
  try {
    for (const id of ['skeleton_notplayer_2', 'skeleton']) {
      expect((await executeDebugCommand(`c_spawn("${id}")`, s.inventory, id => s.registry.spawn(id))).ok).toBe(true);
    }
    const targets = s.skeletons.hammerTargets;
    // skeleton_notplayer_2 is fixed to idle8; skeleton rolls math.random(1, 6) at .05 → idle1. Neither is a playerskeleton.
    expect(s.skeletons.exportRecords().map(({ prefabId, record }) => [prefabId, record.components.skeleton])).toEqual([
      ['skeleton_notplayer_2', { anim: 8 }], ['skeleton', { anim: 1 }]]);
    for (const target of targets) {
      expect(prefabInstance(actionTargetModel(target))!.listTags()).toContain('skeleton'); expect(prefabInstance(actionTargetModel(target))!.listTags()).not.toContain('playerskeleton');
    }
    s.skeletons.setSkeletonDescription(actionTargetModel(targets[1]), 'waxwell', 'Maxwell', 'Starvation');
    expect(s.skeletons.exportRecords()[1].record.components.skeleton).toEqual({ anim: 1 });

    const [record] = s.skeletons.exportRecords();
    await restored.skeletons.spawn('skeleton_notplayer_2', new THREE.Vector3(...record.record.transform.position),
      { id: record.record.id, transform: record.record.transform, components: { skeleton: record.record.components.skeleton } });
    expect(restored.skeletons.exportRecords()).toEqual([record]);

    const hammer = s.inventory.entities.create({ itemId: 'hammer', count: 1 });
    for (let i = 0; i < 3; i++) expect(performToolWork('HAMMER', targets[1].entity, {}, hammer)).toBe(true);
    await vi.waitFor(() => expect(s.ground.exportRecords().map(item => item.components.stack?.itemId).sort())
      .toEqual(['boneshard', 'boneshard', 'scrapbook_page']));
  } finally { s.dispose(); restored.dispose(); }
}, 20000);

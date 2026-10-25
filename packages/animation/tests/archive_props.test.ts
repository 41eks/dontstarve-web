import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { ArchivePropsManager } from '../../prefab/src/archive_props';
import { GroundItemManager } from '../../../src/groundItems';
import { createInventoryStore } from '../../../src/inventory';
import { createSignal } from '../../signals/src';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { FACING } from '../src/facing';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { modelHasTag, prefabInstance } from '../../prefab/src/prefabInstance';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const inventory = createInventoryStore([]), scene = new THREE.Scene(), player = new THREE.Group(), physics = new CANNON.World();
  const ground = new GroundItemManager(scene, new THREE.PerspectiveCamera(), { domElement: new EventTarget() } as THREE.WebGLRenderer,
    '/dst/data/databundles/images.zip', inventory, '/dst/data/anim', player);
  const cameraFacing = createSignal<number>(FACING.DOWN);
  const props = new ArchivePropsManager(scene, { physics, cameraFacing, prepareSpawn: (definition, fling) => ground.prepareSpawn(definition, fling) });
  const registry = new EntityRegistry();
  registry.register(PREFAB_DEFINITIONS.archiveProps, {
    restore: (id, record) => props.spawn(id, new THREE.Vector3(...record.transform.position),
      { id: record.id, transform: record.transform, components: { archiveProp: record.components.archiveProp } }).then(model => model!),
    debugSpawn: id => props.spawn(id, player.position),
    exportRecords: () => props.exportRecords(), dispose: () => props.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.groundItems, {
    restore: () => { throw new Error('unused'); },
    debugSpawn: id => ground.spawnFromSave(`command:${id}`, { ...SAVE_CATALOG.items[id], itemId: id, count: 1 }, player.position),
    exportRecords: () => ground.exportRecords().map(record => ({ prefabId: 'ground_item', record })), dispose: () => ground.dispose(),
  });
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  const save = () => serializeSave(template, { entities: {
    ...Object.fromEntries(PREFAB_DEFINITIONS.archiveProps.prefabIds.map(id => [id, props.exportRecords().filter(entry => entry.prefabId === id).map(entry => entry.record)])),
    ground_item: ground.exportRecords() },
  inventory: inventory.exportState(), elapsedSeconds: 0, playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
  return { inventory, scene, physics, ground, props, registry, cameraFacing, save, player,
    dispose: () => { registry.dispose(); inventory.dispose(); } };
}

const dropped = (s: ReturnType<typeof setup>) => s.ground.exportRecords().map(record => record.components.stack?.itemId).sort();

it('mines an archive_moon_statue down for its loot and keeps its pose through save/load', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(.5);
  const s = setup(), restored = setup();
  try {
    expect((await executeDebugCommand('c_spawn("archive_moon_statue")', s.inventory, id => s.registry.spawn(id))).ok).toBe(true);
    // math.random(4) at .5 → variant 3; workable.savestate is false, so only the pose is saved.
    expect(s.props.exportRecords().map(({ prefabId, record }) => [prefabId, record.components])).toEqual([
      ['archive_moon_statue', { archiveProp: { anim: 3 } }]]);
    const [minimap] = s.props.miniMapEntities;
    expect(minimap.icon).toBe('archive_moon_statue3.png');
    const model = s.props.mineTargets[0].model;
    expect(model.userData.instance.sprite.sprite.peek().clip).toMatchObject({ name: 'idle_full_3', loop: false });
    expect(prefabInstance(model)!.listTags()).toEqual(expect.arrayContaining(['structure', 'statue', 'dustable']));
    expect(s.physics.bodies).toHaveLength(1);

    let json = '';
    expect((await executeDebugCommand('c_save()', s.inventory, undefined, () => { json = s.save(); })).ok).toBe(true);
    const record = deserializeSave(json, SAVE_CATALOG).world.entities.archive_moon_statue[0];
    await restored.props.spawn('archive_moon_statue', new THREE.Vector3(...record.transform.position),
      { id: record.id, transform: record.transform, components: { archiveProp: record.components.archiveProp } });
    expect(restored.props.exportRecords()).toEqual(s.props.exportRecords());
    expect(restored.props.mineTargets[0].model.userData.instance.sprite.sprite.peek().clip)
      .toMatchObject({ name: 'idle_full_3', loop: true });

    // MARBLEPILLAR_MINE = 10 works; the final one drops the table (the 5% nugget misses at .5), collapses and removes the statue.
    const pickaxe = s.inventory.entities.create({ itemId: 'pickaxe', count: 1 });
    const [mine] = s.props.mineTargets;
    for (let i = 0; i < 9; i++) expect(performToolWork('MINE', mine.entity, {}, pickaxe)).toBe(true);
    expect(s.props.exportRecords()).toHaveLength(1);
    expect(performToolWork('MINE', mine.entity, {}, pickaxe)).toBe(true);
    expect(s.props.mineTargets).toEqual([]); expect(s.props.exportRecords()).toEqual([]);
    expect(s.physics.bodies).toHaveLength(0); expect(s.props.miniMapEntities.every(entry => !entry.enabled)).toBe(true);
    await vi.waitFor(() => expect(dropped(s)).toEqual(['moonrocknugget', 'thulecite']));
    await vi.waitFor(() => expect(s.props.renderEntities).toHaveLength(0));
  } finally { s.dispose(); restored.dispose(); }
}, 20000);

it('hands out rune story lines once, saves static props and ignores the pad and rubble worldgen items', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const s = setup(), restored = setup();
  try {
    for (const id of ['archive_rune_statue', 'archive_rune_statue', 'archive_portal', 'archive_switch_base', 'archive_ambient_sfx', 'archive_switch_pad', 'rubble1', 'rubble2']) {
      expect(await s.registry.spawn(id)).toBe(true);
    }
    const runes = [...s.scene.children].filter(model => model.userData.instance?.prefab === 'archive_rune_statue');
    const status = (model: THREE.Object3D) => model.userData.components.inspectable.getstatus();
    expect([status(runes[0]), status(runes[1]), status(runes[0])]).toEqual(['LINE_1', 'LINE_2', 'LINE_1']);
    // Only a reader holding the ancient_reader tag gets the text.
    const reader = { components: { inventory: { EquipHasTag: (tag: string) => tag === 'ancient_reader' } } };
    expect(runes[0].userData.components.inspectable.descriptionfn(reader)).toBe('LINE_1');
    expect(runes[0].userData.components.inspectable.descriptionfn({})).toBeUndefined();
    s.cameraFacing.set(FACING.UPRIGHT);
    // The pad (persists = false) and the self-removing rubble never reach the save.
    const records = s.props.exportRecords();
    expect(records.map(({ prefabId }) => prefabId)).toEqual(['archive_rune_statue', 'archive_rune_statue', 'archive_portal', 'archive_switch_base', 'archive_ambient_sfx']);
    expect(records.filter(({ prefabId }) => prefabId === 'archive_rune_statue').map(({ record }) => record.components.archiveProp!.storyprogress)).toEqual([1, 2]);

    let json = '';
    expect((await executeDebugCommand('c_save()', s.inventory, undefined, () => { json = s.save(); })).ok).toBe(true);
    const entities = deserializeSave(json, SAVE_CATALOG).world.entities;
    for (const [prefabId, saved] of Object.entries(entities)) {
      for (const record of saved) {
        if (!(PREFAB_DEFINITIONS.archiveProps.prefabIds as readonly string[]).includes(prefabId)) continue;
        await restored.props.spawn(prefabId as 'archive_portal', new THREE.Vector3(...record.transform.position),
          { id: record.id, transform: record.transform, components: { archiveProp: record.components.archiveProp } });
      }
    }
    expect(restored.props.exportRecords()).toEqual(records);
    const [portal] = [...restored.scene.children].filter(model => model.userData.instance?.prefab === 'archive_portal');
    expect(prefabInstance(portal)!.listTags()).toEqual(expect.arrayContaining(['groundhole', 'blocker']));
    expect(portal.children.some(child => modelHasTag(child, 'NOCLICK'))).toBe(true);
    expect(restored.props.miniMapEntities.map(entry => entry.icon).sort()).toEqual(['archive_portal.png', 'archive_runes.png', 'archive_runes.png']);
    // A rune statue's counter resumes after the highest saved line.
    await restored.props.spawn('archive_rune_statue', new THREE.Vector3(30, 0, 0));
    const fresh = [...restored.scene.children].filter(model => model.userData.instance?.prefab === 'archive_rune_statue').at(-1)!;
    expect(fresh.userData.components.inspectable.getstatus()).toBe('LINE_3');
  } finally { s.dispose(); restored.dispose(); }
}, 20000);

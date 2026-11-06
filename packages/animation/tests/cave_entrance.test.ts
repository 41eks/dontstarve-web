import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { PrefabDisplayGroup } from '@dontstarve-web/display';
import { caveEntrancePrefabs, type CaveEntranceInstance, type CaveEntranceWorld } from '../../prefab/src/cave_entrance';
import { GroundItemManager } from '../../prefab/src/groundItemManager';
import { createInventoryStore } from '../../../src/inventory';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import { PlayerActionPicker } from '../../stategraphs/src/playeractionpicker';
import { createSignal, readonlySignal, type TileStateQuery } from '../../signals/src';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { PrefabEntityManager, prefabInstance, type PrefabInstance } from '../../prefab/src/prefabInstance';
import { workTargets } from './workTargets';
import { canDoSceneAction, sceneActions } from './sceneActions';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(world: Partial<CaveEntranceWorld> & { tickingarea?: TileStateQuery } = {}) {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const inventory = createInventoryStore([]), scene = new THREE.Scene(), player = new THREE.Group(), physics = new CANNON.World();
  const ground = new GroundItemManager(scene, new THREE.PerspectiveCamera(), { domElement: new EventTarget() } as THREE.WebGLRenderer,
    '/dst/data/databundles/images.zip', inventory, '/dst/data/anim', player);
  const displays = new PrefabDisplayGroup(scene);
  const caves = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { physics, tickingarea: world.tickingarea });
  caves.register(caveEntrancePrefabs({
    spawnGroundItem: (definition, position, options) => ground.spawnGroundItem(definition, position, options),
    spawnPrefab: (prefab, position) => caves.spawn(prefab, position), ...world,
  }) as never);
  const registry = new EntityRegistry([], caves, () => player.position);
  registry.registerPrefabs(PREFAB_DEFINITIONS.caveEntrances);
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  const save = () => serializeSave(template, { entities: registry.exportRecords(),
    inventory: inventory.exportState(), elapsedSeconds: 0, playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
  return { inventory, scene, physics, ground, caves, registry, player, save, dispose: () => { registry.dispose(); caves.dispose(); displays.dispose(); ground.dispose(); inventory.dispose(); } };
}

it('mines a closed entrance into cave_entrance_open, dropping rocks and flint, and keeps the open entrance through c_save', async () => {
  const s = setup(), restored = setup();
  try {
    s.player.position.set(5, 0, 7);
    expect((await executeDebugCommand('c_spawn("cave_entrance")', s.inventory, id => s.registry.spawn(id))).ok).toBe(true);
    expect(prefabInstance(s.scene.children.find(model => prefabInstance(model)?.prefab === 'cave_entrance'))!.minimap.icon).toBe('cave_closed.png');
    expect(s.physics.bodies).toHaveLength(1);
    const pickaxe = s.inventory.entities.create({ itemId: 'pickaxe', count: 1 });
    const [mine] = workTargets('MINE', s.scene);
    for (let i = 0; i < 5; i++) expect(performToolWork('MINE', mine.entity, {}, pickaxe)).toBe(true);
    expect(s.caves.exportRecords().map(({ prefabId }) => prefabId)).toEqual(['cave_entrance']);
    expect(performToolWork('MINE', mine.entity, {}, pickaxe)).toBe(true);

    // The open entrance replaces it at the same point, is drawn on the background layer, and is no longer mineable.
    const [{ prefabId, record }] = s.caves.exportRecords();
    expect([prefabId, record.transform.position, record.components]).toEqual(['cave_entrance_open', [5, 0, 7], {}]);
    expect(workTargets('MINE', s.scene)).toEqual([]);
    expect(s.physics.bodies).toHaveLength(1);
    const open = s.caves.get(record.id)!;
    expect(open.sprite.sprite.peek().ground).toEqual({ renderOrder: -.5, flat: false });
    expect(open.minimap.icon).toBe('cave_open.png');
    await vi.waitFor(() => expect(s.ground.exportRecords().map(r => r.components.stack?.itemId).sort())
      .toEqual(['flint', 'flint', 'flint', 'rocks', 'rocks']));

    let json = '';
    expect((await executeDebugCommand('c_save()', s.inventory, undefined, () => { json = s.save(); })).ok).toBe(true);
    const { entities } = deserializeSave(json, SAVE_CATALOG).world;
    expect(entities.cave_entrance).toEqual([]);
    await restored.registry.restoreAll({ cave_entrance_open: entities.cave_entrance_open });
    expect(restored.caves.exportRecords()).toEqual(s.caves.exportRecords());
  } finally { s.dispose(); restored.dispose(); }
}, 20000);

it('offers MIGRATE on an open entrance whose Caves destination is available and hands the player to that shard', async () => {
  const migrated: unknown[][] = [];
  const shard = { isWorldAvailable: (id: string) => id === 'Caves', isWorldFull: () => false, migratePlayer: (...args: unknown[]) => { migrated.push(args); } };
  const s = setup({ shard }), unavailable = setup();
  try {
    const open = s.caves.spawn('cave_entrance_open', new THREE.Vector3(1, 0, 2)).transform.model;
    expect(canDoSceneAction('MIGRATE', open)).toBe(true);
    expect(prefabInstance(open)!.listTags()).toContain('migrator');
    expect(prefabInstance(open)!.sprite.sprite.peek().clip.name).toBe('open');
    expect(prefabInstance<CaveEntranceInstance>(open)!.components.worldmigrator!.Activate({ hasTag: () => false })).toBe(false);
    const player = { hasTag: (tag: string) => tag === 'player' };
    expect(prefabInstance<CaveEntranceInstance>(open)!.components.worldmigrator!.Activate(player)).toBe(true);
    expect(migrated).toEqual([[player, undefined, 'Caves']]);

    const closed = unavailable.caves.spawn('cave_entrance_open', new THREE.Vector3(5, 0, 2)).transform.model;
    expect(sceneActions(closed)).not.toContain('MIGRATE');
    expect(prefabInstance(closed)!.listTags()).not.toContain('migrator');
  } finally { s.dispose(); unavailable.dispose(); }
}, 20000);

it('stays clickable after its tile leaves and re-enters the tickingarea', async () => {
  const active = createSignal(true);
  const tickingarea = (() => Object.assign(readonlySignal(active), { dispose: () => {} })) as never;
  const s = setup({ tickingarea });
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 200);
  camera.position.set(5, 13, 27); camera.lookAt(5, 1, 7); camera.updateMatrixWorld();
  const renderer = { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) } } as unknown as THREE.WebGLRenderer;
  const pointer = new PointerRaycaster({ camera, renderer, scene: s.scene }), picker = new PlayerActionPicker(pointer);
  pointer.trackPointer({ clientX: 50, clientY: 50 } as PointerEvent);
  try {
    const model = s.caves.spawn('cave_entrance_open', new THREE.Vector3(5, 0, 7)).transform.model;
    await vi.waitFor(() => expect(prefabInstance(model)!.sprite.loaded).toBe(true));
    s.scene.updateMatrixWorld(true);
    const hit = () => { picker.getMouseActions(); return picker.targetModel === model; };
    expect(hit()).toBe(true);
    active.set(false);
    await new Promise(resolve => setTimeout(resolve, 0));
    s.scene.updateMatrixWorld(true);
    expect(hit()).toBe(false);
    active.set(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    s.scene.updateMatrixWorld(true);
    expect(hit()).toBe(true);
  } finally { picker.dispose(); s.dispose(); }
}, 20000);

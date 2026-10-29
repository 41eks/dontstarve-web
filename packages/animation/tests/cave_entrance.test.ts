import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { CaveEntranceManager } from '../../prefab/src/cave_entrance';
import { GroundItemManager } from '../../../src/groundItems';
import { createInventoryStore } from '../../../src/inventory';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { getMigrateActions } from '../../stategraphs/src/migrate';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import { PlayerActionPicker } from '../../stategraphs/src/playeractionpicker';
import { createSignal, readonlySignal } from '../../signals/src';
import { prefabInstance } from '../../prefab/src/prefabInstance';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('mines a closed entrance into cave_entrance_open, dropping rocks and flint, and keeps the open entrance in saves', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const inventory = createInventoryStore([]), scene = new THREE.Scene(), physics = new CANNON.World();
  const ground = new GroundItemManager(scene, new THREE.PerspectiveCamera(), { domElement: new EventTarget() } as THREE.WebGLRenderer,
    '/dst/data/databundles/images.zip', inventory, '/dst/data/anim', new THREE.Group());
  const caves = new CaveEntranceManager(scene, { physics, spawnGroundItem: (definition, position, options) => ground.spawnGroundItem(definition, position, options) });
  try {
    await caves.spawn('cave_entrance', new THREE.Vector3(5, 0, 7));
    expect(prefabInstance(scene.children.find(model => prefabInstance(model)?.prefab === 'cave_entrance'))!.minimap.icon).toBe('cave_closed.png');
    const pickaxe = inventory.entities.create({ itemId: 'pickaxe', count: 1 });
    const [mine] = caves.mineTargets;
    for (let i = 0; i < 5; i++) expect(performToolWork('MINE', mine.entity, {}, pickaxe)).toBe(true);
    expect(caves.exportRecords().map(({ prefabId }) => prefabId)).toEqual(['cave_entrance']);
    expect(performToolWork('MINE', mine.entity, {}, pickaxe)).toBe(true);

    // The open entrance replaces it at the same point, is background layered, and is no longer mineable.
    const [{ prefabId, record }] = caves.exportRecords();
    expect([prefabId, record.transform.position]).toEqual(['cave_entrance_open', [5, 0, 7]]);
    expect(caves.mineTargets).toEqual([]);
    expect(caves.renderEntities.map(entity => entity.renderLayer)).toEqual([-1]);
    expect(prefabInstance(caves.renderEntities[0].object)!.minimap.icon).toBe('cave_open.png');
    await vi.waitFor(() => expect(ground.exportRecords().map(r => r.components.stack?.itemId).sort())
      .toEqual(['flint', 'flint', 'flint', 'rocks', 'rocks']));

    const restored = new CaveEntranceManager(scene, { physics: new CANNON.World(), spawnGroundItem: () => { throw new Error('unused'); } });
    await restored.spawn('cave_entrance_open', new THREE.Vector3(...record.transform.position), record);
    expect(restored.exportRecords()).toEqual(caves.exportRecords());
    restored.dispose();
  } finally { caves.dispose(); ground.dispose(); inventory.dispose(); }
}, 20000);

it('offers MIGRATE on an open entrance whose Caves destination is available and hands the player to that shard', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const scene = new THREE.Scene(), migrated: unknown[][] = [];
  const shard = { isWorldAvailable: (id: string) => id === 'Caves', isWorldFull: () => false, migratePlayer: (...args: unknown[]) => { migrated.push(args); } };
  const caves = new CaveEntranceManager(scene, { shard, spawnGroundItem: () => { throw new Error('unused'); } });
  const unavailable = new CaveEntranceManager(scene, { spawnGroundItem: () => { throw new Error('unused'); } });
  try {
    const open = await caves.spawn('cave_entrance_open', new THREE.Vector3(1, 0, 2));
    const [action] = getMigrateActions(open);
    expect(action).toMatchObject({ button: 'left', available: true, action: { action: 'MIGRATE' } });
    expect(prefabInstance(open)!.listTags()).toContain('migrator');
    expect(open.userData.components.worldmigrator.Activate({ hasTag: () => false })).toBe(false);
    const player = { hasTag: (tag: string) => tag === 'player' };
    expect(open.userData.components.worldmigrator.Activate(player)).toBe(true);
    expect(migrated).toEqual([[player, undefined, 'Caves']]);

    const closed = await unavailable.spawn('cave_entrance_open', new THREE.Vector3(5, 0, 2));
    expect(getMigrateActions(closed)).toEqual([]);
    expect(prefabInstance(closed)!.listTags()).not.toContain('migrator');
  } finally { caves.dispose(); unavailable.dispose(); }
}, 20000);

it('stays clickable after its tile leaves and re-enters the tickingarea', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const scene = new THREE.Scene(), active = createSignal(true);
  const tickingarea = (() => Object.assign(readonlySignal(active), { dispose: () => {} })) as never;
  const caves = new CaveEntranceManager(scene, { tickingarea, spawnGroundItem: () => { throw new Error('unused'); } });
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 200);
  camera.position.set(5, 13, 27); camera.lookAt(5, 1, 7); camera.updateMatrixWorld();
  const renderer = { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) } } as unknown as THREE.WebGLRenderer;
  const pointer = new PointerRaycaster({ camera, renderer, scene }), picker = new PlayerActionPicker(pointer);
  pointer.trackPointer({ clientX: 50, clientY: 50 } as PointerEvent);
  try {
    const model = await caves.spawn('cave_entrance_open', new THREE.Vector3(5, 0, 7));
    await vi.waitFor(() => expect(prefabInstance(model)!.sprite.loaded).toBe(true));
    scene.updateMatrixWorld(true);
    const hit = () => { picker.getMouseActions(); return picker.targetModel === model; };
    expect(hit()).toBe(true);
    active.set(false);
    await new Promise(resolve => setTimeout(resolve, 0));
    scene.updateMatrixWorld(true);
    expect(hit()).toBe(false);
    active.set(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    scene.updateMatrixWorld(true);
    expect(hit()).toBe(true);
  } finally { picker.dispose(); caves.dispose(); }
}, 20000);

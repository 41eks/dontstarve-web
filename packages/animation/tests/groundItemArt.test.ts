import { prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import type { PrefabDisplay } from '@dontstarve-web/display';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { GroundItemManager } from '../../../src/groundItems';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { GROUND_ART_DEFINITIONS } from '../../prefab/src/groundItems';
import { createSignal } from '../../signals/src';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { createClusterSaveZip } from '../../../src/save/download';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initial from '../../../public/saves/initial-world.json' with { type: 'json' };
import { createPickupInventory } from './pickupFixture';
import { importedSave } from './importedSave';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { bindTestWorld } from './worldContentFixture';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const turn = () => new Promise(resolve => setTimeout(resolve, 0));
function setup(active = createSignal(true)) {
  vi.stubGlobal('fetch', async (url: string) => {
    const path = new URL(url, 'http://test').pathname;
    const file = path.startsWith('/@fs/') ? path.slice('/@fs'.length) : new URL(`../../../public${path}`, import.meta.url);
    return new Response(await readFile(file));
  });
  const scene = new THREE.Scene(), inventory = createPickupInventory();
  const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) });
  const manager = new GroundItemManager(scene, new THREE.PerspectiveCamera(), { domElement: canvas } as unknown as THREE.WebGLRenderer,
    '/dst/data/databundles/images.zip', inventory, '/dst/data/anim', new THREE.Group(), undefined, undefined, undefined, inventory.entities,
    undefined, undefined, undefined, undefined, undefined, undefined,
    () => Object.assign(active, { dispose: vi.fn() }));
  const spawn = (itemId: string, id: string, position = new THREE.Vector3(3, 0, 4), state = {}) => manager.spawnFromSave(id,
    { ...GROUND_ART_DEFINITIONS[itemId], icon: GROUND_ART_DEFINITIONS[itemId].icon ?? '', itemId, count: 1, ...state }, position);
  return { scene, inventory, manager, spawn, dispose() { manager.dispose(); inventory.dispose(); } };
}
function firstMesh(model: THREE.Object3D) {
  let mesh: THREE.Mesh | undefined;
  model.traverse(child => { if (!mesh && child instanceof THREE.Mesh) mesh = child; });
  return mesh!;
}

it('lets displays orient ground archives, hats and fallback icons, and resync sleeping art to the camera on wake', async () => {
  const scheduler = new GameTimeScheduler(), content = bindTestWorld(scheduler);
  const active = createSignal(true), world = setup(active);
  const rotation = (angle: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
  const drawnRotation = (model: THREE.Object3D) => model.children[0].getWorldQuaternion(new THREE.Quaternion());
  try {
    const initialRotation = rotation(Math.PI / 4);
    content.camerarotation.set(initialRotation);
    const twig = world.spawn('twigs', 'twigs'), card = world.spawn('playing_card', 'card');
    const hat = world.manager.spawnFromSave('hat', { ...SAVE_CATALOG.items.strawhat, itemId: 'strawhat', count: 1 }, new THREE.Vector3(4, 0, 5));
    const icon = world.manager.spawnFromSave('icon', { itemId: 'fallback_icon', icon: 'twigs.tex', name: 'Icon', count: 1 }, new THREE.Vector3(5, 0, 6));
    const billboards = [twig, hat, icon];
    await Promise.all([...billboards, card].map(model => prefabDisplay(model)!.artLoaded()));
    for (const model of billboards) expect(drawnRotation(model).angleTo(initialRotation)).toBeLessThan(1e-7);
    const cardRotation = drawnRotation(card), feet = billboards.map(model => model.position.toArray());
    const copies = billboards.flatMap(model => [vi.spyOn(model.quaternion, 'copy'), vi.spyOn(model.children[0].quaternion, 'copy')]);
    const turned = rotation(Math.PI / 3);
    content.camerarotation.set(turned);
    // The camera's publishing frame draws the new angle, without waiting for an effect microtask or a manager tick.
    for (const model of billboards) expect(drawnRotation(model).angleTo(turned)).toBeLessThan(1e-7);
    expect(drawnRotation(card).angleTo(cardRotation)).toBeLessThan(1e-7);
    copies.forEach(copy => copy.mockClear());
    world.manager.update(.1, new THREE.Quaternion());
    for (const copy of copies) expect(copy).not.toHaveBeenCalled();
    expect(billboards.map(model => model.position.toArray())).toEqual(feet);

    active.set(false); await turn();
    expect(prefabInstance(twig)!.sprite.loaded).toBe(false);
    expect(prefabInstance(hat)!.sprite.loaded).toBe(false);
    expect(twig.parent).toBeNull();
    expect(hat.parent).toBeNull();
    const wakingRotation = rotation(Math.PI / 2);
    content.camerarotation.set(wakingRotation);
    active.set(true); await turn();
    await Promise.all([twig, hat].map(model => prefabDisplay(model)!.artLoaded()));
    for (const model of billboards) expect(drawnRotation(model).angleTo(wakingRotation)).toBeLessThan(1e-7);
    expect(drawnRotation(card).angleTo(cardRotation)).toBeLessThan(1e-7);
    world.dispose();
    copies.forEach(copy => copy.mockClear());
    content.camerarotation.set(rotation(Math.PI));
    for (const copy of copies) expect(copy).not.toHaveBeenCalled();
  } finally { world.dispose(); content.unbind(); scheduler.dispose(); }
});

it('passes a standalone camera to a ground display and its attached fire', async () => {
  const world = setup();
  try {
    const log = world.spawn('log', 'log');
    world.manager.entities.get('log')!.components.burnable!.Ignite();
    const fire = prefabInstance(log)!.sprite.fx.peek().get('fire')!.display!;
    await Promise.all([prefabDisplay(log)!.artLoaded(), fire.artLoaded()]);
    const camera = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 3);
    world.manager.update(0, camera);
    const drawn = log.children.find(child => child !== fire.model)!;
    expect(drawn.getWorldQuaternion(new THREE.Quaternion()).angleTo(camera)).toBeLessThan(1e-7);
    expect(fire.model.children[0].getWorldQuaternion(new THREE.Quaternion()).angleTo(camera)).toBeLessThan(1e-7);
  } finally { world.dispose(); }
});

it('reuses ground item resources and activity, and skips sleeping visuals in the existing update loop', async () => {
  const active = createSignal(true), world = setup(active);
  try {
    const first = await world.spawn('sculpture_bishophead', 'head:1');
    const second = await world.spawn('sculpture_bishophead', 'head:2');
    // The displays load the art after the items exist.
    await Promise.all([first, second].map(model => (prefabDisplay(model) as PrefabDisplay).artLoaded()));
    const mesh = firstMesh(first), dispose = vi.fn();
    const added = vi.fn(), removed = vi.fn();
    first.addEventListener('added', added);
    first.addEventListener('removed', removed);
    expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(0);
    expect(mesh.geometry).toBe(firstMesh(second).geometry);
    mesh.geometry.addEventListener('dispose', dispose);
    const instance = prefabInstance(first)!;
    expect(instance.listTags()).toEqual(expect.arrayContaining(['heavy', 'irreplaceable', 'nonpotatable']));
    const update = vi.spyOn(instance.sprite, 'update');
    world.manager.update(.1, new THREE.Quaternion());
    expect(update).toHaveBeenCalledOnce();
    const before = world.manager.exportRecords();
    active.set(false); await turn();
    expect(world.scene.children).toHaveLength(0);
    expect(removed).toHaveBeenCalledOnce();
    update.mockClear();
    world.manager.update(.1, new THREE.Quaternion());
    expect(update).not.toHaveBeenCalled();
    expect(world.manager.renderEntities).toHaveLength(0);
    expect(world.manager.exportRecords()).toEqual(before);
    expect(dispose).not.toHaveBeenCalled();
    active.set(true); await turn(); await turn();
    expect(world.scene.children).toHaveLength(2);
    expect(added).toHaveBeenCalledOnce();
    expect(world.manager.exportRecords()).toEqual(before);
    world.manager.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  } finally { world.dispose(); }
});

it('creates a spawned item at once and lets its display draw it when the art has loaded', async () => {
  const world = setup();
  try {
    const entity = world.manager.spawnGroundItem({ ...SAVE_CATALOG.items.twigs, itemId: 'twigs', count: 1 }, new THREE.Vector3(3, 0, 4))!;
    // The inst, its model and its save record exist before any art is loaded; nothing is drawn yet.
    const [model] = world.scene.children;
    expect(prefabInstance(model)!.entityId).toBe(entity.id);
    expect(model.position.toArray()).toEqual([3, 0, 4]);
    expect(firstMesh(model)).toBeUndefined();
    await vi.waitFor(() => expect(firstMesh(model)?.geometry.getAttribute('position').count).toBeGreaterThan(0));
    expect(model.position.toArray()).toEqual([3, 0, 4]);
  } finally { world.dispose(); }
});

it('uses ground_item for c_spawn, c_save ZIP export and restore of skins, quantities, variants and height', async () => {
  const world = setup(), restored = setup(), registry = new EntityRegistry();
  registry.register(PREFAB_DEFINITIONS.groundItems, {
    debugSpawn: itemId => world.spawn(itemId, `debug:${itemId}`),
    restore: (_, record) => {
      const item = record.components.stack!;
      return world.spawn(item.itemId, record.id, new THREE.Vector3(...record.transform.position), item);
    },
    exportRecords: () => world.manager.exportRecords().map(record => ({ prefabId: 'ground_item', record })),
    dispose: () => world.manager.dispose(),
  });
  try {
    expect((await executeDebugCommand('c_spawn("icestaff")', world.inventory, id => registry.spawn(id))).ok).toBe(true);
    await world.spawn('singingshell_octave3', 'shell', undefined, { count: 7, variant: '2' });
    await world.spawn('goldenaxe', 'axe', undefined, { skinId: 'goldenaxe_invisible', remainingUses: 72.5 });
    await world.spawn('rocks', 'rocks', new THREE.Vector3(0, 3, 3), { count: 8, variant: 'f2' });
    const card = await world.spawn('playing_card', 'card', undefined, { variant: '101' });
    world.manager.update(.1, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 3));
    expect(card.quaternion.equals(new THREE.Quaternion())).toBe(true);
    expect(prefabInstance(card)!.sprite.sprite.peek().ground).toEqual({ renderOrder: 3, flat: true });
    const before = registry.exportRecords();
    let archive!: Uint8Array;
    const result = await executeDebugCommand('c_save()', world.inventory, undefined, async () => {
      archive = await createClusterSaveZip(serializeSave(deserializeSave(JSON.stringify(initial), SAVE_CATALOG), {
        entities: before, inventory: world.inventory.exportState(), elapsedSeconds: 10,
        playerTransform: { position: [0, 0, 0], rotationY: 0 },
      }, SAVE_CATALOG), 'forest');
    });
    expect(result.ok, result.message).toBe(true);
    const files = unzipSync(archive);
    const worldText = strFromU8(files['Cluster_1/Master.json']);
    const worldSave = JSON.parse(worldText) as { session: { playerFile: string }; players: object };
    expect(worldSave.players).toEqual({});
    const session = JSON.parse(strFromU8(files[`Cluster_1/${worldSave.session.playerFile}`])) as { player: unknown };
    const saved = deserializeSave(worldText, SAVE_CATALOG, session.player);
    expect(saved.world.entities).toEqual(before);
    for (const record of saved.world.entities.ground_item) {
      const item = record.components.stack!;
      const model = await restored.spawn(item.itemId, record.id, new THREE.Vector3(...record.transform.position), item);
      const instance = prefabInstance(model)!;
      if (item.itemId === 'rocks') expect(instance.sprite.currentAnimation).toBe('f2');
      if (item.itemId === 'singingshell_octave3') expect(instance.sprite.sprite.peek().appearance.get('archive-symbol:shell_placeholder')).toMatchObject({ sourceSymbol: 'octave3_2' });
    }
    expect(restored.manager.exportRecords()).toEqual(world.manager.exportRecords());
    const invalid = structuredClone(saved);
    invalid.world.entities.ground_item[1].components.stack!.variant = '999';
    expect(() => deserializeSave(JSON.stringify(invalid), SAVE_CATALOG)).toThrow('variant');
    // Existing pickup/drop keeps the same logical item and source-saved appearance.
    const rocks = world.manager.entities.get('rocks')!;
    expect(world.inventory.GiveItem(rocks)).toBe(true);
    expect(rocks.snapshot()).toMatchObject({ entityId: 'rocks', count: 8, variant: 'f2' });
    world.inventory.DropEverything();
    await turn(); await turn();
    expect(world.manager.entities.get('rocks')).toBe(rocks);
    expect(world.manager.exportRecords().find(record => record.id === 'rocks')?.components.stack)
      .toMatchObject({ itemId: 'rocks', count: 8, variant: 'f2' });
  } finally { registry.dispose(); restored.dispose(); world.dispose(); }
});

it('loads the regenerated forest and cave ground records through the normal save parser', async () => {
  for (const shard of ['Master', 'Caves'] as const) {
    const save = importedSave(shard);
    expect(save.world.entities.ground_item.length).toBeGreaterThan(100);
  }
});

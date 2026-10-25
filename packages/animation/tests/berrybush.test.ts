import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { BerrybushManager, BERRYBUSH_MAX_REGROW_TIME } from '../../prefab/src/berrybush';
import { GroundItemManager } from '../../../src/groundItems';
import { createInventoryStore } from '../../../src/inventory';
import { inventorySlotAddress } from '../../inventory/src';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { inventoryStateFromSave } from '../../../src/save/inventoryState';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { bindTestWorld } from './worldContentFixture';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const settleEffects = () => new Promise(resolve => setTimeout(resolve, 0));

function setup() {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const inventory = createInventoryStore([]), scene = new THREE.Scene(), player = new THREE.Group(), physics = new CANNON.World();
  const scheduler = new GameTimeScheduler();
  const ground = new GroundItemManager(scene, new THREE.PerspectiveCamera(), { domElement: new EventTarget() } as THREE.WebGLRenderer,
    '/dst/data/databundles/images.zip', inventory, '/dst/data/anim', player);
  const { season, snowLevel } = bindTestWorld(scheduler);
  const bushes = new BerrybushManager(scene, '/dst/data/anim', { physics,
    prepareSpawn: (definition, fling) => ground.prepareSpawn(definition, fling) });
  const registry = new EntityRegistry();
  registry.register(PREFAB_DEFINITIONS.berrybushes, {
    restore: (_, record) => bushes.spawn(new THREE.Vector3(...record.transform.position), record),
    debugSpawn: () => bushes.spawn(player.position),
    exportRecords: () => bushes.exportRecords().map(record => ({ prefabId: 'berrybush', record })), dispose: () => bushes.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.groundItems, {
    restore: (_, record) => ground.spawnFromSave(record.id,
      { ...SAVE_CATALOG.items[record.components.stack!.itemId], ...record.components.stack! }, new THREE.Vector3(...record.transform.position)),
    debugSpawn: id => ground.spawnFromSave('root:command', { ...SAVE_CATALOG.items[id], itemId: id, count: 1 }, player.position),
    exportRecords: () => ground.exportRecords().map(record => ({ prefabId: 'ground_item', record })), dispose: () => ground.dispose(),
  });
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  const save = () => serializeSave(template, { entities: { berrybush: bushes.exportRecords(), ground_item: ground.exportRecords() },
    inventory: inventory.exportState(), elapsedSeconds: scheduler.now, playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
  const advance = (seconds: number) => { scheduler.advance(seconds); bushes.update(seconds, new THREE.Quaternion()); };
  return { inventory, scene, physics, scheduler, season, snowLevel, ground, bushes, registry, save, advance,
    picker: { giveItem: (id: string, count: number) => inventory.add(id, count) },
    dispose: () => { registry.dispose(); inventory.dispose(); scheduler.dispose(); } };
}

it('picks native berries without consuming cycles, pauses in winter and reloads a randomized regrowth deadline', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(.5);
  const s = setup(), restored = setup();
  try {
    expect((await executeDebugCommand('c_spawn("berrybush");c_give("dug_berrybush",2);c_spawn("dug_berrybush")',
      s.inventory, id => s.registry.spawn(id))).ok).toBe(true);
    expect(s.inventory.getItemSpec('dug_berrybush').maxStack).toBe(10);
    expect(s.inventory.getItemSpec('dug_berrybush').atlas).toBe('images/inventoryimages.xml');
    const model = s.bushes.digTargets[0].model, pickable = model.userData.components.pickable;
    expect(s.physics.bodies).toHaveLength(1);
    expect(model.userData.instance?.getPhysicsRadius(undefined)).toBeCloseTo(.3);
    expect(pickable.pick(s.picker)).toBe(true);
    expect(s.inventory.count('berries')).toBe(1);
    expect(pickable.cyclesLeft).toBe(5);
    expect(pickable.remainingSeconds).toBe(1920);
    expect(model.userData.animationController.currentAnimation).toBe('picked');
    for (let frame = 0; frame < 90; frame++) s.advance(1 / 30);
    expect(model.userData.animationController.currentAnimation).toBe('idle');
    const waiting = pickable.state.timer.peek(); s.advance(100);
    expect(pickable.state.timer.peek()).toBe(waiting);
    s.season.set({ season: 'winter', progress: 0 }); await settleEffects();
    expect(pickable.state.timer.peek().status).toBe('paused');
    let json = '';
    expect((await executeDebugCommand('c_save()', s.inventory, undefined, () => { json = s.save(); })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG), record = saved.world.entities.berrybush[0];
    restored.season.set({ season: 'winter', progress: 0 }); await settleEffects();
    await restored.bushes.spawn(new THREE.Vector3(...record.transform.position), record);
    restored.inventory.replaceState(inventoryStateFromSave(saved), SAVE_CATALOG.recipes);
    for (const ground of saved.world.entities.ground_item) await restored.ground.spawnFromSave(ground.id,
      { ...SAVE_CATALOG.items[ground.components.stack!.itemId], ...ground.components.stack! }, new THREE.Vector3(...ground.transform.position));
    expect(restored.bushes.exportRecords()).toEqual([record]);
    expect(restored.ground.exportRecords()).toEqual(s.ground.exportRecords());
    expect(restored.inventory.exportState()).toEqual(s.inventory.exportState());
    const remaining = pickable.remainingSeconds;
    s.advance(1000); expect(pickable.remainingSeconds).toBe(remaining);
    s.season.set({ season: 'spring', progress: 0 }); await settleEffects();
    expect(pickable.remainingSeconds).toBeCloseTo(remaining * .75);
    s.advance(pickable.remainingSeconds); expect(pickable.canBePicked).toBe(true);
    expect(model.userData.animationController.currentAnimation).toBe('grow');
    expect(pickable.pick(s.picker)).toBe(true);
    expect(pickable.cyclesLeft).toBe(5);
    expect(pickable.remainingSeconds).toBe(1440);
    const invalid = JSON.parse(s.save());
    invalid.world.entities.berrybush[0].components.pickable.regrowSeconds = BERRYBUSH_MAX_REGROW_TIME + 1;
    expect(() => deserializeSave(JSON.stringify(invalid), SAVE_CATALOG)).toThrow(/regrowSeconds/);
  } finally { s.dispose(); restored.dispose(); }
});

it('preserves a reskinned bush through digging, item pickup/drop, transplant, fertilizer and depletion into two separate twigs', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(.5);
  const s = setup(), restored = setup();
  try {
    const position = new THREE.Vector3(24, 0, 36);
    const model = await s.bushes.spawn(position), originalId = model.userData.instance?.entityId;
    const reskin = await s.bushes.reskinTargets[0].prepareNextSkin();
    expect(reskin.apply()).toBe(true); reskin.dispose();
    expect(model.userData.instance?.skinId).toBe('berrybush_cawnival');
    expect(model.userData.instance?.entityId).toBe(originalId); expect(model.position.equals(position)).toBe(true);
    const original = s.bushes.exportRecords()[0];
    expect(performToolWork('DIG', s.bushes.digTargets[0].entity!, {})).toBe(true);
    expect(s.physics.bodies).toHaveLength(0);
    const loot = s.ground.exportRecords();
    expect(loot.map(record => record.components.stack?.itemId)).toEqual(['berries', 'dug_berrybush']);
    const root = loot[1].components.stack!;
    expect(root.skinId).toBe('dug_berrybush_cawnival');
    // Inventory ownership changes retain the same root inst, its skin and its source animation.
    const item = s.inventory.entities.create(root);
    s.inventory.GiveItem(item);
    expect(s.inventory.getEntity(inventorySlotAddress(0))?.id).toBe(item.id);
    const detached = s.inventory.extract(inventorySlotAddress(0), 1, item)!;
    const drop = await s.ground.prepareSpawn({ ...SAVE_CATALOG.items[root.itemId], ...detached.snapshot(), entity: detached });
    expect(drop.spawn(new THREE.Vector3(60, 0, 36))).toBe(true);
    expect(s.ground.exportRecords().at(-1)?.components.stack?.skinId).toBe(root.skinId);
    const prepared = await s.bushes.prepareTransplant(root.skinId);
    expect(item.components.deployable!.Deploy(position, { position, PushEvent: vi.fn() }, {
      canDeployPlant: () => true, deployPlant: (point: THREE.Vector3) => prepared.spawn(point),
    })).toBe(true);
    prepared.dispose();
    const replanted = s.bushes.digTargets[0].model, pickable = replanted.userData.components.pickable;
    expect(replanted.userData.instance?.skinId).toBe('berrybush_cawnival');
    expect(pickable.exportState()).toMatchObject({ picked: true, transplanted: true, cyclesLeft: 0 });
    expect(replanted.userData.animationController.currentAnimation).toBe('dead');
    s.snowLevel.set(.5); await settleEffects();
    const beforeFertilize = s.bushes.exportRecords()[0];
    const nextSkin = await s.bushes.reskinTargets[0].prepareNextSkin();
    expect(nextSkin.apply()).toBe(true); nextSkin.dispose();
    expect(replanted.userData.instance?.skinId).toBe('berrybush_mystical');
    expect(s.bushes.exportRecords()[0].components.pickable).toEqual(beforeFertilize.components.pickable);
    expect(pickable.remainingSeconds).toBeUndefined();
    const fertilizer = s.inventory.entities.create({ itemId: 'poop', count: 1 }); s.inventory.configureItem(fertilizer);
    expect(pickable.Fertilize(fertilizer)).toBe(true);
    expect(pickable.remainingSeconds).toBe(1920);
    expect(replanted.userData.animationController.currentAnimation).toBe('dead_to_idle');
    s.advance(1920);
    expect(pickable.pick(s.picker)).toBe(true);
    expect(pickable.cyclesLeft).toBe(4); expect(pickable.remainingSeconds).toBe(2160);
    let json = '';
    expect((await executeDebugCommand('c_save()', s.inventory, undefined, () => { json = s.save(); })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG), record = saved.world.entities.berrybush[0];
    expect(record.id).not.toBe(original.id);
    expect(record.components.plant?.skinId).toBe('berrybush_mystical');
    await restored.bushes.spawn(new THREE.Vector3(...record.transform.position), record);
    expect(restored.bushes.exportRecords()).toEqual([record]);
    for (let remaining = 4; remaining > 0; remaining--) {
      s.advance(pickable.remainingSeconds); expect(pickable.pick(s.picker)).toBe(true);
    }
    expect(pickable.IsBarren()).toBe(true); expect(pickable.remainingSeconds).toBeUndefined();
    expect(replanted.userData.animationController.currentAnimation).toBe('idle_to_dead');
    expect(performToolWork('DIG', s.bushes.digTargets[0].entity!, {})).toBe(true);
    expect(s.ground.exportRecords().slice(-2).map(record => record.components.stack?.itemId)).toEqual(['twigs', 'twigs']);
    expect(s.ground.exportRecords().slice(-2).map(record => record.components.stack?.count)).toEqual([1, 1]);
    s.advance(10000); expect(s.bushes.exportRecords()).toEqual([]);
    expect(s.physics.bodies).toHaveLength(0);
  } finally { s.dispose(); restored.dispose(); }
});

it('updates snow art after spawning and reskinning and cleans up each removed plant independently', async () => {
  const s = setup();
  const drawnIndices = (model: THREE.Group) => {
    let count = 0;
    model.traverse(object => { if (object instanceof THREE.Mesh) count += object.geometry.drawRange.count; });
    return count;
  };
  try {
    s.snowLevel.set(.5);
    const first = await s.bushes.spawn(new THREE.Vector3()), second = await s.bushes.spawn(new THREE.Vector3(20, 0, 0));
    const initialSnow = drawnIndices(first), secondSnow = drawnIndices(second);
    s.snowLevel.set(.014); await settleEffects();
    expect(drawnIndices(first)).toBeLessThan(initialSnow);
    s.snowLevel.set(.015); await settleEffects();
    expect(drawnIndices(first)).toBe(initialSnow);
    // The sprite json stays with the plant; a reskin replaces only its drawn sprite.
    const controller = first.userData.animationController, oldSprite = first.children[0];
    const oldMesh = oldSprite.getObjectByProperty('isMesh', true) as THREE.Mesh;
    const oldCount = oldMesh.geometry.drawRange.count;
    const skin = await s.bushes.reskinTargets[0].prepareNextSkin();
    expect(skin.apply()).toBe(true); skin.dispose();
    await settleEffects();
    expect(first.userData.animationController).toBe(controller);
    expect(first.children[0]).not.toBe(oldSprite);
    expect(oldSprite.parent).toBeNull();
    const reskinnedSnow = drawnIndices(first);
    s.snowLevel.set(0); await settleEffects();
    expect(drawnIndices(first)).toBeLessThan(reskinnedSnow);
    s.snowLevel.set(.5); await settleEffects();
    expect(drawnIndices(first)).toBe(reskinnedSnow);
    expect(oldMesh.geometry.drawRange.count).toBe(oldCount);
    // A prepared replacement reads the latest snow even if applied before its queued effect runs.
    const nextSkin = await s.bushes.reskinTargets[0].prepareNextSkin();
    s.snowLevel.set(0);
    expect(nextSkin.apply()).toBe(true); nextSkin.dispose();
    await settleEffects();
    const bareReplacement = drawnIndices(first);
    await settleEffects();
    expect(drawnIndices(first)).toBe(bareReplacement);
    // Discarding a prepared skin also releases its controller without touching the live plant.
    const canceled = await s.bushes.reskinTargets[0].prepareNextSkin();
    canceled.dispose();
    s.snowLevel.set(.5); await settleEffects();
    expect(drawnIndices(first)).toBeGreaterThan(bareReplacement);
    const hide = vi.spyOn(first.userData.animationController, 'hideLayer');
    s.snowLevel.set(0);
    s.bushes.remove(first);
    await settleEffects();
    expect(hide).not.toHaveBeenCalled();
    expect(drawnIndices(second)).toBeLessThan(secondSnow);
  } finally { s.dispose(); }
});

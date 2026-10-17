import { createPickupInventory } from './pickupFixture';
import { createPickupDoer, performPickupAction } from '../../stategraphs/src/pickup';
import * as THREE from 'three';
import type { ItemEntity } from '../../inventory/src';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GroundItemManager } from '../../../src/groundItems';
import { createGroundItemSprite } from '@dontstarve-web/prefab/groundItems';
import { FindEntities } from '../../prefab/src/actionEntity';
import { EventEmitter } from '@dontstarve-web/signals';
import type { WorldEvents } from '../../prefab/src/worldContext';

vi.mock('@dontstarve-web/animation/imageAtlas', () => ({
  loadImageAtlas: async () => ({
    require: () => ({ width: 1, height: 1, pixels: new Uint8Array([255, 255, 255, 255]) }),
  }),
}));

// This suite checks save/transfer state; browser tests load the real DST assets.
vi.mock('@dontstarve-web/prefab/groundItems', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dontstarve-web/prefab/groundItems')>();
  const createGroundItemSprite = vi.fn(async () => {
    const model = new THREE.Group();
    model.add(new THREE.Group());
    model.userData.events = [];
    for (const type of ['ondropped', 'onputininventory', 'onload'] as const) {
      model.addEventListener(type, () => model.userData.events.push(type));
    }
    return { model, update() {}, dispose() { model.userData.events.push('dispose'); model.removeFromParent(); } };
  });
  return {
    ...actual, createGroundItemSprite,
    createGroundItemFactory: () => ({
      itemIds: Object.keys(actual.GROUND_ITEM_DEFINITIONS),
      create: createGroundItemSprite,
    }),
  };
});

vi.mock('@dontstarve-web/prefab/butterfly', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dontstarve-web/prefab/butterfly')>();
  class MockButterflyAssets {
    dispose() {}
    async create(prefab: 'butterfly' | 'moonbutterfly', world: import('../../prefab/src/butterfly').ButterflyWorld) {
      const model = new THREE.Group();
      model.add(new THREE.Group());
      let controller: InstanceType<typeof actual.ButterflyController> | undefined;
      return { model, get controller() { return controller; },
        bindTransform(transform: ItemEntity['transform']) {
          controller = new actual.ButterflyController(actual.BUTTERFLY_DEFINITIONS[prefab], transform,
            { start() {}, playOnce() {}, update() {}, currentAnimation: 'idle_flight_loop', currentAnimationLength: 1 }, world, undefined, () => 0);
        },
        update: (dt: number) => controller?.update(dt),
        dispose: () => model.removeFromParent() };
    }
  }
  return {
    ...actual, ButterflyAssets: MockButterflyAssets,
    createButterflyGroundFactory: (context: import('../../prefab/src/groundPrefab').GroundPrefabContext) => {
      const assets = new MockButterflyAssets();
      return {
        itemIds: [actual.BUTTERFLY_ID], capture: 'net',
        configureEntity: actual.configureButterflyEntity,
        create: () => actual.createButterflyGroundSprite(
          assets as unknown as InstanceType<typeof actual.ButterflyAssets>,
          context.butterflyWorld,
          (position, radius, mustTags) => FindEntities(context.scene, position, radius, mustTags)),
        dispose: () => assets.dispose(),
      };
    },
  };
});

afterEach(() => vi.restoreAllMocks());

function setup() {
  const scene = new THREE.Scene();
  const canvas = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  });
  const inventory = createPickupInventory();
  const pickup = vi.spyOn(inventory, 'GiveItem');
  const player = new THREE.Group();
  const worldEvents = new EventEmitter<WorldEvents>();
  const manager = new GroundItemManager(scene, new THREE.PerspectiveCamera(),
    { domElement: canvas } as unknown as THREE.WebGLRenderer, 'images.zip', inventory, 'anim', player,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, worldEvents);
  const doer = createPickupDoer(player, inventory);
  const pick = (model: THREE.Object3D) => performPickupAction(model.userData.pickupTarget, doer);
  return { manager, scene, pickup, pick, player, inventory, canvas, worldEvents };
}

const definition = { itemId: 'log', count: 1, name: 'Log', icon: 'log.tex' };

describe('ground item save records', () => {
  it('restores a thermal stone temperature and unfinished usage cycle with its skin and durability', async () => {
    const original = setup(), restored = setup();
    const position = new THREE.Vector3(4, 0, 5);
    const stone = { itemId: 'heatrock', count: 1, name: 'Thermal Stone', icon: 'heatrock_fantasy5.tex',
      skinId: 'heatrock_fantasy', remainingFuel: 62.5, temperature: { current: 66 }, highTemp: 66 };
    try {
      await original.manager.spawnFromSave('thermal-stone', stone, position);
      const record = original.manager.exportRecords()[0];
      expect(record).toMatchObject({ id: 'thermal-stone', transform: { position: [4, 0, 5] },
        components: { stack: { itemId: 'heatrock', count: 1, skinId: 'heatrock_fantasy',
          remainingFuel: 62.5, temperature: { current: 66 }, highTemp: 66 } } });
      await restored.manager.spawnFromSave(record.id, { ...stone, ...record.components.stack },
        new THREE.Vector3(...record.transform.position));
      expect(restored.manager.exportRecords()).toEqual([record]);
    } finally {
      original.manager.dispose(); original.inventory.dispose();
      restored.manager.dispose(); restored.inventory.dispose();
    }
  });

  it('queries only the requested prefab using live positions, replacing spawn reservations without duplicate entries', async () => {
    const { manager, inventory } = setup();
    const createSprite = vi.mocked(createGroundItemSprite).getMockImplementation()!;
    const position = new THREE.Vector3(8, 0, 9);
    let release!: () => void;
    const loading = new Promise<void>(resolve => { release = resolve; });
    let atCommit: THREE.Vector3[] = [];
    try {
      const unrelated = await manager.spawnFromSave('unrelated', { ...definition, itemId: 'ash' }, new THREE.Vector3());
      vi.mocked(createGroundItemSprite).mockImplementationOnce(async (...args) => {
        await loading;
        const sprite = await createSprite(...args);
        sprite.model.addEventListener('onload', () => { atCommit = [...manager.iteratePrefabPositions('log')]; });
        return sprite;
      });
      const spawning = manager.spawnFromSave('query:log', definition, position);
      expect([...manager.iteratePrefabPositions('log')]).toEqual([position]);
      release();
      const model = await spawning;
      model.removeFromParent(); // A logical ground item remains queryable without attached art.
      const entity = manager.entities.get('query:log')!;
      expect(atCommit).toEqual([entity.transform.position]);
      const exportRecords = vi.spyOn(manager, 'exportRecords');
      const snapshot = vi.spyOn(entity, 'snapshot');
      const unrelatedEntity = unrelated.userData.pickupTarget.entity as ItemEntity;
      const unrelatedSnapshot = vi.spyOn(unrelatedEntity, 'snapshot');
      const unrelatedTags = vi.spyOn(unrelatedEntity, 'hasTag');
      entity.transform.position.set(20, 0, -30);
      entity.persists = false; // Lua spatial queries include live, non-persistent entities too.
      expect([...manager.iteratePrefabPositions('log')]).toEqual([entity.transform.position]);
      expect([...manager.iteratePrefabPositions('log')][0]).toBe(entity.transform.position);
      entity.addTag('INLIMBO');
      expect([...manager.iteratePrefabPositions('log')]).toEqual([]);
      entity.removeTag('INLIMBO');
      expect(exportRecords).not.toHaveBeenCalled();
      expect(snapshot).not.toHaveBeenCalled();
      expect(unrelatedSnapshot).not.toHaveBeenCalled();
      expect(unrelatedTags).not.toHaveBeenCalled();
      expect(inventory.GiveItem(entity)).toBe(true);
      expect([...manager.iteratePrefabPositions('log')]).toEqual([]);
      entity.destroy();
      expect([...manager.iteratePrefabPositions('log')]).toEqual([]);
    } finally { release(); manager.dispose(); inventory.dispose(); }
  });

  it('releases failed and disposed spawn reservations while art is loading', async () => {
    const { manager, inventory } = setup();
    const createSprite = vi.mocked(createGroundItemSprite).getMockImplementation()!;
    let release!: () => void;
    const loading = new Promise<void>(resolve => { release = resolve; });
    try {
      vi.mocked(createGroundItemSprite).mockRejectedValueOnce(new Error('art failed'));
      const failed = manager.spawnFromSave('failed', definition, new THREE.Vector3());
      expect([...manager.iteratePrefabPositions('log')]).toHaveLength(1);
      await expect(failed).rejects.toThrow('art failed');
      expect([...manager.iteratePrefabPositions('log')]).toEqual([]);
      vi.mocked(createGroundItemSprite).mockImplementationOnce(async (...args) => { await loading; return createSprite(...args); });
      const late = manager.spawnFromSave('late', definition, new THREE.Vector3());
      expect([...manager.iteratePrefabPositions('log')]).toHaveLength(1);
      manager.dispose();
      expect([...manager.iteratePrefabPositions('log')]).toEqual([]);
      release();
      await expect(late).rejects.toThrow('disposed');
      expect([...manager.iteratePrefabPositions('log')]).toEqual([]);
    } finally { release(); manager.dispose(); inventory.dispose(); }
  });

  it('spawns ash through scene events, preserves its saved identity and position, and stops listening on disposal', async () => {
    const first = setup(), restored = setup();
    try {
      const position = new THREE.Vector3(7, 0, 9);
      first.worldEvents.emit('spawnAsh', position);
      position.set(100, 0, 100);
      await new Promise(resolve => setTimeout(resolve, 0));
      const records = first.manager.exportRecords();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        transform: { position: [7, 0, 9] }, components: { stack: { itemId: 'ash', count: 1 } },
      });
      expect(restored.manager.exportRecords()).toEqual([]);
      await restored.manager.spawnFromSave(records[0].id,
        { ...restored.inventory.getItemSpec('ash'), ...records[0].components.stack! },
        new THREE.Vector3(...records[0].transform.position));
      expect(restored.manager.exportRecords()).toEqual(records);
      const spawn = vi.spyOn(first.manager, 'spawnFromSave');
      first.manager.dispose();
      first.worldEvents.emit('spawnAsh', position);
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(spawn).not.toHaveBeenCalled();
      expect(restored.manager.exportRecords()).toEqual(records);
    } finally {
      first.manager.dispose(); restored.manager.dispose(); first.inventory.dispose(); restored.inventory.dispose();
    }
  });

  it('saves and restores inventory overflow before its ground art finishes loading', async () => {
    const { manager, inventory, player } = setup();
    try {
      const capacity = inventory.GetNumSlots() * inventory.getStackSpec({ itemId: 'log', count: 1 }).maxStack;
      expect(inventory.add('log', capacity)).toBe(true);
      player.position.set(4, 0, 5);
      const entity = inventory.entities.create({ itemId: 'log', count: 1 });
      expect(inventory.GiveItem(entity, new THREE.Vector3(8, 0, 9))).toBe(true);
      expect(manager.renderEntities).toHaveLength(0);
      expect([...manager.iteratePrefabPositions('log')]).toEqual([entity.transform.position]);
      const records = manager.exportRecords();
      expect(records).toHaveLength(1);
      expect(records[0].id).toBe(entity.id);
      expect(records[0].transform.position).toEqual([4, 0, 5]);
      expect(records[0].components.stack).toMatchObject({ itemId: 'log', count: 1 });
      // The logical drop is saved immediately; loading art must not add another record.
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(manager.exportRecords()).toEqual(records);
      expect(manager.renderEntities).toHaveLength(1);
      expect([...manager.iteratePrefabPositions('log')]).toEqual([entity.transform.position]);
      expect(inventory.count('log')).toBe(capacity);
      const restored = setup();
      try {
        await restored.manager.spawnFromSave(records[0].id,
          { ...definition, ...records[0].components.stack }, new THREE.Vector3(...records[0].transform.position));
        expect(restored.manager.exportRecords()).toEqual(records);
      } finally { restored.manager.dispose(); restored.inventory.dispose(); }
    } finally { manager.dispose(); inventory.dispose(); }
  });

  it('commits prepared output synchronously for saves and disposes canceled preparations', async () => {
    const { manager } = setup();
    const prepared = await manager.prepareSpawn({ ...definition, count: 3 });
    expect(manager.exportRecords()).toEqual([]);
    expect(prepared.spawn(new THREE.Vector3(4, 0, 5), 2)).toBe(true);
    prepared.dispose();
    const records = manager.exportRecords();
    expect(records).toHaveLength(1);
    expect(records[0].transform.position).toEqual([4, 0, 5]);
    expect(records[0].components.stack).toMatchObject({ itemId: 'log', count: 2 });
    const canceled = await manager.prepareSpawn(definition);
    canceled.dispose();
    expect(canceled.spawn(new THREE.Vector3())).toBe(false);
    expect(manager.exportRecords()).toEqual(records);
    manager.dispose();
  });
  it('uses entity coordinates for rendering, reskinning, pickup and saves, ignoring stale model or foot projections', async () => {
    const { manager, player, inventory, pick } = setup();
    const backpack = { itemId: 'backpack', count: 1, name: 'Backpack', icon: 'backpack.tex',
      container: { slotCount: 8, slots: [{ slotKey: '2', item: { itemId: 'log', count: 3 } }] } };
    const model = await manager.spawnFromSave('bag:position', backpack, new THREE.Vector3(2, 0.25, 3));
    const entity = manager.entities.get('bag:position')!;
    entity.transform.position.set(12, 0.25, 13);
    model.position.set(-100, 40, -100);
    const projection = manager.renderEntities[0].footPosition;
    projection.set(-10, 50, -10);
    expect(manager.exportRecords()[0].transform.position).toEqual([12, 0.25, 13]);
    expect(manager.renderEntities[0].footPosition.toArray()).toEqual([12, 0.25, 13]);
    manager.update(0, new THREE.Quaternion());
    expect(model.position.toArray()).toEqual(entity.transform.position.toArray());

    const preparing = manager.reskinTargets[0].prepareNextSkin();
    entity.transform.position.set(20, 0.5, 21);
    const prepared = await preparing;
    expect(prepared.apply()).toBe(true);
    prepared.dispose();
    const replacement = manager.renderEntities[0].object;
    expect(replacement.position.toArray()).toEqual(entity.transform.position.toArray());
    expect(manager.entities.get(entity.id)).toBe(entity);
    expect([...manager.iteratePrefabPositions('backpack')]).toEqual([entity.transform.position]);
    const saved = manager.exportRecords()[0];
    expect(saved.transform.position).toEqual([20, 0.5, 21]);
    expect(saved.components.stack?.container).toEqual(entity.snapshot().container);
    expect(saved.components.stack?.skinId).toBe(entity.skinId);
    const restored = setup();
    await restored.manager.spawnFromSave(saved.id, { ...backpack, ...saved.components.stack }, new THREE.Vector3(...saved.transform.position));
    expect(restored.manager.exportRecords()).toEqual([saved]);
    restored.manager.dispose();

    // Input checks current entity coordinates before the next active frame.
    entity.transform.position.set(30, 0, 31);
    player.position.set(30, 0, 31);
    const equip = vi.spyOn(inventory, 'Equip');
    equip.mockReturnValueOnce(false);
    pick(replacement);
    expect(manager.exportRecords()[0].transform.position).toEqual([30, 0, 31]);
    pick(replacement);
    expect(inventory.GetEquippedItem('body')).toBe(entity);
    expect(replacement.parent).toBeNull();
    expect(manager.exportRecords()).toEqual([]);
    manager.dispose();
  });

  it('flings one entity per loot piece, keeps flight heights out of saves and stops motion on pickup', async () => {
    const { manager, pickup, player, pick } = setup();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      await manager.flingLoot([{ ...definition, count: 3 }], new THREE.Vector3(1, 0, 2));
      const models = manager.renderEntities.map(({ object }) => object);
      expect(models).toHaveLength(3);
      expect(manager.exportRecords().map(({ components }) => components.stack?.count)).toEqual([1, 1, 1]);
      manager.update(0.1, new THREE.Quaternion());
      expect(models.every((model) => model.children[0].position.y > 0 && model.position.y === 0)).toBe(true);
      expect(manager.exportRecords().every((record) => record.transform.position[1] === 0)).toBe(true);
      const model = models[0];
      player.position.copy(model.position);
      const entity = model.userData.pickupTarget.entity;
      const position = model.position.clone();
      pick(model);
      expect(pickup).toHaveBeenCalledWith(entity, position);
      expect(model.parent).toBeNull();
      const pickedUpPosition = model.position.clone();
      manager.update(5, new THREE.Quaternion());
      expect(model.position).toEqual(pickedUpPosition);
      expect(manager.exportRecords()).toHaveLength(2);
      expect(models.slice(1).every((model) => model.children[0].position.y === 0)).toBe(true);
      const records = manager.exportRecords();
      manager.update(5, new THREE.Quaternion());
      expect(manager.exportRecords()).toEqual(records);
    } finally { manager.dispose(); }
  });

  it('dispatches prefab events only after successful transfers and distinguishes restore from drop', async () => {
    const { manager, scene, pickup, pick } = setup();
    const lastModel = async () => (await vi.mocked(createGroundItemSprite).mock.results.at(-1)!.value).model;
    expect(await manager.drop(definition, new THREE.Vector3(), () => false)).toBe(false);
    expect((await lastModel()).userData.events).toEqual(['dispose']);
    await expect(manager.drop(definition, new THREE.Vector3(), () => { throw new Error('transfer failed'); }))
      .rejects.toThrow('transfer failed');
    expect((await lastModel()).userData.events).toEqual(['dispose']);
    await manager.drop(definition, new THREE.Vector3(3, 7, 4), () => true);
    const model = await lastModel();
    expect(model.userData.events).toEqual(['ondropped']);
    expect(model.position.toArray()).toEqual([3, 0, 4]);
    let attachedOnPickup = false;
    model.addEventListener('onputininventory', () => { attachedOnPickup = model.parent === scene; });
    const click = () => pick(model);
    pickup.mockReturnValueOnce(false);
    click();
    expect(model.userData.events).toEqual(['ondropped']);
    expect(manager.exportRecords()).toHaveLength(1);
    click();
    expect(model.userData.events).toEqual(['ondropped', 'onputininventory', 'dispose']);
    expect(attachedOnPickup).toBe(true);
    expect(manager.exportRecords()).toHaveLength(0);
    const restored = await manager.spawnFromSave('restored-events', definition, new THREE.Vector3(2, 0.25, 3));
    expect(restored.userData.events).toEqual(['onload']);
    expect(restored.position.toArray()).toEqual([2, 0.25, 3]);
    manager.update(0, new THREE.Quaternion());
    expect(manager.exportRecords()[0].transform.position).toEqual([2, 0.25, 3]);
    manager.dispose();
  });
  it('saves live drops at their ground position and excludes failed drops and picked-up items', async () => {
    const { manager, scene, pickup, pick, player } = setup();
    player.position.set(8, 0, 9);
    expect(await manager.drop(definition, new THREE.Vector3(8, 30, 9), () => false)).toBe(false);
    expect(manager.exportRecords()).toEqual([]);
    expect(await manager.drop(definition, new THREE.Vector3(8, 30, 9), () => true)).toBe(true);
    const [record] = manager.exportRecords();
    expect(record.id).toBe(scene.children[0].userData.entityId);
    expect(record.transform.position).toEqual([8, 0, 9]);
    expect(record.components.stack).toEqual({ itemId: 'log', count: 1 });
    record.components.stack!.count = 20;
    expect(manager.exportRecords()[0].components.stack?.count).toBe(1);
    const entity = scene.children[0].userData.pickupTarget.entity;
    pick(scene.children[0]);
    expect(pickup).toHaveBeenCalledWith(entity, new THREE.Vector3(8, 0, 9));
    expect(manager.exportRecords()).toEqual([]);
    expect(scene.children).toHaveLength(0);
  });

  it('splits a dropped butterfly stack into one living entity per butterfly', async () => {
    const { manager, scene, inventory } = setup();
    try {
      expect(inventory.add('butterfly', 3)).toBe(true);
      inventory.DropEverything();
      await new Promise(resolve => setTimeout(resolve, 0));
      await new Promise(resolve => setTimeout(resolve, 0));
      const records = manager.exportRecords();
      expect(records.map(record => record.components.stack?.count)).toEqual([1, 1, 1]);
      expect(new Set(records.map(record => record.id)).size).toBe(3);
      expect(scene.children).toHaveLength(3);
    } finally { manager.dispose(); inventory.dispose(); }
  });

  it('requires NET for living butterflies and keeps a failed capture in the world', async () => {
    const { manager, scene, pickup, canvas } = setup();
    const butterfly = { itemId: 'butterfly', count: 1, name: '蝴蝶', icon: 'butterfly.tex' };
    await manager.drop(butterfly, new THREE.Vector3(), () => true);
    const entity = manager.entities.get(scene.children[0].userData.entityId)!;
    // The brain's priority scatter and Wander's initial wait come first, then the butterfly flies.
    for (let frame = 0; frame < 40; frame++) manager.update(0.1, new THREE.Quaternion());
    expect(entity.transform.position.x).toBeGreaterThan(0);
    expect(scene.children[0].position.toArray()).toEqual(entity.transform.position.toArray());
    vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects').mockReturnValue([
      { object: scene.children[0] } as THREE.Intersection,
    ]);
    canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0, clientX: 50, clientY: 50 }));
    expect(pickup).not.toHaveBeenCalled();
    const [target] = manager.netCaptureTargets;
    pickup.mockImplementationOnce(entity => { entity.PushEvent('ondropped', undefined); return false; });
    expect(target.capture()).toBe(false);
    expect(target.isValid()).toBe(true);
    expect(manager.exportRecords()).toHaveLength(1);
    expect(target.capture()).toBe(true);
    expect(target.isValid()).toBe(false);
    expect(target.capture()).toBe(false);
    expect(pickup).toHaveBeenCalledTimes(2);
    expect(scene.children).toHaveLength(0);
    expect(manager.exportRecords()).toHaveLength(0);
  });
});

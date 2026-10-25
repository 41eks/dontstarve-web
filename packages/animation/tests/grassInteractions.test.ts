import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { GrassManager } from '../../prefab/src/grass';
import { GroundItemManager } from '../../../src/groundItems';
import { createPickupInventory } from './pickupFixture';
import { createPickupDoer } from '../../stategraphs/src/pickup';
import { performToolWork, collectEquippedActions } from '../../stategraphs/src/componentactions';
import { inventorySlotAddress, equipmentSlotAddress } from '../../inventory/src';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { inventoryStateFromSave } from '../../../src/save/inventoryState';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { bindTestWorld, tickWorld } from './worldContentFixture';
import { getPickActions } from '../../stategraphs/src/pick';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const inventory = createPickupInventory(), scene = new THREE.Scene(), player = new THREE.Group();
  const ground = new GroundItemManager(scene, new THREE.PerspectiveCamera(),
    { domElement: new EventTarget() } as unknown as THREE.WebGLRenderer, '/dst/data/databundles/images.zip',
    inventory, '/dst/data/anim', player);
  const worker = createPickupDoer(player, inventory);
  const scheduler = new GameTimeScheduler();
  bindTestWorld(scheduler);
  const grass = new GrassManager(scene, '/dst/data/anim', {
    prepareSpawn: (definition, fling) => ground.prepareSpawn(definition, fling),
  });
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  const save = () => serializeSave(template, {
    entities: { grass: grass.exportRecords(), ground_item: ground.exportRecords() }, inventory: inventory.exportState(),
    elapsedSeconds: 100, playerTransform: { position: [3, 0, 6], rotationY: 0 },
  }, SAVE_CATALOG);
  const dispose = () => { grass.dispose(); ground.dispose(); inventory.dispose(); };
  return { inventory, scene, player, ground, worker, grass, scheduler, save, dispose };
}

it('digs mature/picked grass through workable, preserves dug-item commands and reloads fractional shovel uses and loot', async () => {
  const s = setup(), restored = setup(), registry = new EntityRegistry();
  registry.register(PREFAB_DEFINITIONS.grasses, {
    restore: (_prefab, record) => s.grass.spawn(new THREE.Vector3(...record.transform.position), record),
    debugSpawn: () => s.grass.spawn(s.player.position),
    exportRecords: () => s.grass.exportRecords().map(record => ({ prefabId: 'grass', record })),
    dispose: () => s.grass.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.groundItems, {
    restore: (_prefab, record) => s.ground.spawnFromSave(record.id, {
      ...SAVE_CATALOG.items[record.components.stack!.itemId], ...record.components.stack!,
    }, new THREE.Vector3(...record.transform.position)),
    debugSpawn: id => s.ground.spawnFromSave('dug:command', { ...SAVE_CATALOG.items[id], itemId: id, count: 1 }, s.player.position),
    exportRecords: () => s.ground.exportRecords().map(record => ({ prefabId: 'ground_item', record })),
    dispose: () => s.ground.dispose(),
  });
  try {
    s.player.position.set(160, 0, 6);
    expect((await executeDebugCommand('c_give("dug_grass",2);c_give("goldenshovel");c_spawn("dug_grass")', s.inventory,
      id => registry.spawn(id))).ok).toBe(true);
    expect(s.inventory.count('dug_grass')).toBe(2);
    expect(s.inventory.getItemSpec('dug_grass').maxStack).toBe(10);
    s.player.position.set(3, 0, 6);
    expect((await executeDebugCommand('c_spawn("grass")', s.inventory, id => registry.spawn(id))).ok).toBe(true);
    const target = s.grass.digTargets[0], oldState = target.model.userData.pickablePlantState;
    const shovel = s.inventory.getEntity(inventorySlotAddress(1))!;
    expect(s.inventory.transfer(inventorySlotAddress(1), equipmentSlotAddress('hand'), 1)).toBe(true);
    expect(performToolWork('DIG', target.entity!, s.worker, shovel)).toBe(true);
    expect(performToolWork('DIG', target.entity!, s.worker, shovel)).toBe(false);
    expect(oldState.phase.peek()).toBe('removed');
    expect(shovel.components.finiteuses.remaining).toBe(24.75);
    expect(s.ground.exportRecords().slice(1).map(record => record.components.stack?.itemId)).toEqual(['cutgrass', 'dug_grass']);
    for (const record of s.ground.exportRecords().slice(1)) {
      const [x, y, z] = record.transform.position;
      expect(y).toBe(0);
      expect(Math.hypot(x - 3, z - 6)).toBeCloseTo(2.7);
    }
    let json = '';
    expect((await executeDebugCommand('c_save()', s.inventory, undefined, () => { json = s.save(); })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG);
    expect(saved.world.entities.grass).toEqual([]);
    restored.inventory.replaceState(inventoryStateFromSave(saved), SAVE_CATALOG.recipes);
    for (const record of saved.world.entities.ground_item) {
      const item = record.components.stack!;
      await restored.ground.spawnFromSave(record.id, { ...SAVE_CATALOG.items[item.itemId], ...item }, new THREE.Vector3(...record.transform.position));
    }
    expect(restored.ground.exportRecords()).toEqual(s.ground.exportRecords());
    expect(restored.inventory.exportState()).toEqual(s.inventory.exportState());
    expect(restored.inventory.GetEquippedItem('hand')?.id).toBe(shovel.id);
    expect(restored.inventory.GetEquippedItem('hand')?.components.finiteuses.remaining).toBe(24.75);

    const picked = await s.grass.spawn(new THREE.Vector3(80, 0, 6));
    picked.userData.components.pickable.pick({ giveItem: (item: string, count: number) => s.inventory.add(item, count) });
    const pickedTarget = s.grass.digTargets[0];
    shovel.components.finiteuses.remaining = .25;
    expect(performToolWork('DIG', pickedTarget.entity!, s.worker, shovel)).toBe(true);
    expect(s.inventory.GetEquippedItem('hand')).toBeNull();
    expect(s.inventory.handEquipment.peek()).toBeNull();
    expect(s.ground.exportRecords().at(-1)?.components.stack?.itemId).toBe('dug_grass');
    tickWorld(s.scheduler, s.grass, 2000, new THREE.Quaternion());
    expect(s.grass.exportRecords()).toEqual([]);
    expect(s.ground.exportRecords()).toHaveLength(4);
  } finally { registry.dispose(); s.dispose(); restored.dispose(); }
});

it('retains regrowth on extinguish, then burns to exactly one saved ash and releases nested-batch state', async () => {
  const s = setup();
  try {
    const model = await s.grass.spawn(new THREE.Vector3(3, 0, 6));
    const state = model.userData.pickablePlantState, burnable = model.userData.components.burnable;
    model.userData.components.pickable.pick({ giveItem: () => true });
    burnable.Ignite();
    const timer = burnable.timer.peek();
    expect(state.phase.peek()).toBe('burning');
    expect(state.persistence.peek()).toBe(false);
    expect(s.grass.exportRecords()).toEqual([]);
    expect(getPickActions(model).find(action => action.model === model)?.available).toBe(false);
    expect(s.grass.digTargets[0].isValid()).toBe(true);
    tickWorld(s.scheduler, s.grass, 10, new THREE.Quaternion());
    expect(burnable.timer.peek()).toBe(timer);
    burnable.Extinguish();
    const record = s.grass.exportRecords()[0];
    expect(record.id).toBe(model.userData.instance?.entityId);
    expect(record.components.pickable).toEqual({ picked: true, regrowSeconds: 1430 });
    expect(state.phase.peek()).toBe('picked');
    expect(state.persistence.peek()).toBe(true);
    const torch = s.inventory.entities.create({ itemId: 'torch', count: 1 });
    s.inventory.configureItem(torch);
    expect(collectEquippedActions(torch, model.userData.actionEntity, true)).toContain('LIGHT');
    burnable.Ignite();
    tickWorld(s.scheduler, s.grass, 20, new THREE.Quaternion());
    expect(state.phase.peek()).toBe('removed');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(model.parent).toBeNull();
    expect(s.grass.digTargets).toEqual([]);
    expect(s.grass.renderEntities).toEqual([]);
    expect(s.ground.exportRecords()).toHaveLength(1);
    expect(s.ground.exportRecords()[0].components.stack).toMatchObject({ itemId: 'ash', count: 1 });
    expect(s.ground.exportRecords()[0].transform.position).toEqual([3, 0, 6]);
    const saved = deserializeSave(s.save(), SAVE_CATALOG);
    expect(saved.world.entities.grass).toEqual([]);
    expect(saved.world.entities.ground_item).toEqual(s.ground.exportRecords());
    tickWorld(s.scheduler, s.grass, 1440, new THREE.Quaternion());
    expect(s.ground.exportRecords()).toHaveLength(1);
  } finally { s.dispose(); }
});

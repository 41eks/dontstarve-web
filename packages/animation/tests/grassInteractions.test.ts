import { withEntity } from './entityFixture';
import { pickupDoer } from './playerDoer';
import { prefabDisplays } from './prefabManagerFixture';
import { plantManager } from './plantManagerFixture';
import { collectEquippedItemActions } from '../../stategraphs/src/componentactions';
import { findActionEntity } from '../../prefab/src/actionEntity';
import { prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { grassPrefabs } from '../../prefab/src/grass';
import { ItemWorldFixture, itemEntities } from './itemWorldFixture';
import { createPickupInventory } from './pickupFixture';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { inventorySlotAddress, equipmentSlotAddress } from '../../inventory/src';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { loadSavedInventory } from '../../../src/save/inventoryState';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { bindTestWorld, tickWorld, plantInstance } from './worldContentFixture';
import { workTargets } from './workTargets';
import { canDoSceneAction } from './sceneActions';

vi.mock('../../prefab/src/sound', () => ({
  PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop: vi.fn() })),
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup() {
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  );
  vi.stubGlobal('window', new EventTarget());
  const inventory = createPickupInventory(),
    scene = new THREE.Scene(),
    player = withEntity(new THREE.Group(), 'wilson');
  const ground = new ItemWorldFixture(
    scene,
    new THREE.PerspectiveCamera(),
    { domElement: new EventTarget() } as unknown as THREE.WebGLRenderer,
    '/dst/data/databundles/images.zip',
    inventory,
    '/dst/data/anim',
    player,
  );
  const worker = pickupDoer(player, inventory);
  const scheduler = new GameTimeScheduler();
  bindTestWorld(scheduler);
  const grass = plantManager(grassPrefabs, scene, {
    spawnGroundItem: (definition, position, options) => ground.spawnGroundItem(definition, position, options),
  });
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  const save = () =>
    serializeSave(
      template,
      {
        entities: { grass: grass.exportRecords().map(({ record }) => record), ...ground.exportEntities() },
        inventory: inventory.exportSaved(),
        elapsedSeconds: 100,
        playerTransform: { position: [3, 0, 6], rotationY: 0 },
      },
      SAVE_CATALOG,
    );
  const dispose = () => {
    grass.dispose();
    ground.dispose();
    inventory.dispose();
  };
  return { inventory, scene, player, ground, worker, grass, scheduler, save, dispose };
}

it('digs mature/picked grass through workable, preserves dug-item commands and reloads fractional shovel uses and loot', async () => {
  const s = setup(),
    restored = setup(),
    registry = new EntityRegistry();
  registry.register(PREFAB_DEFINITIONS.grasses, {
    restore: (_prefab, record) => s.grass.restore('grass', record).transform.model,
    debugSpawn: () => s.grass.spawn('grass', s.player.position).transform.model,
    exportRecords: () => s.grass.exportRecords(),
    dispose: () => s.grass.dispose(),
  });
  registry.register(
    PREFAB_DEFINITIONS.groundItems,
    s.ground.registration(
      () => s.player.position,
      () => 'dug:command',
    ),
  );
  try {
    s.player.position.set(160, 0, 6);
    expect(
      (
        await executeDebugCommand(
          'c_give("dug_grass",2);c_give("goldenshovel");c_spawn("dug_grass")',
          s.inventory,
          id => registry.spawn(id),
        )
      ).ok,
    ).toBe(true);
    expect(s.inventory.count('dug_grass')).toBe(2);
    expect(s.inventory.getItemSpec('dug_grass').maxStack).toBe(10);
    s.player.position.set(3, 0, 6);
    expect((await executeDebugCommand('c_spawn("grass")', s.inventory, id => registry.spawn(id))).ok).toBe(true);
    const target = workTargets('DIG')[0],
      oldState = plantInstance(target.model);
    const shovel = s.inventory.getEntity(inventorySlotAddress(1))!;
    expect(s.inventory.transfer(inventorySlotAddress(1), equipmentSlotAddress('hand'), 1)).toBe(true);
    expect(performToolWork('DIG', target.entity!, s.worker, shovel)).toBe(true);
    expect(performToolWork('DIG', target.entity!, s.worker, shovel)).toBe(false);
    expect(oldState.isRemoved).toBe(true);
    expect(shovel.components.finiteuses.remaining).toBe(24.75);
    expect(
      s.ground
        .groundStacks()
        .slice(1)
        .map(stack => stack.itemId),
    ).toEqual(['cutgrass', 'dug_grass']);
    for (const record of s.ground.exportRecords().slice(1)) {
      const [x, y, z] = record.transform.position;
      expect(y).toBe(0);
      expect(Math.hypot(x - 3, z - 6)).toBeCloseTo(2.7);
    }
    let json = '';
    expect(
      (
        await executeDebugCommand('c_save()', s.inventory, undefined, () => {
          json = s.save();
        })
      ).ok,
    ).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG);
    expect(saved.world.entities.grass).toEqual([]);
    loadSavedInventory(restored.inventory, saved, SAVE_CATALOG.recipes);
    restored.ground.restoreEntities(saved.world.entities);
    expect(restored.ground.exportEntities()).toEqual(s.ground.exportEntities());
    expect(restored.inventory.exportState()).toEqual(s.inventory.exportState());
    expect(restored.inventory.GetEquippedItem('hand')?.id).toBe(shovel.id);
    expect(restored.inventory.GetEquippedItem('hand')?.components.finiteuses.remaining).toBe(24.75);

    const picked = await s.grass.spawn('grass', new THREE.Vector3(80, 0, 6)).transform.model;
    plantInstance(picked).components.pickable.pick({
      giveItem: (item: string, count: number) => s.inventory.add(item, count),
    });
    const pickedTarget = workTargets('DIG')[0];
    shovel.components.finiteuses.remaining = 0.25;
    expect(performToolWork('DIG', pickedTarget.entity!, s.worker, shovel)).toBe(true);
    expect(s.inventory.GetEquippedItem('hand')).toBeNull();
    expect(s.inventory.handEquipment.value).toBeNull();
    expect(s.ground.groundStacks().at(-1)?.itemId).toBe('dug_grass');
    tickWorld(s.scheduler, prefabDisplays(s.grass), 2000, new THREE.Quaternion());
    expect(s.grass.exportRecords().map(({ record }) => record)).toEqual([]);
    expect(s.ground.exportRecords()).toHaveLength(4);
  } finally {
    registry.dispose();
    s.dispose();
    restored.dispose();
  }
});

it('retains regrowth on extinguish, then burns to exactly one saved ash and releases nested-batch state', async () => {
  const s = setup();
  try {
    const model = await s.grass.spawn('grass', new THREE.Vector3(3, 0, 6)).transform.model;
    const state = plantInstance(model),
      burnable = plantInstance(model).components.burnable;
    plantInstance(model).components.pickable.pick({ giveItem: () => true });
    burnable.Ignite();
    const timer = burnable.timer.value;
    expect(burnable.IsBurning()).toBe(true);
    expect(state.persists).toBe(false);
    expect(s.grass.exportRecords().map(({ record }) => record)).toEqual([]);
    expect(canDoSceneAction('PICK', model)).toBe(false);
    expect(workTargets('DIG')[0].isValid()).toBe(true);
    tickWorld(s.scheduler, prefabDisplays(s.grass), 10, new THREE.Quaternion());
    expect(burnable.timer.value).toBe(timer);
    burnable.Extinguish();
    const record = s.grass.exportRecords().map(({ record }) => record)[0];
    expect(record.id).toBe(lookupPrefabInstance(model)?.entityId);
    expect(record.components.pickable).toEqual({ picked: true, regrowSeconds: 1430 });
    expect(burnable.IsBurning()).toBe(false);
    expect(state.components.pickable.state.phase.value).toBe('picked');
    expect(state.persists).toBe(true);
    // The worker holds its tool: SpawnPrefab puts the inst in the world, GiveItem takes it out of the scene.
    const torch = s.inventory.entities.create({ itemId: 'torch', count: 1 });
    s.inventory.GiveItem(torch);
    s.inventory.configureItem(torch);
    expect(collectEquippedItemActions(torch, undefined, findActionEntity(model)!, true)).toContain('LIGHT');
    burnable.Ignite();
    tickWorld(s.scheduler, prefabDisplays(s.grass), 20, new THREE.Quaternion());
    expect(state.isRemoved).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(model.parent).toBeNull();
    expect(workTargets('DIG')).toEqual([]);
    expect(s.grass.renderEntities).toEqual([]);
    expect(s.ground.exportRecords()).toHaveLength(1);
    expect(s.ground.groundStacks()[0]).toMatchObject({ itemId: 'ash', count: 1 });
    expect(s.ground.exportRecords()[0].transform.position).toEqual([3, 0, 6]);
    const saved = deserializeSave(s.save(), SAVE_CATALOG);
    expect(saved.world.entities.grass).toEqual([]);
    expect(itemEntities(saved.world.entities)).toEqual(s.ground.exportEntities());
    tickWorld(s.scheduler, prefabDisplays(s.grass), 1440, new THREE.Quaternion());
    expect(s.ground.exportRecords()).toHaveLength(1);
  } finally {
    s.dispose();
  }
});

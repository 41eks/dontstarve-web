import { prefabDisplays } from './prefabManagerFixture';
import { plantManager } from './plantManagerFixture';
import { prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import * as THREE from 'three';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { berrybushPrefabs, BERRYBUSH_MAX_REGROW_TIME } from '../../prefab/src/berrybush';
import { ItemWorldFixture } from './itemWorldFixture';
import { inventorySlotAddress } from '../../inventory/src';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { loadSavedInventory } from '../../../src/save/inventoryState';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { bindTestWorld, drawn, plantInstance } from './worldContentFixture';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { reskinEntity, reskinTargetOf } from '../../prefab/src/reskin_tool';
import { workTargets } from './workTargets';
import { createInventoryStore } from './testInventory';

vi.mock('../../prefab/src/sound', () => ({
  PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop: vi.fn() })),
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const settleEffects = () => new Promise(resolve => setTimeout(resolve, 0));

function setup() {
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  );
  vi.stubGlobal('window', new EventTarget());
  const inventory = createInventoryStore([]),
    scene = new THREE.Scene(),
    player = new THREE.Group(),
    physics = new CANNON.World();
  const scheduler = new GameTimeScheduler();
  const ground = new ItemWorldFixture(
    scene,
    new THREE.PerspectiveCamera(),
    { domElement: new EventTarget() } as THREE.WebGLRenderer,
    '/dst/data/databundles/images.zip',
    inventory,
    '/dst/data/anim',
    player,
  );
  const { season, snowLevel } = bindTestWorld(scheduler);
  const bushes = plantManager(berrybushPrefabs, scene, {
    physics,
    spawnGroundItem: (definition, position, options) => ground.spawnGroundItem(definition, position, options),
  });
  const registry = new EntityRegistry();
  registry.register(PREFAB_DEFINITIONS.berrybushes, {
    restore: (_, record) => drawn(bushes.restore('berrybush', record).transform.model),
    debugSpawn: () => drawn(bushes.spawn('berrybush', player.position).transform.model),
    exportRecords: () => bushes.exportRecords(),
    dispose: () => bushes.dispose(),
  });
  registry.register(
    PREFAB_DEFINITIONS.groundItems,
    ground.registration(() => player.position),
  );
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  const save = () =>
    serializeSave(
      template,
      {
        entities: { berrybush: bushes.exportRecords().map(({ record }) => record), ...ground.exportEntities() },
        inventory: inventory.exportSaved(),
        elapsedSeconds: scheduler.now,
        playerTransform: { position: [0, 0, 0], rotationY: 0 },
      },
      SAVE_CATALOG,
    );
  const advance = (seconds: number) => {
    scheduler.advance(seconds);
    prefabDisplays(bushes).update(seconds);
  };
  return {
    inventory,
    scene,
    physics,
    scheduler,
    season,
    snowLevel,
    ground,
    bushes,
    registry,
    save,
    advance,
    picker: { giveItem: (id: string, count: number) => inventory.add(id, count) },
    dispose: () => {
      registry.dispose();
      inventory.dispose();
      scheduler.dispose();
    },
  };
}

it('picks native berries without consuming cycles, pauses in winter and reloads a randomized regrowth deadline', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const s = setup(),
    restored = setup();
  try {
    expect(
      (
        await executeDebugCommand(
          'c_spawn("berrybush");c_give("dug_berrybush",2);c_spawn("dug_berrybush")',
          s.inventory,
          id => s.registry.spawn(id),
        )
      ).ok,
    ).toBe(true);
    expect(s.inventory.getItemSpec('dug_berrybush').maxStack).toBe(10);
    expect(s.inventory.getItemSpec('dug_berrybush').atlas).toBe('images/inventoryimages.xml');
    const model = workTargets('DIG')[0].model,
      pickable = plantInstance(model).components.pickable;
    expect(s.physics.bodies).toHaveLength(1);
    expect(lookupPrefabInstance(model)?.getPhysicsRadius(undefined)).toBeCloseTo(0.3);
    expect(pickable.pick(s.picker)).toBe(true);
    expect(s.inventory.count('berries')).toBe(1);
    expect(pickable.cyclesLeft).toBe(5);
    expect(pickable.remainingSeconds).toBe(1920);
    expect(plantInstance(model).sprite.currentAnimation).toBe('picked');
    // The berries stay drawn through the picked clip; its animover hides them as the queue moves on to idle.
    const berriesShown = () =>
      [...plantInstance(model).sprite.sprite.peek().appearance.values()].some(
        op => op.kind === 'layer' && op.layer.startsWith('berries') && !op.hidden,
      );
    expect(berriesShown()).toBe(true);
    for (let frame = 0; frame < 90; frame++) {
      s.advance(1 / 30);
    }
    expect(plantInstance(model).sprite.currentAnimation).toBe('idle');
    expect(berriesShown()).toBe(false);
    const waiting = pickable.state.timer.peek();
    s.advance(100);
    expect(pickable.state.timer.peek()).toBe(waiting);
    s.season.set({ season: 'winter', progress: 0 });
    await settleEffects();
    expect(pickable.state.timer.peek().status).toBe('paused');
    let json = '';
    expect(
      (
        await executeDebugCommand('c_save()', s.inventory, undefined, () => {
          json = s.save();
        })
      ).ok,
    ).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG),
      record = saved.world.entities.berrybush[0];
    restored.season.set({ season: 'winter', progress: 0 });
    await settleEffects();
    await drawn(restored.bushes.restore('berrybush', record).transform.model);
    loadSavedInventory(restored.inventory, saved, SAVE_CATALOG.recipes);
    restored.ground.restoreEntities(saved.world.entities);
    expect(restored.bushes.exportRecords().map(({ record }) => record)).toEqual([record]);
    expect(restored.ground.exportEntities()).toEqual(s.ground.exportEntities());
    expect(restored.inventory.exportState()).toEqual(s.inventory.exportState());
    const remaining = pickable.remainingSeconds;
    s.advance(1000);
    expect(pickable.remainingSeconds).toBe(remaining);
    s.season.set({ season: 'spring', progress: 0 });
    await settleEffects();
    expect(pickable.remainingSeconds).toBeCloseTo(remaining! * 0.75);
    s.advance(pickable.remainingSeconds!);
    expect(pickable.canBePicked).toBe(true);
    expect(plantInstance(model).sprite.currentAnimation).toBe('grow');
    expect(pickable.pick(s.picker)).toBe(true);
    expect(pickable.cyclesLeft).toBe(5);
    expect(pickable.remainingSeconds).toBe(1440);
    const invalid = JSON.parse(s.save());
    invalid.world.entities.berrybush[0].components.pickable.regrowSeconds = BERRYBUSH_MAX_REGROW_TIME + 1;
    expect(() => deserializeSave(JSON.stringify(invalid), SAVE_CATALOG)).toThrow(/regrowSeconds/);
  } finally {
    s.dispose();
    restored.dispose();
  }
});

it('preserves a reskinned bush through digging, item pickup/drop, transplant, fertilizer and depletion into two separate twigs', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const s = setup(),
    restored = setup();
  try {
    const position = new THREE.Vector3(24, 0, 36);
    const model = await drawn(s.bushes.spawn('berrybush', position).transform.model),
      originalId = lookupPrefabInstance(model)?.entityId;
    expect(reskinEntity(reskinTargetOf(prefabInstance(workTargets('DIG')[0].model))!)).toBe(true);
    expect(lookupPrefabInstance(model)?.skinId).toBe('berrybush_cawnival');
    expect(lookupPrefabInstance(model)?.entityId).toBe(originalId);
    expect(model.position.equals(position)).toBe(true);
    const original = s.bushes.exportRecords().map(({ record }) => record)[0];
    expect(performToolWork('DIG', workTargets('DIG')[0].entity!, {})).toBe(true);
    expect(s.physics.bodies).toHaveLength(0);
    const loot = s.ground.groundStacks();
    expect(loot.map(stack => stack.itemId)).toEqual(['berries', 'dug_berrybush']);
    const { entityId: _id, ...root } = loot[1];
    expect(root.skinId).toBe('dug_berrybush_cawnival');
    // Inventory ownership changes retain the same root inst, its skin and its source animation.
    const item = s.inventory.entities.create(root);
    s.inventory.GiveItem(item);
    expect(s.inventory.getEntity(inventorySlotAddress(0))?.id).toBe(item.id);
    const detached = s.inventory.extract(inventorySlotAddress(0), 1, item)!;
    expect(
      s.ground.spawnGroundItem(
        { ...SAVE_CATALOG.items[root.itemId], ...detached.snapshot(), entity: detached },
        new THREE.Vector3(60, 0, 36),
      ),
    ).toBe(detached);
    expect(s.ground.groundStacks().at(-1)?.skinId).toBe(root.skinId);
    expect(
      item.components.deployable!.Deploy(
        position,
        { position, PushEvent: vi.fn() },
        {
          canPlaceTurf: () => false,
          setTile: vi.fn(),
          itemPlanted: vi.fn(),
          canDeployDock: () => false,
          createDock: vi.fn(),
          canDeployPlow: () => false,
          deployPlow: () => false,
          isPassableAtPoint: () => true,
          isOceanTileAtPoint: () => false,
          canDeployPlant: () => true,
          SpawnPrefab: (_prefab: string, point: THREE.Vector3, skinId?: string) =>
            s.bushes.spawn('berrybush', point, undefined, skinId),
        },
      ),
    ).toBe(true);
    const replanted = await drawn(workTargets('DIG')[0].model),
      pickable = plantInstance(replanted).components.pickable;
    expect(lookupPrefabInstance(replanted)?.skinId).toBe('berrybush_cawnival');
    expect(pickable.exportState()).toMatchObject({ picked: true, transplanted: true, cyclesLeft: 0 });
    expect(plantInstance(replanted).sprite.currentAnimation).toBe('dead');
    s.snowLevel.set(0.5);
    await settleEffects();
    const beforeFertilize = s.bushes.exportRecords().map(({ record }) => record)[0];
    expect(reskinEntity(reskinTargetOf(prefabInstance(workTargets('DIG')[0].model))!)).toBe(true);
    expect(lookupPrefabInstance(replanted)?.skinId).toBe('berrybush_mystical');
    expect(s.bushes.exportRecords().map(({ record }) => record)[0].components.pickable).toEqual(
      beforeFertilize.components.pickable,
    );
    expect(pickable.remainingSeconds).toBeUndefined();
    const fertilizer = s.inventory.entities.create({ itemId: 'poop', count: 1 });
    s.inventory.configureItem(fertilizer);
    expect(pickable.Fertilize(fertilizer)).toBe(true);
    expect(pickable.remainingSeconds).toBe(1920);
    expect(plantInstance(replanted).sprite.currentAnimation).toBe('dead_to_idle');
    s.advance(1920);
    expect(pickable.pick(s.picker)).toBe(true);
    expect(pickable.cyclesLeft).toBe(4);
    expect(pickable.remainingSeconds).toBe(2160);
    let json = '';
    expect(
      (
        await executeDebugCommand('c_save()', s.inventory, undefined, () => {
          json = s.save();
        })
      ).ok,
    ).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG),
      record = saved.world.entities.berrybush[0];
    expect(record.id).not.toBe(original.id);
    expect(record.skinname).toBe('berrybush_mystical');
    await drawn(restored.bushes.restore('berrybush', record).transform.model);
    expect(restored.bushes.exportRecords().map(({ record }) => record)).toEqual([record]);
    for (let remaining = 4; remaining > 0; remaining--) {
      s.advance(pickable.remainingSeconds!);
      expect(pickable.pick(s.picker)).toBe(true);
    }
    expect(pickable.IsBarren()).toBe(true);
    expect(pickable.remainingSeconds).toBeUndefined();
    expect(plantInstance(replanted).sprite.currentAnimation).toBe('idle_to_dead');
    expect(performToolWork('DIG', workTargets('DIG')[0].entity!, {})).toBe(true);
    expect(
      s.ground
        .groundStacks()
        .slice(-2)
        .map(stack => stack.itemId),
    ).toEqual(['twigs', 'twigs']);
    expect(
      s.ground
        .groundStacks()
        .slice(-2)
        .map(stack => stack.count),
    ).toEqual([1, 1]);
    s.advance(10000);
    expect(s.bushes.exportRecords().map(({ record }) => record)).toEqual([]);
    expect(s.physics.bodies).toHaveLength(0);
  } finally {
    s.dispose();
    restored.dispose();
  }
});

it('updates snow art after spawning and reskinning and cleans up each removed plant independently', async () => {
  const s = setup();
  const drawnIndices = (model: THREE.Group) => {
    let count = 0;
    model.traverse(object => {
      if (object instanceof THREE.Mesh) {
        count += object.geometry.drawRange.count;
      }
    });
    return count;
  };
  try {
    s.snowLevel.set(0.5);
    const first = await drawn(s.bushes.spawn('berrybush', new THREE.Vector3()).transform.model),
      second = await drawn(s.bushes.spawn('berrybush', new THREE.Vector3(20, 0, 0)).transform.model);
    const initialSnow = drawnIndices(first),
      secondSnow = drawnIndices(second);
    s.snowLevel.set(0.014);
    await settleEffects();
    expect(drawnIndices(first)).toBeLessThan(initialSnow);
    s.snowLevel.set(0.015);
    await settleEffects();
    expect(drawnIndices(first)).toBe(initialSnow);
    // Reskin declares appearance on the same plant, without replacing its resident sprite.
    const controller = plantInstance(first).sprite,
      oldSprite = first.children[0];
    const oldMesh = oldSprite.getObjectByProperty('isMesh', true) as THREE.Mesh;
    expect(reskinEntity(reskinTargetOf(prefabInstance(workTargets('DIG')[0].model))!)).toBe(true);
    await drawn(first);
    await settleEffects();
    expect(plantInstance(first).sprite).toBe(controller);
    expect(first.children[0]).toBe(oldSprite);
    expect(oldSprite.parent).toBe(first);
    const reskinnedSnow = drawnIndices(first);
    s.snowLevel.set(0);
    await settleEffects();
    expect(drawnIndices(first)).toBeLessThan(reskinnedSnow);
    s.snowLevel.set(0.5);
    await settleEffects();
    expect(drawnIndices(first)).toBe(reskinnedSnow);
    expect(oldSprite.getObjectByProperty('isMesh', true)).toBe(oldMesh);
    // The next appearance also reads the latest snow declaration.
    s.snowLevel.set(0);
    expect(reskinEntity(reskinTargetOf(prefabInstance(workTargets('DIG')[0].model))!)).toBe(true);
    await drawn(first);
    await settleEffects();
    const bareReplacement = drawnIndices(first);
    await settleEffects();
    expect(drawnIndices(first)).toBe(bareReplacement);
    s.snowLevel.set(0.5);
    await settleEffects();
    expect(drawnIndices(first)).toBeGreaterThan(bareReplacement);
    // The snow layer is the display's to follow: the plant's sprite json does not change with the world's cover.
    const json = plantInstance(first).sprite.sprite.peek();
    s.snowLevel.set(0);
    expect(plantInstance(first).sprite.sprite.peek()).toBe(json);
    plantInstance(first).remove();
    s.snowLevel.set(0.5);
    s.snowLevel.set(0);
    await settleEffects();
    expect(drawnIndices(second)).toBeLessThan(secondSnow);
  } finally {
    s.dispose();
  }
});

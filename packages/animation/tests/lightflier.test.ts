import * as THREE from 'three';
import { testPlayer } from './testPlayer';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrefabDisplayGroup, SpriteState } from '@dontstarve-web/display';
import {
  lightflierFlowerPrefabs,
  LIGHTFLIER_FLOWER_ID,
  LightFlierFlowerInstance,
} from '../../prefab/src/lightflier_flower';
import {
  LightFlier,
  LightFlierHabitat,
  MakeLightFlier,
  UpdateLightFlier,
  configureLightFlierEntity,
  type LightFlierPlayer,
} from '../../prefab/src/lightflier';
import type { EntitySaveRecord } from '../../prefab/src/saveRecord';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { ItemEntity } from '../../inventory/src';
import { createPickupInventory } from './pickupFixture';
import { ItemWorldFixture } from './itemWorldFixture';
import { inventorySlotAddress } from '../../inventory/src';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { createMemo, createSignal } from '../../signals/src';
import { bindTestWorld } from './worldContentFixture';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { PrefabEntityManager, PrefabInstance, prefabInstance } from '../../prefab/src/prefabInstance';
import { createInventoryStore, testSavedItem } from './testInventory';

/** The inst.Light an entity's model declares. */
const declaredLight = (model: THREE.Object3D) => prefabInstance(model)?.light.peek();

vi.mock('../../prefab/src/sound', () => ({
  PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop() {}, isPlaying: () => true })),
}));
beforeEach(() =>
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  ),
);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const task = () => new Promise(resolve => setTimeout(resolve, 0));
function setup(players: LightFlierPlayer[] = [], withWorld = false) {
  const scene = new THREE.Scene(),
    scheduler = new GameTimeScheduler(),
    entities: ItemEntity[] = [],
    loot: string[] = [];
  const awake = createSignal(true),
    area = createMemo(() => awake.get());
  const world = withWorld ? bindTestWorld(scheduler, () => area) : undefined;
  const dropLoot = (id: string, count: number) => {
    for (let i = 0; i < count; i++) {
      loot.push(id);
    }
  };
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance<SpriteState, object>>(displays, '/dst/data/anim', {
    scheduler,
    tickingarea: world?.tickingarea,
  });
  // TheSim: the players the brain runs from stand in the same manager as the flies and their homes.
  for (const player of players) {
    const inst = new PrefabInstance('wilson', new SpriteState({ name: 'idle', billboard: true }));
    inst.addTag('player');
    inst.addTag('scarytoprey');
    inst.setPosition(player.position.x, 0, player.position.z);
    prefabs.track(inst);
  }
  const habitat = new LightFlierHabitat({
    scheduler,
    getWatchWorldContent: world?.getWatchWorldContent,
    tickingarea: world?.tickingarea,
    getPlayers: () => players,
    spawnItem: state => {
      const entity = new LightFlier(state, undefined, testSavedItem);
      MakeLightFlier(entity);
      prefabs.track(entity);
      entities.push(entity);
      return entity;
    },
    dropLoot,
    getHomes: () => prefabs.instances(LIGHTFLIER_FLOWER_ID) as Iterable<LightFlierFlowerInstance>,
  });
  prefabs.register(
    lightflierFlowerPrefabs({
      scheduler,
      habitat,
      dropLoot,
      getWatchWorldContent: world?.getWatchWorldContent,
      getLightLevel: () => 1,
    }),
  );
  const spawn = (position: THREE.Vector3, record?: EntitySaveRecord) =>
    prefabs.spawnAs(LightFlierFlowerInstance, LIGHTFLIER_FLOWER_ID, position, record);
  const records = () => prefabs.exportRecords().map(({ record }) => record);
  const step = async (dt: number) => {
    scheduler.advance(dt);
    for (const fly of habitat.flies) {
      UpdateLightFlier(fly, dt);
    }
    habitat.update(dt);
    displays.update(dt);
    await task();
  };
  const dispose = () => {
    entities.forEach(entity => entity.destroy());
    prefabs.dispose();
    displays.dispose();
    habitat.dispose();
    world?.unbind();
    area.dispose();
    scheduler.dispose();
  };
  return { scene, scheduler, entities, habitat, prefabs, spawn, records, loot, step, dispose, awake };
}

it('releases a child on light timeout, pauses growth, and captures the same entity before resuming the 12-day timer', async () => {
  const s = setup(),
    inventory = createPickupInventory();
  try {
    const plant = s.spawn(new THREE.Vector3(3, 0, 4)),
      model = plant.transform.model;
    await s.step(1);
    expect(plant.light_state).toBe('ON');
    await s.step(198);
    const [fly] = s.habitat.flies;
    expect(plant.components.pickable.canBePicked).toBe(false);
    expect(plant.components.pickable.state.paused.peek()).toBe(true);
    expect(fly.home).toBe(plant);
    expect(s.entities).toHaveLength(1);
    expect(plant.components.childspawner.numchildrenoutside).toBe(1);
    expect(declaredLight(model)).toBeUndefined();
    expect(performToolWork('NET', fly, testPlayer({ inventory }))).toBe(true);
    expect(inventory.Has('lightflier')).toBe(true);
    expect(inventory.exportState().slots.find(slot => slot.item?.itemId === 'lightflier')?.item?.entityId).toBe(fly.id);
    expect(plant.components.childspawner.numchildrenoutside).toBe(0);
    expect(plant.components.pickable.state.paused.peek()).toBe(false);
    expect(plant.components.pickable.remainingSeconds).toBe(5760);
    const seconds = plant.components.pickable.remainingSeconds!;
    s.scheduler.advance(seconds);
    expect(plant.components.pickable.canBePicked).toBe(true);
  } finally {
    inventory.dispose();
    s.dispose();
  }
});

it('restores child ownership and returns home only at the source stategraph frame, validating burning targets', async () => {
  const s = setup(),
    restored = setup();
  try {
    const plant = s.spawn(new THREE.Vector3());
    plant.components.pickable.Pick();
    const fly = [...s.habitat.flies][0];
    const record = s.records()[0],
      state = fly.snapshot();
    // OnSave writes the record the save reader returns unchanged.
    const inventory = createPickupInventory();
    try {
      const json = serializeSave(
        deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG),
        {
          entities: { lightflier_flower: [record] },
          inventory: inventory.exportSaved(),
          elapsedSeconds: 1,
          playerTransform: { position: [0, 0, 0], rotationY: 0 },
        },
        SAVE_CATALOG,
      );
      expect(deserializeSave(json, SAVE_CATALOG).world.entities.lightflier_flower).toEqual([record]);
    } finally {
      inventory.dispose();
    }
    expect(record.components.lightflierFlower).toMatchObject({
      picked: true,
      paused: true,
      childspawner: { childrenoutside: [fly.id] },
    });
    const home = restored.spawn(new THREE.Vector3(), record);
    const child = new LightFlier(state, undefined, testSavedItem);
    restored.entities.push(child);
    MakeLightFlier(child);
    restored.prefabs.track(child);
    configureLightFlierEntity(child);
    restored.habitat.bind(child);
    expect(child.home).toBe(home);
    expect(home.components.childspawner.OnSave().childrenoutside).toEqual([fly.id]);
    child.getPosition().copy(home.getPosition());
    home._lightflier_returning_home = child;
    await restored.step(1); // Finish initial flight state / evaluate the GOHOME branch.
    expect(child.stategraph.stateName).toBe('go_home');
    restored.scheduler.advance(19 / 30);
    expect(child.isRemoved).toBe(false);
    home.components.burnable.Ignite();
    restored.scheduler.advance(1 / 30 + 0.001);
    expect(child.isRemoved).toBe(false);
    expect(child.stategraph.stateName).toBe('idle');
    home.components.burnable.Extinguish();
    for (let i = 0; i < 12 && !child.isRemoved; i++) {
      await restored.step(0.25);
    }
    expect(child.isRemoved).toBe(true);
    expect(home.components.pickable.canBePicked).toBe(true);
    expect(home.light_state).toBe('ON');
    expect(home.components.childspawner.numchildrenoutside).toBe(0);
  } finally {
    s.dispose();
    restored.dispose();
  }
});

it('forms a following circle only for a player holding a lightflier, and detaches a far home when the formation disbands', async () => {
  let carrying = true;
  const player: LightFlierPlayer = {
    position: new THREE.Vector3(4, 0, 0),
    isValid: () => true,
    hasLightFlier: () => carrying,
    getFacing: () => 0,
    getWalkSpeed: () => 12,
    wantsToMove: () => false,
  };
  const s = setup([player]);
  try {
    const home = s.spawn(new THREE.Vector3());
    home.components.pickable.Pick();
    const fly = [...s.habitat.flies][0];
    await s.step(1);
    expect(s.habitat.formations.size).toBe(1);
    expect(fly.inFormation).toBe(true);
    expect(fly.hasTag('NOBLOCK')).toBe(true);
    for (let i = 0; i < 20; i++) {
      await s.step(0.1);
    }
    expect(fly.components.formationfollower.targetpos).toBeInstanceOf(THREE.Vector3);
    expect(fly.components.formationfollower.active).toBe(true);
    fly.getPosition().set(100, 0, 0);
    carrying = false;
    await s.step(1);
    expect(fly.inFormation).toBe(false);
    expect(fly.home).toBeUndefined();
    expect(home.components.pickable.state.paused.peek()).toBe(false);
    expect(fly.hasTag('NOBLOCK')).toBe(false);
  } finally {
    s.dispose();
  }
});

it('drops one bulb on death and cancels owned tasks on disposal while preserving the injected scheduler', async () => {
  const s = setup();
  const home = s.spawn(new THREE.Vector3());
  home.components.pickable.Pick();
  const fly = [...s.habitat.flies][0];
  fly.components.health.DoDelta(-25);
  expect(s.loot).toEqual(['lightbulb']);
  expect(home.components.childspawner.numchildrenoutside).toBe(0);
  const recall = home._call_for_lightflier_task;
  expect(recall?.NextTime()).toBeDefined();
  s.dispose();
  expect(recall!.NextTime()).toBeUndefined();
});

it('feeds captured livestock and replaces an entire starving stack with the same number of bulbs', () => {
  const inventory = createPickupInventory();
  try {
    inventory.add('lightflier', 3);
    const stack = inventory.exportState().slots.find(slot => slot.item?.itemId === 'lightflier')!;
    const bug = inventory.getEntity(stack.address)!;
    bug.components.perishable.SetPercent(0.2);
    const food = inventory.entities.create({ itemId: 'carrot', count: 1 });
    inventory.configureItem(food);
    expect(bug.components.eater!.Eat(food)).toBe(true);
    expect(bug.components.perishable.GetPercent()).toBe(1);
    bug.components.perishable.Perish();
    expect(inventory.get(stack.address)?.itemId).toBe('lightbulb');
    expect(inventory.get(stack.address)?.count).toBe(3);
  } finally {
    inventory.dispose();
  }
});

it('freezes and thaws through scheduler tasks, and returns an offscreen child home during daytime without rendering', async () => {
  const s = setup([], true);
  try {
    const home = s.spawn(new THREE.Vector3());
    home.components.pickable.Pick();
    const fly = [...s.habitat.flies][0];
    await task();
    const swapFrozen = () => fly.sprite.sprite.peek().appearance.get('archive-symbol:swap_frozen');
    fly.components.freezable!.AddColdness(1, 1);
    expect(fly.stategraph.stateName).toBe('frozen');
    // commonstates' frozen states: swap_frozen from frozen.zip while frozen or thawing, cleared on unfreeze.
    expect(swapFrozen()).toMatchObject({ archive: 'frozen.zip', sourceSymbol: 'frozen' });
    s.scheduler.advance(1);
    expect(fly.components.freezable!.IsThawing()).toBe(true);
    expect(fly.stategraph.stateName).toBe('thaw');
    expect(swapFrozen()).toMatchObject({ archive: 'frozen.zip' });
    s.scheduler.advance(10);
    expect(fly.components.freezable!.IsFrozen()).toBe(false);
    expect(fly.stategraph.stateName).toBe('hit');
    expect(swapFrozen()).toMatchObject({ archive: undefined });
    s.awake.set(false);
    await task();
    expect(fly.active.peek()).toBe(false);
    s.scheduler.advance(11); // No visual/update() call; entity sleep's daytime callback owns the commit.
    expect(fly.isRemoved).toBe(true);
    expect(home.components.pickable.canBePicked).toBe(true);
  } finally {
    s.dispose();
  }
});

it('spawns a lightflier as its own entity, whose brain stops while it is held and is remade when it is dropped', () => {
  const scheduler = new GameTimeScheduler(),
    inventory = createInventoryStore([]),
    restoredInventory = createInventoryStore([]);
  const habitat = (store: typeof inventory) =>
    new LightFlierHabitat({
      scheduler,
      getPlayers: () => [],
      dropLoot: () => {},
      getHomes: () => [],
      spawnItem: state => store.entities.create(state),
    });
  const fixture = (store: typeof inventory, world: LightFlierHabitat) =>
    new ItemWorldFixture(
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      undefined,
      '/dst/data/databundles/images.zip',
      store,
      '/dst/data/anim',
      new THREE.Group(),
      undefined,
      undefined,
      undefined,
      undefined,
      scheduler,
      undefined,
      undefined,
      undefined,
      undefined,
      world,
    );
  const world = habitat(inventory),
    restoredWorld = habitat(restoredInventory);
  const items = fixture(inventory, world),
    restored = fixture(restoredInventory, restoredWorld);
  try {
    items.spawnFromSave(
      'fly',
      { ...SAVE_CATALOG.items.lightflier, itemId: 'lightflier', count: 1 },
      new THREE.Vector3(3, 0, 0),
    );
    const fly = items.entities.get('fly');
    if (!(fly instanceof LightFlier)) {
      throw new Error('the lightflier prefab makes a LightFlier');
    }
    expect(world.flies.has(fly)).toBe(true);
    const brain = fly.brain;
    expect(brain?.stopped).toBe(false);
    expect(inventory.GiveItem(fly)).toBe(true);
    expect(inventory.getEntity(inventorySlotAddress(0))).toBe(fly);
    expect(fly.brain).toBeUndefined();
    expect(brain?.stopped).toBe(true);
    inventory.DropItem(fly, new THREE.Vector3(5, 0, 0));
    expect(fly.brain).toBeDefined();
    expect(fly.brain).not.toBe(brain);
    expect(fly.stategraph.stateName).toBe('idle');
    restored.restoreEntities(items.exportEntities());
    const [copy] = restored.entities.values();
    if (!(copy instanceof LightFlier)) {
      throw new Error('a saved lightflier restores as a LightFlier');
    }
    expect(restoredWorld.flies.has(copy)).toBe(true);
  } finally {
    items.dispose();
    restored.dispose();
    world.dispose();
    restoredWorld.dispose();
    inventory.dispose();
    restoredInventory.dispose();
    scheduler.dispose();
  }
});

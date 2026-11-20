import { SpatialIndex } from '../../prefab/src/spatialIndex';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FARM_PLOW_DRILLING_DURATION } from '../../prefab/src/farm_plow';
import { farmFixture } from './farmFixture';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { createPickupInventory } from './pickupFixture';
import { createDeployMap } from '../../prefab/src/deployMap';
import { DeployPlacer } from '../../prefab/src/deployPlacer';
import { deployActor } from './deployActor';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import { collectPointActions } from '../../stategraphs/src/componentactions';
import { getActionString } from '../../stategraphs/src/actions';
import { cursorSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { TurfMap, WORLD_TILES } from '../../prefab/src/turfMap';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from '../../prefab/src/groundItems';
import { createGroundItemVisual } from './groundItemVisual';
import type { WorldContext } from '../../prefab/src/worldContext';
import { PlaySound } from '../../prefab/src/sound';
import { workTargets } from './workTargets';
import { createInventoryStore, testItem } from './testInventory';

const soundStops = vi.hoisted(() => [] as ReturnType<typeof vi.fn>[]);
vi.mock('../../prefab/src/sound', () => ({
  PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => {
    const stop = vi.fn();
    soundStops.push(stop);
    return { stop, isPlaying: () => true };
  }),
}));
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  );
  vi.stubGlobal('window', new EventTarget());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  soundStops.length = 0;
});

function setup() {
  const turf = new TurfMap(96);
  const world = {
    scene: new THREE.Scene(),
    player: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(),
    ground: new THREE.Group(),
    renderer: { domElement: new EventTarget() },
    createCursorLabel: () => ({ show() {}, hide() {}, update() {} }),
  } as unknown as WorldContext;
  const returnItem = vi.fn(() => {});
  const blockers = new SpatialIndex<{ position: THREE.Vector3; tags?: string[] }>(blocker => blocker.position);
  const farm = farmFixture(world.scene, turf, {
    blockers: blockers as never,
    random: () => 0.5,
    spawnSaveRecord: returnItem,
  });
  return { turf, world, returnItem, blockers, farm, advance: farm.advance };
}

function item(remainingUses?: number) {
  return testItem({ itemId: 'farm_plow_item', count: 1, remainingUses });
}

it('loads original packed ground art and the actual inventory atlas', async () => {
  const assets = new GroundItemAssets();
  try {
    const item = await createGroundItemVisual('farm_plow_item');
    expect(GROUND_ITEM_DEFINITIONS.farm_plow_item).toMatchObject({
      atlas: 'images/inventoryimages2.xml',
      animation: 'idle_packed',
      bank: 'farm_plow',
      skinArchives: {},
    });
    expect(item.model.children[0].children).toHaveLength(1);
    expect((item.model.children[0].children[0].children[0] as THREE.Mesh).geometry.drawRange.count).toBeGreaterThan(0);
    item.dispose();
  } finally {
    assets.dispose();
  }
});

it('snaps deployment, drills for 15 seconds, terraforms and returns a folded three-use item', async () => {
  const { farm, turf, returnItem, advance } = setup();
  try {
    const original = item();
    const use = vi.spyOn(original.components.finiteuses, 'use');
    expect(farm.map.deploy(new THREE.Vector3(1, 0, 2), original)).toBe(true);
    expect(use).toHaveBeenCalledExactlyOnceWith(1);
    expect(original.isRemoved).toBe(true);
    // deploy_item_save_record: the item's GetSaveRecord after its use, kept by id though the item is gone.
    const savedItem = {
      id: original.id,
      prefab: 'farm_plow_item',
      components: { finiteuses: { uses: original.components.finiteuses.remaining } },
    };
    expect(farm.plows()[0]).toMatchObject({
      transform: { position: [6, 0, 6] },
      components: {
        farmPlow: { phase: 'drill_pre', remainingSeconds: FARM_PLOW_DRILLING_DURATION, deployItem: savedItem },
      },
    });
    expect(farm.map.canDeploy(new THREE.Vector3(4, 0, 4))).toBe(false);
    // drill_pre's animover starts drilling once the display has drawn it.
    await workTargets('HAMMER')[0].display!.artLoaded();
    expect(farm.plows()[0].components.farmPlow!.phase).toBe('drill_pre');
    await advance(2);
    expect(farm.plows()[0].components.farmPlow!.phase).toBe('drill_loop');
    expect(turf.getTileAtWorld({ x: 6, z: 6 })).toBe(WORLD_TILES.DECIDUOUS);
    await advance(13);
    expect(returnItem).not.toHaveBeenCalled();
    await advance(5);
    expect(turf.getTileAtWorld({ x: 6, z: 6 })).toBe(WORLD_TILES.FARMING_SOIL);
    expect(farm.plows()).toEqual([]);
    expect(returnItem).toHaveBeenCalledExactlyOnceWith(new THREE.Vector3(6, 0, 6), savedItem);
    expect(farm.decor().some(({ prefabId }) => prefabId === 'farm_soil_debris')).toBe(true);
    expect(farm.decor().some(({ prefabId }) => prefabId === 'farm_soil')).toBe(true);
    expect(farm.decor().every(({ record }) => record.components.farmSoil?.plowId === undefined)).toBe(true);
    expect(farm.map.canDeploy(new THREE.Vector3(6, 0, 6))).toBe(false);
    const loopCall = vi.mocked(PlaySound).mock.calls.findIndex(([event]) => event === 'farming/common/farm/plow/LP');
    expect(soundStops[loopCall]).toHaveBeenCalledOnce();
    turf.dig({ x: 6, z: 6 });
    expect(turf.getTileAtWorld({ x: 6, z: 6 })).toBe(WORLD_TILES.DECIDUOUS);
    expect(farm.decor().some(({ prefabId }) => prefabId === 'farm_soil')).toBe(false);
  } finally {
    farm.dispose();
  }
});

it('does not return an exhausted item on its fourth use and one hammer hit recovers an active item', async () => {
  const { farm, turf, returnItem, advance } = setup();
  try {
    const lastUse = item(1);
    farm.map.deploy(new THREE.Vector3(1, 0, 1), lastUse);
    expect(lastUse.isRemoved).toBe(true);
    expect(farm.plows()[0].components.farmPlow!.deployItem).toBeNull();
    await advance(20);
    expect(turf.getTileAtWorld({ x: 6, z: 6 })).toBe(WORLD_TILES.FARMING_SOIL);
    expect(returnItem).not.toHaveBeenCalled();
    const original = item(3);
    farm.map.deploy(new THREE.Vector3(-13, 0, -1), original);
    await advance(3);
    const target = workTargets('HAMMER')[0];
    target.work();
    target.work();
    expect(target.isValid()).toBe(false);
    expect(farm.plows()).toEqual([]);
    expect(returnItem).toHaveBeenCalledExactlyOnceWith(new THREE.Vector3(-18, 0, -6), {
      id: original.id,
      prefab: 'farm_plow_item',
      components: { finiteuses: { uses: original.components.finiteuses.remaining } },
    });
    expect(turf.getTileAtWorld({ x: -18, z: -6 })).toBe(WORLD_TILES.DECIDUOUS);
    expect(farm.decor().every(({ record }) => record.components.farmSoil?.plowId !== target.id)).toBe(true);
  } finally {
    farm.dispose();
  }
});

it('rejects hard terrain and blocking entities without spending an item', async () => {
  const { farm, turf, blockers } = setup();
  const point = new THREE.Vector3(1, 0, 1);
  const original = item();
  try {
    turf.setOriginalTile(point, WORLD_TILES.WOODFLOOR);
    expect(farm.map.deploy(point, original)).toBe(false);
    turf.setOriginalTile(point, WORLD_TILES.DECIDUOUS);
    const blocker = { position: point, tags: [] as string[] };
    blockers.add(blocker);
    expect(farm.map.deploy(point, original)).toBe(false);
    blocker.tags = ['FX'];
    expect(farm.map.canDeploy(point)).toBe(true);
    expect(farm.plows()).toEqual([]);
    expect(original.isRemoved).toBe(false);
    expect(original.components.finiteuses.remaining).toBeUndefined();
  } finally {
    farm.dispose();
  }
});

it('picks DEPLOY_TILEARRIVE for the held item, arrives anywhere on the tile and commits one use at frame six', async () => {
  const { farm, turf, world, blockers } = setup();
  const inventory = createInventoryStore([]);
  const map = createDeployMap({ turf, blockers: blockers as never, farm: farm.map }),
    actor = deployActor(world, inventory, map);
  const placer = new DeployPlacer(world, map, () => inventory.GetActiveItem());
  const click = new THREE.Vector3(10, 0, 2);
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  );
  vi.spyOn(PointerRaycaster.prototype, 'groundPoint').mockImplementation(() => click.clone());
  try {
    expect(inventory.add('farm_plow_item', 1)).toBe(true);
    expect(inventory.transfer(inventorySlotAddress(0), cursorSlotAddress(), 1)).toBe(true);
    const entity = inventory.GetActiveItem()!;
    for (const tag of ['usedeploystring', 'tile_deploy']) {
      expect(entity.hasTag(tag)).toBe(true);
    }

    // Selecting the item shows farm_plow_item_placer and its tile_outline, snapped to the tile centre.
    placer.update();
    expect(world.scene.children.map(model => model.name)).toEqual(
      expect.arrayContaining(['FarmPlowPlacer', 'FarmPlowTileOutline']),
    );
    const preview = world.scene.children.find(model => model.name === 'FarmPlowPlacer')!;
    expect(preview.position.toArray()).toEqual([6, 0, 6]);

    const [point] = collectPointActions(entity, actor.doer, click, true);
    expect(point).toBe('DEPLOY_TILEARRIVE');
    expect(getActionString({ action: point, invobject: entity })).toBe('部署');
    world.player.position.set(-30, 0, 2);
    const action = actor.controller.createAction({ action: point, invobject: entity, pos: click })!;
    expect(actor.controller.DoAction(action)).toBe(true);
    const [walk, arrive] = actor.locomotor.pushAction.mock.calls[0];
    expect(walk.distance).toBeUndefined();
    expect(walk.arrived!()).toBe(false);
    // CheckTileWithinRange: inside the clicked tile, however far from the click itself.
    world.player.position.set(0.5, 0, 11);
    expect(walk.arrived!()).toBe(true);
    arrive();
    expect(actor.graph.stateName).toBe('doshortaction');
    actor.graph.update(5 / 30);
    expect(farm.plows()).toEqual([]);
    actor.graph.update(1 / 30);
    const [record] = farm.plows();
    expect(record.transform.position).toEqual([6, 0, 6]);
    expect(record.components.farmPlow!.deployItem).toMatchObject({
      prefab: 'farm_plow_item',
      components: { finiteuses: { uses: 3 } },
    });
    expect(inventory.GetActiveItem()).toBeNull();
    placer.update();
    expect(world.scene.children.some(model => model.name === 'FarmPlowPlacer')).toBe(false);
  } finally {
    placer.dispose();
    actor.controller.dispose();
    inventory.dispose();
    farm.dispose();
  }
});

it('restores drilling progress, attached soil and remaining item uses without restarting the timer', async () => {
  const { farm, returnItem, turf, advance } = setup();
  try {
    // farm_plow.lua deploy_item_save_record: the item's GetSaveRecord, with one use left.
    const deployItem = { id: 'saved_item', prefab: 'farm_plow_item', components: { finiteuses: { uses: 1 } } };
    farm.spawn(
      'farm_plow',
      new THREE.Vector3(6, 0, 6),
      { farmPlow: { phase: 'drill_loop', remainingSeconds: 2, deployItem } },
      'saved_plow',
    );
    const exported = farm.plows();
    exported[0].components.farmPlow!.deployItem!.components.finiteuses = { uses: 3 };
    expect(farm.plows()[0].components.farmPlow!.deployItem).toEqual(deployItem);
    farm.spawn(
      'farm_soil',
      new THREE.Vector3(6, 0, 10.5),
      { farmSoil: { broken: false, plowId: 'saved_plow' } },
      'saved_soil',
    );
    await farm.advance(0.1);
    // OnLoadPostPass links the soil to its restored plow.
    expect(farm.decor().find(({ record }) => record.id === 'saved_soil')?.record.components.farmSoil).toEqual({
      broken: false,
      plowId: 'saved_plow',
    });
    // OnSave writes the records the save reader returns unchanged.
    const entities = { farm_plow: farm.plows(), farm_soil: farm.decor().map(({ record }) => record) },
      inventory = createPickupInventory();
    try {
      const json = serializeSave(
        deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG),
        {
          entities,
          inventory: inventory.exportSaved(),
          elapsedSeconds: 1,
          playerTransform: { position: [0, 0, 0], rotationY: 0 },
        },
        SAVE_CATALOG,
      );
      const saved = deserializeSave(json, SAVE_CATALOG).world.entities;
      expect({ farm_plow: saved.farm_plow, farm_soil: saved.farm_soil }).toEqual(entities);
    } finally {
      inventory.dispose();
    }
    expect(farm.plows()[0].id).toBe('saved_plow');
    await advance(5);
    expect(turf.getTileAtWorld({ x: 6, z: 6 })).toBe(WORLD_TILES.FARMING_SOIL);
    expect(returnItem).toHaveBeenCalledExactlyOnceWith(new THREE.Vector3(6, 0, 6), deployItem);
    expect(farm.plows()).toEqual([]);
  } finally {
    farm.dispose();
  }
});

import { SpatialIndex } from '../../prefab/src/spatialIndex';
import type { PlacementBlocker } from '../../prefab/src/placementEntities';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDockWorld } from '../../prefab/src/dock_kit';
import { createDeployMap } from '../../prefab/src/deployMap';
import { DeployPlacer } from '../../prefab/src/deployPlacer';
import { deployActor } from './deployActor';
import { PlayerActionPicker } from '../../stategraphs/src/playeractionpicker';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import { createInventoryStore } from '../../../src/inventory';
import { cursorSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { prefabDisplay } from '@dontstarve-web/display';
import { TurfMap, WORLD_TILES, type TurfTileSave } from '../../prefab/src/turfMap';
import { DockManager, type DockMap } from '../../componets/src/dockmanager';
import { INVENTORY_ITEM_SPECS } from '../../../src/inventoryItems';
import { deserializeSave } from '../../../src/save/deserialize';
import type { SaveDocument } from '../../../src/save/types';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import definitions from '../../prefab/src/definitions.json' with { type: 'json' };
import type { WorldContext } from '../../prefab/src/worldContext';

const setParameter = vi.hoisted(() => vi.fn());
vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn(), setParameter })) }));
beforeEach(() => vi.stubGlobal('window', new EventTarget()));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

/** A 96-unit world: land for cols -4..-1, an ocean field for cols 0..3 (rows -4..3). */
const oceanTiles = (): TurfTileSave[] => Array.from({ length: 32 }, (_, i) => ({
  col: Math.floor(i / 8), row: (i % 8) - 4, tileId: WORLD_TILES.OCEAN_COASTAL }));
const centre = (col: number, row: number) => new THREE.Vector3(col * 12 + 6, 0, row * 12 + 6);

function setup(tiles = oceanTiles(), blockers = new SpatialIndex<PlacementBlocker>(blocker => blocker.position, blocker => blocker.smartRadius ?? 0)) {
  const turf = new TurfMap(96, tiles), renderer = { domElement: new EventTarget() } as unknown as THREE.WebGLRenderer;
  const camera = new THREE.PerspectiveCamera();
  const world = { scene: new THREE.Scene(), player: new THREE.Group(), camera, ground: new THREE.Group(), renderer,
    mouseActions: new PlayerActionPicker(new PointerRaycaster({ camera, renderer })) } as unknown as WorldContext;
  return { turf, world, blockers, docks: createDockWorld(turf, blockers as never) };
}

it('is a 20-stack inventory item with its own ground art and icon', () => {
  expect(INVENTORY_ITEM_SPECS.dock_kit).toMatchObject({ maxStack: 20, icon: 'dock_kit.tex' });
});

it('deploys only on ocean touching land or a dock, covers the ocean tile and survives a save round trip', () => {
  const { turf, docks } = setup();
  expect(docks.canDeployDock(centre(-1, 0))).toBe(false); // land
  expect(docks.canDeployDock(centre(2, 0))).toBe(false); // open water, no adjacent land or dock
  expect(docks.canDeployDock(centre(0, 0))).toBe(true); // shore
  docks.createDock(centre(0, 0));
  expect(turf.tileIdAtCell(0, 0)).toBe(WORLD_TILES.MONKEY_DOCK);
  expect(turf.underTileAtCell(0, 0)).toBe(WORLD_TILES.OCEAN_COASTAL);
  expect(turf.isOceanAtWorld({ x: 6, z: 6 })).toBe(false);
  expect(docks.dockmanager.IsRoot(0, 0)).toBe(true);

  // The new dock extends the reach one tile at a time.
  expect(docks.canDeployDock(centre(1, 0))).toBe(true);
  docks.createDock(centre(1, 0));
  expect(docks.dockmanager.IsRoot(1, 0)).toBe(false); // touches only the dock at (0, 0)

  const restored = setup(turf.exportTiles());
  expect(restored.turf.tileIdAtCell(1, 0)).toBe(WORLD_TILES.MONKEY_DOCK);
  expect(restored.docks.dockmanager.IsRoot(0, 0)).toBe(true);
  expect(restored.docks.dockmanager.IsRoot(1, 0)).toBe(false);
  expect(restored.docks.canDeployDock(centre(2, 0))).toBe(true);
});

it('refuses a tile with an unrelated entity standing in the water or a dockjammer, ignores ones on land and the player', () => {
  const blockers = new SpatialIndex<PlacementBlocker>(blocker => blocker.position);
  blockers.add({ position: centre(0, 1), tags: ['player'] });
  const { docks } = setup(oceanTiles(), blockers);
  expect(docks.canDeployDock(centre(0, 0))).toBe(true);
  blockers.add({ position: centre(-1, 0), tags: [] }); // on land: IsDockNearOtherOnOcean ignores it
  expect(docks.canDeployDock(centre(0, 0))).toBe(true);
  const obstacle = { position: new THREE.Vector3(8, 0, 8), tags: [] };
  blockers.add(obstacle);
  expect(docks.canDeployDock(centre(0, 0))).toBe(false);
  blockers.delete(obstacle); blockers.add({ position: centre(0, 0), tags: ['dockjammer'] });
  expect(docks.canDeployDock(centre(0, 0))).toBe(false);
});

it('dockmanager breaks only docks with no path to a permanent root', () => {
  const tiles = new Map<string, number>([['0,0', 1], ['1,0', 2], ['2,0', 2], ['5,5', 2]]); // 1 land, 2 dock
  const map: DockMap = { getTile: (c, r) => tiles.get(`${c},${r}`) ?? 0, setTile: (c, r, t) => { tiles.set(`${c},${r}`, t); },
    cellsOfTile: t => [...tiles].filter(([, v]) => v === t).map(([k]) => k.split(',').map(Number) as [number, number]),
    isLandTile: t => t !== 0, isTemporaryTile: t => t === 2 };
  const queued: string[] = [];
  const manager = new DockManager(map, { dock: 2, farmingSoil: 3 }, (c, r) => queued.push(`${c},${r}`));
  expect(manager.IsRoot(1, 0)).toBe(true);
  expect(manager.IsRoot(2, 0)).toBe(false);
  expect(manager.ResolveDockSafetyAtTile(2, 0)).toBe(false); // reaches the root through (1, 0)
  expect(manager.ResolveDockSafetyAtTile(5, 5)).toBe(true); // floating dock
  expect(queued).toEqual(['5,5']);
});

it('saves a dock as a MONKEY_DOCK tile over its ocean undertile and rejects one without it', () => {
  const parse = (tiles: unknown) => {
    const save = structuredClone(initialWorld) as unknown as SaveDocument;
    (save.world.map as { tiles?: unknown }).tiles = tiles;
    save.world.entities = {};
    save.players.local.inventory.containers = { 'player:inventory': { slotCount: 15, slots: [] }, 'player:equipment': { slotCount: 3, slots: [] } };
    save.players.local.inventory.bufferedBuilds = [];
    return deserializeSave(JSON.stringify(save), { items: {}, skins: {}, recipes: {}, recipeSkins: {},
      buildings: definitions.animatedBuildings, walls: Object.keys(definitions.walls) });
  };
  const ocean = { col: 0, row: 0, tileId: WORLD_TILES.OCEAN_COASTAL };
  const dock = { col: 1, row: 0, tileId: WORLD_TILES.MONKEY_DOCK, underTileId: WORLD_TILES.OCEAN_COASTAL };
  expect(parse([ocean, dock]).world.map.tiles).toEqual([ocean, dock]);
  expect(() => parse([ocean, { ...dock, underTileId: undefined }])).toThrow(/dock covers an ocean tile/);
  expect(() => parse([ocean, { ...dock, underTileId: WORLD_TILES.DIRT }])).toThrow(/dock covers an ocean tile/);
});

it('walks to the shore through DEPLOY, reaches over the water, consumes one kit at frame six and shows the gridplacer', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const { turf, world, blockers } = setup();
  const inventory = createInventoryStore([{ slot_index: 0, id: 'dock_kit', num: 2 }]);
  const map = createDeployMap({ turf, blockers, plants: {} }), actor = deployActor(world, inventory, map);
  const placer = new DeployPlacer(world, map, () => inventory.GetActiveItem());
  vi.spyOn(PointerRaycaster.prototype, 'groundPoint').mockReturnValue(centre(0, 0));
  vi.spyOn(PointerRaycaster.prototype, 'pickMouseTarget').mockReturnValue(undefined as never);
  try {
    // Selecting the kit picks it up like any other item; no placement mode claims the slot click.
    expect(inventory.transfer(inventorySlotAddress(0), cursorSlotAddress(), 2)).toBe(true);
    const entity = inventory.GetActiveItem()!;
    expect(entity.components.deployable).toMatchObject({ mode: 'CUSTOM', usegridplacer: true });
    for (const tag of ['groundtile', 'deploykititem', 'usedeployspacingasoffset']) expect(entity.hasTag(tag)).toBe(true);

    placer.update();
    await vi.waitFor(() => expect(world.scene.children).toHaveLength(1));
    const [outline] = world.scene.children, instance = prefabInstance(outline)!;
    placer.update();
    await prefabDisplay(outline)!.artLoaded();
    expect(instance.sprite.currentAnimation).toBe('anim');
    expect(instance.position.x).toBe(6);

    world.player.position.set(-6, 0, 6);
    const action = actor.controller.createAction({ action: 'DEPLOY', invobject: entity as never, pos: centre(0, 0) })!;
    expect(actor.controller.DoAction(action)).toBe(true);
    // actions.lua ExtraDeployDist: 1.1 + DEPLOYSPACING.DEFAULT (2) + 1 DST units, from land to an ocean point.
    expect(actor.locomotor.PushAction.mock.calls[0][0]).toMatchObject({ distance: expect.closeTo(4.1 * 3) });
    actor.locomotor.PushAction.mock.calls[0][1]();
    actor.graph.update(5 / 30);
    expect(turf.tileIdAtCell(0, 0)).toBe(WORLD_TILES.OCEAN_COASTAL);
    actor.graph.update(1 / 30);
    expect(turf.tileIdAtCell(0, 0)).toBe(WORLD_TILES.MONKEY_DOCK);
    expect(setParameter).toHaveBeenCalledWith('intensity', .8);
    expect(inventory.get(cursorSlotAddress())?.count).toBe(1);

    // Not ocean any more: no action at the pointer, and the rest of the stack returns on a right click.
    expect(world.mouseActions!.getMouseActions().right).toBeUndefined();
    const event = Object.assign(new Event('pointerdown', { cancelable: true }), { button: 2, clientX: 0, clientY: 0 });
    world.renderer.domElement.dispatchEvent(event);
    expect(inventory.GetActiveItem()).toBeNull();
    placer.update();
    expect(instance.isRemoved).toBe(true);
    expect(world.scene.children).toEqual([]);
  } finally { placer.dispose(); actor.controller.dispose(); inventory.dispose(); }
});

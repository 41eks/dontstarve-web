import { SpatialIndex } from '../../prefab/src/spatialIndex';
import type { PlacementBlocker } from '../../prefab/src/placementEntities';
import { ItemEntity } from '@dontstarve-web/inventory';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DockKitPlacement } from '../../prefab/src/dock_kit';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { prefabDisplay } from '@dontstarve-web/display';
import { TurfMap, WORLD_TILES, type TurfTileSave } from '../../prefab/src/turfMap';
import { DockManager, type DockMap } from '../../componets/src/dockmanager';
import { PlaySound } from '../../prefab/src/sound';
import { INVENTORY_ITEM_SPECS } from '../../../src/inventoryItems';
import { deserializeSave } from '../../../src/save/deserialize';
import type { SaveDocument } from '../../../src/save/types';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import definitions from '../../prefab/src/definitions.json' with { type: 'json' };
import type { WorldContext } from '../../prefab/src/worldContext';

const setParameter = vi.hoisted(() => vi.fn());
vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn(), setParameter })) }));
beforeEach(() => vi.stubGlobal('window', new EventTarget()));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

/** A 96-unit world: land for cols -4..-1, an ocean field for cols 0..3 (rows -4..3). */
const oceanTiles = (): TurfTileSave[] => Array.from({ length: 32 }, (_, i) => ({
  col: Math.floor(i / 8), row: (i % 8) - 4, tileId: WORLD_TILES.OCEAN_COASTAL }));
const centre = (col: number, row: number) => new THREE.Vector3(col * 12 + 6, 0, row * 12 + 6);

function setup(tiles = oceanTiles(), blockers = new SpatialIndex<PlacementBlocker>(blocker => blocker.position, blocker => blocker.smartRadius ?? 0)) {
  const turf = new TurfMap(96, tiles);
  const world = { scene: new THREE.Scene(), player: new THREE.Group(), camera: new THREE.PerspectiveCamera(),
    ground: new THREE.Group(), renderer: { domElement: new EventTarget() },
    createCursorLabel: () => ({ show() {}, hide() {}, update() {} }) } as unknown as WorldContext;
  return { turf, world, placement: new DockKitPlacement(world, turf, blockers) };
}
const kit = () => new ItemEntity({ itemId: 'dock_kit', count: 1 });

it('is a 20-stack inventory item with its own ground art and icon', () => {
  expect(INVENTORY_ITEM_SPECS.dock_kit).toMatchObject({ maxStack: 20, icon: 'dock_kit.tex' });
});

it('deploys only on ocean touching land or a dock, covers the ocean tile and survives a save round trip', () => {
  const { turf, placement } = setup();
  try {
    expect(placement.canDeploy(centre(-1, 0))).toBe(false); // land
    expect(placement.canDeploy(centre(2, 0))).toBe(false); // open water, no adjacent land or dock
    expect(placement.canDeploy(centre(0, 0))).toBe(true); // shore
    const first = kit();
    expect(placement.deploy(centre(0, 0), () => first)).toBe(true);
    expect(first.isRemoved).toBe(true);
    expect(setParameter).toHaveBeenCalledWith('intensity', .8);
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/common/together/boat/damage', expect.any(THREE.Vector3));
    expect(turf.tileIdAtCell(0, 0)).toBe(WORLD_TILES.MONKEY_DOCK);
    expect(turf.underTileAtCell(0, 0)).toBe(WORLD_TILES.OCEAN_COASTAL);
    expect(turf.isOceanAtWorld({ x: 6, z: 6 })).toBe(false);
    expect(placement.dockmanager.IsRoot(0, 0)).toBe(true);

    // The new dock extends the reach one tile at a time; a refused deploy keeps the kit.
    expect(placement.canDeploy(centre(1, 0))).toBe(true);
    const refused = kit();
    expect(placement.deploy(centre(2, 0), () => refused)).toBe(false);
    expect(refused.isRemoved).toBe(false);
    expect(placement.deploy(centre(1, 0), kit)).toBe(true);
    expect(placement.dockmanager.IsRoot(1, 0)).toBe(false); // touches only the dock at (0, 0)

    const restored = setup(turf.exportTiles());
    try {
      expect(restored.turf.tileIdAtCell(1, 0)).toBe(WORLD_TILES.MONKEY_DOCK);
      expect(restored.placement.dockmanager.IsRoot(0, 0)).toBe(true);
      expect(restored.placement.dockmanager.IsRoot(1, 0)).toBe(false);
      expect(restored.placement.canDeploy(centre(2, 0))).toBe(true);
    } finally { restored.placement.dispose(); }
  } finally { placement.dispose(); }
});

it('refuses a tile with an unrelated entity standing in the water or a dockjammer, ignores ones on land and the player', () => {
  const blockers = new SpatialIndex<PlacementBlocker>(blocker => blocker.position);
  blockers.add({ position: centre(0, 1), tags: ['player'] });
  const { placement } = setup(oceanTiles(), blockers);
  try {
    expect(placement.canDeploy(centre(0, 0))).toBe(true);
    blockers.add({ position: centre(-1, 0), tags: [] }); // on land: IsDockNearOtherOnOcean ignores it
    expect(placement.canDeploy(centre(0, 0))).toBe(true);
    const obstacle = { position: new THREE.Vector3(8, 0, 8), tags: [] };
    blockers.add(obstacle);
    expect(placement.canDeploy(centre(0, 0))).toBe(false);
    blockers.delete(obstacle); blockers.add({ position: centre(0, 0), tags: ['dockjammer'] });
    expect(placement.canDeploy(centre(0, 0))).toBe(false);
  } finally { placement.dispose(); }
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

it('shows the looping gridplacer at once, lets its display load the art, and releases it on cancel and disposal', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const { placement, world } = setup();
  try {
    // begin declares the placer synchronously; nothing waits for its art.
    expect(placement.begin(() => kit())).toBeUndefined();
    const [outline] = world.scene.children;
    const instance = prefabInstance(outline)!;
    // gridplacer.lua: AddTag("CLASSIFIED"), AddTag("NOCLICK"), AddTag("placer").
    expect(instance.listTags()).toEqual(expect.arrayContaining(['CLASSIFIED', 'NOCLICK', 'placer']));
    await prefabDisplay(outline)!.artLoaded();
    expect(instance.sprite.loaded).toBe(true);
    expect(instance.sprite.currentAnimation).toBe('anim');
    placement.cancel();
    expect(instance.isRemoved).toBe(true);
    expect(world.scene.children).toEqual([]);
    placement.begin(() => kit());
    placement.dispose();
    expect(world.scene.children).toEqual([]);
    expect(() => placement.begin(() => kit())).toThrow('disposed');
  } finally { placement.dispose(); }
});

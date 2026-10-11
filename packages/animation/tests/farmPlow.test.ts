import { ItemEntity } from '@dontstarve-web/inventory';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FarmPlowPlacement, FARM_PLOW_DRILLING_DURATION } from '../../prefab/src/farm_plow';
import { TurfMap, WORLD_TILES } from '../../prefab/src/turfMap';
import { GroundItemAssets, createGroundItemSprite, GROUND_ITEM_DEFINITIONS } from '../../prefab/src/groundItems';
import type { WorldContext } from '../../prefab/src/worldContext';
import { PlaySound } from '../../prefab/src/sound';

const soundStops = vi.hoisted(() => [] as ReturnType<typeof vi.fn>[]);
vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => { const stop = vi.fn(); soundStops.push(stop); return { stop }; }) }));
beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); soundStops.length = 0; });

function setup() {
  const turf = new TurfMap(96);
  const world = { scene: new THREE.Scene(), player: new THREE.Group(), camera: new THREE.PerspectiveCamera(),
    ground: new THREE.Group(), renderer: { domElement: new EventTarget() },
    createCursorLabel: () => ({ show() {}, hide() {}, update() {} }) } as unknown as WorldContext;
  const returnItem = vi.fn(async () => {});
  const blockers: { position: THREE.Vector3; tags?: string[] }[] = [];
  const plow = new FarmPlowPlacement(world, turf, '/dst/data', returnItem, () => blockers, () => 0.5);
  const advance = async (seconds: number) => {
    for (let i = 0; i < Math.ceil(seconds / 0.1); i++) {
      plow.update(0.1, new THREE.Quaternion());
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  };
  return { turf, world, returnItem, blockers, plow, advance };
}

function item(remainingUses?: number) {
  return new ItemEntity({ itemId: 'farm_plow_item', count: 1, remainingUses });
}

it('loads original packed ground art and the actual inventory atlas', async () => {
  const assets = new GroundItemAssets('/dst/data/anim');
  try {
    const item = await createGroundItemSprite(assets, 'farm_plow_item');
    expect(GROUND_ITEM_DEFINITIONS.farm_plow_item).toMatchObject({
      atlas: 'images/inventoryimages2.xml', animation: 'idle_packed', bank: 'farm_plow', skinArchives: {},
    });
    expect(item.model.children[0].children).toHaveLength(1);
    expect((item.model.children[0].children[0] as THREE.Mesh).geometry.drawRange.count).toBeGreaterThan(0);
    item.dispose();
  } finally { assets.dispose(); }
});

it('snaps deployment, drills for 15 seconds, terraforms and returns a folded three-use item', async () => {
  const { plow, turf, returnItem, advance } = setup();
  try {
    const original = item();
    const use = vi.spyOn(original.components.finiteuses, 'use');
    expect(await plow.deploy(new THREE.Vector3(1, 0, 2), () => original)).toBe(true);
    expect(use).toHaveBeenCalledExactlyOnceWith(1);
    expect(original.isRemoved).toBe(true);
    const savedItem = original.snapshot();
    expect(plow.exportRecords()[0]).toMatchObject({ transform: { position: [6, 0, 6] },
      components: { farmPlow: { phase: 'drill_pre', remainingSeconds: FARM_PLOW_DRILLING_DURATION, deployItem: savedItem } } });
    expect(plow.canDeploy(new THREE.Vector3(4, 0, 4))).toBe(false);
    await advance(2);
    expect(plow.exportRecords()[0].components.farmPlow.phase).toBe('drill_loop');
    expect(turf.getTileAtWorld({ x: 6, z: 6 })).toBe(WORLD_TILES.DECIDUOUS);
    await advance(13);
    expect(returnItem).not.toHaveBeenCalled();
    await advance(5);
    expect(turf.getTileAtWorld({ x: 6, z: 6 })).toBe(WORLD_TILES.FARMING_SOIL);
    expect(plow.exportRecords()).toEqual([]);
    expect(returnItem).toHaveBeenCalledExactlyOnceWith(new THREE.Vector3(6, 0, 6), savedItem);
    expect(plow.exportDecorRecords().some(({ prefabId }) => prefabId === 'farm_soil_debris')).toBe(true);
    expect(plow.exportDecorRecords().some(({ prefabId }) => prefabId === 'farm_soil')).toBe(true);
    expect(plow.exportDecorRecords().every(({ record }) => record.components.farmSoil?.plowId === undefined)).toBe(true);
    expect(plow.canDeploy(new THREE.Vector3(6, 0, 6))).toBe(false);
    const loopCall = vi.mocked(PlaySound).mock.calls.findIndex(([event]) => event === 'farming/common/farm/plow/LP');
    expect(soundStops[loopCall]).toHaveBeenCalledOnce();
    turf.dig({ x: 6, z: 6 });
    expect(turf.getTileAtWorld({ x: 6, z: 6 })).toBe(WORLD_TILES.DECIDUOUS);
    expect(plow.exportDecorRecords().some(({ prefabId }) => prefabId === 'farm_soil')).toBe(false);
  } finally { plow.dispose(); }
});

it('does not return an exhausted item on its fourth use and one hammer hit recovers an active item', async () => {
  const { plow, turf, returnItem, advance } = setup();
  try {
    const lastUse = item(1);
    await plow.deploy(new THREE.Vector3(1, 0, 1), () => lastUse);
    expect(lastUse.isRemoved).toBe(true);
    expect(plow.exportRecords()[0].components.farmPlow.deployItem).toBeNull();
    await advance(20);
    expect(turf.getTileAtWorld({ x: 6, z: 6 })).toBe(WORLD_TILES.FARMING_SOIL);
    expect(returnItem).not.toHaveBeenCalled();
    const original = item(3);
    await plow.deploy(new THREE.Vector3(-13, 0, -1), () => original);
    await advance(3);
    const target = plow.hammerTargets[0];
    target.playHit(); target.playHit();
    expect(target.isValid()).toBe(false);
    await Promise.resolve();
    expect(plow.exportRecords()).toEqual([]);
    expect(returnItem).toHaveBeenCalledExactlyOnceWith(new THREE.Vector3(-18, 0, -6), original.snapshot());
    expect(turf.getTileAtWorld({ x: -18, z: -6 })).toBe(WORLD_TILES.DECIDUOUS);
    expect(plow.exportDecorRecords().every(({ record }) => record.components.farmSoil?.plowId !== target.id)).toBe(true);
  } finally { plow.dispose(); }
});

it('rejects hard terrain, blocking entities and failed/cancelled item transfers without spending an item', async () => {
  const { plow, turf, blockers } = setup();
  const point = new THREE.Vector3(1, 0, 1);
  const original = item();
  const take = vi.fn(() => original);
  try {
    turf.setOriginalTile(point, WORLD_TILES.WOODFLOOR);
    expect(await plow.deploy(point, take)).toBe(false);
    turf.setOriginalTile(point, WORLD_TILES.DECIDUOUS);
    blockers.push({ position: point });
    expect(await plow.deploy(point, take)).toBe(false);
    blockers[0].tags = ['FX'];
    expect(plow.canDeploy(point)).toBe(true);
    expect(take).not.toHaveBeenCalled();
    expect(await plow.deploy(point, () => undefined)).toBe(false);
    const request = plow.deploy(point, take);
    plow.cancel();
    expect(await request).toBe(false);
    expect(take).not.toHaveBeenCalled();
    expect(plow.exportRecords()).toEqual([]);
    expect(original.isRemoved).toBe(false);
    expect(original.components.finiteuses.remaining).toBeUndefined();
  } finally { plow.dispose(); }
});

it('restores drilling progress, attached soil and remaining item uses without restarting the timer', async () => {
  const { plow, returnItem, turf, advance } = setup();
  try {
    const deployItem = { entityId: 'saved_item', itemId: 'farm_plow_item', count: 1, remainingUses: 1 };
    await plow.spawn(new THREE.Vector3(6, 0, 6), { id: 'saved_plow',
      state: { phase: 'drill_loop', remainingSeconds: 2, deployItem } });
    const exported = plow.exportRecords();
    exported[0].components.farmPlow.deployItem!.remainingUses = 3;
    expect(plow.exportRecords()[0].components.farmPlow.deployItem).toEqual(deployItem);
    await plow.spawnDecor('farm_soil', new THREE.Vector3(3, 0, 3), { broken: false, plowId: 'saved_plow' }, undefined, 'saved_soil');
    expect(plow.exportRecords()[0].id).toBe('saved_plow');
    await advance(5);
    expect(turf.getTileAtWorld({ x: 6, z: 6 })).toBe(WORLD_TILES.FARMING_SOIL);
    expect(returnItem).toHaveBeenCalledExactlyOnceWith(new THREE.Vector3(6, 0, 6), deployItem);
    expect(plow.exportRecords()).toEqual([]);
  } finally { plow.dispose(); }
});

it('keeps the complete deployed snapshot saveable until asynchronous item restoration commits', async () => {
  const { plow, returnItem, advance } = setup();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  returnItem.mockReturnValueOnce(pending);
  try {
    const original = item(3);
    await plow.deploy(new THREE.Vector3(1, 0, 1), () => original);
    const target = plow.hammerTargets[0];
    target.playHit(); target.playHit();
    await advance(2);
    expect(returnItem).toHaveBeenCalledExactlyOnceWith(new THREE.Vector3(6, 0, 6), original.snapshot());
    expect(plow.exportRecords()[0].components.farmPlow).toEqual({
      phase: 'collapse', remainingSeconds: 0, deployItem: original.snapshot(),
    });
    release(); await Promise.resolve();
    expect(plow.exportRecords()).toEqual([]);
  } finally { release(); plow.dispose(); }
});

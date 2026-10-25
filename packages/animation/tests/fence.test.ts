import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FencePlacement, calcRotationEnum, fixUpFenceRotation, isNarrowRotation, placerRotation } from '../../prefab/src/fence';
import { FENCE_SKIN_ARCHIVES, fenceWorldSkin } from '../../prefab/src/fenceSkins';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from '../../prefab/src/groundItems';
import { createGroundItemVisual } from './groundItemVisual';
import type { WorldContext } from '../../prefab/src/worldContext';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import { createArchiveSprite } from '../src/archiveSprite';
import { FACING, facingFromRotation, selectsFacing } from '../src/facing';
import { createSignal } from '../../signals/src';
import { snapToWallSlotCenter } from '../../prefab/src/tile';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => {
    const file = String(url).split('dst/data/')[1];
    return new Response(await readFile(new URL(`../../../public/dst/data/${file}`, import.meta.url)));
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(consume: (id: string, skinId?: string) => boolean = () => true) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 12, 40); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const canvas = new EventTarget();
  const heading = createSignal(45);
  const dropLoot = vi.fn(), dropItem = vi.fn();
  const spawnItem = vi.fn((state: { itemId: string; count: number }) => ({ ...state }) as never);
  const world = { scene: new THREE.Scene(), camera, cameraFacing: createSignal(8), cameraHeading: heading, ground: new THREE.Group(),
    player: new THREE.Group(), physics: new CANNON.World(), renderer: { domElement: canvas },
    createCursorLabel: () => ({ show() {}, hide() {}, update() {} }), dropLoot, dropItem, spawnItem,
  } as unknown as WorldContext;
  const placement = new FencePlacement(world, consume as never);
  return { world, canvas, heading, placement, dropLoot, dropItem, spawnItem };
}

it('derives rotation parity, banks and eight-faced facings from fence.lua and the camera', () => {
  // CalcRotationEnum buckets floor(rot / 45); even enums are narrow (fence_thin), odd ones wide (fence).
  expect([0, 44, 45, 90, -45, 359].map(calcRotationEnum)).toEqual([0, 0, 1, 2, 7, 7]);
  expect([0, 90, 45, -45].map(isNarrowRotation)).toEqual([true, true, false, false]);
  expect(placerRotation(45)).toBe(-45);
  // Placing against the camera always faces it: rotation + heading = 0 is DOWN; the camera then orbits the fence.
  expect(facingFromRotation(placerRotation(45), 45)).toBe(FACING.DOWN);
  expect([90, 135, 180, 225, 270, 315].map(heading => facingFromRotation(placerRotation(45), heading)))
    .toEqual([FACING.DOWNLEFT, FACING.LEFT, FACING.UPLEFT, FACING.UP, FACING.UPRIGHT, FACING.RIGHT]);
  expect(facingFromRotation(0, 90)).toBe(FACING.LEFT);
  expect(facingFromRotation(0, 270)).toBe(FACING.RIGHT);
  expect(facingFromRotation(0, 180)).toBe(FACING.UP);
  // A clip that lists a facing and its left-hand mirror is flipped for the left-hand one.
  expect(selectsFacing(5, FACING.RIGHT)).toEqual({ matches: true, flipped: false });
  expect(selectsFacing(5, FACING.LEFT)).toEqual({ matches: true, flipped: true });
  expect(selectsFacing(8, FACING.DOWN)).toEqual({ matches: true, flipped: false });
  expect(selectsFacing(48, FACING.DOWN).matches).toBe(false);
  // Placing from behind a parallel fence flips 180; a perpendicular or wall neighbour does not.
  expect(fixUpFenceRotation(0, [{ isFence: true, rotation: 180 }])).toBe(180);
  expect(fixUpFenceRotation(0, [{ isFence: true, rotation: 0 }])).toBe(0);
  expect(fixUpFenceRotation(0, [{ isFence: true, rotation: 90 }])).toBe(0);
  expect(fixUpFenceRotation(0, [{ isFence: false, rotation: 180 }])).toBe(0);
  expect(fenceWorldSkin('fence_item', 'fence_ancient_item')).toBe('fence_ancient');
  expect(() => fenceWorldSkin('fence', 'fence_unknown')).toThrow('Unsupported');
});

it('selects the facing clip and mirrors left-hand views of the shared side art', async () => {
  const assets = new GroundItemAssets();
  try {
    const sprite = await createArchiveSprite(assets, { animationArchive: 'fence.zip', buildArchives: ['fence.zip'],
      bank: 'fence', animation: 'idle', loop: false });
    const visual = sprite.model.children[0], scale = visual.scale.x;
    sprite.setFacing(FACING.RIGHT); expect(visual.scale.x).toBe(scale);
    const side = visual.children.length;
    sprite.setFacing(FACING.LEFT); expect(visual.scale.x).toBe(-scale); expect(visual.children.length).toBe(side);
    sprite.setFacing(FACING.DOWN); expect(visual.scale.x).toBe(scale);
    sprite.dispose();
    const ghost = await createArchiveSprite(assets, { animationArchive: 'fence.zip', buildArchives: ['fence.zip'],
      bank: 'fence', animation: 'idle', loop: false }, { opacity: .65 });
    ghost.setOpacity(1);
    ghost.dispose();
    const shared = await createArchiveSprite(assets, { animationArchive: 'fence.zip', buildArchives: ['fence.zip'],
      bank: 'fence', animation: 'idle', loop: false });
    expect(() => shared.setOpacity(1)).toThrow('does not own');
    shared.dispose();
  } finally { assets.dispose(); }
});

it('previews against the camera, swaps banks as it rotates, places on click and keeps rotation and skin through save/load', async () => {
  const consume = vi.fn(() => true);
  const { world, canvas, heading, placement } = setup(consume);
  vi.spyOn(PointerRaycaster.prototype, 'isOverGround', 'get').mockReturnValue(true);
  vi.spyOn(PointerRaycaster.prototype, 'groundPoint').mockReturnValue(new THREE.Vector3(7.2, 0, -4.1));
  try {
    await placement.begin('fence_item', 'fence_rose_item');
    placement.update();
    const preview = world.scene.children[0] as THREE.Group;
    expect(preview.visible).toBe(true);
    const snapped = snapToWallSlotCenter(new THREE.Vector3(7.2, 0, -4.1));
    expect([preview.position.x, preview.position.z]).toEqual([snapped.x, snapped.z]);
    // fixedcameraoffset 0 - heading: -45 is an odd enum, so the wide bank; one camera step later it is narrow.
    expect(preview.userData.fenceRotation).toBe(-45); expect(isNarrowRotation(preview.userData.fenceRotation)).toBe(false);
    heading.set(90); await settle(); placement.update();
    expect(preview.userData.fenceRotation).toBe(-90); expect(isNarrowRotation(-90)).toBe(true);
    expect(placement.renderEntities).toHaveLength(1);
    // A preview is not an inst: it has no LIGHT/HAMMER target and no tags.
    expect(preview.userData.actionEntity).toBeUndefined();
    expect(placement.hammerTargets).toEqual([]);

    canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0 }));
    expect(consume).toHaveBeenCalledWith('fence_item', 'fence_rose_item');
    expect(placement.hammerTargets).toHaveLength(1);
    expect(world.physics!.bodies).toHaveLength(1);
    const [exported] = placement.exportRecords();
    expect(exported.prefabId).toBe('fence');
    expect(exported.record.components.fence).toEqual({ rot: calcRotationEnum(-90), skinId: 'fence_rose' });
    expect(preview.userData.actionEntity.hasTag('fence')).toBe(true);
    expect(preview.userData.actionEntity.hasTag('wall')).toBe(true);

    // Reload the saved record on a fresh placement.
    const restored = setup();
    const model = await restored.placement.spawnFromSave('fence', exported.record);
    expect(model.userData.fenceRotation).toBe(calcRotationEnum(-90) * 45);
    expect(restored.placement.exportRecords()[0].record.components).toEqual(exported.record.components);
    expect(restored.world.physics!.bodies).toHaveLength(1);
    restored.placement.dispose();
  } finally { placement.dispose(); }
}, 20000);

it('is hammered in three hits for a twig, can be reskinned, and burns into ash without being saved', async () => {
  const { world, placement, dropLoot, dropItem, spawnItem } = setup();
  try {
    const model = await placement.spawnFromSave('fence', { id: 'fence:1', transform: { position: [6, 0, 6], rotationY: 0 }, components: { fence: { rot: 2 } } });
    const reskin = placement.reskinTargets[0];
    expect(reskin.skins).toEqual(Object.keys(FENCE_SKIN_ARCHIVES));
    const prepared = await reskin.prepareNextSkin();
    expect(prepared.apply()).toBe(true);
    expect(placement.exportRecords()[0].record.components.fence).toEqual({ rot: 2, skinId: 'fence_ancient' });

    const fire = model.userData.actionEntity.components.burnable;
    fire.Ignite();
    expect(model.userData.instance?.persists).toBe(false);
    expect(placement.exportRecords()).toEqual([]);
    fire.Extinguish();
    expect(placement.exportRecords()).toHaveLength(1);
    fire.Ignite();
    fire.StopSmoldering();
    // DefaultBurntFn: ash at the fence, then Remove.
    const timer = fire.timer.peek();
    expect(timer.status).toBe('scheduled');
    placement.update(25);
    expect(spawnItem).toHaveBeenCalledWith({ itemId: 'ash', count: 1 });
    expect(dropItem).toHaveBeenCalled();
    expect(placement.hammerTargets).toEqual([]);
    expect(world.physics!.bodies).toHaveLength(0);

    await placement.spawn('fence');
    expect(placement.exportRecords().at(-1)!.record.id).toMatch(/^e_/);
    expect(placement.hammerTargets).toHaveLength(1);
    await placement.hammerTargets[0].entity.components.workable!.WorkedBy({}, 3);
    expect(placement.hammerTargets).toEqual([]);
    const second = await placement.spawnFromSave('fence', { id: 'fence:2', transform: { position: [9, 0, 6], rotationY: 0 }, components: {} });
    const target = placement.hammerTargets[0];
    for (let hit = 0; hit < 3; hit++) { expect(placement.hammerTargets).toHaveLength(1); target.playHit(); }
    expect(dropLoot).toHaveBeenCalledWith([{ itemId: 'twigs', count: 1 }], expect.any(THREE.Vector3));
    expect(placement.hammerTargets).toEqual([]);
    expect(second.parent).toBeNull();
    expect(world.physics!.bodies).toHaveLength(0);
  } finally { placement.dispose(); }
}, 20000);

it('draws the fence item and every item skin from the shared catalog, matching the world skins', async () => {
  const assets = new GroundItemAssets();
  try {
    const itemSkins = Object.keys(GROUND_ITEM_DEFINITIONS.fence_item.skinArchives);
    expect(itemSkins.map(skin => fenceWorldSkin('fence_item', skin))).toEqual(Object.keys(FENCE_SKIN_ARCHIVES));
    for (const skinId of [undefined, itemSkins[0], itemSkins.at(-1)]) (await createGroundItemVisual(assets, 'fence_item', skinId)).dispose();
  } finally { assets.dispose(); }
});

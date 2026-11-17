import { SpriteState, PrefabDisplayGroup, prefabDisplay } from '../../display/src';
import { PrefabEntityManager, PrefabInstance, prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { calcRotationEnum, fixUpFenceRotation, GetRotation, isNarrowRotation, placerRotation, type FenceInstance } from '../../prefab/src/fence';
import { findActionEntity } from '../../prefab/src/actionEntity';
import { FENCE_SKIN_ARCHIVES, fenceWorldSkin } from '../../prefab/src/fenceSkins';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from '../../prefab/src/groundItems';
import { createGroundItemVisual } from './groundItemVisual';
import type { WorldContext } from '../../prefab/src/worldContext';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import { createArchiveSprite } from '../src/archiveSprite';
import { FACING, facingFromRotation, selectsFacing } from '../src/facing';
import { createMemo, createSignal } from '../../signals/src';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { FireFxHost } from '../../prefab/src/treeFire';
import { snapToWallSlotCenter } from '../../prefab/src/tile';
import { reskinEntity, reskinTargetOf } from '../../prefab/src/reskin_tool';
import { PlaceableBuildingPlacement } from '../../../src/placeableBuilding';
import { executeDebugCommand } from '../../../src/debugCommands';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { bindTestWorld } from './worldContentFixture';
import { workTargets } from './workTargets';
import { testInventoryStore, testItem } from './testInventory';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function meshes(model: THREE.Object3D): THREE.Mesh[] {
  const result: THREE.Mesh[] = [];
  model.traverse(object => { if (object instanceof THREE.Mesh) result.push(object); });
  return result;
}

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => {
    const file = String(url).split('dst/data/')[1];
    return new Response(await readFile(new URL(`../../../public/dst/data/${file}`, import.meta.url)));
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** The scene's wiring: the build flow, the shared PrefabEntityManager and the registry that saves and c_spawns through them. */
function setup(consume: (id: string, skinId?: string) => boolean = () => true, playerPosition = new THREE.Vector3()) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 12, 40); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const canvas = new EventTarget(), awake = createSignal(true);
  const heading = createSignal(45), scheduler = new GameTimeScheduler(), fire = FireFxHost.create();
  const dropLoot = vi.fn(), dropItem = vi.fn(), addWall = vi.fn(), removeWall = vi.fn();
  const spawnItem = vi.fn((state: { itemId: string; count: number }) => testItem(state));
  const player = new THREE.Group(); player.position.copy(playerPosition);
  const world = { scene: new THREE.Scene(), camera, cameraFacing: createSignal(8), cameraHeading: heading, ground: new THREE.Group(),
    player, physics: new CANNON.World(), renderer: { domElement: canvas }, scheduler, fire,
    tickingarea: () => createMemo(() => awake.get()), pathfinder: { AddWall: addWall, RemoveWall: removeWall },
    createCursorLabel: () => ({ show() {}, hide() {}, update() {} }), dropLoot, dropItem, spawnItem,
  } as unknown as WorldContext;
  const displays = new PrefabDisplayGroup(world.scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim',
    { tickingarea: world.tickingarea, physics: world.physics, scheduler });
  const placement = new PlaceableBuildingPlacement(world, consume as never, undefined, prefabs);
  const registry = new EntityRegistry([], prefabs);
  registry.register(PREFAB_DEFINITIONS.buildings, {
    restore: (id, record) => placement.spawnFromSave(id, record), debugSpawn: id => placement.spawn(id),
    exportRecords: () => placement.exportRecords(), dispose: () => placement.dispose(),
  });
  const fences = () => [...prefabs.instances('fence')] as FenceInstance[];
  const update = (dt = 0) => { scheduler.advance(dt); displays.update(dt); placement.update(dt); };
  const dispose = () => { registry.dispose(); prefabs.dispose(); displays.dispose(); fire.dispose(); scheduler.dispose(); };
  return { world, canvas, heading, awake, scheduler, placement, prefabs, registry, fences, update, dispose,
    dropLoot, dropItem, spawnItem, addWall, removeWall };
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

const fenceRecord = (id: string, position: [number, number, number], fence?: { rot?: number; skinId?: string }) =>
  ({ id, transform: { position, rotationY: 0 }, components: fence ? { fence } : {} });
const records = (registry: EntityRegistry) => registry.exportRecords().fence ?? [];

it('previews against the camera, swaps banks as it rotates, places on click and keeps rotation and skin through save/load', async () => {
  const consume = vi.fn(() => true);
  const { world, canvas, heading, placement, fences, registry, update, dispose } = setup(consume);
  vi.spyOn(PointerRaycaster.prototype, 'isOverGround', 'get').mockReturnValue(true);
  vi.spyOn(PointerRaycaster.prototype, 'groundPoint').mockReturnValue(new THREE.Vector3(7.2, 0, -4.1));
  const restored = setup();
  try {
    await placement.begin('fence_item', 'fence_rose_item');
    update();
    const preview = world.scene.children.find(child => lookupPrefabInstance(child)?.prefab === 'fence_item_placer') as THREE.Group;
    const previewInstance = lookupPrefabInstance<PrefabInstance>(preview)!;
    // MakePlacer("fence_item_placer", ...): its own non-persisting entity, shown once the pointer is over the ground.
    expect(previewInstance.persists).toBe(false);
    for (const tag of ['CLASSIFIED', 'NOCLICK', 'placer']) expect(previewInstance.hasTag(tag)).toBe(true);
    expect(previewInstance.sprite.sprite.peek()).toMatchObject({ clip: { name: 'idle', loop: true }, lightOverride: 1, visible: true });
    const snapped = snapToWallSlotCenter(new THREE.Vector3(7.2, 0, -4.1));
    expect([preview.position.x, preview.position.z]).toEqual([snapped.x, snapped.z]);
    // fixedcameraoffset 0 - heading: -45 is an odd enum, so the wide bank; one camera step later it is narrow.
    expect(GetRotation(previewInstance)).toBe(-45); expect(isNarrowRotation(GetRotation(previewInstance))).toBe(false);
    expect(previewInstance.sprite.sprite.peek().source?.bank).toBe('fence');
    const sprite = previewInstance.sprite;
    heading.set(90); update();
    expect(GetRotation(previewInstance)).toBe(-90);
    expect(previewInstance.sprite).toBe(sprite);
    expect(sprite.sprite.peek().source?.bank).toBe('fence_thin');
    expect(previewInstance.skinId).toBe('fence_rose');
    // The placer has no LIGHT/HAMMER target and no fence tags.
    expect(findActionEntity(preview)).toBeUndefined();
    expect(previewInstance.hasTag('fence')).toBe(false);
    expect(workTargets('HAMMER')).toEqual([]);

    canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0 }));
    expect(consume).toHaveBeenCalledWith('fence_item', 'fence_rose_item');
    expect(workTargets('HAMMER')).toHaveLength(1);
    expect(world.physics!.bodies).toHaveLength(1);
    // ondeploywall spawns a new fence with the placer's rotation and the linked world skin; the placer is released.
    expect(previewInstance.status.peek()).toBe('removed');
    expect(preview.parent).toBeNull();
    const [built] = fences();
    expect([built.prefab, GetRotation(built), built.skinId]).toEqual(['fence', -90, 'fence_rose']);
    expect([built.position.x, built.position.z]).toEqual([snapped.x, snapped.z]);
    expect(built.sprite.sprite.peek().lightOverride).toBeUndefined();
    for (const tag of ['wall', 'fence', 'alignwall', 'rotatableobject']) expect(built.hasTag(tag)).toBe(true);
    const [exported] = records(registry);
    expect(exported.components).toEqual({ fence: { rot: calcRotationEnum(-90), skinId: 'fence_rose' } });

    // Reload the saved record into a fresh world.
    await restored.registry.restoreAll({ fence: [exported] });
    expect(GetRotation(restored.fences()[0])).toBe(calcRotationEnum(-90) * 45);
    expect(restored.fences()[0].skinId).toBe('fence_rose');
    expect(records(restored.registry)).toEqual([exported]);
    expect(restored.world.physics!.bodies).toHaveLength(1);
  } finally { dispose(); restored.dispose(); }
}, 20000);

it('is hammered in three hits for a twig, can be reskinned, and burns into ash without being saved', async () => {
  const { world, registry, fences, update, dispose, dropItem, spawnItem, addWall, removeWall } = setup();
  try {
    await registry.restoreAll({ fence: [fenceRecord('fence:1', [6, 0, 6], { rot: 2 })] });
    const [fence] = fences(), model = fence.transform.model;
    // DoTaskInTime(0, InitializePathFinding).
    expect(addWall).not.toHaveBeenCalled();
    update(0.01);
    expect(addWall).toHaveBeenCalledWith(expect.objectContaining({ x: 6, z: 6 }));
    const reskin = reskinTargetOf(lookupPrefabInstance(model))!;
    expect(reskin.sprite.skinNames).toEqual(Object.keys(FENCE_SKIN_ARCHIVES));
    expect(reskinEntity(reskin)).toBe(true);
    expect(records(registry)[0].components.fence).toEqual({ rot: 2, skinId: 'fence_ancient' });

    const fire = fence.components.burnable!;
    fire.Ignite();
    expect(fence.persists).toBe(false);
    expect(records(registry)).toEqual([]);
    fire.Extinguish();
    expect(records(registry)).toHaveLength(1);
    fire.Ignite();
    fire.StopSmoldering();
    // DefaultBurntFn: ash at the fence, then Remove.
    update(25);
    expect(spawnItem).toHaveBeenCalledWith({ itemId: 'ash', count: 1 });
    expect(dropItem).toHaveBeenCalled();
    expect(fence.isRemoved).toBe(true);
    expect(removeWall).toHaveBeenCalled();
    expect(workTargets('HAMMER')).toEqual([]);
    expect(world.physics!.bodies).toHaveLength(0);

    await registry.restoreAll({ fence: [fenceRecord('fence:2', [9, 0, 6])] });
    const [second] = fences();
    const target = workTargets('HAMMER')[0];
    await target.display!.artLoaded();
    const attacker = new PrefabInstance('wilson', new SpriteState({ name: 'idle', held: true }));
    const worked = vi.fn(); second.ListenForEvent('worked', worked);
    const working = vi.fn(); attacker.ListenForEvent('working', working);
    second.components.combat.GetAttacked(attacker, 1);
    expect(worked).toHaveBeenCalledWith(second, { worker: attacker, workleft: 2 });
    expect(working).toHaveBeenCalledWith(attacker, { target: second });
    expect(second.sprite.sprite.peek().clip).toMatchObject({ name: 'hit', loop: false });
    expect(second.sprite.sprite.peek().queue).toEqual([{ name: 'idle', loop: false }]);
    for (let hit = 0; hit < 2; hit++) { expect(workTargets('HAMMER')).toHaveLength(1); target.work(); }
    attacker.remove();
    expect(spawnItem).toHaveBeenCalledWith({ itemId: 'twigs', count: 1 });
    expect(dropItem).toHaveBeenCalledWith(expect.objectContaining({ prefab: 'twigs' }), expect.any(THREE.Vector3));
    expect(second.isRemoved).toBe(true);
    expect(world.physics!.bodies).toHaveLength(0);
  } finally { dispose(); }
}, 20000);

it('settles a fence hit on sleep, reskins dormant art, restores mirroring, and completes burning while dormant', async () => {
  const { world, awake, heading, registry, fences, update, dispose } = setup();
  const content = bindTestWorld(new GameTimeScheduler());
  content.camerarotation.set(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4));
  const restored = setup();
  try {
    await registry.restoreAll({ fence: [fenceRecord('fence', [3, 0, 6])] });
    const [instance] = fences(), model = instance.transform.model;
    await vi.waitFor(() => expect(instance.sprite.loaded).toBe(true));
    const entity = findActionEntity(model)!;
    const resident = instance.sprite;
    workTargets('HAMMER')[0].work();
    awake.set(false); await settle();
    expect(meshes(model)).toHaveLength(0);
    expect(entity.components.workable!.GetWorkLeft()).toBe(2);
    heading.set(90);
    content.camerarotation.set(new THREE.Quaternion());
    expect(reskinEntity(reskinTargetOf(lookupPrefabInstance(model))!)).toBe(true);
    const [saved] = records(registry);
    awake.set(true); await settle(); await settle();
    expect(lookupPrefabInstance(model)).toBe(instance);
    expect(findActionEntity(model)).toBe(entity);
    expect(records(registry)).toEqual([saved]);
    expect(instance.sprite).toBe(resident);
    expect(resident.currentAnimation).toBe('idle');
    await vi.waitFor(() => expect(meshes(model).length).toBeGreaterThan(0));
    expect(meshes(model)[0].parent!.scale.x).toBeLessThan(0);
    await restored.registry.restoreAll({ fence: [saved] });
    expect(records(restored.registry)).toEqual([saved]);
    entity.components.burnable!.Ignite();
    awake.set(false); await settle();
    update(25);
    expect(world.spawnItem).toHaveBeenCalledWith({ itemId: 'ash', count: 1 });
    expect(records(registry)).toEqual([]);
    expect(world.physics!.bodies).toHaveLength(0);
    awake.set(true); await settle();
    expect(model.parent).toBeNull();
    expect(instance.isRemoved).toBe(true);
  } finally { dispose(); restored.dispose(); content.unbind(); }
}, 20000);

it('draws narrow, wide and skinned fences in the shared batches, and keeps a fence there when SetOrientation swaps its bank', async () => {
  const { registry, prefabs, dispose } = setup();
  try {
    await registry.restoreAll({ fence: [fenceRecord('narrow', [3, 0, 3]), fenceRecord('wide', [6, 0, 3], { rot: 1 }),
      fenceRecord('skinned', [9, 0, 3], { rot: 1, skinId: 'fence_rose' })] });
    const fence = (id: string) => prefabs.get(id) as FenceInstance;
    // An instanced sprite hides its own meshes; the shared batch draws it.
    const ownShown = (inst: FenceInstance) => meshes(inst.transform.model).filter(mesh => mesh.visible).length;
    for (const id of ['narrow', 'wide', 'skinned']) await prefabDisplay(fence(id).transform.model)!.artLoaded();
    expect(fence('narrow').sprite.sprite.peek().source).toMatchObject({ bank: 'fence_thin', buildArchive: 'fence.zip' });
    expect(fence('wide').sprite.sprite.peek().source).toMatchObject({ bank: 'fence', buildArchive: 'fence.zip' });
    expect(['narrow', 'wide', 'skinned'].map(id => ownShown(fence(id)))).toEqual([0, 0, 0]);
    // fence.lua SetOrientation on a drawn fence: the archive sprite takes the other bank and stays batched.
    const wide = fence('wide');
    wide.SetOrientation(wide, 0);
    await prefabDisplay(wide.transform.model)!.artLoaded(); await settle();
    expect(wide.sprite.sprite.peek().source).toMatchObject({ bank: 'fence_thin' });
    expect(wide.sprite.currentAnimation).toBe('idle');
    expect(ownShown(wide)).toBe(0);
  } finally { dispose(); }
});

it('c_spawn places a fence at the wall slot ahead of the player, and c_save reloads it', async () => {
  const first = setup(undefined, new THREE.Vector3(3, 0, -6)), second = setup(), inventory = testInventoryStore([], SAVE_CATALOG.items);
  try {
    const spawned = await executeDebugCommand('c_spawn("fence")', inventory, prefab => first.registry.spawn(prefab));
    expect(spawned).toMatchObject({ ok: true });
    const [fence] = first.fences();
    const { x, z } = snapToWallSlotCenter(fence.position);
    expect([fence.position.x, fence.position.z]).toEqual([x, z]);
    expect(GetRotation(fence)).toBe(0);
    const template = deserializeSave(await readFile(new URL('../../../public/saves/initial-world.json', import.meta.url), 'utf8'), SAVE_CATALOG);
    let json = '';
    expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
      json = serializeSave(template, { entities: { ...template.world.entities, ...first.registry.exportRecords() },
        inventory: inventory.exportState(), playerTransform: { position: [3, 0, -6], rotationY: 0 }, elapsedSeconds: 0 }, SAVE_CATALOG);
    })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG).world.entities.fence!;
    expect(saved).toEqual([{ id: String(fence.entityId), transform: { position: [x, 0, z], rotationY: 0 }, components: { fence: {} } }]);
    await second.registry.restoreAll({ fence: saved });
    expect(records(second.registry)).toEqual(saved);
    expect(second.prefabs.get(saved[0].id)!.hasTag('fence')).toBe(true);
  } finally { first.dispose(); second.dispose(); inventory.dispose(); }
}, 20000);

it('draws the fence item and every item skin from the shared catalog, matching the world skins', async () => {
  const assets = new GroundItemAssets();
  try {
    const itemSkins = Object.keys(GROUND_ITEM_DEFINITIONS.fence_item.skinArchives);
    expect(itemSkins.map(skin => fenceWorldSkin('fence_item', skin))).toEqual(Object.keys(FENCE_SKIN_ARCHIVES));
    for (const skinId of [undefined, itemSkins[0], itemSkins.at(-1)]) (await createGroundItemVisual('fence_item', skinId)).dispose();
  } finally { assets.dispose(); }
});

import { fixedCamera } from '../../prefab/src/followcamera';
import { withEntity } from './entityFixture';
import { testLocomotor } from './testLocomotor';
import { playerDoer } from './playerDoer';
import { prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import { actionTool } from './actionFixtures';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InstancedArchiveSprites, type InstancedSprite } from '../src/instancedArchiveSprites';
import { PrefabDisplayGroup, prefabDisplay, SpriteResources, SpriteState } from '../../display/src';
import { ResidentSprite } from '../src/residentSprite';
import { BuildingPlacer } from '../../prefab/src/buildingPlacer';
import { buildingPlacer } from '../../prefab/src/building';
import { PrefabEntityManager, PrefabInstance } from '../../prefab/src/prefabInstance';
import { wallPrefabs } from '../../prefab/src/walls';
import { snapToWallSlotCenter } from '../../prefab/src/tile';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import type { WorldContext } from '../../prefab/src/worldContext';
import { displayLightOverride } from '../../display/src/displaySprites';
import { InventorySlot, inventorySlotAddress } from '../../inventory/src';
import { EventEmitter, createEquipmentExistenceState, createSignal } from '../../signals/src';
import type { PlayerActionEvents } from '../../stategraphs/src/actionEvents';
import { PlayerController } from '../../stategraphs/src/playercontroller';
import { registerActionEntity, disposeActionEntity, findActionEntity } from '../../prefab/src/actionEntity';
import { GroundItemAssets } from '../../prefab/src/groundItems';
import { bindTestWorld } from './worldContentFixture';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { bufferingStategraph } from './bufferingStategraph';
import { slotWith, testInventoryStore } from './testInventory';

/** Fetches of the mirrored assets wait for this, when a test holds them back. */
let fetchGate: Promise<void> | undefined;
/** The shared-batch instances retained so far, in order, and those released since. */
const retained: InstancedSprite[] = [];
const released = new Set<InstancedSprite>();
/** Those not released yet, drawn in `scene`: a test's own entities, whatever art an earlier test's entities finish loading. */
const live = (scene: THREE.Scene) => retained.filter(instance => {
  if (released.has(instance)) { return false; }
  let node: THREE.Object3D | null = (instance as unknown as { model: THREE.Object3D }).model;
  while (node && node !== scene) { node = node.parent; }
  return node === scene;
});

beforeEach(() => {
  fetchGate = undefined; retained.length = 0; released.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    await fetchGate;
    const relative = url.slice(url.indexOf('/dst/data/') + '/dst/data/'.length);
    try { return new Response(await readFile(new URL(`../../../public/dst/data/${relative}`, import.meta.url))); }
    catch { return new Response(null, { status: 404 }); }
  }));
  const retain = InstancedArchiveSprites.prototype.retain;
  vi.spyOn(InstancedArchiveSprites.prototype, 'retain').mockImplementation(function (this: InstancedArchiveSprites, ...args) {
    const instance = retain.apply(this, args), dispose = instance.dispose;
    instance.dispose = () => { released.add(instance); dispose(); };
    retained.push(instance);
    return instance;
  });
  vi.spyOn(GroundItemAssets.prototype, 'loadAnimation').mockResolvedValue({} as never);
  vi.spyOn(GroundItemAssets.prototype, 'loadBuild').mockResolvedValue({} as never);
  vi.stubGlobal('window', new EventTarget());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

/** A building's build flow as the application wires it: its placer, and the shared manager that spawns what it builds. */
function buildingFlow(world: WorldContext, consume: () => boolean, onbuilt: () => void) {
  // The placer and the building it spawns draw treasure_chest's shared archive in the batches.
  const declaration = { archive: 'treasure_chest.zip', name: 'Building', buildLabel: 'building', idleAnimation: 'closed',
    skinArchives: { treasurechest_cake: 'dynamic/treasurechest_cake.zip' } };
  const displays = new PrefabDisplayGroup(world.scene), sprites = new SpriteResources();
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, undefined, {}, { building: {
    fn: () => {
      const inst = new PrefabInstance('building', new SpriteState({ name: 'closed', billboard: true }));
      inst.ListenForEvent('onbuilt', onbuilt);
      return inst;
    },
    assets: { animationArchive: declaration.archive, buildArchives: [declaration.archive], bank: 'chest' },
    assetOptions: { instancedAnimations: 'all' }, skins: declaration.skinArchives, alignBottom: true,
  } });
  const placer = new BuildingPlacer<'building'>(world, () => buildingPlacer(declaration, 'chest'), consume,
    (buildId, position, skinId) => { prefabs.spawn(buildId, position, undefined, skinId).PushEvent('onbuilt', undefined); });
  let disposed = false;
  return {
    begin: (buildId: 'building', skinId?: string) => placer.begin(buildId, skinId),
    spawn: (buildId: 'building') => { prefabs.spawn(buildId, placer.groundInFrontOfPlayer()); },
    exportRecords: () => prefabs.exportRecords(),
    get renderEntities() { return [...displays.renderEntities, ...placer.renderEntities]; },
    dispose() {
      if (disposed) { return; }
      disposed = true;
      placer.dispose(); prefabs.dispose(); displays.dispose(); sprites.dispose();
    },
  };
}

/** A wall item's build flow as the application wires it: the wall placer, and the shared manager that ondeploywall spawns on. */
function wallFlow(world: WorldContext, consume: () => boolean) {
  const scheduler = new GameTimeScheduler(), displays = new PrefabDisplayGroup(world.scene);
  const walls = wallPrefabs({ ...world, scheduler });
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, undefined, { scheduler }, walls.prefabs);
  const snap = (point: THREE.Vector3) => { const { x, z } = snapToWallSlotCenter(point); return new THREE.Vector3(x, point.y, z); };
  const placer = new BuildingPlacer<'wall_stone_item'>(world, buildId => walls.placer(buildId, snap), consume,
    (buildId, position, skinId) => { walls.ondeploywall(prefabs, buildId, position, skinId); });
  let disposed = false;
  return {
    begin: (_buildId: 'building', skinId?: string) => placer.begin('wall_stone_item', skinId),
    spawn: (_buildId: 'building') => { prefabs.spawn('wall_stone', snap(placer.groundInFrontOfPlayer())); },
    exportRecords: () => prefabs.exportRecords(),
    get renderEntities() { return [...displays.renderEntities, ...placer.renderEntities]; },
    dispose() {
      if (disposed) { return; }
      disposed = true;
      placer.dispose(); prefabs.dispose(); displays.dispose(); scheduler.dispose();
    },
  };
}

function setup(kind: 'animated' | 'wall') {
  const cursor = { hidden: true };
  const canvas = new EventTarget();
  const cameraFacing = createSignal(8);
  const world = {
    actionEvents: new EventEmitter<PlayerActionEvents>(),
    scene: new THREE.Scene(), player: new THREE.Object3D(), ground: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(), cameraFacing, cameraHeading: createSignal(45), TheCamera: fixedCamera(45), renderer: { domElement: canvas },
    createCursorLabel: () => ({
      show: () => { cursor.hidden = false; },
      hide: () => { cursor.hidden = true; },
      update: () => {},
    }),
  } as unknown as WorldContext;
  vi.spyOn(PointerRaycaster.prototype, 'trackPointer').mockImplementation(() => {});
  vi.spyOn(PointerRaycaster.prototype, 'groundPoint').mockReturnValue(new THREE.Vector3(3, 0, 4));
  vi.spyOn(PointerRaycaster.prototype, 'isOverGround', 'get').mockReturnValue(true);
  const store = testInventoryStore([
    { address: inventorySlotAddress(0), slot: slotWith(new InventorySlot(), { itemId: 'log', count: 2 }) },
  ], {
    log: { name: 'log', maxStack: 20, icon: 'log.tex' },
    building: { name: 'building', maxStack: 40, icon: 'building.tex' },
  });
  const recipe = {
    recipeId: 'building', productId: 'building', productCount: 1,
    ingredients: { log: 2 }, buffered: kind === 'animated',
  };
  expect(store.craft(recipe, kind === 'animated' ? 'treasurechest_cake' : undefined)).toBe(true);
  const consume = vi.fn(() => store.takeBuffered('building') || store.takeItem('building'));
  const onbuilt = vi.fn();
  const placement = kind === 'animated' ? buildingFlow(world, consume, onbuilt) : wallFlow(world, consume);
  const begin = () => placement.begin('building', store.bufferedSkin('building'));
  const click = (button: number) => canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button }));
  return { world, cameraFacing, cursor, store, recipe, consume, onbuilt, placement, begin, click };
}

it('an accepted action cancels a paid preview through events and skips its own cancellation', async () => {
  const { world, store, placement, begin, consume, cursor } = setup('animated');
  await placement.spawn('building');
  const existing = world.scene.children[0];
  await begin();
  const paidState = store.exportState();
  const preview = world.scene.children[1];
  await vi.waitFor(() => expect(lookupPrefabInstance(preview)!.sprite.loaded).toBe(true));
  // The building and the placer are each drawn by their resources' shared batches.
  expect(live(world.scene)).toHaveLength(2);
  const released = vi.spyOn(live(world.scene)[1], 'dispose');
  const equipped = createEquipmentExistenceState('HANDS');
  const tool = actionTool('reskin_tool');
  const model = withEntity(new THREE.Group(), 'icebox'); world.scene.add(model);
  model.position.set(400, 0, 0); // out of the player's reach, so the walk never arrives
  const target = registerActionEntity(lookupPrefabInstance(model)!);
  const animation = bufferingStategraph();
  // The player walks towards the target with its own locomotor; it never arrives, so the cast is never buffered.
  const controller = new PlayerController(world, animation.graph,
    testLocomotor(world.player).locomotor, equipped, playerDoer(withEntity(world.player, 'wilson')));
  const cast = () => controller.DoAction(controller.createAction({ action: 'CASTSPELL', target, invobject: tool.entity })!);
  const cancel = vi.spyOn(controller, 'cancel');
  try {
    // Without the tool in hand the action is invalid: nothing begins.
    expect(cast()).toBe(false);
    expect(world.scene.children).toEqual([existing, preview, model]);
    expect(cancel).not.toHaveBeenCalled();
    world.actionEvents!.emit('action:interrupt', { reason: 'slot-select' });
    expect(world.scene.children).toEqual([existing, preview, model]);
    expect(store.exportState()).toEqual(paidState);
    cancel.mockClear();
    equipped.set(tool);
    expect(cast()).toBe(true);
    expect(cancel).toHaveBeenCalledOnce(); // The owner resets itself once; its event skips itself.
    expect(world.scene.children).toEqual([existing, model]);
    expect(released).toHaveBeenCalledOnce();
    expect(cursor.hidden).toBe(true);
    expect(store.exportState()).toEqual(paidState);
    expect(consume).not.toHaveBeenCalled();
    world.actionEvents!.emit('action:interrupt', { reason: 'drop' });
    expect(controller.bufferedAction).toBeDefined();
    world.actionEvents!.emit('action:interrupt', { reason: 'slot-select' });
    expect(controller.bufferedAction).toBeUndefined();
    expect(animation.sg.pushBufferedAction).not.toHaveBeenCalled();
    controller.dispose();
    cancel.mockClear();
    world.actionEvents!.emit('action:interrupt', { reason: 'emote' });
    expect(cancel).not.toHaveBeenCalled();
    expect(store.exportState()).toEqual(paidState);
  } finally { controller.dispose(); disposeActionEntity(findActionEntity(model)); placement.dispose(); store.dispose(); }
});

it.each(['animated', 'wall'] as const)('%s right-click removes only the preview and lets the paid build resume', async (kind) => {
  const { world, cursor, store, recipe, consume, onbuilt, placement, begin, click } = setup(kind);
  await placement.spawn('building');
  const existing = world.scene.children[0];
  await begin();
  const preview = world.scene.children[1];
  expect(displayLightOverride(preview)).toBe(1);
  expect(placement.renderEntities.map(({ object }) => object)).toContain(preview);
  const paidState = store.exportState();
  expect(cursor.hidden).toBe(false);

  click(2);
  expect(preview.parent).toBeNull();
  expect(world.scene.children).toEqual([existing]);
  expect(cursor.hidden).toBe(true);
  expect(store.exportState()).toEqual(paidState);
  expect(consume).not.toHaveBeenCalled();
  expect(onbuilt).not.toHaveBeenCalled();
  click(0);
  expect(consume).not.toHaveBeenCalled();
  expect(placement.exportRecords()).toHaveLength(1);

  if (kind === 'animated') {
    expect(store.craft(recipe)).toBe(false);
    expect(store.bufferedSkin('building')).toBe('treasurechest_cake');
  }
  await begin();
  expect(store.exportState()).toEqual(paidState);
  if (kind === 'animated') { expect(lookupPrefabInstance(world.scene.children[1])?.skinId).toBe('treasurechest_cake'); }
  click(0);
  expect(consume).toHaveBeenCalledTimes(1);
  expect(displayLightOverride(world.scene.children[1])).toBe(0);
  expect(store.isBuffered('building')).toBe(false);
  expect(store.count('building')).toBe(0);
  expect(store.count('log')).toBe(0);
  expect(placement.exportRecords()).toHaveLength(2);
  expect(onbuilt).toHaveBeenCalledTimes(kind === 'animated' ? 1 : 0);
});

it.each(['animated', 'wall'] as const)('%s does not resurrect a preview cancelled while assets load', async (kind) => {
  const { world, cursor, store, consume, placement, begin, click } = setup(kind);
  let release!: () => void;
  fetchGate = new Promise(done => { release = done; });
  const pending = begin();
  await new Promise(resolve => setTimeout(resolve, 0));
  const paidState = store.exportState();
  click(2);
  expect(cursor.hidden).toBe(true);
  expect(store.exportState()).toEqual(paidState);

  await begin();
  const resumed = world.scene.children[0];
  release();
  await pending;
  // Whatever the cancelled placer's load built is released: only the resumed placer stays in the batches.
  await vi.waitFor(() => expect(lookupPrefabInstance(resumed)!.sprite.loaded).toBe(true));
  expect(live(world.scene)).toHaveLength(1);
  expect(world.scene.children).toEqual([resumed]);
  expect(cursor.hidden).toBe(false);
  expect(consume).not.toHaveBeenCalled();
  click(0);
  expect(consume).toHaveBeenCalledTimes(1);
  expect(placement.exportRecords()).toHaveLength(1);
});

it.each(['animated', 'wall'] as const)('%s disposal removes placed sprites, previews and pointer listeners once', async (kind) => {
  const { placement, begin, world, click, consume } = setup(kind);
  const removeListener = vi.spyOn(world.renderer.domElement, 'removeEventListener');
  const pointerDispose = vi.spyOn(PointerRaycaster.prototype, 'dispose');
  await placement.spawn('building');
  await begin();
  await vi.waitFor(() => {
    for (const model of world.scene.children) { expect(lookupPrefabInstance(model)!.sprite.loaded).toBe(true); }
  });
  // The building or wall and its placer each release their instance in the shared batches.
  const resources = live(world.scene).map(instance => vi.spyOn(instance, 'dispose'));
  expect(resources).toHaveLength(2);
  placement.dispose(); placement.dispose();
  expect(world.scene.children).toEqual([]);
  expect(placement.exportRecords()).toEqual([]);
  expect(placement.renderEntities).toEqual([]);
  expect(pointerDispose).toHaveBeenCalledOnce();
  expect(removeListener).toHaveBeenCalledOnce();
  resources.forEach((resource) => expect(resource).toHaveBeenCalledOnce());
  click(0);
  expect(consume).not.toHaveBeenCalled();
  // A disposed build flow refuses a new placer.
  await expect(async () => begin()).rejects.toThrow('disposed');
});

it('turns a wall placer to the camera\'s facing only when the shared camera orientation changes', async () => {
  const { begin, placement, world } = setup('wall');
  const setFacing = vi.spyOn(ResidentSprite.prototype, 'setFacing');
  const scheduler = new GameTimeScheduler(), content = bindTestWorld(scheduler);
  const rotation = (heading: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (90 - heading) * Math.PI / 180);
  content.camerarotation.set(rotation(0));
  await begin();
  const preview = world.scene.children[0];
  await vi.waitFor(() => expect(lookupPrefabInstance(preview)!.sprite.loaded).toBe(true));
  // The wall_segment image of the frame drawn: the bank's facing=15 clip shows the front, facing=240 the oblique side.
  const segment = () => prefabDisplay(preview)!.resolveFrame().map(({ image }) => image.index);
  expect(setFacing.mock.lastCall?.[0]).toBe(8); expect(segment()).toEqual([14]);
  const calls = setFacing.mock.calls.length;
  content.camerarotation.set(rotation(45)); await new Promise(resolve => setTimeout(resolve, 0));
  expect(setFacing.mock.lastCall?.[0]).toBe(128); expect(segment()).toEqual([4]);
  const camera = rotation(180);
  content.camerarotation.set(camera); await new Promise(resolve => setTimeout(resolve, 0));
  expect(setFacing.mock.lastCall?.[0]).toBe(2); expect(segment()).toEqual([14]);
  const changed = setFacing.mock.calls.length;
  content.camerarotation.set(camera); await new Promise(resolve => setTimeout(resolve, 0));
  expect(setFacing.mock.calls.length).toBe(changed); expect(changed).toBe(calls + 2);
  placement.dispose();
  content.unbind(); scheduler.dispose();
});

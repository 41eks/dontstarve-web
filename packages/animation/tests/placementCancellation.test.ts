import { prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import { actionTool, reskinEntityFields } from './actionFixtures';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createAnimatedSpriteSource } from '../src/sprite';
import { createStaticSpriteFactory } from '../src/wallSprite';
import { AnimatedBuildingPlacement } from '../../prefab/src/animatedBuildingPlacement';
import { WallPlacement } from '../../prefab/src/wallPlacement';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import type { WorldContext } from '../../prefab/src/worldContext';
import { displayLightOverride } from '../../display/src/displaySprites';
import { InventorySlot, InventoryStore, inventorySlotAddress } from '../../inventory/src';
import { EventEmitter, createEquipmentExistenceState, createSignal } from '../../signals/src';
import type { PlayerActionEvents } from '../../stategraphs/src/actionEvents';
import { ReskinActionController, type ReskinTarget } from '../../stategraphs/src/reskin_tool';
import type { ActionAnimationController } from '../../stategraphs/src/actionContext';
import { GroundItemAssets } from '../../prefab/src/groundItems';
import { bindTestWorld } from './worldContentFixture';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { SpriteState } from '@dontstarve-web/display';

vi.mock('../src/sprite', async importOriginal => ({ ...await importOriginal<typeof import('../src/sprite')>(), createAnimatedSpriteSource: vi.fn() }));
vi.mock('../src/wallSprite', () => ({ createStaticSpriteFactory: vi.fn() }));

function model() {
  const result = new THREE.Group();
  result.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
  result.userData.animationController = {
    update: vi.fn(), start: vi.fn(), showImage: vi.fn(), setFacing: vi.fn(), setPose: vi.fn(), setColour: vi.fn(), setOpacity: vi.fn(),
    playOnce: vi.fn((_name: string, complete: () => void) => complete()),
  };
  return result;
}

beforeEach(() => {
  vi.spyOn(GroundItemAssets.prototype, 'loadAnimation').mockResolvedValue({} as never);
  vi.spyOn(GroundItemAssets.prototype, 'loadBuild').mockResolvedValue({} as never);
  vi.mocked(createAnimatedSpriteSource).mockImplementation(async () => ({
    create: () => model(),
    disposeSprite: (sprite: THREE.Group) => {
      sprite.removeFromParent();
      sprite.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    },
    dispose: vi.fn(),
  }));
  vi.mocked(createStaticSpriteFactory).mockImplementation(async () => ({
    create: vi.fn(() => model()),
    disposeSprite: sprite => { sprite.removeFromParent(); sprite.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); }); },
    dispose: vi.fn(),
  }));
  vi.stubGlobal('window', new EventTarget());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

function setup(kind: 'animated' | 'wall') {
  const cursor = { hidden: true };
  const canvas = new EventTarget();
  const cameraFacing = createSignal(8);
  const world = {
    actionEvents: new EventEmitter<PlayerActionEvents>(),
    scene: new THREE.Scene(), player: new THREE.Object3D(), ground: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(), cameraFacing, cameraHeading: createSignal(45), renderer: { domElement: canvas },
    createCursorLabel: () => ({
      show: () => { cursor.hidden = false; },
      hide: () => { cursor.hidden = true; },
      update: () => {},
    }),
  } as unknown as WorldContext;
  vi.spyOn(PointerRaycaster.prototype, 'trackPointer').mockImplementation(() => {});
  vi.spyOn(PointerRaycaster.prototype, 'groundPoint').mockReturnValue(new THREE.Vector3(3, 0, 4));
  vi.spyOn(PointerRaycaster.prototype, 'isOverGround', 'get').mockReturnValue(true);
  const store = new InventoryStore([
    { address: inventorySlotAddress(0), slot: new InventorySlot({ itemId: 'log', count: 2 }) },
  ], {
    log: { name: 'log', maxStack: 20, icon: 'log.tex' },
    building: { name: 'building', maxStack: 40, icon: 'building.tex' },
  });
  const recipe = {
    recipeId: 'building', productId: 'building', productCount: 1,
    ingredients: { log: 2 }, buffered: kind === 'animated',
  };
  expect(store.craft(recipe, kind === 'animated' ? 'selected_skin' : undefined)).toBe(true);
  const consume = vi.fn(() => store.takeBuffered('building') || store.takeItem('building'));
  const onbuilt = vi.fn(({ onComplete }: { onComplete: () => void }) => onComplete());
  const placement = kind === 'animated'
    ? new AnimatedBuildingPlacement(world, {
      building: {
        archive: 'building.zip', name: 'Building', buildLabel: 'building',
        scale: 1, skinArchives: { selected_skin: 'dynamic/selected_skin.zip' }, onbuilt,
      },
    }, consume)
    : new WallPlacement(world, {
      building: { archive: 'wall.zip', name: 'Wall', buildLabel: 'wall', scale: 1, frontImageIndex: 14, sideImageIndex: 4 },
    }, consume);
  const begin = () => placement.begin('building', store.bufferedSkin('building'));
  const click = (button: number) => canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button }));
  const load = kind === 'animated' ? vi.mocked(createAnimatedSpriteSource) : vi.mocked(createStaticSpriteFactory);
  return { world, cameraFacing, cursor, store, recipe, consume, onbuilt, placement, begin, click, load };
}

it('an accepted action cancels a paid preview through events, skips its own cancellation and invalidates late loading', async () => {
  const { world, store, placement, begin, consume, cursor } = setup('animated');
  await placement.spawn('building');
  const existing = world.scene.children[0];
  await begin();
  const paidState = store.exportState();
  const preview = world.scene.children[1];
  await vi.waitFor(() => expect(lookupPrefabInstance(preview)!.sprite.loaded).toBe(true));
  const geometry = vi.spyOn((preview.children[0].children[0] as THREE.Mesh).geometry, 'dispose');
  const equipped = createEquipmentExistenceState('HANDS');
  equipped.set(actionTool('reskin_tool'));
  let valid = false, release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const sprite = new SpriteState({ name: '' }), model = new THREE.Group();
  const target: ReskinTarget = { ...reskinEntityFields, id: 'target', prefabId: 'icebox', model, sprite,
    get skinId() { return sprite.skinId.peek(); }, position: new THREE.Vector3(1, 0, 0), isValid: () => valid,
    display: { model, preloadSkin: async () => { await ready; } } as never };
  const animation = { isReskinning: false, cancelEmote: vi.fn(), cancelReskin: vi.fn(), playReskin: vi.fn() };
  const controller = new ReskinActionController(world, animation as unknown as ActionAnimationController,
    { stop: vi.fn(), goToPoint: () => true, destination: undefined }, equipped,
    { prepare: () => ({ play: vi.fn(), dispose: vi.fn() }) });
  const cancel = vi.spyOn(controller, 'cancel');
  try {
    expect(await controller.request(target)).toBe(false);
    expect(world.scene.children).toEqual([existing, preview]);
    expect(cancel).not.toHaveBeenCalled();
    valid = true;
    const request = controller.request(target);
    expect(cancel).toHaveBeenCalledOnce(); // The owner resets itself once; its event skips itself.
    expect(world.scene.children).toEqual([existing]);
    expect(geometry).toHaveBeenCalledOnce();
    expect(cursor.hidden).toBe(true);
    expect(store.exportState()).toEqual(paidState);
    expect(consume).not.toHaveBeenCalled();
    world.actionEvents!.emit('action:interrupt', { reason: 'slot-select' });
    release();
    expect(await request).toBe(false);
    expect(sprite.skinId.peek()).toBeUndefined();
    expect(animation.playReskin).not.toHaveBeenCalled();
    controller.dispose();
    cancel.mockClear();
    world.actionEvents!.emit('action:interrupt', { reason: 'emote' });
    expect(cancel).not.toHaveBeenCalled();
    expect(store.exportState()).toEqual(paidState);
  } finally { release(); controller.dispose(); placement.dispose(); store.dispose(); }
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
    expect(store.bufferedSkin('building')).toBe('selected_skin');
  }
  await begin();
  expect(store.exportState()).toEqual(paidState);
  if (kind === 'animated') expect(lookupPrefabInstance(world.scene.children[1])?.skinId).toBe('selected_skin');
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
  const { world, cursor, store, consume, placement, begin, click, load } = setup(kind);
  let resolve!: (value: never) => void;
  load.mockImplementationOnce((() => new Promise<never>((done) => { resolve = done; })) as never);
  const pending = begin();
  await new Promise(resolve => setTimeout(resolve, 0));
  const paidState = store.exportState();
  click(2);
  expect(cursor.hidden).toBe(true);
  expect(store.exportState()).toEqual(paidState);

  const cancelled = model();
  const source = { create: vi.fn(() => cancelled), disposeSprite: (sprite: THREE.Group) => sprite.removeFromParent(), dispose: vi.fn() };
  let resumed: THREE.Object3D;
  if (kind === 'wall') {
    const resuming = begin();
    source.create = vi.fn(() => model());
    resolve(source as never);
    await Promise.all([pending, resuming]);
    resumed = world.scene.children[0];
  } else {
    await begin();
    resumed = world.scene.children[0];
    resolve(source as never);
    await pending;
  }
  expect(world.scene.children).toEqual([resumed]);
  if (kind === 'wall') expect(cancelled.parent).toBeNull();
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
    for (const model of world.scene.children) expect(lookupPrefabInstance(model)!.sprite.loaded).toBe(true);
  });
  const resources = world.scene.children.flatMap((model) => {
    // A resident building returns its sprite to the shared source, which keeps the atlas materials.
    const mesh = model.children[0].children[0] as THREE.Mesh;
    return [vi.spyOn(mesh.geometry, 'dispose')];
  });
  placement.dispose(); placement.dispose();
  expect(world.scene.children).toEqual([]);
  expect(placement.exportRecords()).toEqual([]);
  expect(placement.renderEntities).toEqual([]);
  expect(pointerDispose).toHaveBeenCalledOnce();
  expect(removeListener).toHaveBeenCalledOnce();
  resources.forEach((resource) => expect(resource).toHaveBeenCalledOnce());
  click(0);
  expect(consume).not.toHaveBeenCalled();
  // The animated placer throws at once; walls still reject their load.
  await expect(async () => begin()).rejects.toThrow('disposed');
});

it('lets the display select wall images only when the shared camera orientation changes', async () => {
  const { begin, load, placement } = setup('wall');
  const scheduler = new GameTimeScheduler(), content = bindTestWorld(scheduler);
  const rotation = (heading: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (90 - heading) * Math.PI / 180);
  content.camerarotation.set(rotation(0));
  await begin();
  const factory = await load.mock.results[0].value;
  await vi.waitFor(() => expect(factory.create).toHaveBeenCalled());
  const controller = factory.create.mock.results[0].value.userData.animationController;
  expect(controller.setFacing.mock.lastCall[0]).toBe(8); expect(controller.showImage).toHaveBeenLastCalledWith(14);
  const calls = controller.setFacing.mock.calls.length;
  content.camerarotation.set(rotation(45)); await new Promise(resolve => setTimeout(resolve, 0));
  expect(controller.setFacing.mock.lastCall[0]).toBe(128); expect(controller.showImage).toHaveBeenLastCalledWith(4);
  const camera = rotation(180);
  content.camerarotation.set(camera); await new Promise(resolve => setTimeout(resolve, 0));
  expect(controller.setFacing.mock.lastCall[0]).toBe(2); expect(controller.showImage).toHaveBeenLastCalledWith(14);
  const changed = controller.setFacing.mock.calls.length;
  content.camerarotation.set(camera); await new Promise(resolve => setTimeout(resolve, 0));
  expect(controller.setFacing.mock.calls.length).toBe(changed); expect(changed).toBe(calls + 2);
  placement.dispose();
  content.unbind(); scheduler.dispose();
});

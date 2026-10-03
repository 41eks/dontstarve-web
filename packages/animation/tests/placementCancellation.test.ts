import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createAnimatedSprite, createStaticSprite } from '../src/sprite';
import { AnimatedBuildingPlacement } from '../../prefab/src/animatedBuildingPlacement';
import { WallPlacement } from '../../prefab/src/wallPlacement';
import { PointerRaycaster } from '../../prefab/src/pointerRaycaster';
import type { WorldContext } from '../../prefab/src/worldContext';
import { InventorySlot, InventoryStore, inventorySlotAddress } from '../../inventory/src';

vi.mock('../src/sprite', () => ({ createAnimatedSprite: vi.fn(), createStaticSprite: vi.fn() }));

function model() {
  const result = new THREE.Group();
  result.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
  result.userData.animationController = {
    update: vi.fn(), start: vi.fn(), showImage: vi.fn(),
    playOnce: vi.fn((_name: string, complete: () => void) => complete()),
  };
  return result;
}

beforeEach(() => {
  vi.mocked(createAnimatedSprite).mockImplementation(async () => model());
  vi.mocked(createStaticSprite).mockImplementation(async () => model());
  vi.stubGlobal('window', new EventTarget());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

function setup(kind: 'animated' | 'wall') {
  const cursor = { hidden: true, style: {}, setAttribute: vi.fn() };
  vi.stubGlobal('document', { createElement: () => cursor, body: { appendChild: vi.fn() } });
  const canvas = new EventTarget();
  const world = {
    scene: new THREE.Scene(), player: new THREE.Object3D(), ground: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(), renderer: { domElement: canvas },
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
        archive: 'building.zip', name: 'Building', buildLabel: 'building', onProximity: false,
        scale: 1, skinArchives: { selected_skin: 'dynamic/selected_skin.zip' }, onbuilt,
      },
    }, consume)
    : new WallPlacement(world, {
      building: { archive: 'wall.zip', name: 'Wall', buildLabel: 'wall', scale: 1, frontImageIndex: 14, sideImageIndex: 4 },
    }, consume);
  const begin = () => placement.begin('building', store.bufferedSkin('building'));
  const click = (button: number) => canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button }));
  const load = kind === 'animated' ? vi.mocked(createAnimatedSprite) : vi.mocked(createStaticSprite);
  return { world, cursor, store, recipe, consume, onbuilt, placement, begin, click, load };
}

it.each(['animated', 'wall'] as const)('%s right-click removes only the preview and lets the paid build resume', async (kind) => {
  const { world, cursor, store, recipe, consume, onbuilt, placement, begin, click } = setup(kind);
  await placement.spawn('building');
  const existing = world.scene.children[0];
  await begin();
  const preview = world.scene.children[1];
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
  if (kind === 'animated') expect(world.scene.children[1].userData.skinId).toBe('selected_skin');
  click(0);
  expect(consume).toHaveBeenCalledTimes(1);
  expect(store.isBuffered('building')).toBe(false);
  expect(store.count('building')).toBe(0);
  expect(store.count('log')).toBe(0);
  expect(placement.exportRecords()).toHaveLength(2);
  expect(onbuilt).toHaveBeenCalledTimes(kind === 'animated' ? 1 : 0);
});

it.each(['animated', 'wall'] as const)('%s does not resurrect a preview cancelled while assets load', async (kind) => {
  const { world, cursor, store, consume, placement, begin, click, load } = setup(kind);
  let resolve!: (value: THREE.Group) => void;
  load.mockImplementationOnce(() => new Promise<THREE.Group>((done) => { resolve = done; }));
  const pending = begin();
  const paidState = store.exportState();
  click(2);
  expect(cursor.hidden).toBe(true);
  expect(store.exportState()).toEqual(paidState);

  await begin();
  const resumed = world.scene.children[0];
  const cancelled = model();
  resolve(cancelled);
  await pending;
  expect(world.scene.children).toEqual([resumed]);
  expect(cancelled.parent).toBeNull();
  expect(cursor.hidden).toBe(false);
  expect(consume).not.toHaveBeenCalled();
  click(0);
  expect(consume).toHaveBeenCalledTimes(1);
  expect(placement.exportRecords()).toHaveLength(1);
});

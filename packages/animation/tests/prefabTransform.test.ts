import { Group, Quaternion, Vector3 } from 'three';
import { expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '../../signals/src';
import { Transform } from '../../prefab/src/transform';
import { createEmptyEntity, PrefabInstance } from '../../prefab/src/prefabInstance';
import { SpriteState } from '../../display/src/spriteState';
import { TransformRoot } from '../src/transformRoot';
import { updateSceneMatrices } from '../src/matrixUpdates';
import { GetTileKeyAtPoint } from '../../componets/src/tileManager';
import { useTestTileMap } from './tileMapFixture';
import { readFile } from 'node:fs/promises';
import { PrefabDisplay } from '../../display/src/prefabDisplay';
import { SpriteResources } from '../../display/src/spriteResources';
import { SpriteController } from '../src/sprite';
import { ArchiveSpriteAssets, createSharedArchiveSprite } from '../src/archiveSprite';

useTestTileMap();

const SYMBOL = 'swap_acidglob1';

it('owns position, scale and degree heading before display and preserves them across replacement displays', () => {
  const dirty = vi.fn(), transform = new Transform(dirty);
  const instance = new PrefabInstance('transform-only', new SpriteState({ name: '', none: true }), transform);
  const position = instance.position, scale = instance.scale;
  instance.setPosition(3, 0, 6);
  instance.setRotation(90);
  instance.setScale(2);
  expect(dirty).toHaveBeenCalledTimes(3);
  expect(dirty.mock.calls.every(([model]) => model === transform.model)).toBe(true);
  expect(instance.rotation).toBeCloseTo(90);
  expect(transform.model.rotation.y).toBeCloseTo(Math.PI / 2);
  const first = createEmptyEntity(instance.prefab, undefined, { instance, billboard: true });
  expect(first.display.model).toBe(transform.model);
  const cameraRotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -.3);
  first.display.update(0, cameraRotation);
  expect(instance.rotation).toBeCloseTo(90);
  expect(first.display.model.children[0].getWorldQuaternion(new Quaternion()).angleTo(cameraRotation)).toBeCloseTo(0);
  first.display.dispose();
  expect(transform.model.children).toHaveLength(0);
  const second = createEmptyEntity(instance.prefab, undefined, { instance });
  try {
    expect(second.display.model).toBe(first.display.model);
    expect(instance.position).toBe(position);
    expect(instance.scale).toBe(scale);
    expect(position.toArray()).toEqual([3, 0, 6]);
    expect(scale.toArray()).toEqual([2, 2, 2]);
    expect(instance.rotation).toBeCloseTo(90);
  } finally { second.display.dispose(); instance.remove(); }
});

it('retains the stationary root and marks it after logical writes and a display-local change', () => {
  const transform = Transform.stationary(), root = transform.model as TransformRoot;
  const point = new Group(); root.add(point);
  updateSceneMatrices(root);
  expect(root.transformDirty).toBe(false);
  transform.setPosition(3, 0, 6);
  expect(root.transformDirty).toBe(true);
  updateSceneMatrices(root);
  expect(point.matrixWorld.elements.slice(12, 15)).toEqual([3, 0, 6]);
  point.position.y = 4;
  transform.markDirty();
  updateSceneMatrices(root);
  expect(point.matrixWorld.elements[13]).toBe(4);
  transform.dispose();
});

it('keeps a symbol follower on the camera-facing sprite, whatever the camera and the entity heading', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  // One unit along the sprite's own x.
  const symbol = vi.spyOn(SpriteController.prototype, 'getSymbolPosition').mockImplementation((_symbol, _x, _y, target) => { target.set(1, 0, 0); return true; });
  const camera = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
  const instance = new PrefabInstance('follower-host', new SpriteState({ name: 'idle', billboard: true }));
  const display = new PrefabDisplay({ root: instance.transform.model, name: 'host', sprite: instance.sprite, status: instance.status,
    source: new SpriteResources().factory({ buildArchive: 'berrybush.zip', animationArchive: 'berrybush.zip' }) });
  const follower = instance.sprite.followSymbol('swap_object', 0, 0);
  try {
    await display.artLoaded();
    const worldPoint = () => {
      for (let frame = 0; frame < 2; frame++) { display.update(1 / 30, camera); instance.sprite.update(1 / 30); }
      return follower.node.getWorldPosition(new Vector3());
    };
    const facing = new Vector3(1, 0, 0).applyQuaternion(camera);
    expect(worldPoint().distanceTo(facing)).toBeCloseTo(0);
    instance.setRotation(45);
    expect(worldPoint().distanceTo(facing)).toBeCloseTo(0);
    expect(follower.node.parent).toBe(display.model);
  } finally { follower.remove(); display.dispose(); instance.remove(); symbol.mockRestore(); vi.unstubAllGlobals(); }
});

it('keeps a symbol follower on a camera-facing archive sprite, whatever the camera and the entity heading', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const assets = new ArchiveSpriteAssets();
  const drawn = await createSharedArchiveSprite(assets, { animationArchive: 'mushroom_tree_tall.zip', buildArchives: ['mushroom_tree_tall.zip'],
    bank: 'mushroom_tree', animation: 'idle_loop', loop: true });
  const instance = new PrefabInstance('archive-follower-host', new SpriteState({ name: 'idle_loop', billboard: true }));
  instance.setPosition(3, 0, 6);
  const display = new PrefabDisplay({ root: instance.transform.model, name: 'host', sprite: instance.sprite, status: instance.status,
    archive: { create: () => drawn, initial: drawn } });
  const follower = instance.sprite.followSymbol(SYMBOL, 20, -110);
  const turned = (radians: number) => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), radians);
  /** The follower's world point beside the same symbol point read from the drawn sprite itself. */
  const points = (camera: Quaternion) => {
    display.update(0, camera);
    const follows = follower.node.getWorldPosition(new Vector3());
    const symbol = new Vector3();
    expect(drawn.getSymbolPosition(SYMBOL, 20, -110, symbol)).toBe(true);
    drawn.model.updateWorldMatrix(true, false);
    return { follows, symbol: symbol.applyMatrix4(drawn.model.matrixWorld) };
  };
  try {
    await display.artLoaded();
    const first = points(turned(Math.PI / 2));
    expect(follower.node.visible).toBe(true);
    expect(first.follows.distanceTo(first.symbol)).toBeCloseTo(0);
    instance.setRotation(45);
    const headed = points(turned(Math.PI / 2));
    expect(headed.follows.distanceTo(first.follows)).toBeCloseTo(0);
    expect(headed.follows.distanceTo(headed.symbol)).toBeCloseTo(0);
    const other = points(turned(-Math.PI / 4));
    expect(other.follows.distanceTo(first.follows)).toBeGreaterThan(.01);
    expect(other.follows.distanceTo(other.symbol)).toBeCloseTo(0);
    expect(follower.node.parent).toBe(display.model);
  } finally { follower.remove(); display.dispose(); instance.remove(); assets.dispose(); vi.unstubAllGlobals(); }
});

it.each(['archive', 'factory'] as const)('lifts the drawn %s sprite off a grounded entity, across deferred art and reloading', async kind => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const assets = new ArchiveSpriteAssets();
  const settle = async (display: PrefabDisplay) => { await new Promise(resolve => setTimeout(resolve, 0)); await display.artLoaded(); display.update(0); };
  // A fresh resource owner each time: the sprite is drawn only after its source has loaded.
  const draw = (name: string) => {
    const instance = new PrefabInstance(name, new SpriteState({ name: kind === 'archive' ? 'idle_loop' : 'idle', billboard: true }));
    const display = new PrefabDisplay({ root: instance.transform.model, name, sprite: instance.sprite, status: instance.status, alignBottom: true, ...kind === 'archive'
      ? { archive: { create: () => createSharedArchiveSprite(assets, { animationArchive: 'mushroom_tree_tall.zip', buildArchives: ['mushroom_tree_tall.zip'], bank: 'mushroom_tree', animation: 'idle_loop', loop: true }) } }
      : { source: new SpriteResources().factory({ buildArchive: 'berrybush.zip', animationArchive: 'berrybush.zip' }) } });
    return { instance, display };
  };
  const resting = draw('resting'), { instance, display } = draw('lifted');
  const root = instance.transform.model, fx = new Group();
  const drawnHeight = () => root.children.find(child => child !== fx)!.position.y;
  try {
    // An attached child comes before a sprite that is drawn later.
    root.add(fx);
    instance.sprite.setVisualHeight(5);
    await settle(resting.display);
    const rest = resting.instance.transform.model.children[0].position.y;
    await settle(display);
    expect(root.children[0]).toBe(fx);
    expect(drawnHeight()).toBeCloseTo(rest + 5);
    expect(fx.position.y).toBe(0);
    expect(instance.position.y).toBe(0);

    instance.setActive(false);
    await settle(display);
    instance.setActive(true);
    await settle(display);
    expect(drawnHeight()).toBeCloseTo(rest + 5);

    instance.sprite.setVisualHeight(0);
    display.update(0);
    expect(drawnHeight()).toBeCloseTo(rest);
    instance.sprite.setVisualHeight(7);
    display.update(0);
    expect(drawnHeight()).toBeCloseTo(rest + 7);
    expect(instance.position.y).toBe(0);
  } finally { display.dispose(); instance.remove(); resting.display.dispose(); resting.instance.remove(); assets.dispose(); vi.unstubAllGlobals(); }
});

it('shares one activity query and tracker, retaining the result until the final consumer leaves', () => {
  const transform = new Transform(), playerActive = createSignal(true);
  const origin = GetTileKeyAtPoint(new Vector3());
  const query = vi.fn(tile => createMemo(() => playerActive.get() && tile.get() === origin));
  const firstCleanup: (() => void)[] = [], secondCleanup: (() => void)[] = [];
  const first = transform.getTileActivity(query, stop => firstCleanup.push(stop))!;
  const second = transform.getTileActivity(query, stop => secondCleanup.push(stop))!;
  const dispose = vi.spyOn(first, 'dispose');
  expect(first).toBe(second);
  expect(query).toHaveBeenCalledExactlyOnceWith(transform.tileTracker.tile);
  expect(first.peek()).toBe(true);
  firstCleanup.forEach(stop => stop());
  expect(dispose).not.toHaveBeenCalled();
  transform.setPosition(24, 0, 0);
  expect(second.peek()).toBe(false);
  transform.setPosition(0, 0, 0);
  expect(second.peek()).toBe(true);
  playerActive.set(false);
  expect(second.peek()).toBe(false);
  secondCleanup.forEach(stop => stop());
  expect(dispose).toHaveBeenCalledOnce();
  transform.dispose();
  expect(dispose).toHaveBeenCalledOnce();
});

it('turns the visual only when the camera, the root or an ancestor turned', () => {
  const instance = new PrefabInstance('turning', new SpriteState({ name: '', none: true }), new Transform());
  const { display } = createEmptyEntity(instance.prefab, undefined, { instance, billboard: true });
  const parent = new Group();
  display.mount(parent);
  const faceCamera = vi.spyOn((display as unknown as { engine: { faceCamera(rotation: Quaternion): void } }).engine, 'faceCamera');
  const worldQuery = vi.spyOn(display.model, 'getWorldQuaternion');
  const camera = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -.3);
  const facesCamera = () => display.model.children[0].getWorldQuaternion(new Quaternion()).angleTo(camera);
  try {
    display.update(0, camera);
    expect(facesCamera()).toBeCloseTo(0);
    worldQuery.mockClear();
    faceCamera.mockClear();
    instance.sprite.update(0);
    instance.sprite.update(0);
    expect(faceCamera).not.toHaveBeenCalled();
    expect(worldQuery).not.toHaveBeenCalled();

    instance.setRotation(90);
    instance.sprite.update(0);
    expect(faceCamera).toHaveBeenCalledTimes(1);
    expect(facesCamera()).toBeCloseTo(0);

    parent.rotation.y = 1;
    instance.sprite.update(0);
    expect(faceCamera).toHaveBeenCalledTimes(2);
    expect(facesCamera()).toBeCloseTo(0);
    expect(instance.rotation).toBeCloseTo(90);
  } finally { display.dispose(); instance.remove(); }
});

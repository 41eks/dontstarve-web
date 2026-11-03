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

useTestTileMap();

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

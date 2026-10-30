import { findActionEntity } from '../../prefab/src/actionEntity';
import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { intersectSpriteEntities, PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import { PlayerActionPicker } from '../../stategraphs/src/playeractionpicker';
import { actionEntity, activePrefabs, bindActionEntityWorld, disposeActionEntity } from '../../prefab/src/actionEntity';
import { ItemEntity } from '../../inventory/src';
import { createMemo, createSignal } from '../../signals/src';
import { DisposeTileStates, GetTileStateAtPoint } from '../../componets/src/tileManager';
import { useTestTileMap } from './tileMapFixture';
import { SpriteFrameRenderer, type ResolvedSprite } from '../src/animationAssets';
import { mouseTargets, setMouseTargetEnabled } from '../../prefab/src/mouseTargets';

useTestTileMap();
afterEach(() => { vi.unstubAllGlobals(); expect(activePrefabs).toHaveLength(0); expect(mouseTargets.size).toBe(0); });

it('picks behind hidden/NOCLICK swarms, restores visible bounding-box picking and keeps unavailable visible targets blocking', () => {
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 100);
  camera.position.z = 10; camera.updateMatrixWorld();
  const scene = new THREE.Scene(), swarm = new THREE.Group(), visual = new THREE.Group();
  const geometry = new THREE.PlaneGeometry(2, 2), material = new THREE.MeshBasicMaterial();
  const back = new THREE.Mesh(geometry, material);
  swarm.position.z = 2; swarm.userData.rayTestOnBB = true;
  const part = new THREE.Mesh(geometry, material);
  part.position.x = 1.5; visual.add(part);
  const other = new THREE.Mesh(geometry, material);
  other.position.x = -1.5; visual.add(other);
  const hidden = new THREE.Mesh(geometry, material);
  hidden.position.x = 10; hidden.visible = false; visual.add(hidden);
  swarm.add(visual); scene.add(swarm, back); scene.updateMatrixWorld(true);
  const renderer = { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) } } as unknown as THREE.WebGLRenderer;
  const pointer = new PointerRaycaster({ camera, renderer }), picker = new PlayerActionPicker(pointer);
  const pickup = { action: 'PICKUP' as const }, net = { action: 'NET' as const };
  let available = false;
  const swarmEntity = actionEntity(swarm, 'fireflies');
  swarmEntity.addTag('NOCLICK');
  actionEntity(back as unknown as THREE.Group, 'back');
  const swarmActions = vi.fn(model => model === swarm ? [{ action: net, model: swarm, button: 'left' as const, available }] : []);
  picker.register(swarmActions);
  picker.register(model => model === back ? [{ action: pickup, model: back, button: 'left' }] : []);
  try {
    pointer.trackPointer({ clientX: 50, clientY: 50 } as PointerEvent);
    // A visible but NOCLICK swarm cannot occlude the item behind it.
    expect(picker.getMouseActions().left).toBe(pickup);
    expect(swarmActions).toHaveBeenLastCalledWith(back);
    swarmEntity.removeTag('NOCLICK'); visual.visible = false;
    expect(picker.getMouseActions().left).toBe(pickup);
    visual.visible = true;
    // The visible swarm's full bounds bridge the gap between its two parts.
    expect(picker.getMouseActions().left).toBeUndefined();
    available = true;
    expect(picker.getMouseActions().left).toBe(net);
    const outside = new THREE.Raycaster(new THREE.Vector3(10, 0, 10), new THREE.Vector3(0, 0, -1));
    expect(intersectSpriteEntities(outside, [swarm])).toEqual([]);
    // A directly queried descendant still inherits its ancestor's visibility/NOCLICK.
    const ray = new THREE.Raycaster(new THREE.Vector3(1.5, 0, 10), new THREE.Vector3(0, 0, -1));
    swarm.visible = false;
    expect(intersectSpriteEntities(ray, [part])).toEqual([]);
    swarm.visible = true; swarmEntity.addTag('NOCLICK');
    expect(intersectSpriteEntities(ray, [part])).toEqual([]);
    swarmEntity.removeTag('NOCLICK');
    expect(intersectSpriteEntities(ray, [part])[0]?.object).toBe(part);
    swarm.userData.rayTestOnBB = false; visual.visible = false;
    expect(intersectSpriteEntities(ray, [swarm])).toEqual([]);
    visual.visible = true;
    expect(intersectSpriteEntities(ray, [swarm])[0]?.object).toBe(part);
  } finally { disposeActionEntity(swarm); disposeActionEntity(back as unknown as THREE.Group); picker.dispose(); geometry.dispose(); material.dispose(); }
});

it('picks active prefabs using logical NOCLICK/removal and resolves a pointer event once for all action consumers', () => {
  const scene = new THREE.Scene(), front = new THREE.Group(), back = new THREE.Group();
  const geometry = new THREE.PlaneGeometry(2, 2), material = new THREE.MeshBasicMaterial();
  front.add(new THREE.Mesh(geometry, material)); back.add(new THREE.Mesh(geometry, material));
  front.position.z = 2; scene.add(front, back); scene.updateMatrixWorld(true);
  const item = new ItemEntity({ itemId: 'log', count: 1 });
  item.addTag('NOCLICK');
  actionEntity(front, 'log', item); actionEntity(back, 'rock');
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 100);
  camera.position.z = 10; camera.updateMatrixWorld();
  const renderer = { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) } } as unknown as THREE.WebGLRenderer;
  const pointer = new PointerRaycaster({ camera, renderer, scene }), picker = new PlayerActionPicker(pointer);
  const raycasts = vi.spyOn(pointer, 'pickMouseTarget'), traversal = vi.spyOn(scene, 'traverse');
  const worldScan = vi.spyOn(activePrefabs, Symbol.iterator);
  const pickup = { action: 'PICKUP' as const };
  const provider = vi.fn(model => model ? [{ action: pickup, model, button: 'left' as const, available: model === back }] : []);
  picker.register(provider);
  try {
    const event = { clientX: 50, clientY: 50 } as PointerEvent;
    expect(picker.getMouseActions(event).left).toBe(pickup);
    expect(picker.getMouseActions(event).left).toBe(pickup);
    expect(raycasts).toHaveBeenCalledTimes(1);
    expect(provider).toHaveBeenCalledExactlyOnceWith(back);
    item.removeTag('NOCLICK');
    expect(picker.getMouseActions().left).toBeUndefined();
    expect(provider).toHaveBeenLastCalledWith(front); // An unavailable visible entity still occludes the back.
    setMouseTargetEnabled(front, false);
    expect(activePrefabs.some(entity => entity.model === front)).toBe(true);
    expect(mouseTargets.has(findActionEntity(front))).toBe(false);
    expect(picker.getMouseActions().left).toBe(pickup);
    setMouseTargetEnabled(front, true);
    expect(picker.getMouseActions().left).toBeUndefined();
    front.removeFromParent();
    expect(picker.getMouseActions().left).toBe(pickup);
    scene.add(front);
    expect(picker.getMouseActions().left).toBeUndefined();
    item.destroy();
    expect(picker.getMouseActions().left).toBe(pickup);
    item.removeTag('NOCLICK');
    expect(picker.getMouseActions().left).toBe(pickup);
    expect(traversal).not.toHaveBeenCalled();
    expect(worldScan).not.toHaveBeenCalled();
  } finally {
    raycasts.mockRestore(); traversal.mockRestore(); worldScan.mockRestore();
    item.destroy(); disposeActionEntity(front); disposeActionEntity(back); picker.dispose();
    geometry.dispose(); material.dispose();
  }
});

it('returns ground points with exactly zero Y while preserving ray intersections and cached coordinates', () => {
  vi.stubGlobal('window', new EventTarget());
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 100);
  camera.position.set(0, 10, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = 1e-10; ground.updateMatrixWorld();
  const renderer = { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) } } as unknown as THREE.WebGLRenderer;
  const pointer = new PointerRaycaster({ camera, renderer, ground });
  try {
    pointer.trackPointer({ clientX: 50, clientY: 50 } as PointerEvent);
    pointer.beginFrame();
    const raw = pointer.raycastPointer([ground])!.point;
    expect(raw.y).not.toBe(0);
    const position = pointer.groundPoint()!;
    expect(position.toArray()).toEqual([raw.x, 0, raw.z]);
    position.x = 99;
    expect(pointer.groundPoint()!.x).toBe(raw.x);
    expect(raw.y).toBeCloseTo(1e-10, 12);
  } finally { pointer.endFrame(); pointer.dispose(); ground.geometry.dispose(); ground.material.dispose(); }
});

it('follows tickingarea and picks tall art away from its logical foot using current transforms', async () => {
  const scene = new THREE.Scene(), tall = new THREE.Group(), back = new THREE.Group();
  const geometry = new THREE.PlaneGeometry(2, 2), material = new THREE.MeshBasicMaterial();
  const part = new THREE.Mesh(geometry, material);
  tall.position.set(132, 0, 2); part.position.set(-132, 8, 0); tall.add(part);
  tall.userData.rayTestOnBB = true;
  back.position.y = 8; back.add(new THREE.Mesh(geometry, material)); scene.add(tall, back);
  const positions = createSignal([new THREE.Vector3()]);
  const player = createMemo(() => positions.get()[0]);
  const stop = bindActionEntityWorld(scene, GetTileStateAtPoint(player), positions);
  actionEntity(tall, 'tall').addTag('NOBLOCK'); actionEntity(back, 'back');
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 100);
  camera.position.set(0, 8, 10); camera.updateMatrixWorld();
  const renderer = { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) } } as unknown as THREE.WebGLRenderer;
  const pointer = new PointerRaycaster({ camera, renderer, scene }), picker = new PlayerActionPicker(pointer);
  const pick = () => { picker.getMouseActions(); return picker.targetModel; };
  try {
    pointer.trackPointer({ clientX: 50, clientY: 50 } as PointerEvent);
    expect(pick()).toBe(back);
    positions.set([new THREE.Vector3(12, 0, 0)]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(pick()).toBe(tall); // Its foot lies far outside the pointer ray; its drawn art is in front.
    tall.position.x += 20;
    expect(pick()).toBe(back); // No rendered frame or index synchronization is required.
    tall.position.x -= 20;
    expect(pick()).toBe(tall);
    positions.set([new THREE.Vector3()]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(pick()).toBe(back);
  } finally {
    picker.dispose(); stop(); DisposeTileStates(player); player.dispose();
    geometry.dispose(); material.dispose();
  }
});

it('reads current drawn frame bounds on animation changes, including shared frames and empty visuals', () => {
  const scene = new THREE.Scene(), model = new THREE.Group(), visual = new THREE.Group();
  model.add(visual); scene.add(model); model.userData.rayTestOnBB = true;
  const renderer = new SpriteFrameRenderer(visual), material = new THREE.MeshBasicMaterial();
  const frame = (x: number): ResolvedSprite => ({
    element: { imageHash: 1, imageIndex: 0, layerHash: 1, matrix: [1, 0, 0, 1, x, 0], z: 0 },
    image: { index: 0, duration: 1, x: 0, y: 0, width: 2, height: 2, vertexIndex: 0,
      vertexCount: 6, sampler: 0, bbx: 0, bby: 0, canvasWidth: 2, canvasHeight: 2 },
    materials: [material],
  });
  renderer.show([frame(0)]);
  const ray = new THREE.Raycaster(new THREE.Vector3(12, 0, 10), new THREE.Vector3(0, 0, -1));
  let shared: ReturnType<SpriteFrameRenderer['snapshot']> | undefined;
  try {
    expect(intersectSpriteEntities(ray, [model])).toEqual([]);
    renderer.show([frame(-12), frame(12)]);
    // No rendered frame is required between a frame change and an input event.
    expect(intersectSpriteEntities(ray, [model])[0]?.object).toBe(model);
    renderer.show([frame(12)]);
    const center = new THREE.Raycaster(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1));
    expect(intersectSpriteEntities(center, [model])).toEqual([]);
    shared = renderer.snapshot();
    renderer.show([frame(0)]);
    expect(intersectSpriteEntities(center, [model])[0]?.object).toBe(model);
    renderer.showShared(shared);
    expect(intersectSpriteEntities(center, [model])).toEqual([]);
    expect(intersectSpriteEntities(ray, [model])[0]?.object).toBe(model);
    // Growing a reusable buffer can replace its position attribute with the same version number.
    renderer.show(Array.from({ length: 17 }, () => frame(0)));
    expect(intersectSpriteEntities(center, [model])[0]?.object).toBe(model);
    expect(intersectSpriteEntities(ray, [model])).toEqual([]);
    renderer.show([]);
    expect(intersectSpriteEntities(ray, [model])).toEqual([]);
  } finally {
    shared?.geometry.dispose(); renderer.dispose();
    (visual.children[0] as THREE.Mesh).geometry.dispose(); material.dispose();
  }
});

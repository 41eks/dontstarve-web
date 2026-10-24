import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { intersectSpriteEntities, PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import { PlayerActionPicker } from '../../stategraphs/src/playeractionpicker';
import { registerMouseTarget } from '../../stategraphs/src/mouseTargets';
import { actionEntity, disposeActionEntity } from '../../prefab/src/actionEntity';
import { ItemEntity } from '../../inventory/src';
import { mouseTargetsAlongRay, syncEntitySpatial } from '../../stategraphs/src/entitySpatialIndex';
import { SpriteFrameRenderer, type ResolvedSprite } from '../src/animationAssets';

afterEach(() => vi.unstubAllGlobals());

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
  let available = false, noClick = true;
  swarm.userData.actionEntity = { hasTag: (tag: string) => tag === 'NOCLICK' && noClick };
  const swarmTarget = registerMouseTarget(swarm, () => !noClick), backTarget = registerMouseTarget(back, () => true);
  const swarmActions = vi.fn(model => model === swarm ? [{ action: net, model: swarm, button: 'left' as const, available }] : []);
  picker.register(swarmActions);
  picker.register(model => model === back ? [{ action: pickup, model: back, button: 'left' }] : []);
  try {
    pointer.trackPointer({ clientX: 50, clientY: 50 } as PointerEvent);
    // A visible but NOCLICK swarm cannot occlude the item behind it.
    expect(picker.getMouseActions().left).toBe(pickup);
    expect(swarmActions).toHaveBeenLastCalledWith(back);
    noClick = false; visual.visible = false;
    swarmTarget.refresh();
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
    swarm.visible = true; noClick = true;
    expect(intersectSpriteEntities(ray, [part])).toEqual([]);
    noClick = false;
    expect(intersectSpriteEntities(ray, [part])[0]?.object).toBe(part);
    swarm.userData.rayTestOnBB = false; visual.visible = false;
    expect(intersectSpriteEntities(ray, [swarm])).toEqual([]);
    visual.visible = true;
    expect(intersectSpriteEntities(ray, [swarm])[0]?.object).toBe(part);
  } finally { swarmTarget.dispose(); backTarget.dispose(); picker.dispose(); geometry.dispose(); material.dispose(); }
});

it('updates mouse registration from logical NOCLICK/removal and resolves a pointer event once for all action consumers', () => {
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
    front.removeFromParent();
    expect(picker.getMouseActions().left).toBe(pickup);
    scene.add(front);
    expect(picker.getMouseActions().left).toBeUndefined();
    item.destroy();
    expect(picker.getMouseActions().left).toBe(pickup);
    item.removeTag('NOCLICK');
    expect(picker.getMouseActions().left).toBe(pickup);
    expect(traversal).not.toHaveBeenCalled();
  } finally {
    raycasts.mockRestore(); traversal.mockRestore();
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

it('queries ray cells without touching distant NOBLOCK targets, including tall art away from its foot point', () => {
  const scene = new THREE.Scene(), registrations: ReturnType<typeof registerMouseTarget>[] = [];
  const geometry = new THREE.PlaneGeometry(2, 2), material = new THREE.MeshBasicMaterial();
  const farTargets: THREE.Group[] = [];
  for (let i = 0; i < 2000; i++) {
    const model = new THREE.Group();
    model.position.set(40 + i % 50 * 4, 0, -Math.floor(i / 50) * 4);
    model.userData.tags = ['NOBLOCK']; model.userData.rayTestOnBB = true;
    model.add(new THREE.Mesh(geometry, material)); scene.add(model);
    registrations.push(registerMouseTarget(model, () => true)); farTargets.push(model);
  }
  const tall = new THREE.Group(), part = new THREE.Mesh(geometry, material);
  tall.position.set(12, 0, 0); part.position.set(-12, 8, 0); tall.add(part);
  tall.userData.rayTestOnBB = true; scene.add(tall);
  registrations.push(registerMouseTarget(tall, () => true));
  scene.updateMatrixWorld(true);
  const updates = farTargets.map(model => vi.spyOn(model, 'updateWorldMatrix'));
  const boxTransforms = vi.spyOn(THREE.Box3.prototype, 'applyMatrix4');
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 8, 10), new THREE.Vector3(0, 0, -1));
  try {
    for (let frame = 0; frame < 5; frame++) {
      const candidates = mouseTargetsAlongRay(ray.ray, ray.near, ray.far);
      expect(candidates).toEqual([tall]);
      expect(intersectSpriteEntities(ray, candidates)[0]?.object).toBe(tall);
    }
    expect(updates.every(spy => spy.mock.calls.length === 0)).toBe(true);
    expect(boxTransforms).toHaveBeenCalledTimes(1); // Stationary hover reuses the precise world box.
    part.visible = false;
    expect(intersectSpriteEntities(ray, [tall])).toEqual([]);
    part.visible = true;
    tall.position.x = 32; syncEntitySpatial(tall);
    expect(mouseTargetsAlongRay(ray.ray, ray.near, ray.far)).not.toContain(tall);
    tall.position.x = 12; tall.rotation.z = Math.PI / 2; syncEntitySpatial(tall);
    expect(intersectSpriteEntities(ray, [tall])).toEqual([]);
    tall.rotation.z = 0; syncEntitySpatial(tall);
    expect(intersectSpriteEntities(ray, mouseTargetsAlongRay(ray.ray, ray.near, ray.far))[0]?.object).toBe(tall);
  } finally {
    updates.forEach(spy => spy.mockRestore()); boxTransforms.mockRestore();
    registrations.forEach(target => target.dispose()); geometry.dispose(); material.dispose();
  }
});

it('expands the ray envelope on animation changes and caches only drawn frame bounds, including shared frames', () => {
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
  const target = registerMouseTarget(model, () => true);
  const ray = new THREE.Raycaster(new THREE.Vector3(12, 0, 10), new THREE.Vector3(0, 0, -1));
  let shared: ReturnType<SpriteFrameRenderer['snapshot']> | undefined;
  try {
    expect(mouseTargetsAlongRay(ray.ray, 0, Infinity)).toEqual([]);
    renderer.show([frame(-12), frame(12)]);
    // No rendered frame is required between a frame change and an input event.
    expect(intersectSpriteEntities(ray, mouseTargetsAlongRay(ray.ray, 0, Infinity))[0]?.object).toBe(model);
    renderer.show([frame(12)]);
    const center = new THREE.Raycaster(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1));
    expect(intersectSpriteEntities(center, mouseTargetsAlongRay(center.ray, 0, Infinity))).toEqual([]);
    shared = renderer.snapshot();
    renderer.show([frame(0)]);
    expect(intersectSpriteEntities(center, mouseTargetsAlongRay(center.ray, 0, Infinity))[0]?.object).toBe(model);
    renderer.showShared(shared);
    expect(intersectSpriteEntities(center, mouseTargetsAlongRay(center.ray, 0, Infinity))).toEqual([]);
    expect(intersectSpriteEntities(ray, mouseTargetsAlongRay(ray.ray, 0, Infinity))[0]?.object).toBe(model);
    // Growing a reusable buffer can replace its position attribute with the same version number.
    renderer.show(Array.from({ length: 17 }, () => frame(0)));
    expect(intersectSpriteEntities(center, mouseTargetsAlongRay(center.ray, 0, Infinity))[0]?.object).toBe(model);
    expect(intersectSpriteEntities(ray, mouseTargetsAlongRay(ray.ray, 0, Infinity))).toEqual([]);
    renderer.show([]);
    expect(intersectSpriteEntities(ray, mouseTargetsAlongRay(ray.ray, 0, Infinity))).toEqual([]);
  } finally {
    target.dispose(); shared?.geometry.dispose(); renderer.dispose();
    (visual.children[0] as THREE.Mesh).geometry.dispose(); material.dispose();
  }
});

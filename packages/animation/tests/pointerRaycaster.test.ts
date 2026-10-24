import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { intersectSpriteEntities, PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import { PlayerActionPicker } from '../../stategraphs/src/playeractionpicker';

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
  picker.register(() => [{ action: net, model: swarm, button: 'left', available }]);
  picker.register(() => [{ action: pickup, model: back, button: 'left' }]);
  try {
    pointer.trackPointer({ clientX: 50, clientY: 50 } as PointerEvent);
    // A visible but NOCLICK swarm cannot occlude the item behind it.
    expect(picker.getMouseActions().left).toBe(pickup);
    noClick = false; visual.visible = false;
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
  } finally { picker.dispose(); geometry.dispose(); material.dispose(); }
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

import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';

afterEach(() => vi.unstubAllGlobals());

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

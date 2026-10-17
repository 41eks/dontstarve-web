import * as THREE from 'three';
import { expect, it } from 'vitest';
import { SpriteFrameRenderer, createAtlasTexture, type ResolvedSprite } from '../src/animationAssets';
import { intersectSpriteEntities, PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import { PlayerActionPicker } from '../../stategraphs/src/playeractionpicker';
import { registerMouseTarget } from '../../stategraphs/src/mouseTargets';

function material(alphas: number[], pointFiltering = true) {
  const pixels = new Uint8Array(4 * 4 * 4).fill(255);
  alphas.forEach((alpha, index) => { pixels[index * 4 + 3] = alpha; });
  const map = createAtlasTexture({ width: 4, height: 4, pixels }, pointFiltering);
  return new THREE.MeshBasicMaterial({ map, transparent: true, alphaTest: .01, side: THREE.DoubleSide });
}

function frame(materials: THREE.MeshBasicMaterial[], sampler = 0): ResolvedSprite {
  return {
    element: { imageHash: 1, imageIndex: 0, layerHash: 1, matrix: [1, 0, 0, 1, 0, 0], z: 0 },
    image: { index: 0, duration: 1, x: 0, y: 0, width: 2, height: 2, vertexIndex: 0,
      vertexCount: 6, sampler, bbx: 1, bby: 1, canvasWidth: 4, canvasHeight: 4 },
    materials,
  };
}

function dispose(visual: THREE.Group, renderer: SpriteFrameRenderer, materials: THREE.MeshBasicMaterial[]) {
  renderer.dispose();
  (visual.children[0] as THREE.Mesh).geometry.dispose();
  for (const material of materials) { material.map?.dispose(); material.dispose(); }
}

it('selects actions behind transparent atlas pixels while opaque, mirrored and bounding-box sprites still block', () => {
  const scene = new THREE.Scene(), front = new THREE.Group(), visual = new THREE.Group();
  front.position.z = 2; front.add(visual);
  const renderer = new SpriteFrameRenderer(visual);
  const clear = material(Array(16).fill(0)), cutout = material(Array.from({ length: 16 }, (_, i) => i === 5 ? 0 : 255));
  renderer.show([frame([clear, cutout]), frame([clear, cutout], 1)]);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial());
  scene.add(front, back); scene.updateMatrixWorld(true);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 100);
  camera.position.z = 10; camera.updateMatrixWorld();
  const screen = { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) } } as unknown as THREE.WebGLRenderer;
  const pointer = new PointerRaycaster({ camera, renderer: screen, scene }), picker = new PlayerActionPicker(pointer);
  const frontTarget = registerMouseTarget(front, () => true), backTarget = registerMouseTarget(back, () => true);
  const reskin = { action: 'CASTSPELL' as const, modifier: 'RESKIN' };
  picker.register(target => target === back ? [{ action: reskin, model: back, button: 'right' }] : []);
  const at = (x: number, y: number) => {
    pointer.trackPointer({ clientX: x, clientY: y } as PointerEvent);
    return picker.getMouseActions().right;
  };
  try {
    expect(at(25, 75)).toBe(reskin); // Both atlas layers are transparent at this texel.
    expect(picker.targetModel).toBe(back);
    expect(at(75, 75)).toBeUndefined(); // The second atlas supplies the visible part.
    expect(picker.targetModel).toBe(front); // Lack of a valid action must not enable click-through.
    front.scale.x = -1; scene.updateMatrixWorld(true);
    expect(at(75, 75)).toBe(reskin);
    expect(at(25, 75)).toBeUndefined();
    front.userData.rayTestOnBB = true;
    expect(at(75, 75)).toBeUndefined(); // Lua's explicit BB mode includes transparent gaps.
    expect(picker.targetModel).toBe(front);
  } finally {
    frontTarget.dispose(); backTarget.dispose(); picker.dispose();
    dispose(visual, renderer, [clear, cutout]); back.geometry.dispose(); back.material.dispose();
  }
});

it('samples linear atlas alpha, opacity and texture transforms without changing hit UVs', () => {
  const visual = new THREE.Group(), renderer = new SpriteFrameRenderer(visual);
  const cutout = material(Array.from({ length: 16 }, (_, i) => i % 4 < 2 ? 0 : 255), false);
  renderer.show([frame([cutout])]); visual.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(0, -.5, 10), new THREE.Vector3(0, 0, -1));
  const pick = () => intersectSpriteEntities(ray, [visual]);
  try {
    cutout.alphaTest = .6;
    expect(pick()).toEqual([]); // u=.5 is halfway between transparent and opaque texels.
    cutout.alphaTest = .5;
    const hit = pick()[0];
    expect(hit).toBeDefined();
    expect(hit.uv!.toArray()).toEqual([.5, .375]);
    cutout.opacity = .5;
    expect(pick()).toEqual([]);
    cutout.opacity = 1;
    cutout.map!.offset.x = -.25;
    expect(pick()).toEqual([]);
    cutout.map!.offset.x = .25;
    expect(pick()[0].uv!.toArray()).toEqual([.5, .375]);
  } finally { dispose(visual, renderer, [cutout]); }
});

it('uses current frame and shared-frame atlases, preserves earlier hits and releases no shared texture during picking', () => {
  const visual = new THREE.Group(), renderer = new SpriteFrameRenderer(visual);
  const opaque = material(Array(16).fill(255)), clear = material(Array(16).fill(0));
  renderer.show([frame([opaque])]); visual.updateMatrixWorld(true);
  const shared = renderer.snapshot();
  const mesh = visual.children[0] as THREE.Mesh;
  let textureDisposals = 0;
  opaque.map!.addEventListener('dispose', () => { textureDisposals++; });
  const ray = new THREE.Raycaster(new THREE.Vector3(.5, -.5, 10), new THREE.Vector3(0, 0, -1));
  const initial = ray.intersectObject(visual)[0];
  try {
    renderer.show([frame([clear])]);
    const hits = [initial];
    mesh.raycast(ray, hits);
    expect(hits).toEqual([initial]);
    renderer.showShared(shared);
    mesh.raycast(ray, hits);
    expect(hits).toHaveLength(2);
    expect(hits[1].object).toBe(mesh);
    expect(textureDisposals).toBe(0);
    // The decoded rows are used in their uploaded orientation; no additional atlas Y reversal.
    const pixels = opaque.map!.image.data;
    pixels[5 * 4 + 3] = 0;
    ray.ray.origin.x = -.5;
    expect(ray.intersectObject(visual)).toEqual([]);
    opaque.map!.flipY = true;
    expect(ray.intersectObject(visual).length).toBeGreaterThan(0);
  } finally {
    renderer.show([frame([opaque])]); shared.geometry.dispose();
    dispose(visual, renderer, [opaque, clear]);
  }
});

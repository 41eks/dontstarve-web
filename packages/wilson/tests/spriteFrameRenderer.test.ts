import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  SpriteFrameRenderer,
  type BuildImage,
  type ResolvedSprite,
} from '../src/animationAssets';

function image(sampler = 0): BuildImage {
  return {
    index: 0,
    duration: 1,
    x: 5,
    y: 5,
    width: 2,
    height: 4,
    vertexIndex: 0,
    vertexCount: 6,
    sampler,
    bbx: 10,
    bby: 20,
    canvasWidth: 100,
    canvasHeight: 200,
  };
}

function sprite(
  material: THREE.MeshBasicMaterial,
  matrix: ResolvedSprite['element']['matrix'] = [1, 0, 0, 1, 0, 0],
): ResolvedSprite {
  return {
    element: { imageHash: 1, imageIndex: 0, layerHash: 2, matrix, z: 0 },
    image: image(),
    materials: [material],
  };
}

describe('SpriteFrameRenderer', () => {
  it('bakes every part transform into one indexed mesh', () => {
    const visual = new THREE.Group();
    const renderer = new SpriteFrameRenderer(visual);
    const material = new THREE.MeshBasicMaterial();

    renderer.show([
      sprite(material, [2, 0, 0, 3, 10, 20]),
      sprite(material, [1, 0, 0, 1, -4, -3]),
    ]);

    expect(visual.children).toHaveLength(1);
    const mesh = visual.children[0] as THREE.Mesh;
    const positions = Array.from(mesh.geometry.getAttribute('position').array).slice(0, 24);
    expect(positions).toEqual([
      18, 29, 0, 22, 29, 0, 22, 41, 0, 18, 41, 0,
      0, 0, 0, 2, 0, 0, 2, 4, 0, 0, 4, 0,
    ]);
    expect(Array.from(mesh.geometry.index!.array).slice(0, 12)).toEqual([
      0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7,
    ]);
    expect(mesh.geometry.drawRange).toEqual({ start: 0, count: 12 });
    expect(mesh.geometry.groups).toEqual([{ start: 0, count: 12, materialIndex: 0 }]);
  });

  it('preserves interleaved atlas order as consecutive material groups', () => {
    const visual = new THREE.Group();
    const renderer = new SpriteFrameRenderer(visual);
    const first = new THREE.MeshBasicMaterial();
    const second = new THREE.MeshBasicMaterial();

    renderer.show([sprite(first), sprite(second), sprite(first)]);

    const mesh = visual.children[0] as THREE.Mesh;
    expect(mesh.material).toEqual([first, second]);
    expect(mesh.geometry.groups).toEqual([
      { start: 0, count: 6, materialIndex: 0 },
      { start: 6, count: 6, materialIndex: 1 },
      { start: 12, count: 6, materialIndex: 0 },
    ]);
  });

  it('hides its single mesh for an empty frame', () => {
    const visual = new THREE.Group();
    const renderer = new SpriteFrameRenderer(visual);
    renderer.show([sprite(new THREE.MeshBasicMaterial())]);

    renderer.show([]);

    const mesh = visual.children[0] as THREE.Mesh;
    expect(mesh.visible).toBe(false);
    expect(mesh.geometry.drawRange.count).toBe(0);
  });
});

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  SpriteFrameRenderer,
  createMaterials,
  type BuildImage,
  type ResolvedSprite,
} from '../src/animationAssets';
import { spriteSpatialRadius } from '../src/spatialBounds';

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
  it('draws a depth offset through private copies that follow their sources, leaving shared materials untouched', () => {
    const visual = new THREE.Group();
    const renderer = new SpriteFrameRenderer(visual);
    const mesh = visual.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
    const source = new THREE.MeshBasicMaterial({ transparent: true });
    const shared = { geometry: new THREE.BufferGeometry(), materials: [source], visible: true };
    renderer.showShared(shared);
    renderer.setDepthOffset(true);
    const [copy] = mesh.material;
    expect(copy).not.toBe(source);
    expect(copy).toMatchObject({ polygonOffset: true, polygonOffsetFactor: 0, transparent: true });
    expect(copy.polygonOffsetUnits).toBeLessThan(0);
    expect(source.polygonOffset).toBe(false);
    // Later frames, shared or own, reuse the entity's copy of each source.
    renderer.show([sprite(source)]);
    expect(mesh.material).toEqual([copy]);
    renderer.showShared(shared);
    expect(mesh.material[0]).toBe(copy);
    source.opacity = .5;
    renderer.syncDepthOffset();
    expect(copy).toMatchObject({ opacity: .5, polygonOffset: true });
    let disposed = 0;
    copy.addEventListener('dispose', () => disposed++);
    renderer.setDepthOffset(false);
    expect(mesh.material).toEqual([source]);
    expect(disposed).toBe(1);
    shared.geometry.dispose(); renderer.dispose();
  });

  it('bakes each part\'s symbol light override into its four vertices of the merged frame', () => {
    const visual = new THREE.Group();
    const renderer = new SpriteFrameRenderer(visual);
    const mesh = visual.children[0] as THREE.Mesh;
    const material = new THREE.MeshBasicMaterial();
    renderer.show([sprite(material), { ...sprite(material), lightOverride: .5 }]);
    const light = mesh.geometry.getAttribute('spriteLightOverride');
    expect(Array.from({ length: 8 }, (_, i) => light.getX(i))).toEqual([0, 0, 0, 0, .5, .5, .5, .5]);
    // A later frame without the override restores the part's own light.
    renderer.show([sprite(material), sprite(material)]);
    expect(light.getX(4)).toBe(0);
    renderer.dispose();
  });

  it('renders mirrored and ordinary billboard parts in the same face pass', () => {
    const [material] = createMaterials({
      build: { name: 'test', atlasNames: ['test'], symbols: new Map() },
      atlases: [{ width: 1, height: 1, pixels: new Uint8Array([255, 255, 255, 255]) }],
    });
    expect(material.transparent).toBe(true);
    expect(material.side).toBe(THREE.DoubleSide);
    expect(material.forceSinglePass).toBe(true);
    expect(material.depthWrite).toBe(false);
    material.map?.dispose();
    material.dispose();
  });
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

  it('culls with a padded sphere while the tight bounds and published radius stay on the drawn quads', () => {
    const visual = new THREE.Group();
    const renderer = new SpriteFrameRenderer(visual);
    const material = new THREE.MeshBasicMaterial();
    renderer.show([sprite(material, [1, 0, 0, 1, 10, 20])]);
    const geometry = (visual.children[0] as THREE.Mesh).geometry;
    const tight = geometry.boundingBox!.getBoundingSphere(new THREE.Sphere());
    expect(geometry.boundingSphere!.center.distanceTo(tight.center)).toBeCloseTo(0);
    expect(geometry.boundingSphere!.radius).toBeGreaterThan(tight.radius);
    expect(spriteSpatialRadius(visual)).toBeCloseTo(tight.center.length() + tight.radius);
    expect((visual.children[0] as THREE.Mesh).frustumCulled).toBe(true);
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

import * as THREE from 'three';
import { expect, it } from 'vitest';

import { SpriteFrameRenderer, createMaterials } from '../src/animationAssets';
import { SpriteMaterialDresser } from '../src/spriteDressing';
import { raycastSprite } from '../src/spriteRaycast';

function compiledVertex(material: THREE.Material): string {
  const shader = { vertexShader: '#include <common>\nvoid main() {\n#include <project_vertex>\n}', fragmentShader: '#include <common>\n#include <color_fragment>\n#include <map_fragment>', uniforms: {} };
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  return shader.vertexShader;
}

it('projects sprite quads about their origin through every private copy of a sprite material', () => {
  const [source] = createMaterials({
    build: { name: 'test', atlasNames: ['test'], symbols: new Map() },
    atlases: [{ width: 1, height: 1, pixels: new Uint8Array([255, 255, 255, 255]) }],
  });
  const dresser = new SpriteMaterialDresser();
  dresser.setColour([1, .5, .5]);
  const tinted = dresser.dress(source);
  const bloom = dresser.dress(source, { index: 0, duration: 1, x: 0, y: 0, width: 2, height: 2, vertexIndex: 0, vertexCount: 6,
    sampler: 0, bbx: 0, bby: 0, canvasWidth: 4, canvasHeight: 4 });
  const visual = new THREE.Group(), renderer = new SpriteFrameRenderer(visual);
  renderer.showShared({ geometry: new THREE.BufferGeometry(), materials: [source], visible: true });
  renderer.setDepthOffset(true);
  const [offset] = (visual.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>).material;

  expect(tinted).not.toBe(source);
  for (const material of [source, tinted, bloom, offset]) {
    const vertex = compiledVertex(material);
    expect(vertex.match(/spriteOriginClip =/g)).toHaveLength(1);
    expect(material.customProgramCacheKey()).toContain('spriteOrigin');
  }
  renderer.dispose(); dresser.dispose(); source.map?.dispose(); source.dispose();
});

it('picks a flat sprite off the screen centre at the texel drawn under the pointer', () => {
  const camera = new THREE.PerspectiveCamera(35, 16 / 9, .1, 1000);
  camera.position.set(0, 30, 30); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), [new THREE.MeshBasicMaterial()]);
  mesh.geometry.addGroup(0, Infinity, 0); // Sprite frames draw their atlases as material groups.
  mesh.raycast = raycastSprite;
  mesh.rotation.x = -Math.PI / 2; mesh.position.set(14, 0, 4); mesh.updateMatrixWorld();
  // Where the shader draws local point (1.2, 1.2): the projected origin plus its view-space offset over the origin's depth.
  const modelView = new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld);
  const origin = new THREE.Vector3().applyMatrix4(modelView), point = new THREE.Vector3(1.2, 1.2, 0).applyMatrix4(modelView);
  const projection = camera.projectionMatrix.elements, w = -origin.z;
  const drawn = new THREE.Vector2(
    (projection[0] * origin.x + projection[8] * origin.z) / w + projection[0] * (point.x - origin.x) / w,
    (projection[5] * origin.y + projection[9] * origin.z) / w + projection[5] * (point.y - origin.y) / w);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(drawn, camera);
  const hits: THREE.Intersection[] = [];
  mesh.raycast(raycaster, hits);
  expect(hits).toHaveLength(1);
  expect(hits[0].uv!.x).toBeCloseTo((1.2 + 2) / 4, 4);
  expect(hits[0].uv!.y).toBeCloseTo((1.2 + 2) / 4, 4);
  // The full-perspective position of that point is a different texel of the drawn sprite.
  const perspective = point.clone().applyMatrix4(camera.projectionMatrix);
  raycaster.setFromCamera(new THREE.Vector2(perspective.x, perspective.y), camera);
  hits.length = 0; mesh.raycast(raycaster, hits);
  expect(Math.abs((hits[0]?.uv?.x ?? 0) - .8)).toBeGreaterThan(.01);
  mesh.geometry.dispose();
});

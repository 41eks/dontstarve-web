import * as THREE from 'three';
import { mouseTargets } from '../../prefab/src/mouseTargets';
import { intersectSpriteEntities } from '../../stategraphs/src/pointerRaycaster';

/** Aim real mouse input at opaque artwork, including instanced proxies and skins with transparent centres. */
export function spriteScreenPoint(model: THREE.Object3D, camera: THREE.Camera, renderer: THREE.WebGLRenderer) {
  model.updateWorldMatrix(true, true); camera.updateMatrixWorld();
  const mesh = model.getObjectByProperty('isMesh', true) as THREE.Mesh;
  const geometry = mesh.geometry, vertices = geometry.getAttribute('position'), indices = geometry.getIndex()!;
  const points: { point: THREE.Vector3; area: number }[] = [];
  for (let index = 0; index < geometry.drawRange.count; index += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(vertices, indices.getX(index));
    const b = new THREE.Vector3().fromBufferAttribute(vertices, indices.getX(index + 1));
    const c = new THREE.Vector3().fromBufferAttribute(vertices, indices.getX(index + 2));
    const area = b.clone().sub(a).cross(c.clone().sub(a)).lengthSq();
    for (const weights of [[1 / 3, 1 / 3, 1 / 3], [.6, .2, .2], [.2, .6, .2], [.2, .2, .6]]) {
      points.push({ point: mesh.localToWorld(a.clone().multiplyScalar(weights[0]).addScaledVector(b, weights[1]).addScaledVector(c, weights[2])), area });
    }
  }
  points.sort((a, b) => b.area - a.area);
  const raycaster = new THREE.Raycaster(), rect = renderer.domElement.getBoundingClientRect();
  const candidates = [...mouseTargets].map(entity => entity.model);
  let fallback: { x: number; y: number } | undefined;
  const hitsModel = (x: number, y: number) => {
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
    let target = intersectSpriteEntities(raycaster, candidates)[0]?.object;
    while (target && target !== model) target = target.parent ?? undefined;
    return target === model;
  };
  for (const { point } of points) {
    point.project(camera);
    if (Math.abs(point.x) >= 1 || Math.abs(point.y) >= 1) continue;
    // Chromium delivers float32 pointer coordinates; validate the same ray that the real event will use.
    const screen = { x: Math.fround(rect.left + (point.x + 1) * rect.width / 2),
      y: Math.fround(rect.top + (1 - point.y) * rect.height / 2) };
    const x = (screen.x - rect.left) * 2 / rect.width - 1, y = 1 - (screen.y - rect.top) * 2 / rect.height;
    if (!hitsModel(x, y)) continue;
    fallback ??= screen;
    if ([[-1, -1], [-1, 1], [1, -1], [1, 1]].every(([dx, dy]) => hitsModel(x + dx * 2 / rect.width, y + dy * 2 / rect.height))) return screen;
  }
  if (fallback) return fallback;
  throw new Error(`No opaque mouse target for ${model.name}`);
}

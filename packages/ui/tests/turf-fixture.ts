import * as THREE from 'three';
import { createTurfGround } from '../../prefab/src/turf';
import { createPigKingSetPiece } from '../../prefab/src/setpieces/pigking';
import { GroundItemAssets, createGroundItemSprite } from '../../prefab/src/groundItems';

export async function checkTurfOcclusion() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0000ff);
  scene.add(new THREE.AmbientLight(0xffffff, Math.PI));
  const ground = await createTurfGround({ assetBaseUrl: '/dst/data', noiseTexture: 'Ground_noise_deciduous' });
  const feet = new THREE.Vector3(6, 0, 6);
  const piece = await createPigKingSetPiece({ assetBaseUrl: '/dst/data', position: feet });
  piece.pigKing.standee.visible = false;
  // Solid colours make the complete framebuffer comparable to a sprite-only
  // reference. Add the overlay first to exercise explicit terrain ordering.
  for (const [mesh, color] of [[ground, 0x00ff00], [piece.turf, 0x0000ff]] as const) {
    const material = mesh.material as THREE.MeshLambertMaterial;
    material.map = null;
    material.color.set(color);
    material.needsUpdate = true;
  }
  scene.add(piece.group, ground);
  const renderer = new THREE.WebGLRenderer();
  const target = new THREE.WebGLRenderTarget(256, 256);
  renderer.setRenderTarget(target);
  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 200);
  const reference = new Uint8Array(256 * 256 * 4);
  const actual = new Uint8Array(reference.length);
  const assets = new GroundItemAssets('/dst/data/anim');
  const failures: string[] = [];
  let comparisons = 0;
  try {
    for (const id of ['meatballs', 'log', 'torch', 'wall_stone_item']) {
      const sprite = await createGroundItemSprite(assets, id);
      sprite.model.position.copy(feet);
      scene.add(sprite.model);
      for (const pitch of [30, 60]) for (const heading of [0, 45, 90]) {
        const p = THREE.MathUtils.degToRad(pitch), h = THREE.MathUtils.degToRad(heading);
        camera.position.copy(feet).add(new THREE.Vector3(
          Math.cos(p) * Math.cos(h) * 50, Math.sin(p) * 50, Math.cos(p) * Math.sin(h) * 50,
        ));
        camera.lookAt(feet);
        sprite.model.quaternion.copy(camera.quaternion);
        ground.visible = piece.turf.visible = false;
        renderer.render(scene, camera);
        renderer.readRenderTargetPixels(target, 0, 0, 256, 256, reference);
        ground.visible = piece.turf.visible = true;
        renderer.render(scene, camera);
        renderer.readRenderTargetPixels(target, 0, 0, 256, 256, actual);
        comparisons++;
        if (actual.some((value, i) => value !== reference[i])) failures.push(`${id}:${pitch}:${heading}`);
      }
      sprite.dispose();
    }
  } finally {
    target.dispose();
    renderer.dispose();
  }
  return { comparisons, failures };
}

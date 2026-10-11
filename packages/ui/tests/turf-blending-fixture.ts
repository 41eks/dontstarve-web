import * as THREE from 'three';
import { TurfMap, WORLD_TILES } from '../../prefab/src/turfMap';
import { createTurfGround } from '../../prefab/src/turf';

export async function checkTurfBlending() {
  const map = new TurfMap(120);
  const ground = await createTurfGround({ assetBaseUrl: '/dst/data',
    noiseTexture: 'Ground_noise_deciduous', tileAtlas: 'DECIDUOUS', size: 120 });
  const visual = await map.createVisual('/dst/data');
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, Math.PI), ground, visual);
  const renderer = new THREE.WebGLRenderer();
  renderer.setSize(480, 480);
  document.body.append(renderer.domElement);
  const camera = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.1, 100);
  camera.position.set(6, 50, 6);
  camera.up.set(0, 0, -1);
  camera.lookAt(6, 0, 6);
  const target = new THREE.WebGLRenderTarget(480, 480);
  renderer.setRenderTarget(target);
  const pixels = () => {
    renderer.render(scene, camera);
    const result = new Uint8Array(480 * 480 * 4);
    renderer.readRenderTargetPixels(target, 0, 0, 480, 480, result);
    return result;
  };
  map.dig({ x: 6, z: 6 });
  const edge = visual.getObjectByName('TurfBlend:DECIDUOUS')!;
  edge.visible = false;
  const withoutEdges = pixels();
  edge.visible = true;
  const blended = pixels();
  const pixel = (buffer: Uint8Array, x: number, y: number) => [...buffer.slice((y * 480 + x) * 4, (y * 480 + x) * 4 + 4)];
  const equal = (a: number[], b: number[]) => a.every((value, i) => value === b[i]);
  const centerUnchanged = equal(pixel(withoutEdges, 240, 240), pixel(blended, 240, 240));
  const edgeChanged = !equal(pixel(withoutEdges, 125, 240), pixel(blended, 125, 240));
  const outsideUnchanged = equal(pixel(withoutEdges, 100, 240), pixel(blended, 100, 240));
  const changedPixels = blended.reduce((count, value, i) => count + Number(i % 4 === 0
    && (value !== withoutEdges[i] || blended[i + 1] !== withoutEdges[i + 1] || blended[i + 2] !== withoutEdges[i + 2])), 0);
  // Show a larger patch, a stepped boundary and a dug woodfloor hole for inspection.
  for (const [x, z] of [[18, 6], [6, 18], [18, 18], [30, 6], [-6, 6]]) map.dig({ x, z });
  for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) {
    map.setOriginalTile({ x: -30 + x * 12, z: -30 + z * 12 }, WORLD_TILES.WOODFLOOR);
  }
  map.dig({ x: -18, z: -18 });
  camera.left = camera.bottom = -60;
  camera.right = camera.top = 60;
  camera.position.set(0, 50, 0);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  renderer.setRenderTarget(null);
  renderer.render(scene, camera);
  target.dispose();
  return { centerUnchanged, edgeChanged, outsideUnchanged, changedPixels };
}

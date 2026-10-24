import * as THREE from 'three';
import { createSignal, type ClockState } from '@dontstarve-web/signals';
import { TurfMap, WORLD_TILES } from '../../prefab/src/turfMap';
import { createTurfGround } from '../../prefab/src/turf';
import { SnowEffect } from '../../prefab/src/snow';
import { renderScenePasses } from '@dontstarve-web/animation/sceneRenderPass';

export async function checkOceanRendering() {
  const tiles = [];
  for (let row = -5; row < 5; row++) for (let col = 0; col < 5; col++) {
    tiles.push({ col, row, tileId: WORLD_TILES.OCEAN_COASTAL });
  }
  const map = new TurfMap(120, tiles);
  const ground = await createTurfGround({ assetBaseUrl: '/dst/data', noiseTexture: 'Ground_noise_deciduous',
    tileAtlas: 'DECIDUOUS', size: 120 });
  const visual = await map.createVisual('/dst/data');
  const clock = createSignal<ClockState>({ phase: 'day', timeinphase: 0 });
  map.bindOceanClock(clock);
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, Math.PI), ground, visual);
  const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
  renderer.setSize(480, 480);
  const camera = new THREE.OrthographicCamera(-24, 24, 24, -24, 0.1, 100);
  camera.position.set(6, 50, 6);
  camera.up.set(0, 0, -1);
  camera.lookAt(6, 0, 6);
  const target = new THREE.WebGLRenderTarget(480, 480);
  renderer.setRenderTarget(target);
  const pixels = () => {
    renderScenePasses(renderer, scene, camera);
    renderer.render(scene, camera);
    const result = new Uint8Array(480 * 480 * 4);
    renderer.readRenderTargetPixels(target, 0, 0, 480, 480, result);
    return result;
  };
  const pixel = (buffer: Uint8Array, x: number, y: number) => [...buffer.slice((y * 480 + x) * 4, (y * 480 + x) * 4 + 4)];
  const withoutOcean = (() => { visual.visible = false; const result = pixels(); visual.visible = true; return result; })();
  const daytime = pixels();
  map.update(30);
  const moving = pixels();
  clock.set({ phase: 'dusk', timeinphase: 0 });
  await new Promise(requestAnimationFrame);
  map.update(10);
  const dusk = pixels();
  const snow = new SnowEffect({ scene, dataBaseUrl: '/dst/data', getFocus: () => new THREE.Vector3(6, 0, 6),
    camera, rate: createSignal(0), cover: createSignal(3), groundSize: 120,
    groundOverlay: map });
  for (let i = 0; i < 100 && !scene.getObjectByName('SnowGroundOverlay'); i++) await new Promise(resolve => setTimeout(resolve, 10));
  if (!scene.getObjectByName('SnowGroundOverlay')) throw new Error('Snow ground overlay did not load');
  const snowy = pixels();
  let coastalSnowPixels = 0;
  // x=180 is the tile boundary at world x=0. The positive-X strip belongs to
  // the ocean grid but contains the land atlas's fading shoreline coverage.
  for (let y = 180; y < 300; y++) for (let x = 180; x < 220; x++) {
    const index = (y * 480 + x) * 4;
    if (Math.abs(snowy[index] - dusk[index]) + Math.abs(snowy[index + 1] - dusk[index + 1])
      + Math.abs(snowy[index + 2] - dusk[index + 2]) > 3) coastalSnowPixels++;
  }
  const result = { landBefore: pixel(withoutOcean, 60, 240), landAfter: pixel(daytime, 60, 240),
    oceanBefore: pixel(withoutOcean, 240, 240), oceanAfter: pixel(daytime, 240, 240),
    oceanMoved: pixel(moving, 240, 240), oceanDusk: pixel(dusk, 240, 240),
    oceanSnow: pixel(snowy, 240, 240), snowyLand: pixel(snowy, 60, 240), coastalSnowPixels };
  const overlay = scene.getObjectByName('SnowGroundOverlay') as THREE.Mesh;
  const previousGeometry = overlay.geometry;
  let previousGeometryReleased = 0;
  previousGeometry.addEventListener('dispose', () => previousGeometryReleased++);
  map.dig(new THREE.Vector3(-6, 0, 6));
  const coastUpdated = overlay.geometry !== previousGeometry;
  const materials = Array.isArray(overlay.material) ? overlay.material : [overlay.material];
  const borrowedAtlases = new Set<THREE.Texture>(materials.flatMap(material => material.userData.prewarmTextures));
  let borrowedAtlasesReleased = 0;
  for (const atlas of borrowedAtlases) atlas.addEventListener('dispose', () => borrowedAtlasesReleased++);
  renderer.setRenderTarget(null);
  document.body.append(renderer.domElement);
  renderScenePasses(renderer, scene, camera);
  renderer.render(scene, camera);
  snow.dispose();
  const atlasesPreserved = borrowedAtlasesReleased === 0;
  map.dispose();
  const terrainReleasedAtlases = borrowedAtlasesReleased === borrowedAtlases.size;
  ground.geometry.dispose();
  (ground.material as THREE.Material).dispose();
  target.dispose();
  renderer.dispose();
  return { ...result, coastUpdated, previousGeometryReleased, atlasesPreserved, terrainReleasedAtlases };
}

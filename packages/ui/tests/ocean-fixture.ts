import * as THREE from 'three';
import { createSignal, type ClockState } from '@dontstarve-web/signals';
import { TurfMap, WORLD_TILES } from '../../prefab/src/turfMap';
import { createTurfGround } from '../../prefab/src/turf';
import { GroundDisplay } from '../../display/src/groundDisplay';
import { SnowEffect } from '../../prefab/src/snow';
import { renderSceneWithPasses } from '@dontstarve-web/animation/sceneRenderPass';

export async function checkOceanRendering() {
  const tiles = [];
  for (let row = -5; row < 5; row++) for (let col = 0; col < 5; col++) {
    tiles.push({ col, row, tileId: WORLD_TILES.OCEAN_COASTAL });
  }
  const map = new TurfMap(120, tiles);
  const ground = await createTurfGround({ assetBaseUrl: '/dst/data', noiseTexture: 'Ground_noise_deciduous',
    tileAtlas: 'DECIDUOUS', size: 120 });
  const visual = await map.createVisual('/dst/data');
  const display = new GroundDisplay(map, '/dst/data');
  await display.prepare();
  const clock = createSignal<ClockState>({ phase: 'day', timeinphase: 0 });
  map.bindOceanClock(clock);
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, Math.PI), ground, visual, display.root);
  const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
  renderer.setSize(480, 480);
  const camera = new THREE.OrthographicCamera(-24, 24, 24, -24, 0.1, 100);
  camera.position.set(6, 50, 6);
  camera.up.set(0, 0, -1);
  camera.lookAt(6, 0, 6);
  const target = new THREE.WebGLRenderTarget(480, 480);
  renderer.setRenderTarget(target);
  let matrixUpdates = 0;
  const updateMatrixWorld = scene.updateMatrixWorld;
  scene.updateMatrixWorld = function (force) {
    matrixUpdates++;
    updateMatrixWorld.call(this, force);
  };
  const matrixUpdatesPerRender: number[] = [];
  const pixels = () => {
    const before = matrixUpdates;
    renderSceneWithPasses(renderer, scene, camera);
    matrixUpdatesPerRender.push(matrixUpdates - before);
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
    groundOverlay: display });
  // Snow declares its overlay; the ground display loads it and draws it per chunk and layer.
  const overlayMeshes = () => display.root.children.filter(object => object.name === 'GroundOverlay:snow') as THREE.Mesh[];
  for (let i = 0; i < 100 && !overlayMeshes().some(mesh => mesh.visible); i++) await new Promise(resolve => setTimeout(resolve, 10));
  if (!overlayMeshes().some(mesh => mesh.visible)) throw new Error('Snow ground overlay did not load');
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
  const previousGeometries = overlayMeshes().map(mesh => mesh.geometry);
  let released = 0;
  for (const geometry of previousGeometries) geometry.addEventListener('dispose', () => released++);
  map.dig(new THREE.Vector3(-6, 0, 6));
  // The edit rebuilds the overlay of the chunk it reaches; this map is a single chunk.
  const coastUpdated = overlayMeshes().length > 0 && overlayMeshes().every(mesh => !previousGeometries.includes(mesh.geometry));
  const previousGeometryReleased = released === previousGeometries.length ? 1 : 0;
  const materials = overlayMeshes().map(mesh => mesh.material as THREE.Material);
  const borrowedAtlases = new Set<THREE.Texture>(materials.flatMap(material => material.userData.prewarmTextures));
  let borrowedAtlasesReleased = 0;
  for (const atlas of borrowedAtlases) atlas.addEventListener('dispose', () => borrowedAtlasesReleased++);
  renderer.setRenderTarget(null);
  document.body.append(renderer.domElement);
  renderSceneWithPasses(renderer, scene, camera);
  snow.dispose();
  const atlasesPreserved = borrowedAtlasesReleased === 0;
  // The ground display owns the layer art the snow overlay borrows.
  display.dispose(); map.dispose();
  const terrainReleasedAtlases = borrowedAtlasesReleased === borrowedAtlases.size;
  ground.geometry.dispose();
  (ground.material as THREE.Material).dispose();
  target.dispose();
  renderer.dispose();
  return { ...result, coastUpdated, previousGeometryReleased, atlasesPreserved, terrainReleasedAtlases,
    matrixUpdatesPerRender };
}

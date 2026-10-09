import * as THREE from 'three';
import { DstLightingRenderer } from '../../../src/dstLighting';
import { GroundItemManager } from '../../../src/groundItems';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from '../../prefab/src/groundItems';
import { createLightbulbGroundSprite } from '../../prefab/src/lightbulb';
import { getPrefabLocalLight } from '../../prefab/src/localLight';
import { clockstate, seasonstate } from '@dontstarve-web/signals';

export async function checkLightbulbLighting() {
  clockstate.set({ phase: 'night', timeinphase: 0 });
  seasonstate.set({ season: 'spring', progress: 0.5 });
  const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
  renderer.setSize(400, 400);
  document.body.append(renderer.domElement);
  const lighting = await DstLightingRenderer.create(renderer, '/dst/data/images/colour_cubes');
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, Math.PI));
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial()));
  const camera = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.1, 100);
  camera.position.set(0, 40, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const pixel = new Uint8Array(4);
  const sample = (x: number, z = -1.25) => {
    lighting.render(scene, camera);
    const point = new THREE.Vector3(x, 0, z).project(camera);
    const gl = renderer.getContext();
    gl.readPixels(Math.floor((point.x + 1) * 200), Math.floor((point.y + 1) * 200), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return pixel[0] + pixel[1] + pixel[2];
  };
  const baseline = sample(0);
  const assets = new GroundItemAssets('/dst/data/anim');
  const bulb = await createLightbulbGroundSprite(assets);
  scene.add(bulb.model);
  bulb.model.quaternion.copy(camera.quaternion);
  const parameters = getPrefabLocalLight(bulb.model);
  const glowing = { near: sample(0), far: sample(6) };
  bulb.setLit(false);
  const disabled = sample(0);
  bulb.setLit(true);
  const reenabled = sample(0);
  bulb.dispose();
  const disposed = sample(0);
  let acceptsPickup = false;
  const manager = new GroundItemManager(scene, camera, renderer, '/missing-atlas.zip', () => acceptsPickup, '/dst/data/anim', new THREE.Group());
  const definition = { itemId: 'lightbulb', name: '荧光果', icon: 'missing.tex', count: 1 };
  const failedDrop = await manager.drop(definition, new THREE.Vector3(5, 20, 0), () => false);
  const failedDropBrightness = sample(5);
  await manager.drop(definition, new THREE.Vector3(5, 20, 0), () => true);
  manager.update(0.05, camera.quaternion);
  const dropped = sample(5);
  const click = () => {
    const { object: model } = manager.renderEntities[0];
    model.updateWorldMatrix(true, true);
    const mesh = model.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry>;
    const bounds = new THREE.Box3();
    const vertices = mesh.geometry.getAttribute('position');
    for (let i = 0; i < mesh.geometry.drawRange.count / 6 * 4; i++)
      bounds.expandByPoint(mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(vertices, i)));
    const point = bounds.getCenter(new THREE.Vector3()).project(camera);
    const canvas = renderer.domElement.getBoundingClientRect();
    renderer.domElement.dispatchEvent(new MouseEvent('pointerdown', {
      button: 0, clientX: canvas.left + (point.x + 1) * canvas.width / 2,
      clientY: canvas.top + (1 - point.y) * canvas.height / 2,
    }));
  };
  click();
  const failedPickupCount = manager.exportRecords().length;
  const failedPickupBrightness = sample(5);
  const saved = manager.exportRecords()[0];
  acceptsPickup = true;
  click();
  const pickedUp = { count: manager.exportRecords().length, brightness: sample(5) };
  const restored = await manager.spawnFromSave('restored-bulb', definition, new THREE.Vector3(5, 0, 0));
  const restoredBrightness = sample(5);
  const restoredLit = !!getPrefabLocalLight(restored);
  lighting.dispose();
  renderer.dispose();
  return { baseline, parameters, glowing, disabled, reenabled, disposed,
    failedDrop, failedDropBrightness, dropped, failedPickupCount, failedPickupBrightness,
    saved, pickedUp, restoredBrightness, restoredLit, source: GROUND_ITEM_DEFINITIONS.lightbulb };
}

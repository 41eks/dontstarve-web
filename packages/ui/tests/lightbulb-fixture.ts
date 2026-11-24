import { prefabDisplay } from '../../display/src';
import { fixturePickup } from './pickup-fixture';
import * as THREE from 'three';
import type { PrefabDisplay } from '@dontstarve-web/display';
import { DstLightingRenderer } from '../../../src/dstLighting';
import { itemAt, ItemWorldFixture } from '../../animation/tests/itemWorldFixture';
import { createPickupInventory } from '../../animation/tests/pickupFixture';
import { GROUND_ITEM_DEFINITIONS } from '../../prefab/src/groundItems';
import { prefabInstance } from '../../prefab/src/prefabInstance';

/** The inst.Light a model's entity declares. */
const getDeclaredLight = (model: THREE.Object3D) => prefabInstance(model)?.light.peek();
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
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  // Lights reach the display list after the declaration settles.
  const sample = async (x: number, z = -1.25) => {
    await settle();
    lighting.render(scene, camera);
    const point = new THREE.Vector3(x, 0, z).project(camera);
    const gl = renderer.getContext();
    gl.readPixels(
      Math.floor((point.x + 1) * 200),
      Math.floor((point.y + 1) * 200),
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixel,
    );
    return pixel[0] + pixel[1] + pixel[2];
  };
  const baseline = await sample(0);
  // A bulb lying in the world lights it; held (RemoveFromScene) it does not.
  const bulbInventory = createPickupInventory();
  const bulbs = new ItemWorldFixture(
    scene,
    camera,
    renderer,
    '/missing-atlas.zip',
    bulbInventory,
    '/dst/data/anim',
    new THREE.Group(),
  );
  const bulbModel = bulbs.spawnFromSave(
    'bulb',
    { itemId: 'lightbulb', name: '荧光果', icon: 'missing.tex', count: 1 },
    new THREE.Vector3(),
  );
  const bulb = itemAt(bulbModel);
  await (prefabDisplay(bulbModel) as PrefabDisplay).artLoaded();
  bulbModel.quaternion.copy(camera.quaternion);
  const parameters = getDeclaredLight(bulbModel);
  const glowing = { near: await sample(0), far: await sample(6) };
  bulb.RemoveFromScene();
  const disabled = await sample(0);
  bulb.ReturnToScene();
  const reenabled = await sample(0);
  bulb.remove();
  const disposed = await sample(0);
  bulbs.dispose();
  bulbInventory.dispose();
  const pickup = fixturePickup(scene, camera, renderer);
  pickup.setAllowed(false);
  const manager = new ItemWorldFixture(
    scene,
    camera,
    renderer,
    '/missing-atlas.zip',
    pickup.inventory,
    '/dst/data/anim',
    new THREE.Group(),
  );
  const definition = { itemId: 'lightbulb', name: '荧光果', icon: 'missing.tex', count: 1 };
  const failedDrop = await manager.drop(definition, new THREE.Vector3(5, 20, 0), () => false);
  const failedDropBrightness = await sample(5);
  await manager.drop(definition, new THREE.Vector3(5, 20, 0), () => true);
  manager.update(0.05, camera.quaternion);
  // The dropped bulb is a billboard; face it to the fixture's top-down camera so the click can hit its art.
  const droppedModel = manager.reskinTargets[0].transform.model;
  await (prefabDisplay(droppedModel) as PrefabDisplay).artLoaded();
  await new Promise(resolve => setTimeout(resolve, 0));
  droppedModel.quaternion.copy(camera.quaternion);
  manager.update(0, camera.quaternion);
  const dropped = await sample(5);
  const click = () => {
    const model = manager.reskinTargets[0].transform.model;
    model.updateWorldMatrix(true, true);
    const mesh = model.getObjectByProperty('isMesh', true) as THREE.Mesh<THREE.BufferGeometry>;
    const bounds = new THREE.Box3();
    const vertices = mesh.geometry.getAttribute('position');
    for (let i = 0; i < (mesh.geometry.drawRange.count / 6) * 4; i++) {
      bounds.expandByPoint(mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(vertices, i)));
    }
    const point = bounds.getCenter(new THREE.Vector3()).project(camera);
    const canvas = renderer.domElement.getBoundingClientRect();
    const position = {
      clientX: canvas.left + ((point.x + 1) * canvas.width) / 2,
      clientY: canvas.top + ((1 - point.y) * canvas.height) / 2,
    };
    pickup.updatePointer(position);
    renderer.domElement.dispatchEvent(new PointerEvent('pointerdown', { button: 0, ...position }));
  };
  click();
  pickup.settle();
  const failedPickupCount = manager.exportRecords().length;
  const failedPickupBrightness = await sample(5);
  const saved = manager.exportRecords()[0];
  pickup.setAllowed(true);
  click();
  pickup.settle();
  const pickedUp = { count: manager.exportRecords().length, brightness: await sample(5) };
  const restored = await manager.spawnFromSave('restored-bulb', definition, new THREE.Vector3(5, 0, 0));
  const restoredBrightness = await sample(5);
  const restoredLit = !!getDeclaredLight(restored);
  pickup.dispose();
  manager.dispose();
  lighting.dispose();
  renderer.dispose();
  return {
    baseline,
    parameters,
    glowing,
    disabled,
    reenabled,
    disposed,
    failedDrop,
    failedDropBrightness,
    dropped,
    failedPickupCount,
    failedPickupBrightness,
    saved,
    pickedUp,
    restoredBrightness,
    restoredLit,
    source: GROUND_ITEM_DEFINITIONS.lightbulb,
  };
}

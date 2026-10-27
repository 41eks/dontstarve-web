import { fixturePickup } from './pickup-fixture';
import * as THREE from 'three';
import type { PrefabDisplay } from '@dontstarve-web/display';
import { GroundItemManager } from '../../../src/groundItems';
import { prewarmScenePasses, renderSceneWithPasses } from '../../animation/src/sceneRenderPass';

export async function checkGroundItemPickup() {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  camera.position.set(0, 0, 20);
  camera.updateMatrixWorld();
  const renderer = new THREE.WebGLRenderer({ alpha: true });
  renderer.setSize(320, 320);
  document.body.append(renderer.domElement);
  const pickedUp: string[] = [];
  const player = new THREE.Group();
  const pickup = fixturePickup(scene, camera, renderer, player);
  pickup.inventory.subscribeReceived(received => received.forEach(item => pickedUp.push(item.itemId)));
  const manager = new GroundItemManager(scene, camera, renderer, '/missing-inventory-atlas.zip',
    pickup.inventory, '/dst/data/anim', player);
  // Invalid UI icon/atlas deliberately proves every supported item uses its world art.
  const definition = (id: string) => ({ itemId: id, name: id, icon: 'missing.tex', count: 1 });
  // Split builds, overridden food symbols, materials, walls and tools.
  const common = ['torch', 'meatballs', 'log', 'wall_stone_item', 'hammer'];
  const failures: string[] = [];
  let blockedDistantPickups = 0;
  for (const id of common) {
    player.position.set(9.01, 0, 0);
    const dropped = await manager.drop(definition(id), new THREE.Vector3(0, 9, 0), () => true);
    manager.update(0.05, camera.quaternion);
    const { model } = manager.reskinTargets[0];
    await (model.userData.display as PrefabDisplay).artLoaded();
    const mesh = model.getObjectByProperty('isMesh', true) as THREE.Mesh<THREE.BufferGeometry>;
    mesh.updateWorldMatrix(true, false);
    const box = new THREE.Box3();
    const positions = mesh.geometry.getAttribute('position');
    for (let vertex = 0; vertex < mesh.geometry.drawRange.count / 6 * 4; vertex++) {
      box.expandByPoint(mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, vertex)));
    }
    const point = box.getCenter(new THREE.Vector3()).project(camera);
    await prewarmScenePasses(renderer, scene, camera);
    renderSceneWithPasses(renderer, scene, camera);
    const bounds = renderer.domElement.getBoundingClientRect();
    const click = () => renderer.domElement.dispatchEvent(new MouseEvent('pointerdown', {
      clientX: bounds.left + (point.x + 1) * bounds.width / 2,
      clientY: bounds.top + (1 - point.y) * bounds.height / 2, button: 0,
    }));
    click();
    if (manager.exportRecords().length === 1 && !pickedUp.includes(id)) blockedDistantPickups++;
    else failures.push(`${id}:distant pickup`);
    player.position.set(9, 100, 0);
    pickup.settle();
    if (!dropped || manager.exportRecords().length || pickedUp.at(-1) !== id) failures.push(id);
  }
  let inventoryMutations = 0;
  let failedLoad = false;
  try {
    await manager.drop({ ...definition('torch'), skinId: 'invalid-skin' }, new THREE.Vector3(),
      () => { inventoryMutations++; return true; });
  } catch { failedLoad = true; }
  const failedTransfer = await manager.drop(definition('meatballs'), new THREE.Vector3(), () => false);
  const remaining = manager.exportRecords().length;
  await manager.spawnFromSave('restore-native', definition('meatballs'), new THREE.Vector3(2, 0.25, 3));
  const restoredFoot = manager.exportRecords()[0].transform.position;
  pickup.dispose(); manager.dispose();
  renderer.dispose();
  return { failures, pickedUp, blockedDistantPickups, failedLoad, inventoryMutations, failedTransfer, remaining, restoredFoot };
}

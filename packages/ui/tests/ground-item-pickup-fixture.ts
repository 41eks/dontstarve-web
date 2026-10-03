import * as THREE from 'three';
import { GroundItemManager } from '../../../src/groundItems';

export async function checkGroundItemPickup() {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  camera.position.set(0, 0, 20);
  camera.updateMatrixWorld();
  const renderer = new THREE.WebGLRenderer({ alpha: true });
  renderer.setSize(320, 320);
  document.body.append(renderer.domElement);
  const pickedUp: string[] = [];
  const manager = new GroundItemManager(scene, camera, renderer, '/missing-inventory-atlas.zip',
    (item) => { pickedUp.push(item.itemId); return true; }, '/dst/data/anim');
  // Invalid UI icon/atlas deliberately proves every supported item uses its world art.
  const definition = (id: string) => ({ itemId: id, name: id, icon: 'missing.tex', count: 1 });
  const common = ['torch', 'lantern', 'lightbulb', 'yellowstaff', 'meatballs', 'cutgrass', 'twigs', 'log', 'rocks', 'goldnugget',
    'gears', 'charcoal', 'pigskin', 'cutstone', 'rope',
    'wall_stone_item', 'wall_wood_item', 'wall_hay_item', 'wall_ruins_item',
    'wall_moonrock_item', 'wall_dreadstone_item', 'wall_scrap_item', 'axe', 'hammer'];
  const failures: string[] = [];
  for (const id of common) {
    const dropped = await manager.drop(definition(id), new THREE.Vector3(0, 9, 0), () => true);
    manager.update(0.05, camera.quaternion);
    const { object: model } = manager.renderEntities[0];
    const mesh = model.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry>;
    mesh.updateWorldMatrix(true, false);
    const box = new THREE.Box3();
    const positions = mesh.geometry.getAttribute('position');
    for (let vertex = 0; vertex < mesh.geometry.drawRange.count / 6 * 4; vertex++) {
      box.expandByPoint(mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, vertex)));
    }
    const point = box.getCenter(new THREE.Vector3()).project(camera);
    renderer.render(scene, camera);
    const bounds = renderer.domElement.getBoundingClientRect();
    renderer.domElement.dispatchEvent(new MouseEvent('pointerdown', {
      clientX: bounds.left + (point.x + 1) * bounds.width / 2,
      clientY: bounds.top + (1 - point.y) * bounds.height / 2, button: 0,
    }));
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
  renderer.dispose();
  return { failures, pickedUp, failedLoad, inventoryMutations, failedTransfer, remaining, restoredFoot };
}

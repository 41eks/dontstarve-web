import * as THREE from 'three';
import { HAT_IDS, HAT_ITEM_SPECS, HAT_SKIN_SPECS, HAT_DEFINITIONS } from '@three-roaming/prefab/hats';
import { GroundItemManager } from '../../../src/groundItems';

export async function checkGroundHats() {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  camera.position.set(0, 0, 20);
  camera.updateMatrixWorld();
  const renderer = new THREE.WebGLRenderer({ alpha: true });
  renderer.setSize(320, 320);
  document.body.append(renderer.domElement);
  const pickedUp: string[] = [];
  let allowPickup = true;
  const manager = new GroundItemManager(scene, camera, renderer, '/dst/data/databundles/images.zip',
    (item) => { if (!allowPickup) return false; pickedUp.push(item.itemId); return true; }, '/dst/data/anim');
  const definition = (id: string, skinId?: string) => ({
    itemId: id, count: 1, ...(skinId ? { skinId } : {}),
    ...(skinId ? HAT_SKIN_SPECS[skinId] : HAT_ITEM_SPECS[id]),
  });
  const failedDrop = await manager.drop(definition('strawhat'), new THREE.Vector3(), () => false);
  const rollbackCount = manager.exportRecords().length;
  await manager.drop(definition('strawhat'), new THREE.Vector3(0, 9, 0), () => true);
  manager.update(0.1, camera.quaternion);
  const model = manager.renderEntities[0].object;
  const foot = manager.exportRecords()[0].transform.position;
  const mesh = model.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry>;
  mesh.updateWorldMatrix(true, false);
  const box = new THREE.Box3();
  const positions = mesh.geometry.getAttribute('position');
  for (let vertex = 0; vertex < mesh.geometry.drawRange.count / 6 * 4; vertex++) {
    box.expandByPoint(mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, vertex)));
  }
  const point = box.getCenter(new THREE.Vector3()).project(camera);
  const click = () => {
    renderer.render(scene, camera);
    const bounds = renderer.domElement.getBoundingClientRect();
    renderer.domElement.dispatchEvent(new MouseEvent('pointerdown', {
      clientX: bounds.left + (point.x + 1) * bounds.width / 2,
      clientY: bounds.top + (1 - point.y) * bounds.height / 2, button: 0,
    }));
  };
  allowPickup = false;
  click();
  const rejectedPickupCount = manager.exportRecords().length;
  allowPickup = true;
  click();
  const afterPickupCount = manager.exportRecords().length;
  const failures: string[] = [];
  for (const id of HAT_IDS) {
    const model = await manager.spawnFromSave(id, definition(id), new THREE.Vector3(30, 0, 0));
    const visual = model.children[0];
    const mesh = visual.children[0] as THREE.Mesh<THREE.BufferGeometry>;
    if (visual.children.length !== 1 || !mesh.isMesh || mesh.geometry.drawRange.count < 6) failures.push(id);
  }
  for (const [id, hat] of Object.entries(HAT_DEFINITIONS)) {
    for (const skinId of Object.keys(hat.skinArchives)) {
      const model = await manager.spawnFromSave(skinId, definition(id, skinId), new THREE.Vector3(30, 0, 0));
      const mesh = model.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry>;
      if (mesh.geometry.drawRange.count < 6) failures.push(skinId);
    }
  }
  const restoredPosition = new THREE.Vector3(3, 0.25, 4);
  await manager.spawnFromSave('restore-foot', definition('rabbithat'), restoredPosition);
  manager.update(0.1, camera.quaternion);
  const restoredFoot = manager.exportRecords().find(({ id }) => id === 'restore-foot')!.transform.position;
  const torch = await manager.spawnFromSave('torch-ground', {
    itemId: 'torch', name: '火炬', icon: 'torch.tex', count: 1,
  }, new THREE.Vector3(-6, 0, 0));
  const torchMesh = torch.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry>;
  const torchIsMesh = torchMesh.isMesh;
  const torchFoot = manager.exportRecords().find(({ id }) => id === 'torch-ground')!.transform.position;
  torchMesh.updateWorldMatrix(true, false);
  const torchBox = new THREE.Box3();
  const torchPositions = torchMesh.geometry.getAttribute('position');
  for (let vertex = 0; vertex < torchMesh.geometry.drawRange.count / 6 * 4; vertex++) {
    torchBox.expandByPoint(torchMesh.localToWorld(new THREE.Vector3().fromBufferAttribute(torchPositions, vertex)));
  }
  const iconPoint = torchBox.getCenter(new THREE.Vector3()).project(camera);
  renderer.render(scene, camera);
  const iconBounds = renderer.domElement.getBoundingClientRect();
  renderer.domElement.dispatchEvent(new MouseEvent('pointerdown', {
    clientX: iconBounds.left + (iconPoint.x + 1) * iconBounds.width / 2,
    clientY: iconBounds.top + (1 - iconPoint.y) * iconBounds.height / 2, button: 0,
  }));
  const torchPickedUp = !manager.exportRecords().some(({ id }) => id === 'torch-ground');
  renderer.dispose();
  return {
    failedDrop, rollbackCount, foot, isAnimatedMesh: mesh.isMesh, pickedUp,
    rejectedPickupCount, afterPickupCount, failures, restoredFoot, torchIsMesh, torchFoot, torchPickedUp,
  };
}

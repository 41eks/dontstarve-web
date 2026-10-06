import * as THREE from 'three';
import { GroundItemManager } from '../../../src/groundItems';
import { GROUND_ITEM_DEFINITIONS, GroundItemAssets } from '../../prefab/src/groundItems';
import { setSpriteEntityRenderOrder } from '../../animation/src/renderOrder';

export async function checkBernieGround() {
  let sanity = 1;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-20, 20, 40, -2, 0.1, 100);
  camera.position.set(0, 0, 50);
  camera.updateMatrixWorld();
  const renderer = new THREE.WebGLRenderer({ alpha: true });
  renderer.setSize(400, 400);
  document.body.append(renderer.domElement);
  const pickedUp: { itemId: string; skinId?: string; count: number }[] = [];
  const manager = new GroundItemManager(scene, camera, renderer, '/missing-inventory-atlas.zip',
    (item) => { pickedUp.push(item); return true; }, '/dst/data/anim', new THREE.Group(), undefined, undefined,
    { getSanityPercent: () => sanity });
  const assets = new GroundItemAssets('/dst/data/anim');
  const failures: string[] = [];
  const cases = [];
  const inventoryForms: string[] = [];
  const height = (model: THREE.Group) => {
    const mesh = model.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry>;
    mesh.updateWorldMatrix(true, false);
    const box = new THREE.Box3();
    const positions = mesh.geometry.getAttribute('position');
    for (let vertex = 0; vertex < mesh.geometry.drawRange.count / 6 * 4; vertex++) {
      box.expandByPoint(mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, vertex)));
    }
    return { box, height: box.max.y - box.min.y };
  };
  for (const skinId of [undefined, ...Object.keys(GROUND_ITEM_DEFINITIONS.bernie_inactive.skinArchives)]) {
    sanity = 1;
    const definition = { itemId: 'bernie_inactive', skinId, count: 1, name: '伯尼', icon: 'missing.tex' };
    await manager.drop(definition, new THREE.Vector3(0, 9, 0), () => true);
    const model = manager.renderEntities[0].object;
    model.addEventListener('onputininventory', () => inventoryForms.push(model.userData.prefab));
    const record = manager.exportRecords()[0];
    const transitions = [];
    for (const [percent, expected] of [[1, 'bernie_active'], [0.1, 'bernie_big'], [0.15, 'bernie_active'],
      [0.149, 'bernie_big'], [0.151, 'bernie_active'], [0.175, 'bernie_active']] as const) {
      sanity = percent;
      // Size changes now finish their source animation queue before settling.
      manager.update(0, camera.quaternion);
      for (let i = 0; model.userData.animation !== 'idle_loop' && i < 80; i++) {
        manager.update(0.05, camera.quaternion);
      }
      if (model.userData.animation !== 'idle_loop') failures.push('transition did not finish');
      if (manager.renderEntities[0].object !== model) failures.push('entity replaced');
      if (JSON.stringify(manager.exportRecords()[0]) !== JSON.stringify(record)) failures.push('record changed');
      if (model.userData.prefab !== expected) failures.push(`${percent}:${model.userData.prefab}`);
      setSpriteEntityRenderOrder(model, 42);
      const mesh = model.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
      if (model.children[0].children.length !== 1 || !mesh.isMesh) failures.push('unmerged sprite');
      if (!mesh.material.every((material) => material.forceSinglePass)) failures.push('double face pass');
      if (model.children[0].renderOrder !== 42) failures.push('wrong render group');
      transitions.push({ percent, prefab: model.userData.prefab, height: height(model).height });
    }
    // Draw every frame in both banks for the base and both actual skin builds.
    for (const [percent, archive, bank] of [[1, 'bernie.zip', 'bernie'], [0.1, 'bernie_big.zip', 'bernie_big']] as const) {
      sanity = percent;
      const parsed = await assets.loadAnimation(archive);
      const clip = parsed.animations.find((clip) => clip.name === 'idle_loop')!;
      for (let i = 0; i < Math.ceil(clip.frames.length / clip.frameRate / 0.05) + 1; i++) {
        manager.update(0.05, camera.quaternion);
        const mesh = model.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
        if (mesh.geometry.drawRange.count < 6) failures.push(`${bank}:empty frame`);
        if (skinId && !mesh.material.some((material) => material.name.includes(skinId))) failures.push(`${skinId}:skin unused`);
      }
    }
    renderer.render(scene, camera);
    const centre = height(model).box.getCenter(new THREE.Vector3()).project(camera);
    const bounds = renderer.domElement.getBoundingClientRect();
    renderer.domElement.dispatchEvent(new MouseEvent('pointerdown', {
      clientX: bounds.left + (centre.x + 1) * bounds.width / 2,
      clientY: bounds.top + (1 - centre.y) * bounds.height / 2, button: 0,
    }));
    if (manager.exportRecords().length !== 0) failures.push('pickup failed');
    cases.push({ skinId, transitions, savedItem: record.components.stack });
  }
  sanity = 0.1;
  const restored = await manager.spawnFromSave('e_bernie_restored', {
    itemId: 'bernie_inactive', skinId: 'bernie_cat', count: 1, name: '伯尼', icon: 'missing.tex',
  }, new THREE.Vector3(2, 0.25, 3));
  const restoredState = { prefab: restored.userData.prefab, record: manager.exportRecords()[0] };
  manager.dispose();
  assets.dispose();
  renderer.dispose();
  return { failures, cases, pickedUp, restoredState, inventoryForms };
}

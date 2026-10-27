import * as THREE from 'three';
import { GroundItemAssets, createResidentGroundItem, type ResidentGroundItem } from '../../prefab/src/groundItems';
import { renderSceneWithPasses } from '../../animation/src/sceneRenderPass';

export async function checkGroundItemInstancing() {
  const assets = new GroundItemAssets(), scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer();
  renderer.setSize(128, 128);
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, .1, 100);
  camera.position.z = 20;
  const items: ResidentGroundItem[] = [];
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const sample = () => {
    assets.instancedSprites.flush(renderer);
    renderSceneWithPasses(renderer, scene, camera);
    const colour = scene.getObjectByName('ArchiveSpriteInstances:colour') as THREE.InstancedMesh | undefined;
    return { calls: renderer.info.render.calls, count: colour?.count ?? 0 };
  };
  try {
    // Static held poses and split animation/build archives use the same instancing path as loops.
    for (let index = 0; index < 24; index++) {
      const item = createResidentGroundItem({ assets }, { itemId: 'torch' });
      await item.display.artLoaded();
      item.instance.position.set(index % 6 * 3 - 8, Math.floor(index / 6) * 3 - 5, 0);
      scene.add(item.visual.model);
      items.push(item);
      if (index === 0) sample();
    }
    const many = sample();
    const batch = scene.getObjectByName('ArchiveSpriteInstances:colour') as THREE.InstancedMesh;
    const texture = (batch.material as THREE.MeshBasicMaterial).map;
    items[0].instance.setActive(false);
    await tick();
    const asleep = sample();
    items[0].instance.setActive(true);
    // The cached archives still rebuild the resident sprite asynchronously.
    await tick();
    const awake = sample();
    const sameBatch = scene.getObjectByName('ArchiveSpriteInstances:colour') === batch;
    const sameTexture = (batch.material as THREE.MeshBasicMaterial).map === texture;
    const position = items[0].instance.position.toArray();
    items[0].visual.dispose();
    const removed = sample();
    for (const item of items.slice(1)) item.visual.dispose();
    const empty = sample();
    return { many, asleep, awake, sameBatch, sameTexture, position, removed, empty };
  } finally {
    for (const item of items) item.visual.dispose();
    assets.dispose(); renderer.dispose();
  }
}

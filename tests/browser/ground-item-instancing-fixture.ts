import * as THREE from 'three';
import { prefabDisplay } from '../../packages/display/src';
import { renderSceneWithPasses } from '../../packages/animation/src/sceneRenderPass';
import { itemAt, ItemWorldFixture } from '../fixtures/itemWorldFixture';
import { createPickupInventory } from '../fixtures/pickupFixture';
import type { ItemEntity } from '../../packages/inventory/src';

export async function checkGroundItemInstancing() {
  const scene = new THREE.Scene(),
    inventory = createPickupInventory();
  const world = new ItemWorldFixture(
    scene,
    new THREE.PerspectiveCamera(),
    undefined,
    '/dst/data/databundles/images.zip',
    inventory,
    '/dst/data/anim',
    new THREE.Group(),
  );
  const renderer = new THREE.WebGLRenderer();
  renderer.setSize(128, 128);
  // The torches lie on the ground plane; the camera looks down on it.
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  camera.position.set(0, 20, 0);
  camera.lookAt(0, 0, 0);
  const items: ItemEntity[] = [];
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const sample = () => {
    world.archives.instancedSprites.flush(renderer);
    renderSceneWithPasses(renderer, scene, camera);
    const colour = scene.getObjectByName('ArchiveSpriteInstances:colour') as THREE.InstancedMesh | undefined;
    return { calls: renderer.info.render.calls, count: colour?.count ?? 0 };
  };
  try {
    // Static held poses and split animation/build archives use the same instancing path as loops.
    for (let index = 0; index < 24; index++) {
      const model = world.spawnFromSave(
        `torch:${index}`,
        { itemId: 'torch', count: 1, name: 'torch', icon: '' },
        new THREE.Vector3((index % 6) * 3 - 8, 0, Math.floor(index / 6) * 3 - 5),
      );
      await prefabDisplay(model)!.artLoaded();
      items.push(itemAt(model));
      if (index === 0) {
        sample();
      }
    }
    const many = sample();
    const batch = scene.getObjectByName('ArchiveSpriteInstances:colour') as THREE.InstancedMesh;
    const texture = (batch.material as THREE.MeshBasicMaterial).map;
    items[0].setActive(false);
    await tick();
    const asleep = sample();
    items[0].setActive(true);
    // The cached archives still rebuild the resident sprite asynchronously.
    await tick();
    const awake = sample();
    const sameBatch = scene.getObjectByName('ArchiveSpriteInstances:colour') === batch;
    const sameTexture = (batch.material as THREE.MeshBasicMaterial).map === texture;
    const position = items[0].position.toArray();
    // A removed inst's display releases its instance as its lifecycle effect runs.
    items[0].remove();
    await tick();
    const removed = sample();
    for (const item of items.slice(1)) {
      item.remove();
    }
    await tick();
    const empty = sample();
    return { many, asleep, awake, sameBatch, sameTexture, position, removed, empty };
  } finally {
    world.dispose();
    inventory.dispose();
    renderer.dispose();
  }
}

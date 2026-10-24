import * as THREE from 'three';
import { GameTimeScheduler } from '@dontstarve-web/signals';
import { prewarmScenePasses, renderSceneWithPasses } from '@dontstarve-web/animation/sceneRenderPass';
import { intersectSpriteEntities } from '@dontstarve-web/stategraphs/pointerRaycaster';
import { MushroomPlantManager } from '../../prefab/src/mushroom_plant';
import { bindTestWorld } from '../../animation/tests/worldContentFixture';

export async function checkMushroomInstances() {
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler();
  const world = bindTestWorld(scheduler);
  const mushrooms = new MushroomPlantManager(scene, '/dst/data/anim', {
    prepareSpawn: async () => ({ spawn: () => true, dispose() {} }),
  });
  const renderer = new THREE.WebGLRenderer(); renderer.setSize(256, 256); renderer.setClearColor(0);
  const target = new THREE.WebGLRenderTarget(256, 256);
  const camera = new THREE.OrthographicCamera(-12, 12, 8, -4, .1, 100);
  camera.position.set(0, 2, 25); camera.lookAt(0, 2, 0);
  const draw = () => {
    renderer.info.reset(); renderer.setRenderTarget(target);
    renderSceneWithPasses(renderer, scene, camera);
    return renderer.info.render.calls;
  };
  const advance = (seconds: number) => {
    for (let t = 0; t < seconds - .001; t += .1) {
      scheduler.advance(.1); mushrooms.update(.1, camera.quaternion);
    }
  };
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    const models = await Promise.all(Array.from({ length: 32 }, (_, index) =>
      mushrooms.spawn(new THREE.Vector3(-9 + index % 8 * 2.5, 0, Math.floor(index / 8) * .4))));
    mushrooms.update(0, camera.quaternion);
    await prewarmScenePasses(renderer, scene, camera);
    const calls = [draw()];
    world.cycle.set('night'); await settle();
    advance(12); calls.push(draw());
    const meshes = models.map(model => model.children[0].children[0] as THREE.Mesh);
    const hiddenSources = meshes.filter(mesh => !mesh.visible).length;
    const centre = new THREE.Box3().setFromObject(models[0]).getCenter(new THREE.Vector3());
    const ray = new THREE.Raycaster(centre.clone().add(new THREE.Vector3(0, 0, 25)), new THREE.Vector3(0, 0, -1));
    const alphaPickable = intersectSpriteEntities(ray, [models[0]]).length > 0;
    const pixels = new Uint8Array(256 * 256 * 4);
    renderer.readRenderTargetPixels(target, 0, 0, 256, 256, pixels);
    let brightPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 30) brightPixels++;
    models[0].userData.components.pickable.pick({ giveItem: () => true });
    calls.push(draw());
    const independent = models.slice(0, 2).map(model => model.userData.animationController.currentAnimation);
    for (const model of models.slice(1)) model.userData.components.pickable.pick({ giveItem: () => true });
    advance(1); calls.push(draw());
    // Removing the last entity must also clear the persistent batch group on the next draw.
    for (const model of models) mushrooms.remove(model);
    calls.push(draw());
    mushrooms.dispose();
    const releasedBatch = !scene.getObjectByName('InstancedArchiveSprites');
    return { calls, hiddenSources, alphaPickable, brightPixels, independent, releasedBatch };
  } finally {
    mushrooms.dispose(); world.unbind(); scheduler.dispose(); target.dispose(); renderer.dispose();
  }
}

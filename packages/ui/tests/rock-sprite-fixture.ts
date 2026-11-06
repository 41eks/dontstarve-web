import { activePrefabs } from '../../prefab/src/activePrefabs';
import * as THREE from 'three';
import { prefabDisplay } from '@dontstarve-web/display';
import { rockWorld } from '../../animation/tests/rockWorldFixture';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { prewarmScenePasses, renderSceneWithPasses } from '@dontstarve-web/animation/sceneRenderPass';
import { intersectSpriteEntities } from '@dontstarve-web/stategraphs/pointerRaycaster';

export async function checkRockInstances() {
  const scene = new THREE.Scene();
  const manager = rockWorld(scene);
  const renderer = new THREE.WebGLRenderer(); renderer.setSize(256, 256); renderer.setClearColor(0);
  const target = new THREE.WebGLRenderTarget(256, 256);
  const camera = new THREE.OrthographicCamera(-20, 20, 18, -2, .1, 100);
  camera.position.set(0, 8, 50); camera.lookAt(0, 8, 0);
  const draw = async () => {
    manager.displays.update(0);
    await new Promise(resolve => setTimeout(resolve, 0));
    await prewarmScenePasses(renderer, scene, camera);
    renderer.info.reset(); renderer.setRenderTarget(target);
    renderSceneWithPasses(renderer, scene, camera);
    return renderer.info.render.calls;
  };
  try {
    const models = Array.from({ length: 32 }, (_, index) =>
      manager.spawn('rock1', new THREE.Vector3(-15 + index % 8 * 4, 0, Math.floor(index / 8) * .4)));
    await Promise.all(models.map(model => prefabDisplay(model)!.artLoaded()));
    await prewarmScenePasses(renderer, scene, camera);
    const calls = [await draw()];
    const meshes = models.map(model => { let mesh: THREE.Mesh | undefined; model.traverse(object => { if (!mesh && object instanceof THREE.Mesh) mesh = object; }); return mesh!; });
    const hiddenSources = meshes.filter(mesh => !mesh.visible).length;
    const centre = new THREE.Box3().setFromObject(models[0]).getCenter(new THREE.Vector3());
    const ray = new THREE.Raycaster(centre.clone().add(new THREE.Vector3(0, 0, 50)), new THREE.Vector3(0, 0, -1));
    const alphaPickable = intersectSpriteEntities(ray, [models[0]]).length > 0;
    const pixels = new Uint8Array(256 * 256 * 4);
    renderer.readRenderTargetPixels(target, 0, 0, 256, 256, pixels);
    let painted = 0;
    for (let i = 0; i < pixels.length; i += 4) if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 30) painted++;
    const mine = { entity: activePrefabs.find(entity => entity.hasTag('MINE_workable'))! };
    for (let i = 0; i < 3; i++) performToolWork('MINE', mine.entity, {});
    calls.push(await draw());
    for (let i = 0; i < 3; i++) performToolWork('MINE', mine.entity, {});
    calls.push(await draw());
    // A separate bank/build with a symbol override shares one batch across eight entities too.
    await Promise.all(Array.from({ length: 8 }, (_, index) => prefabDisplay(manager.spawn('cavein_boulder', new THREE.Vector3(index - 4, 0, 0), {
      id: `boulder-${index}`, transform: { position: [index - 4, 0, 0], rotationY: 0 },
      components: { caveinBoulder: { variation: 7 } },
    }))!.artLoaded()));
    calls.push(await draw());
    manager.dispose(); calls.push(await draw());
    return { calls, hiddenSources, alphaPickable, painted };
  } finally { manager.dispose(); target.dispose(); renderer.dispose(); }
}

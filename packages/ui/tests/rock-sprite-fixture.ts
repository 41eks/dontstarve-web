import * as THREE from 'three';
import { RockManager } from '../../prefab/src/rocks';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { prewarmScenePasses, renderSceneWithPasses } from '@dontstarve-web/animation/sceneRenderPass';
import { intersectSpriteEntities } from '@dontstarve-web/stategraphs/pointerRaycaster';
import { GameTimeScheduler } from '@dontstarve-web/signals';

export async function checkRockInstances() {
  const scene = new THREE.Scene();
  const manager = new RockManager(scene, '/dst/data/anim', {
    prepareSpawn: async () => ({ spawn: () => true, dispose() {} }),
  });
  const renderer = new THREE.WebGLRenderer(); renderer.setSize(256, 256); renderer.setClearColor(0);
  const target = new THREE.WebGLRenderTarget(256, 256);
  const camera = new THREE.OrthographicCamera(-20, 20, 18, -2, .1, 100);
  camera.position.set(0, 8, 50); camera.lookAt(0, 8, 0);
  const draw = async () => {
    manager.update(0, camera.quaternion);
    await new Promise(resolve => setTimeout(resolve, 0));
    await prewarmScenePasses(renderer, scene, camera);
    renderer.info.reset(); renderer.setRenderTarget(target);
    renderSceneWithPasses(renderer, scene, camera);
    return renderer.info.render.calls;
  };
  try {
    const models = await Promise.all(Array.from({ length: 32 }, (_, index) =>
      manager.spawn('rock1', new THREE.Vector3(-15 + index % 8 * 4, 0, Math.floor(index / 8) * .4))));
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
    const [mine] = manager.mineTargets;
    for (let i = 0; i < 3; i++) performToolWork('MINE', mine.entity, {});
    calls.push(await draw());
    for (let i = 0; i < 3; i++) performToolWork('MINE', mine.entity, {});
    calls.push(await draw());
    // A separate bank/build with a symbol override shares one batch across eight entities too.
    await Promise.all(Array.from({ length: 8 }, (_, index) => manager.spawn('cavein_boulder', new THREE.Vector3(index - 4, 0, 0), {
      id: `boulder-${index}`, transform: { position: [index - 4, 0, 0], rotationY: 0 },
      components: { caveinBoulder: { variation: 7 } },
    })));
    calls.push(await draw());
    manager.dispose(); calls.push(await draw());
    return { calls, hiddenSources, alphaPickable, painted };
  } finally { manager.dispose(); target.dispose(); renderer.dispose(); }
}

export async function checkMoonShellErosion() {
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler();
  const manager = new RockManager(scene, '/dst/data/anim', { scheduler,
    prepareSpawn: async () => ({ spawn: () => true, dispose() {} }),
  });
  const renderer = new THREE.WebGLRenderer(); renderer.setSize(256, 256); renderer.setClearColor(0);
  const target = new THREE.WebGLRenderTarget(256, 256);
  const camera = new THREE.OrthographicCamera(-16, 16, 12, -8, .1, 100);
  camera.position.set(0, 0, 50); camera.lookAt(0, 0, 0);
  const draw = async () => {
    manager.update(0, camera.quaternion);
    await new Promise(resolve => setTimeout(resolve, 0));
    await prewarmScenePasses(renderer, scene, camera);
    renderer.setRenderTarget(target); renderSceneWithPasses(renderer, scene, camera);
    const pixels = new Uint8Array(256 * 256 * 4), painted = [0, 0];
    renderer.readRenderTargetPixels(target, 0, 0, 256, 256, pixels);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const i = (y * 256 + x) * 4;
      if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 30) painted[x < 128 ? 0 : 1]++;
    }
    return painted;
  };
  try {
    const shells = await Promise.all([-8, 8].map(x => manager.spawn('rock_moon_shell', new THREE.Vector3(x, 0, 0))));
    const breakShell = (index: number) => {
      const target = manager.getMineTargets(shells[index])[0];
      for (let i = 0; i < 6; i++) performToolWork('MINE', target.entity, {});
      shells[index].userData.animationController.setPaused(true);
      for (const entity of scene.children) if (entity.userData.prefab === 'moonrockseed') entity.visible = false;
    };
    breakShell(0); scheduler.advance(1); breakShell(1);
    const intact = await draw();
    scheduler.advance(1.5); const half = await draw();
    scheduler.advance(1.5); const removed = await draw();
    return { intact, half, removed };
  } finally { manager.dispose(); scheduler.dispose(); target.dispose(); renderer.dispose(); }
}

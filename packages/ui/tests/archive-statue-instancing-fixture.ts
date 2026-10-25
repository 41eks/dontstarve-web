import * as THREE from 'three';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { ArchivePropsManager } from '../../prefab/src/archive_props';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { bindTestWorld } from '../../animation/tests/worldContentFixture';
import { prewarmScenePasses, renderSceneWithPasses } from '../../animation/src/sceneRenderPass';
import { DisposeSounds } from '../../prefab/src/sound';

export async function checkArchiveStatueInstancing() {
  const scene = new THREE.Scene(), renderer = new THREE.WebGLRenderer();
  renderer.setSize(128, 128);
  const camera = new THREE.OrthographicCamera(-30, 30, 30, -30, .1, 100);
  camera.position.z = 40;
  const scheduler = new GameTimeScheduler(), world = bindTestWorld(scheduler), awake = createSignal(true);
  const manager = new ArchivePropsManager(scene, {
    tickingarea: () => createMemo(() => awake.get()),
    prepareSpawn: async () => ({ spawn: () => true, dispose() {} }),
  });
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const sample = async () => {
    await prewarmScenePasses(renderer, scene, camera);
    renderSceneWithPasses(renderer, scene, camera);
    const batch = scene.getObjectByName('ArchiveSpriteInstances:colour') as THREE.InstancedMesh | undefined;
    return { calls: renderer.info.render.calls, count: batch?.count ?? 0 };
  };
  try {
    for (let index = 0; index < 8; index++) {
      const position = new THREE.Vector3(index * 5 - 17.5, 0, 0);
      await manager.spawn('archive_moon_statue', position, {
        id: `statue:${index}`, transform: { position: position.toArray(), rotationY: 0 }, components: { archiveProp: { anim: 3 } },
      });
    }
    await tick();
    const full = await sample();
    const targets = manager.mineTargets;
    for (const target of targets) target.entity.components.workable!.WorkedBy({}, 4);
    await tick();
    const med = await sample();
    for (const target of targets) target.entity.components.workable!.WorkedBy({}, 3);
    await tick();
    const low = await sample();
    const batch = scene.getObjectByName('ArchiveSpriteInstances:colour');
    const records = JSON.stringify(manager.exportRecords());
    awake.set(false); await tick();
    const asleep = await sample();
    awake.set(true); await tick();
    const restored = await sample();
    const shared = scene.getObjectByName('ArchiveSpriteInstances:colour') === batch;
    const preserved = JSON.stringify(manager.exportRecords()) === records
      && targets.every(target => target.entity.components.workable!.GetWorkLeft() === 3);
    targets[0].entity.components.workable!.WorkedBy({}, 3);
    await tick();
    const removed = await sample();
    return { full, med, low, asleep, restored, shared, preserved, remaining: removed.count };
  } finally {
    manager.dispose(); await tick(); world.unbind(); scheduler.dispose(); DisposeSounds(); renderer.dispose();
  }
}

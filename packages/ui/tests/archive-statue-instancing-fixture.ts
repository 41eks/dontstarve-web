import { activePrefabs } from '../../prefab/src/activePrefabs';
import * as THREE from 'three';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { archivePropsPrefabs } from '../../prefab/src/archive_props';
import { PrefabEntityManager, type PrefabInstance } from '../../prefab/src/prefabInstance';
import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
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
  const displays = new PrefabDisplayGroup(scene);
  const manager = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim',
    { tickingarea: () => createMemo(() => awake.get()) });
  manager.register(archivePropsPrefabs({ scheduler, spawnGroundItem: () => undefined, fx: { collapse: () => {} },
    spawnPrefab: (id, position) => manager.spawn(id, position) }) as never);
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
      const statue = manager.spawn('archive_moon_statue', position, {
        id: `statue:${index}`, transform: { position: position.toArray(), rotationY: 0 }, components: { archiveProp: { anim: 3 } },
      });
      await prefabDisplay(statue.transform.model)!.artLoaded();
    }
    await tick();
    const full = await sample();
    const targets = activePrefabs.filter(entity => entity.hasTag('MINE_workable'));
    for (const target of targets) target.components.workable!.WorkedBy({}, 4);
    await tick();
    const med = await sample();
    for (const target of targets) target.components.workable!.WorkedBy({}, 3);
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
      && targets.every(target => target.components.workable!.GetWorkLeft() === 3);
    targets[0].components.workable!.WorkedBy({}, 3);
    await tick();
    const removed = await sample();
    return { full, med, low, asleep, restored, shared, preserved, remaining: removed.count };
  } finally {
    manager.dispose(); displays.dispose(); await tick(); world.unbind(); scheduler.dispose(); DisposeSounds(); renderer.dispose();
  }
}

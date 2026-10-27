import * as THREE from 'three';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { BerrybushManager } from '../../prefab/src/berrybush';
import { MonkeytailManager } from '../../prefab/src/monkeytail';
import { RockAvocadoBushManager } from '../../prefab/src/rock_avocado_bush';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { bindTestWorld, drawn } from '../../animation/tests/worldContentFixture';
import { prewarmScenePasses, renderSceneWithPasses } from '../../animation/src/sceneRenderPass';

export async function checkPickablePlantInstancing() {
  const scene = new THREE.Scene(), renderer = new THREE.WebGLRenderer();
  renderer.setSize(128, 128);
  const camera = new THREE.OrthographicCamera(-20, 20, 20, -20, .1, 100);
  camera.position.z = 30;
  const scheduler = new GameTimeScheduler(), world = bindTestWorld(scheduler), awake = createSignal(true);
  const options = { tickingarea: () => createMemo(() => awake.get()),
    spawnGroundItem: () => undefined };
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const result = [];
  try {
    for (const Manager of [BerrybushManager, MonkeytailManager, RockAvocadoBushManager]) {
      const manager = new Manager(scene, '/dst/data/anim', options);
      try {
        const models: THREE.Group[] = [];
        for (let index = 0; index < 12; index++) {
          const position = new THREE.Vector3(index * 3 - 17, 0, 0);
          models.push(manager.spawn(position, { id: `plant:${index}`, transform: { position: position.toArray(), rotationY: 0 },
            components: { growable: { stage: 3, time: 900 } } }));
        }
        // The plants exist at once; their displays load the shared art before the batches are sampled.
        await Promise.all(models.map(drawn));
        await tick();
        const sample = async () => {
          await prewarmScenePasses(renderer, scene, camera);
          renderSceneWithPasses(renderer, scene, camera);
          const batch = scene.getObjectByName('ArchiveSpriteInstances:colour') as THREE.InstancedMesh | undefined;
          return { calls: renderer.info.render.calls, count: batch?.count ?? 0 };
        };
        const ready = await sample();
        const batch = scene.getObjectByName('ArchiveSpriteInstances:colour');
        const before = manager.exportRecords();
        awake.set(false); await tick();
        const asleep = await sample();
        const preserved = JSON.stringify(manager.exportRecords()) === JSON.stringify(before);
        awake.set(true); await tick();
        const restored = await sample();
        const shared = scene.getObjectByName('ArchiveSpriteInstances:colour') === batch;
        manager.remove(models[0]);
        const removed = await sample();
        result.push({ ready, asleep, restored, shared, preserved, removed });
      } finally { manager.dispose(); }
    }
    return result;
  } finally { world.unbind(); scheduler.dispose(); renderer.dispose(); }
}

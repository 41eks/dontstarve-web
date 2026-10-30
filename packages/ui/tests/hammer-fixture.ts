import { findActionEntity } from '../../prefab/src/actionEntity';
import { prefabDisplay } from '../../display/src';
import { fixturePickup } from './pickup-fixture';
import { spriteScreenPoint } from './sprite-screen-point';
import * as THREE from 'three';
import { createSignal } from '../../signals/src';
import { actionTargetModel } from '../../stategraphs/src/actionTargetView';
import type { PrefabDisplay } from '@dontstarve-web/display';
import { prewarmScenePasses, renderSceneWithPasses } from '../../animation/src/sceneRenderPass';

/** Exercise the real host loot callback, persistence and pickup after destruction. */
export async function checkResearchLabDestruction() {
  const { createSceneEntities } = await import('../../../src/sceneEntities');
  const { World } = await import('cannon-es');
  const { player } = await import('../../../src/player');
  const { worldState } = await import('../../../src/scene');
  worldState.playerpositions.set([player.position]);
  await new Promise(resolve => setTimeout(resolve, 0));
  const pickedUp: { itemId: string; count: number }[] = [];
  const entities = await createSceneEntities(new World(), {
    ...worldState,
    clock: createSignal({ phase: 'day', timeinphase: 0 }),
    season: createSignal({ season: 'spring', progress: 0 }),
    isNight: createSignal(false),
  }, () => false);
  const { scene, renderer } = await import('../../../src/universal');
  const { camera } = await import('../../../src/camera');
  const pickup = fixturePickup(scene, camera, renderer, player);
  pickup.inventory.subscribeReceived(received => received.forEach(item => pickedUp.push({ itemId: item.itemId, count: item.delta })));
  const ids = ['researchlab', 'researchlab2', 'researchlab3', 'researchlab4'] as const;
  const skins = ['researchlab_green', 'researchlab2_pod', 'researchlab3_crystal', 'researchlab4_chef'];
  const pieceCounts = [5, 4, 7, 5];
  const cases = [];
  try {
    for (const [index, id] of ids.entries()) {
      const position = player.position.clone().setY(0);
      const model = await entities.buildingPlacement.spawnFromSave(id, {
        id: `destroy_${id}`, transform: { position: position.toArray(), rotationY: 0 },
        components: { building: { state: 'idle', skinId: skins[index] } },
      });
      const target = entities.buildingPlacement.hammerTargets.find(target => actionTargetModel(target) === model)!;
      const beforeCount = entities.groundItems.exportRecords().length;
      for (let i = 0; i < 3; i++) target.playHit();
      const remainedAfterThree = target.isValid() && entities.registry.exportRecords()[id].length === 1;
      target.playHit();
      await new Promise(resolve => setTimeout(resolve, 0));
      const lootTargets = entities.groundItems.reskinTargets.slice(beforeCount);
      // Logical loot exists before its display finishes loading the ground art.
      await Promise.all(lootTargets.map(target =>
        (prefabDisplay(actionTargetModel(target)) as PrefabDisplay).artLoaded()));
      // Instanced loot stays pickable, while the batch handles its drawing order.
      const models = lootTargets.map(actionTargetModel);
      if (models.length !== pieceCounts[index]) throw new Error(`Missing loot targets for ${id}: ${models.length}`);
      const initialPositions = models.map((model) => model.position.clone());
      entities.groundItems.update(0.1, camera.quaternion);
      const airborne = models.every((model) => model.children[0].position.y > 0 && model.position.y === 0);
      const moved = models.some((model, i) => model.position.distanceTo(initialPositions[i]) > 0);
      const spread = new Set(models.map((model) => `${model.position.x},${model.position.z}`)).size === models.length;
      const inFlightGrounded = entities.groundItems.exportRecords().every((record) => record.transform.position[1] === 0);
      for (let i = 0; i < 80; i++) entities.groundItems.update(1 / 30, camera.quaternion);
      const settled = models.every((model) => model.children[0].position.y === 0 && model.position.y === 0);
      const landingPositions = models.map((model) => model.position.clone());
      entities.groundItems.update(1, camera.quaternion);
      const stable = models.every((model, i) => model.position.equals(landingPositions[i]));
      const loot = new Map<string, number>();
      for (const record of entities.groundItems.exportRecords().slice(beforeCount)) {
        const stack = record.components.stack!;
        loot.set(stack.itemId, (loot.get(stack.itemId) ?? 0) + stack.count);
      }
      cases.push({ id, remainedAfterThree, removed: !target.isValid() && model.parent === null,
        records: entities.registry.exportRecords()[id],
        loot: Array.from(loot, ([itemId, count]) => ({ itemId, count })),
        airborne, moved, spread, inFlightGrounded, settled, stable,
        effect: entities.buildingPlacement.renderEntities.some(({ object }) => object.name === 'collapse_small'),
      });
    }
    const records = entities.registry.exportRecords();
    for (let i = 0; i < 80; i++) entities.buildingPlacement.update(1 / 30);
    const effectsCleaned = !entities.buildingPlacement.renderEntities.some(({ object }) => object.name === 'collapse_small');
    // Isolate one material stack and pick it up through the public pointer path.
    const groundTargets = entities.groundItems.reskinTargets;
    const pickupTarget = groundTargets.find(target => target.prefabId === 'goldnugget');
    if (!pickupTarget) throw new Error('Missing gold loot target after destroying research labs');
    const groundModel = actionTargetModel(pickupTarget), address = pickupTarget.id;
    for (const target of groundTargets) {
      if (target === pickupTarget) continue;
      findActionEntity(actionTargetModel(target))?.pickupTarget.entity.transform.position.x += 100;
    }
    findActionEntity(groundModel)?.pickupTarget.entity.transform.position.copy(player.position).setY(0).add(new THREE.Vector3(5, 0, 0));
    groundModel.position.copy(findActionEntity(groundModel)?.pickupTarget.entity.transform.position);
    const { scene, renderer } = await import('../../../src/universal');
    camera.position.copy(groundModel.position).add(new THREE.Vector3(0, 20, 35));
    camera.lookAt(groundModel.position);
    camera.updateMatrixWorld();
    worldState.camerarotation.set(camera.quaternion.clone());
    await new Promise(resolve => setTimeout(resolve, 0));
    entities.groundItems.update(0, camera.quaternion);
    await prewarmScenePasses(renderer, scene, camera);
    renderSceneWithPasses(renderer, scene, camera);
    const point = spriteScreenPoint(groundModel, camera, renderer);
    renderer.domElement.dispatchEvent(new PointerEvent('pointerdown', { button: 0,
      clientX: point.x, clientY: point.y,
    }));
    pickup.settle();
    return { cases, records, effectsCleaned, pickedUp,
      pickupRemoved: !entities.groundItems.exportRecords().some((record) => record.id === address) };
  } finally { pickup.dispose(); entities.registry.dispose(); }
}

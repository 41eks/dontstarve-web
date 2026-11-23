import { prefabDisplay } from '@dontstarve-web/display';
import type { InventoryStore } from '@dontstarve-web/inventory';
import * as CANNON from 'cannon-es';
import { world, worldState } from './physics';
import CannonDebugger from 'cannon-es-debugger';
import * as THREE from 'three';
import { setOrdinarySpriteKeys, updateSpriteRenderOrders } from '@dontstarve-web/animation';
import { EventEmitter } from '@dontstarve-web/signals';

import { animate, backTasks, middleTasks } from './animate';
import { prewarmThroughContextLoss } from './prewarmScene';
import { createAnimationUpdater } from './animation';
import { ground, groundDisplay, turfMap, pathfinder } from './building';
import { camera, followCamera } from './camera';
import { createSceneEntities } from './sceneEntities';
import type { EntityRegistry } from './entityRegistry';
import { player, playerBody, playerInstance, disposePlayer } from './player';
import { GetSpeedMultiplier } from '@dontstarve-web/prefab/player_common';
import { isManagedBuildingId, type PlaceableBuildingInteractionChange } from './placeableBuilding';
import { dstLighting, scene } from './universal';
import { updateMovement } from './updatePlayerMovement';
import { view } from './view';
import { bindActionCancellation } from '@dontstarve-web/stategraphs';
import { initialSave } from './save/initialSave';
import type { RuntimeSaveState } from './save/serialize';
import { createWorldClockUpdater } from './worldState';
import type { PerishWorld } from '../packages/componets/src/perishable';
import { Locomotor } from '@dontstarve-web/prefab/locomotor';
import { AddSlipperyFeet, RemoveSlipperyFeet } from '@dontstarve-web/prefab/player_common';
import { bindPlayerBuilder } from '@dontstarve-web/prefab/player_common';
import { removeComponent } from '../packages/prefab/src/components';
import type { DisposalEvents } from './registerDisposal';
import { disposeTextureAssets } from '@dontstarve-web/animation/textureLoader';
import { preloadAnimationArchives } from '@dontstarve-web/animation/preloadArchives';
import { savedPrefabArchives } from './prefabDefinitions';
import { DisposeSounds, PrewarmSounds } from '@dontstarve-web/prefab/sound';
import { GROUND_ITEM_DEFINITIONS } from '@dontstarve-web/prefab/groundItems';
import { prewarmCachedBuilds } from '@dontstarve-web/display';
import { INVENTORY_RECIPES } from '@dontstarve-web/ui';
import { CanDeployRecipeAtPoint } from '../packages/prefab/src/mapEntities';

export { world, worldState };

groundDisplay.bindOceanClock(worldState.clock);

scene.background = new THREE.Color(initialSave.world.prefab === 'cave' ? 0x000000 : 0xbfd1e5);
scene.add(ground, groundDisplay.root, player);

function disposeTerrain(): void {
  groundDisplay.dispose();
  turfMap.dispose();
  ground.removeFromParent();
  ground.geometry.dispose();
  ground.material.dispose();
}

const playerRadius = (playerBody.shapes[0] as CANNON.Sphere).radius;
export const locomotor = new Locomotor(playerBody, {
  footprintRadius: playerRadius,
  isPassable: (x, z) => turfMap.isPassableAtPoint({ x, z }),
  pathfinder,
  // player_common_extensions.lua.
  pathcaps: { player: true, ignorecreep: true },
});
const updatePlayerMovement = updateMovement(followCamera, player, playerBody, locomotor);
const updateAnimation = createAnimationUpdater(player);
const cameraWorldQuaternion = new THREE.Quaternion();
const playerRenderEntries = [{ object: player, footPosition: player.position }];
/** The ordinary billboards' keys written this frame, which the scene's batches are drawn around. */
const ordinaryKeys: number[] = [];

// Every shown entity writes its own key each frame, so one spawned, moved or given an effect (fire) orders itself
// even while the player and camera stand still.
function updateCharacterRenderOrder(registry: EntityRegistry) {
  ordinaryKeys.length = 0;
  updateSpriteRenderOrders(playerRenderEntries, camera.matrixWorldInverse, ordinaryKeys);
  updateSpriteRenderOrders(registry.renderEntities, camera.matrixWorldInverse, ordinaryKeys);
  setOrdinarySpriteKeys(scene, ordinaryKeys);
}

/** The player's run speed, times locomotor:GetSpeedMultiplier (equipped items' walkspeedmult). */
function getVelocity(): number {
  return 16 * GetSpeedMultiplier(playerInstance);
}

middleTasks.push((dt: number) => {
  pathfinder.update();
  updatePlayerMovement(getVelocity(), dt);
});
middleTasks.push(updateAnimation);

// The debugger adds a mesh per body shape (thousands in the Caves); opt in with ?physicsDebug.
if (
  !window.location.hostname.endsWith('github.io') &&
  new URLSearchParams(window.location.search).has('physicsDebug')
) {
  const cannonDebugger = CannonDebugger(scene, world, {
    color: 0x00ff00,
  });
  backTasks.push(() => cannonDebugger.update());
}

export async function startScene(
  onBuildingInteraction: ((change: PlaceableBuildingInteractionChange) => void) | undefined,
  inventory: InventoryStore,
) {
  playerInstance.locomotor = locomotor;
  const clockUpdater = createWorldClockUpdater(worldState, initialSave.world.elapsedSeconds, () => [player.position]);
  const scheduler = worldState.scheduler;
  const perishWorld: PerishWorld = { perishClock: worldState.perishClock, scheduler };
  inventory.entities.bindPerishWorld(perishWorld);
  const entities = await createSceneEntities(world, worldState, onBuildingInteraction, inventory, scheduler);
  const { registry, prefabs } = entities;
  // The player is not SpawnPrefab'd here, but it is in Ents: TheSim queries find it and it queries through them.
  prefabs.track(playerInstance);
  try {
    // Scan the save here; the archive worker decodes the needed art while entities restore and share its cache.
    void preloadAnimationArchives(
      savedPrefabArchives(registry.prefabDefinitions, initialSave.world.entities),
      `${import.meta.env.BASE_URL}dst/data/anim`,
    );
    await registry.restoreAll(initialSave.world.entities);
  } catch (error) {
    entities.dispose();
    disposePlayer();
    world.dispose();
    disposeTerrain();
    worldState.dispose();
    DisposeSounds();
    dstLighting.dispose();
    throw error;
  }
  const builder = bindPlayerBuilder(player, {
    placement: {
      recipe: id => (isManagedBuildingId(id) ? INVENTORY_RECIPES[id] : undefined),
      CanDeployRecipeAtPoint: (point, recipe) => CanDeployRecipeAtPoint(prefabs, turfMap, point, recipe.minSpacing),
      SpawnPrefab: (prefab, point, skin) => registry.SpawnPrefab(prefab, point, skin),
    },
    findEntities: (position, radius, mustTags, cantTags) => prefabs.FindEntities(position, radius, mustTags, cantTags),
    entitiesChanged: prefabs.entitiesChanged,
    getWatchWorldContent: worldState.getWatchWorldContent,
  });
  // player_common.lua AddComponent("slipperyfeet"); CommonPlayerDeath removes it and CommonActualRez adds it back.
  AddSlipperyFeet(playerInstance);
  const updateSlipperyFeet = (dt: number) => playerInstance.slipperyfeet?.update(dt);
  backTasks.push(updateSlipperyFeet);
  const updateBeforePhysics = (dt: number) => registry.beforePhysics(dt);
  // Billboard displays turn to the world's camera rotation themselves.
  const publishCameraRotation = () => {
    camera.getWorldQuaternion(cameraWorldQuaternion);
    if (!worldState.camerarotation.peek().equals(cameraWorldQuaternion)) {
      worldState.camerarotation.set(cameraWorldQuaternion.clone());
    }
  };
  const updateEntities = (dt: number) => {
    groundDisplay.update(dt);
    scheduler.advanceTo(clockUpdater.elapsedSeconds);
    worldState.componentUpdates.update(dt);
    publishCameraRotation();
    prefabDisplay(player)!.update(dt);
    registry.update(dt, cameraWorldQuaternion);
    updateCharacterRenderOrder(registry);
  };
  middleTasks.push(updateBeforePhysics);
  backTasks.push(clockUpdater.update);
  backTasks.push(updateEntities);
  const getSaveState = (): Omit<RuntimeSaveState, 'inventory'> => {
    clockUpdater.flush();
    scheduler.advanceTo(clockUpdater.elapsedSeconds);
    return {
      entities: registry.exportRecords(),
      elapsedSeconds: clockUpdater.elapsedSeconds,
      tiles: turfMap.exportTiles(),
      worldtemperature: worldState.worldtemperature.OnSave(),
      weather: worldState.weather.OnSave(),
      nightmareclock: worldState.nightmareclock?.OnSave(),
      moon: { mooomphasecycle: worldState.moonPhaseCycle() },
      // Physics may place the foot a fraction below the ground while settling.
      playerTransform: {
        position: [player.position.x, Math.max(0, player.position.y), player.position.z],
        rotationY: 0,
      },
    };
  };
  const stopMovementEvents = bindActionCancellation(
    view,
    locomotor,
    () => locomotor.stop(),
    reason => reason === 'emote',
  );
  let animation: ReturnType<typeof animate> | undefined;
  let startPromise: Promise<void> | undefined;
  let disposed = false;
  let preparing = false;
  const preparation = new AbortController();
  const start = (): Promise<void> => {
    if (startPromise) {
      return startPromise;
    }
    startPromise = (async () => {
      if (disposed) {
        throw new Error('Cannot start a disposed scene');
      }
      const { width, height } = view.renderer.domElement.getBoundingClientRect();
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
      publishCameraRotation();
      updateCharacterRenderOrder(registry);
      preparing = true;
      try {
        // Retain resources until every preparation settles, including on failure or disposal.
        const results = await Promise.allSettled([
          prewarmThroughContextLoss(
            view.renderer,
            () => dstLighting.prewarm(scene, camera, preparation.signal),
            preparation.signal,
          ),
          PrewarmSounds(),
          prewarmCachedBuilds(playerInstance.equipmentAssets, [
            'pan_flute.zip',
            ...Object.values(GROUND_ITEM_DEFINITIONS.panflute.skinArchives),
          ]),
        ]);
        for (const result of results) {
          if (result.status === 'rejected') {
            throw result.reason;
          }
        }
      } finally {
        preparing = false;
      }
      if (disposed) {
        throw new Error('Scene disposed while preparing');
      }
      animation = animate(world, camera);
      await animation.ready;
    })();
    return startPromise;
  };
  const disposalEvents = new EventEmitter<DisposalEvents>();
  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    preparation.abort();
    if (playerInstance.locomotor === locomotor) {
      delete playerInstance.locomotor;
    }
    animation?.stop();
    if (playerInstance.components.builder === builder) {
      removeComponent(playerInstance, 'builder');
    }
    RemoveSlipperyFeet(playerInstance);
    const slipTask = backTasks.indexOf(updateSlipperyFeet);
    if (slipTask >= 0) {
      backTasks.splice(slipTask, 1);
    }
    clockUpdater.flush();
    scheduler.advanceTo(clockUpdater.elapsedSeconds);
    locomotor.stop();
    stopMovementEvents();
    disposalEvents.emit('dispose', undefined);
    for (const [tasks, task] of [
      [middleTasks, updateBeforePhysics],
      [backTasks, updateEntities],
      [backTasks, clockUpdater.update],
    ] as const) {
      const index = tasks.indexOf(task);
      if (index >= 0) {
        tasks.splice(index, 1);
      }
    }
    const releaseResources = () => {
      entities.dispose();
      disposePlayer();
      world.dispose();
      disposeTerrain();
      worldState.dispose();
      DisposeSounds();
      dstLighting.dispose();
      disposeTextureAssets();
    };
    // compileAsync still polls its materials: retain them until the in-flight
    // batch settles, while aborting all subsequent uploads and scene startup.
    if (preparing) {
      void startPromise?.catch(() => undefined).then(releaseResources);
    } else {
      releaseResources();
    }
  };
  return {
    ...entities,
    byEntityId: registry.byEntityId,
    scheduler,
    weather: worldState.weather,
    getWatchWorldContent: worldState.getWatchWorldContent,
    moon: { SetMoonPhase: worldState.SetMoonPhase },
    getSaveState,
    disposalEvents,
    start,
    dispose,
  };
}

export function scene_add(model: THREE.Object3D) {
  scene.add(model);
}

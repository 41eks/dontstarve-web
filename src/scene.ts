import type { ItemEntityRegistry, InventoryStore } from '@dontstarve-web/inventory';
import * as CANNON from 'cannon-es';
import { PhysicsWorld } from '../packages/componets/src/physicsWorld';
import CannonDebugger from 'cannon-es-debugger';
import * as THREE from 'three';
import { SpriteRenderOrderSorter } from '@dontstarve-web/animation';
import { createEffect, EventEmitter, watchSignal } from '@dontstarve-web/signals';
import { playerGhostMode, playerStats } from './playerStats';

import { animate, backTasks, middleTasks } from './animate';
import { createAnimationUpdater } from './animation';
import { ground, turfGround, turfMap } from './building';
import { camera } from './camera';
import { createSceneEntities } from './sceneEntities';
import type { EntityRegistry } from './entityRegistry';
import { player, playerBody, setPlayerNormal } from './player';
import {
  type PlaceableBuildingInteractionChange,
  type PlaceableBuildingId,
} from './placeableBuilding';
import { dstLighting, scene } from './universal';
import { updateMovement } from './updatePlayerMovement';
import { view } from './view';
import { bindActionCancellation } from '@dontstarve-web/stategraphs';
import { initialSave } from './save/initialSave';
import type { RuntimeSaveState } from './save/serialize';
import { createWorldState, createWorldClockUpdater } from './worldState';
import type { PerishWorld } from '../packages/componets/src/perishable';
import { Locomotor, findGroundPath, setupLocomotorInput } from '@dontstarve-web/prefab/locomotor';
import { SlipperyFeet } from '../packages/componets/src/slipperyfeet';
import { bindActionEntityWorld, FindEntities } from '../packages/prefab/src/actionEntity';
import { bindPlayerBuilder, type WilsonAnimationController } from '@dontstarve-web/prefab/player';
import { GROUND_COLLISION_GROUP } from '../packages/prefab/src/standardcomponents';
import type { DisposalEvents } from './registerDisposal';
import { disposeTextureAssets } from '@dontstarve-web/animation/textureLoader';
import { preloadAnimationArchives } from '@dontstarve-web/animation/preloadArchives';
import { savedPrefabArchives } from './prefabDefinitions';

export const worldState = createWorldState(initialSave.world);
export const world = new PhysicsWorld({
  gravity: new CANNON.Vec3(0, -9.82, 0),
}, worldState.tickingarea);

turfMap.bindOceanClock(worldState.clock);

const groundMaterial = new CANNON.Material('ground');
const groundBody = new CANNON.Body({
  mass: 0,
  shape: new CANNON.Plane(),
  material: groundMaterial,
});
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
groundBody.collisionFilterGroup = GROUND_COLLISION_GROUP;
world.addBody(groundBody);
world.addBody(playerBody);
scene.background = new THREE.Color(initialSave.world.prefab === 'cave' ? 0x000000 : 0xbfd1e5);
scene.add(ground, turfGround, player);

function disposeTerrain(): void {
  turfMap.dispose();
  ground.removeFromParent();
  ground.geometry.dispose();
  (ground.material as THREE.Material).dispose();
}

const playerRadius = (playerBody.shapes[0] as CANNON.Sphere).radius;
export const locomotor = new Locomotor(playerBody, {
  footprintRadius: playerRadius,
  isPassable: (x, z) => turfMap.isPassableAtPoint({ x, z }),
  findPath(start, target) {
    const mapEdge = initialSave.world.map.generator.options.size / 2 - playerRadius;
    const obstacles = [...world.registeredBodies].filter((body) => body.type === CANNON.Body.STATIC
      && body.collisionResponse
      && (body.collisionFilterMask & playerBody.collisionFilterGroup) !== 0
      && (playerBody.collisionFilterMask & body.collisionFilterGroup) !== 0
      && body.shapes.some((shape) => shape instanceof CANNON.Box || shape instanceof CANNON.Sphere))
      .map((body) => {
        body.updateAABB();
        return {
          minX: body.aabb.lowerBound.x - playerRadius, maxX: body.aabb.upperBound.x + playerRadius,
          minZ: body.aabb.lowerBound.z - playerRadius, maxZ: body.aabb.upperBound.z + playerRadius,
        };
      });
    return findGroundPath(start, target, {
      cellSize: Math.max(1, playerRadius / 2),
      isWalkable: (point) => Math.abs(point.x) <= mapEdge && Math.abs(point.z) <= mapEdge
        && turfMap.isPassableAtPoint(point)
        && !obstacles.some((box) => point.x >= box.minX && point.x <= box.maxX
          && point.z >= box.minZ && point.z <= box.maxZ),
    });
  },
});
const updatePlayerMovement = updateMovement(camera, player, playerBody, locomotor);
const updateAnimation = createAnimationUpdater(player, camera);
const cameraWorldQuaternion = new THREE.Quaternion();
const renderOrderSorter = new SpriteRenderOrderSorter();
const playerRenderEntry = { object: player, footPosition: player.position };

function updateCharacterRenderOrder(registry: EntityRegistry) {
  renderOrderSorter.update([playerRenderEntry, ...registry.renderEntities], camera.matrixWorldInverse);
}

function getVelocity(): number {
  return 16;
}

middleTasks.push((dt: number) => {
  updatePlayerMovement(getVelocity(), dt);
});
middleTasks.push(updateAnimation);

// The debugger adds a mesh per body shape (thousands in the Caves); opt in with ?physicsDebug.
if (!window.location.hostname.endsWith('github.io') && new URLSearchParams(window.location.search).has('physicsDebug')) {
  const cannonDebugger = CannonDebugger(scene, world, {
    color: 0x00ff00,
  });
  backTasks.push(() => cannonDebugger.update());
}

export async function startScene(
  consumeBufferedBuild: (buildingId: PlaceableBuildingId, skinId?: string) => boolean,
  onBuildingInteraction?: (change: PlaceableBuildingInteractionChange) => void,
  itemEntities?: ItemEntityRegistry,
  inventory?: InventoryStore,
) {
  const blockDisabledController = (event: PointerEvent) => {
    if (player.userData.controllerEnabled !== false) return;
    event.preventDefault(); event.stopImmediatePropagation();
  };
  view.renderer.domElement.addEventListener('pointerdown', blockDisabledController, true);
  player.userData.locomotor = locomotor;
  const clockUpdater = createWorldClockUpdater(worldState, initialSave.world.elapsedSeconds, () => [player.position]);
  const stopEntityWorld = bindActionEntityWorld(scene, worldState.tickingarea, worldState.playerpositions);
  const scheduler = worldState.scheduler;
  const perishWorld: PerishWorld = { perishClock: worldState.perishClock, scheduler };
  itemEntities?.bindPerishWorld(perishWorld);
  const entities = await createSceneEntities(world, worldState, consumeBufferedBuild,
    onBuildingInteraction, itemEntities, inventory, scheduler);
  const { registry } = entities;
  try {
    // Scan the save here; the archive worker decodes the needed art while entities restore and share its cache.
    void preloadAnimationArchives(savedPrefabArchives(registry.prefabDefinitions, initialSave.world.entities),
      `${import.meta.env.BASE_URL}dst/data/anim`);
    await registry.restoreAll(initialSave.world.entities);
  } catch (error) {
    view.renderer.domElement.removeEventListener('pointerdown', blockDisabledController, true);
    entities.dispose();
    stopEntityWorld();
    world.dispose();
    disposeTerrain();
    worldState.dispose();
    dstLighting.dispose();
    throw error;
  }
  const builder = bindPlayerBuilder(player, {
    findEntities: (position, radius, mustTags, cantTags) => FindEntities(scene, position, radius, mustTags, cantTags),
  });
  builder.OnUpdate();
  // player_common.lua AddComponent("slipperyfeet"); frozen ponds are its slipperyfeettarget entities.
  const stategraph = (player.userData.animationController as WilsonAnimationController | undefined)?.stategraph;
  const removeSlipperyFeet = () => {
    (player.userData.slipperyfeet as SlipperyFeet | undefined)?.dispose();
    delete player.userData.slipperyfeet;
  };
  const addSlipperyFeet = () => {
    if (!stategraph || player.userData.slipperyfeet) return;
    player.userData.slipperyfeet = new SlipperyFeet({
      getPosition: () => player.position,
      getMotorSpeed: () => player.userData.currentMotorSpeed as number ?? 0,
      PushEvent: (name, data) => stategraph.pushEvent(name, data),
      sg: stategraph,
    }, {
      scheduler,
      findSlipperyEntities: (position, radius) => FindEntities(scene, position, radius, ['slipperyfeettarget']) as never,
    });
  };
  // CommonPlayerDeath removes the component and CommonActualRez adds it back: it exists while the player is alive.
  // A ghost has health too (RESURRECT_HEALTH), so ghost mode keeps it off.
  const stopSlipperyWatch: (() => void)[] = [];
  const watchedHealth = watchSignal(playerStats.health, stop => stopSlipperyWatch.push(stop));
  const watchedGhostMode = watchSignal(playerGhostMode, stop => stopSlipperyWatch.push(stop));
  createEffect(() => {
    if (watchedHealth.get() > 0 && !watchedGhostMode.get()) addSlipperyFeet(); else removeSlipperyFeet();
  });
  const updateSlipperyFeet = (dt: number) => (player.userData.slipperyfeet as SlipperyFeet | undefined)?.update(dt);
  if (stategraph) backTasks.push(updateSlipperyFeet);
  const updateBeforePhysics = (dt: number) => registry.beforePhysics(dt);
  const updateEntities = (dt: number) => {
    turfMap.update(dt);
    scheduler.advanceTo(clockUpdater.elapsedSeconds);
    builder.OnUpdate();
    worldState.componentUpdates.update(dt);
    camera.getWorldQuaternion(cameraWorldQuaternion);
    if (!worldState.camerarotation.peek().equals(cameraWorldQuaternion)) {
      worldState.camerarotation.set(cameraWorldQuaternion.clone());
    }
    setPlayerNormal(cameraWorldQuaternion);
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
      entities: registry.exportRecords(), elapsedSeconds: clockUpdater.elapsedSeconds, tiles: turfMap.exportTiles(),
      worldtemperature: worldState.worldtemperature.OnSave(),
      weather: worldState.weather.OnSave(),
      moon: { mooomphasecycle: worldState.moonPhaseCycle() },
      // Physics may place the foot a fraction below the ground while settling.
      playerTransform: { position: [player.position.x, Math.max(0, player.position.y), player.position.z], rotationY: 0 },
    };
  };
  const removeLocomotorInput = setupLocomotorInput(view, locomotor);
  const stopMovementEvents = bindActionCancellation(view, locomotor, 'movement', () => locomotor.stop());
  let animation: ReturnType<typeof animate> | undefined;
  let startPromise: Promise<void> | undefined;
  let disposed = false;
  let preparing = false;
  const preparation = new AbortController();
  const start = (): Promise<void> => {
    if (startPromise) return startPromise;
    startPromise = (async () => {
      if (disposed) throw new Error('Cannot start a disposed scene');
      const { width, height } = view.renderer.domElement.getBoundingClientRect();
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
      camera.getWorldQuaternion(cameraWorldQuaternion);
      setPlayerNormal(cameraWorldQuaternion);
      // Prepare lazy nearby art without advancing brains, physics or game time.
      entities.moonTreeForest.updateNearby(player.position);
      entities.moonTreeForest.setNormals(cameraWorldQuaternion);
      updateCharacterRenderOrder(registry);
      preparing = true;
      try {
        await dstLighting.prewarm(scene, camera, preparation.signal);
      } finally {
        preparing = false;
      }
      if (disposed) throw new Error('Scene disposed while preparing');
      animation = animate(world, camera);
      await animation.ready;
    })();
    return startPromise;
  };
  const disposalEvents = new EventEmitter<DisposalEvents>();
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    player.MiniMapEntity.dispose();
    preparation.abort();
    view.renderer.domElement.removeEventListener('pointerdown', blockDisabledController, true);
    if (player.userData.locomotor === locomotor) delete player.userData.locomotor;
    animation?.stop();
    builder.dispose();
    if (player.userData.components?.builder === builder) delete player.userData.components.builder;
    stopSlipperyWatch.splice(0).forEach(stop => stop());
    removeSlipperyFeet();
    const slipTask = backTasks.indexOf(updateSlipperyFeet);
    if (slipTask >= 0) backTasks.splice(slipTask, 1);
    clockUpdater.flush();
    scheduler.advanceTo(clockUpdater.elapsedSeconds);
    locomotor.stop();
    removeLocomotorInput();
    stopMovementEvents();
    disposalEvents.emit('dispose', undefined);
    for (const [tasks, task] of [[middleTasks, updateBeforePhysics], [backTasks, updateEntities], [backTasks, clockUpdater.update]] as const) {
      const index = tasks.indexOf(task);
      if (index >= 0) tasks.splice(index, 1);
    }
    const releaseResources = () => {
      entities.dispose();
      stopEntityWorld();
      world.dispose();
      disposeTerrain();
      worldState.dispose();
      dstLighting.dispose();
      disposeTextureAssets();
    };
    // compileAsync still polls its materials: retain them until the in-flight
    // batch settles, while aborting all subsequent uploads and scene startup.
    if (preparing) void startPromise?.catch(() => undefined).then(releaseResources);
    else releaseResources();
  };
  return { ...entities, byEntityId: registry.byEntityId, scheduler, weather: worldState.weather,
    getWatchWorldContent: worldState.getWatchWorldContent,
    moon: { SetMoonPhase: worldState.SetMoonPhase },
    getSaveState, disposalEvents, start, dispose };
}

export function scene_add(model:THREE.Object3D){
  scene.add(model)
}

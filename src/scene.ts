import type { ItemEntityRegistry, InventoryStore } from '@dontstarve-web/inventory';
import * as CANNON from 'cannon-es';
import CannonDebugger from 'cannon-es-debugger';
import * as THREE from 'three';
import { setSpriteEntityRenderOrder } from '@dontstarve-web/animation';
import { EventEmitter } from '@dontstarve-web/signals';

import { animate, backTasks, middleTasks } from './animate';
import { createAnimationUpdater } from './animation';
import { ground, turfGround, turfMap } from './building';
import { camera } from './camera';
import { createSceneEntities } from './sceneEntities';
import type { EntityRegistry, EntityRenderEntry } from './entityRegistry';
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
import { GameTimeScheduler } from '@dontstarve-web/prefab/gameTimeScheduler';
import type { PerishWorld } from '../packages/componets/src/perishable';
import { Locomotor, findGroundPath, setupLocomotorInput } from '@dontstarve-web/prefab/locomotor';
import type { DisposalEvents } from './registerDisposal';

export const world = new CANNON.World({
  gravity: new CANNON.Vec3(0, -9.82, 0),
});

export const worldState = createWorldState(initialSave.world);

const groundMaterial = new CANNON.Material('ground');
const groundBody = new CANNON.Body({
  mass: 0,
  shape: new CANNON.Plane(),
  material: groundMaterial,
});
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(groundBody);
world.addBody(playerBody);
scene.background = new THREE.Color(0xbfd1e5);
scene.add(ground, turfGround, player);

const playerRadius = (playerBody.shapes[0] as CANNON.Sphere).radius;
export const locomotor = new Locomotor(playerBody, {
  findPath(start, target) {
    const mapEdge = initialSave.world.map.generator.options.size / 2 - playerRadius;
    const obstacles = world.bodies.filter((body) => body.type === CANNON.Body.STATIC
      && body.collisionResponse
      && (body.collisionFilterMask & playerBody.collisionFilterGroup) !== 0
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
        && !obstacles.some((box) => point.x >= box.minX && point.x <= box.maxX
          && point.z >= box.minZ && point.z <= box.maxZ),
    });
  },
});
const updatePlayerMovement = updateMovement(camera, player, playerBody, locomotor);
const updateAnimation = createAnimationUpdater(player, camera);
const cameraWorldQuaternion = new THREE.Quaternion();
const playerFootPosition = new THREE.Vector3();
const cameraSpaceFootPosition = new THREE.Vector3();

function updateCharacterRenderOrder(registry: EntityRegistry) {
  playerFootPosition.copy(player.position);
  const renderEntries: EntityRenderEntry[] = [
    { object: player, footPosition: playerFootPosition, cameraDepth: 0 },
    ...registry.renderEntities,
  ];
  for (const entry of renderEntries) {
    entry.cameraDepth = cameraSpaceFootPosition
      .copy(entry.footPosition)
      .applyMatrix4(camera.matrixWorldInverse)
      .z;
  }

  // Visible camera-space z values are negative. Sorting ascending therefore
  // draws the farther entity first, then the nearer entity over it.
  renderEntries.sort((a, b) =>
    a.cameraDepth - b.cameraDepth || (a.sortGroup ?? a.object.id) - (b.sortGroup ?? b.object.id)
      || (a.sortLayer ?? 1) - (b.sortLayer ?? 1) || a.object.id - b.object.id
  );
  renderEntries.forEach((entry, index) => {
    setSpriteEntityRenderOrder(entry.object, index);
  });
}

function getVelocity(): number {
  return 16;
}

middleTasks.push((dt: number) => {
  updatePlayerMovement(getVelocity(), dt);
});
middleTasks.push(updateAnimation);

if (!window.location.hostname.endsWith('github.io')) {
  const cannonDebugger = CannonDebugger(scene, world, {
    color: 0x00ff00,
  });
  backTasks.push(() => cannonDebugger.update());
}

export async function startScene(
  consumeBufferedBuild: (buildingId: PlaceableBuildingId, skinId?: string) => boolean,
  onBuildingInteraction?: (change: PlaceableBuildingInteractionChange) => void,
  onFlowerPlanted?: () => void,
  itemEntities?: ItemEntityRegistry,
  inventory?: InventoryStore,
) {
  const blockDisabledController = (event: PointerEvent) => {
    if (player.userData.controllerEnabled !== false) return;
    event.preventDefault(); event.stopImmediatePropagation();
  };
  view.renderer.domElement.addEventListener('pointerdown', blockDisabledController, true);
  player.userData.locomotor = locomotor;
  const clockUpdater = createWorldClockUpdater(worldState, initialSave.world.elapsedSeconds);
  const scheduler = new GameTimeScheduler(clockUpdater.elapsedSeconds);
  const entities = createSceneEntities(world, worldState, consumeBufferedBuild,
    onBuildingInteraction, onFlowerPlanted, itemEntities, inventory, scheduler);
  const { registry } = entities;
  try {
    await registry.restoreAll(initialSave.world.entities);
  } catch (error) {
    view.renderer.domElement.removeEventListener('pointerdown', blockDisabledController, true);
    entities.dispose();
    scheduler.dispose();
    worldState.dispose();
    dstLighting.dispose();
    throw error;
  }
  const updateBeforePhysics = (dt: number) => registry.beforePhysics(dt);
  const perishWorld: PerishWorld = { temperature: () => worldState.worldtemperature.temperature.peek() };
  const updateEntities = (dt: number) => {
    scheduler.advanceTo(clockUpdater.elapsedSeconds);
    // Inventory, container and ground insts share one registry; each settles its own 60-frame batch.
    for (const entity of itemEntities?.values() ?? []) entity.components.perishable.onFrame(dt, perishWorld);
    camera.getWorldQuaternion(cameraWorldQuaternion);
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
      // Physics may place the foot a fraction below the ground while settling.
      playerTransform: { position: [player.position.x, Math.max(0, player.position.y), player.position.z], rotationY: 0 },
    };
  };
  const removeLocomotorInput = setupLocomotorInput(view, locomotor);
  const stopMovementEvents = bindActionCancellation(view, locomotor, 'movement', () => locomotor.stop());
  const stopAnimation = animate(world, camera);
  const disposalEvents = new EventEmitter<DisposalEvents>();
  const dispose = () => {
    view.renderer.domElement.removeEventListener('pointerdown', blockDisabledController, true);
    if (player.userData.locomotor === locomotor) delete player.userData.locomotor;
    stopAnimation();
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
    entities.dispose();
    scheduler.dispose();
    worldState.dispose();
    dstLighting.dispose();
  };
  return { ...entities, byEntityId: registry.byEntityId, scheduler, getSaveState, disposalEvents, dispose };
}

export function scene_add(model:THREE.Object3D){
  scene.add(model)
}

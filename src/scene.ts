import * as CANNON from 'cannon-es';
import CannonDebugger from 'cannon-es-debugger';
import * as THREE from 'three';

import { animate, backTasks, middleTasks } from './animate';
import { createAnimationUpdater } from './animation';
import { boxes, ground, setTreeNormals } from './building';
import { camera } from './camera';
import { GroundItemManager, type GroundItemDefinition } from './groundItems';
import { pig, pigBody, updatePigPosition } from './pig';
import { setupPigInteraction } from './pigInteraction';
import {
  pigKingBody,
  pigKingFloor,
  pigKingStandee,
  setPigKingNormal,
  setupPigKingInteraction,
  updatePigKingAnimation,
} from './pigking';
import { player, playerBody, setPlayerNormal } from './player';
import {
  PlaceableBuildingPlacement,
  type PlaceableBuildingId,
} from './placeableBuilding';
import { renderer, scene } from './universal';
import { updateMovement } from './updatePlayerMovement';

export const world = new CANNON.World({
  gravity: new CANNON.Vec3(0, -9.82, 0),
});

const groundMaterial = new CANNON.Material('ground');
const groundBody = new CANNON.Body({
  mass: 0,
  shape: new CANNON.Plane(),
  material: groundMaterial,
});
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(groundBody);
world.addBody(playerBody);
world.addBody(pigBody);
world.addBody(pigKingBody);

scene.background = new THREE.Color(0xbfd1e5);
scene.add(ground, pigKingFloor, pigKingStandee, player, pig);
scene.add(...boxes);

const updatePigInteraction = setupPigInteraction(camera, renderer, pig, player);
setupPigKingInteraction(camera, renderer);

const updatePlayerMovement = updateMovement(camera, player, playerBody);
const updateAnimation = createAnimationUpdater(player);
const cameraDirection = new THREE.Vector3();

function getVelocity(): number {
  return 16;
}

middleTasks.push((dt: number) => {
  updatePlayerMovement(getVelocity(), dt);
  updatePigPosition();
});
middleTasks.push(updateAnimation);
middleTasks.push(updatePigKingAnimation);

if (!window.location.hostname.endsWith('github.io')) {
  const cannonDebugger = CannonDebugger(scene, world, {
    color: 0x00ff00,
  });
  backTasks.push(() => cannonDebugger.update());
}

backTasks.push(() => {
  camera.getWorldDirection(cameraDirection);
  setPlayerNormal(cameraDirection);
  setPigKingNormal(cameraDirection);
  setTreeNormals(cameraDirection);
  updatePigInteraction();
});

export function startScene(
  consumeBufferedBuild: (buildingId: PlaceableBuildingId) => boolean,
  pickupGroundItem: (item: GroundItemDefinition) => boolean,
) {
  const buildingPlacement = new PlaceableBuildingPlacement(
    scene,
    camera,
    renderer,
    ground,
    player,
    consumeBufferedBuild,
  );
  middleTasks.push((dt: number) => buildingPlacement.update(dt));
  const groundItems = new GroundItemManager(
    scene,
    camera,
    renderer,
    `${import.meta.env.BASE_URL}dst/data/databundles/images.zip`,
    pickupGroundItem,
  );
  animate(world, camera);
  return { buildingPlacement, groundItems };
}

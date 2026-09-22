import * as CANNON from 'cannon-es';
import CannonDebugger from 'cannon-es-debugger';
import * as THREE from 'three';
import { setSpriteEntityRenderOrder } from '@three-roaming/animation';

import { animate, backTasks, middleTasks } from './animate';
import { createAnimationUpdater } from './animation';
import { boxes, ground, setTreeNormals, updateTreeAnimation } from './building';
import { camera } from './camera';
import { GroundItemManager, type GroundItemDefinition } from './groundItems';
import { updatePigPosition } from './pig';
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
// world.addBody(pigBody);
world.addBody(pigKingBody);

scene.background = new THREE.Color(0xbfd1e5);
scene.add(ground, pigKingFloor, pigKingStandee, player);
scene.add(...boxes);

// const updatePigInteraction = setupPigInteraction(camera, renderer, pig, player);
setupPigKingInteraction(camera, renderer);

const updatePlayerMovement = updateMovement(camera, player, playerBody);
const updateAnimation = createAnimationUpdater(player);
const cameraWorldQuaternion = new THREE.Quaternion();
const playerFootPosition = new THREE.Vector3();
const pigKingFootPosition = new THREE.Vector3();
const cameraSpaceFootPosition = new THREE.Vector3();

const characterRenderEntries = [
  { object: player, footPosition: playerFootPosition, cameraDepth: 0 },
  { object: pigKingStandee, footPosition: pigKingFootPosition, cameraDepth: 0 },
];

function updateCharacterRenderOrder() {
  // The player origin follows the bottom of its physics body. Pig King's root
  // is vertically offset to ground its artwork, so its foot point is y = 0.
  playerFootPosition.copy(player.position);
  pigKingFootPosition.set(pigKingStandee.position.x, 0, pigKingStandee.position.z);

  for (const entry of characterRenderEntries) {
    entry.cameraDepth = cameraSpaceFootPosition
      .copy(entry.footPosition)
      .applyMatrix4(camera.matrixWorldInverse)
      .z;
  }

  // Visible camera-space z values are negative. Sorting ascending therefore
  // draws the farther entity first, then the nearer entity over it.
  characterRenderEntries.sort((a, b) =>
    a.cameraDepth - b.cameraDepth || a.object.id - b.object.id
  );
  characterRenderEntries.forEach((entry, index) => {
    setSpriteEntityRenderOrder(entry.object, index);
  });
}

function getVelocity(): number {
  return 16;
}

middleTasks.push((dt: number) => {
  updatePlayerMovement(getVelocity(), dt);
  updatePigPosition();
});
middleTasks.push(updateAnimation);
middleTasks.push(updatePigKingAnimation);
middleTasks.push(updateTreeAnimation);

if (!window.location.hostname.endsWith('github.io')) {
  const cannonDebugger = CannonDebugger(scene, world, {
    color: 0x00ff00,
  });
  backTasks.push(() => cannonDebugger.update());
}

backTasks.push(() => {
  camera.getWorldQuaternion(cameraWorldQuaternion);
  setPlayerNormal(cameraWorldQuaternion);
  setPigKingNormal(cameraWorldQuaternion);
  setTreeNormals(cameraWorldQuaternion);
  updateCharacterRenderOrder();
  // updatePigInteraction();
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
  // Camera updates in the back phase; align placeable billboards afterwards so
  // they use the camera transform from the same rendered frame.
  backTasks.push((dt: number) => buildingPlacement.update(dt));
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

import * as CANNON from 'cannon-es';
import CannonDebugger from 'cannon-es-debugger';
import * as THREE from 'three';
import { setSpriteEntityRenderOrder } from '@three-roaming/animation';

import { animate, backTasks, middleTasks } from './animate';
import { createAnimationUpdater } from './animation';
import { boxes, ground, moonTreeForest, setTreeNormals } from './building';
import { camera } from './camera';
import { GroundItemManager, type GroundItemDefinition } from './groundItems';
import {
  pigKings,
  setPigKingNormal,
  setupPigKingInteraction,
  updatePigKingAnimation,
} from './pigking';
import { player, playerBody, setPlayerNormal } from './player';
import {
  PlaceableBuildingPlacement,
  isPlaceableBuildingId,
  type PlaceableBuildingInteractionChange,
  type PlaceableBuildingId,
} from './placeableBuilding';
import { renderer, scene } from './universal';
import { updateMovement } from './updatePlayerMovement';
import { view } from './view';
import { initialSave } from './save/initialSave';
import { SAVE_CATALOG } from './save/catalog';
import type { ProximityEntity } from '@three-roaming/prefab/proximityEntities';

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
pigKings.forEach((pigKing) => world.addBody(pigKing.body));

scene.background = new THREE.Color(0xbfd1e5);
scene.add(ground, player);
pigKings.forEach((pigKing) => scene.add(pigKing.floor, pigKing.standee));
scene.add(...boxes);

// const updatePigInteraction = setupPigInteraction(camera, renderer, pig, player);
setupPigKingInteraction(view);

const updatePlayerMovement = updateMovement(camera, player, playerBody);
const updateAnimation = createAnimationUpdater(player);
const cameraWorldQuaternion = new THREE.Quaternion();
const playerFootPosition = new THREE.Vector3();
const cameraSpaceFootPosition = new THREE.Vector3();

const characterRenderEntries = [
  { object: player, footPosition: playerFootPosition, cameraDepth: 0 },
  ...pigKings.map((pigKing) => ({
    object: pigKing.standee,
    footPosition: new THREE.Vector3(...pigKing.record.transform.position),
    cameraDepth: 0,
  })),
];

function updateCharacterRenderOrder() {
  // The player origin follows the bottom of its physics body. Pig King's root
  // is vertically offset to ground its artwork, so its foot point is y = 0.
  playerFootPosition.copy(player.position);

  const renderEntries = [
    ...characterRenderEntries,
    ...Array.from(moonTreeForest.activeEntities, (entity) => ({
      object: entity.model!, footPosition: entity.position, cameraDepth: 0,
    })),
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
    a.cameraDepth - b.cameraDepth || a.object.id - b.object.id
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
middleTasks.push(updatePigKingAnimation);

if (!window.location.hostname.endsWith('github.io')) {
  const cannonDebugger = CannonDebugger(scene, world, {
    color: 0x00ff00,
  });
  backTasks.push(() => cannonDebugger.update());
}

backTasks.push((dt) => {
  moonTreeForest.updateNearby(player.position);
  moonTreeForest.update(dt);
  camera.getWorldQuaternion(cameraWorldQuaternion);
  setPlayerNormal(cameraWorldQuaternion);
  setPigKingNormal(cameraWorldQuaternion);
  setTreeNormals(cameraWorldQuaternion);
  updateCharacterRenderOrder();
  // updatePigInteraction();
});

export async function startScene(
  consumeBufferedBuild: (buildingId: PlaceableBuildingId) => boolean,
  pickupGroundItem: (item: GroundItemDefinition) => boolean,
  onBuildingInteraction?: (change: PlaceableBuildingInteractionChange) => void,
) {
  const buildingPlacement = new PlaceableBuildingPlacement(
    view,
    consumeBufferedBuild,
    onBuildingInteraction,
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
  const byEntityId = new Map<string, THREE.Object3D | ProximityEntity>();
  for (const entity of moonTreeForest.entities) byEntityId.set(entity.saveId!, entity);
  for (const pigKing of pigKings) byEntityId.set(pigKing.record.id, pigKing.standee);
  for (const [prefabId, records] of Object.entries(initialSave.world.entities)) {
    for (const record of records) {
      if (isPlaceableBuildingId(prefabId)) {
        byEntityId.set(record.id, await buildingPlacement.spawnFromSave(prefabId, record));
      } else if (prefabId === 'ground_item') {
        const item = record.components.stack!;
        const spec = SAVE_CATALOG.items[item.itemId];
        const skin = item.skinId ? SAVE_CATALOG.skins[item.skinId] : undefined;
        const model = await groundItems.spawnFromSave(record.id, {
          ...item, name: skin?.name ?? spec.name,
          icon: skin?.icon ?? spec.icon, atlas: skin?.atlas ?? spec.atlas,
        }, new THREE.Vector3(...record.transform.position));
        byEntityId.set(record.id, model);
      }
    }
  }
  // Logical tree records stay in the map even when their models are unloaded.
  moonTreeForest.updateNearby(player.position);
  animate(world, camera);
  return { buildingPlacement, groundItems, byEntityId };
}

export function scene_add(model:THREE.Object3D){
  scene.add(model)
}

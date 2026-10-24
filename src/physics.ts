import * as CANNON from 'cannon-es';
import { PhysicsWorld } from '../packages/componets/src/physicsWorld';
import { GROUND_COLLISION_GROUP } from '../packages/prefab/src/standardcomponents';
import { initialSave } from './save/initialSave';
import { createWorldState } from './worldState';

/** The world and its physics exist before the player, whose physics binding registers the player's body here. */
export const worldState = createWorldState(initialSave.world);
export const world = new PhysicsWorld({
  gravity: new CANNON.Vec3(0, -9.82, 0),
}, worldState.tickingarea);

const groundMaterial = new CANNON.Material('ground');
const groundBody = new CANNON.Body({
  mass: 0,
  shape: new CANNON.Plane(),
  material: groundMaterial,
});
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
groundBody.collisionFilterGroup = GROUND_COLLISION_GROUP;
world.addBody(groundBody);

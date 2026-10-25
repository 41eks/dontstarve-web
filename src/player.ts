import { createWilsonPlayerPrefab } from '@dontstarve-web/prefab/player';
import { initialSave } from './save/initialSave';
import { playerStats } from './playerStats';
import { world } from './physics';

const playerPrefab = await createWilsonPlayerPrefab(
  `${import.meta.env.BASE_URL}dst/data/anim`,
  world,
  { sanityPercent: playerStats.sanity.percent },
);
playerPrefab.model.position.set(...initialSave.players.local.transform.position);
playerPrefab.physics.Teleport();

export const player = playerPrefab.model;
/** inst.Physics of the player; the binding keeps `playerBody`. */
export const playerPhysics = playerPrefab.physics;
export const playerBody = playerPrefab.body;
/** Released with the scene, before its world. */
export const playerPhysicsBinding = playerPrefab.physicsBinding;
export const setPlayerNormal = playerPrefab.setNormal;

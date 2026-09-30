import { createWilsonPlayerPrefab } from '@three-roaming/prefab/player';
import * as CANNON from 'cannon-es';
import { initialSave } from './save/initialSave';

const playerPrefab = await createWilsonPlayerPrefab(
  `${import.meta.env.BASE_URL}dst/data/anim`,
);
playerPrefab.model.position.set(...initialSave.players.local.transform.position);
playerPrefab.model.userData.saveRecord = initialSave.players.local;
const playerRadius = (playerPrefab.body.shapes[0] as CANNON.Sphere).radius;
playerPrefab.body.position.set(
  playerPrefab.model.position.x,
  playerPrefab.model.position.y + playerRadius,
  playerPrefab.model.position.z,
);

export const player = playerPrefab.model;
export const playerBody = playerPrefab.body;
export const setPlayerNormal = playerPrefab.setNormal;

import { createWilsonPlayerPrefab } from '@three-roaming/prefab/player';

const playerPrefab = await createWilsonPlayerPrefab(
  `${import.meta.env.BASE_URL}dst/data/anim`,
);

export const player = playerPrefab.model;
export const playerBody = playerPrefab.body;
export const setPlayerNormal = playerPrefab.setNormal;

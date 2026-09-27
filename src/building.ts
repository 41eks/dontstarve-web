// src/building.ts

import { createMoonTreeForest } from '@three-roaming/prefab/moontree';
import { createTurfGround } from '@three-roaming/prefab/turf';

const ground = await createTurfGround({
    assetBaseUrl: `${import.meta.env.BASE_URL}dst/data`,
    noiseTexture: 'Ground_noise_deciduous',
    size: 1000,
});

const moonTreeForest = await createMoonTreeForest(
    `${import.meta.env.BASE_URL}dst/data/anim`,
);

const boxes = [moonTreeForest.group];

export const setTreeNormals = moonTreeForest.setNormals;
export const updateTreeAnimation = moonTreeForest.update;
export { ground, boxes };

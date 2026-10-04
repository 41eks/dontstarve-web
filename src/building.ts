// src/building.ts

import * as THREE from 'three';
import { createMoonTreeForest } from '@three-roaming/prefab/moontree';
import { TILE_SIZE } from '@three-roaming/prefab/tile';
import { createTurfGround } from '@three-roaming/prefab/turf';
import { TurfMap } from '@three-roaming/prefab/turfMap';
import { initialSave } from './save/initialSave';

const ground = await createTurfGround({
    assetBaseUrl: `${import.meta.env.BASE_URL}dst/data`,
    noiseTexture: 'Ground_noise_deciduous',
    tileAtlas: 'DECIDUOUS',
    size: initialSave.world.map.generator.options.size,
});

export const turfMap = new TurfMap(initialSave.world.map.generator.options.size, initialSave.world.map.tiles);
export const turfGround = await turfMap.createVisual(`${import.meta.env.BASE_URL}dst/data`);

export const moonTreeForest = await createMoonTreeForest(
    `${import.meta.env.BASE_URL}dst/data/anim`,
    {
        positions: (initialSave.world.entities.moon_tree ?? []).map(({ transform }) =>
            new THREE.Vector3(...transform.position)),
        entityIds: (initialSave.world.entities.moon_tree ?? []).map(({ id }) => id),
        loadRadius: 10 * TILE_SIZE,
    },
);

export { ground };

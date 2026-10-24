// src/building.ts

import * as THREE from 'three';
import { createMoonTreeForest } from '@dontstarve-web/prefab/moontree';
import { createTurfGround } from '@dontstarve-web/prefab/turf';
import { TurfMap, WORLD_TILES } from '@dontstarve-web/prefab/turfMap';
import { initialSave } from './save/initialSave';

const ground = await createTurfGround({
    assetBaseUrl: `${import.meta.env.BASE_URL}dst/data`,
    noiseTexture: 'Ground_noise_deciduous',
    tileAtlas: 'DECIDUOUS',
    size: initialSave.world.map.generator.options.size,
});

export const turfMap = new TurfMap(initialSave.world.map.generator.options.size, initialSave.world.map.tiles,
    initialSave.world.map.defaultTileId);
// The plane remains a pointer target; local maps draw only their saved land cells.
(ground.material as THREE.Material).visible = turfMap.defaultTileId === WORLD_TILES.DECIDUOUS;
export const turfGround = await turfMap.createVisual(`${import.meta.env.BASE_URL}dst/data`);

export const moonTreeForest = await createMoonTreeForest(
    `${import.meta.env.BASE_URL}dst/data/anim`,
    {
        positions: (initialSave.world.entities.moon_tree ?? []).map(({ transform }) =>
            new THREE.Vector3(...transform.position)),
        entityIds: (initialSave.world.entities.moon_tree ?? []).map(({ id }) => id),
    },
);

export { ground };

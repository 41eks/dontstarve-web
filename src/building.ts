// src/building.ts

import * as THREE from 'three';
import { createTurfGround } from '@dontstarve-web/prefab/turf';
import { Pathfinder } from '@dontstarve-web/prefab/pathfinder';
import { TurfMap, WORLD_TILES } from '@dontstarve-web/prefab/turfMap';
import { GroundDisplay } from '@dontstarve-web/display';
import { initialSave } from './save/initialSave';

const ground = await createTurfGround({
    assetBaseUrl: `${import.meta.env.BASE_URL}dst/data`,
    noiseTexture: 'Ground_noise_deciduous',
    tileAtlas: 'DECIDUOUS',
    size: initialSave.world.map.generator.options.size,
});

export const turfMap = new TurfMap(initialSave.world.map.generator.options.size, initialSave.world.map.tiles,
    initialSave.world.map.defaultTileId);
/** TheWorld.Pathfinder. */
export const pathfinder = new Pathfinder(turfMap);
// The plane remains a pointer target; local maps draw only their saved land cells.
(ground.material as THREE.Material).visible = turfMap.defaultTileId === WORLD_TILES.DECIDUOUS;
export const turfGround = await turfMap.createVisual(`${import.meta.env.BASE_URL}dst/data`);
/** The turf layers turfMap declares; edits redraw only the chunks they reach. */
export const groundDisplay = new GroundDisplay(turfMap, `${import.meta.env.BASE_URL}dst/data`);
await groundDisplay.prepare();

export { ground };
